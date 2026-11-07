// Tab Lồng tiếng TTS: kịch bản -> từng câu (Edge-TTS) -> ghép + ngắt nghỉ -> WAV 48kHz.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');

const ffmpeg = () => { const p = path.resolve(__dirname, '..', 'bin', 'ffmpeg.exe'); return fs.existsSync(p) ? p : 'ffmpeg'; };
const runFf = (args) => new Promise((res) => execFile(ffmpeg(), ['-y', '-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true, maxBuffer: 1 << 24 }, (e, so, se) => res(e ? { ok: false, error: String(se || e.message).trim().split('\n').pop() } : { ok: true })));

function edgeOnce(text, voice, rate, out, cfg) {
  return new Promise((resolve) => {
    fs.writeFileSync(cfg, JSON.stringify({ text, voice, rate, out }), 'utf8');
    const p = spawn('python', [path.resolve(__dirname, 'edge_tts_cli.py'), cfg], { windowsHide: true });
    let err = ''; p.stderr.on('data', (d) => { err = (err + d).slice(-300); });
    p.on('error', (e) => resolve({ ok: false, error: e.code === 'ENOENT' ? 'Không tìm thấy Python (cần cài Python + gói edge-tts)' : e.message }));
    p.on('close', (c) => resolve(c === 0 && fs.existsSync(out) && fs.statSync(out).size > 0 ? { ok: true } : { ok: false, error: err.split('\n').filter(Boolean).pop() || `mã ${c}` }));
  });
}
async function speak(text, voice, rate, out, cfg) {
  let last = '';
  for (let t = 0; t < 4; t++) {
    const r = await edgeOnce(text, voice, rate, out, cfg);
    if (r.ok) return { ok: true };
    last = r.error; await new Promise((x) => setTimeout(x, 600 * (t + 1)));
  }
  return { ok: false, error: 'Edge-TTS: ' + last };
}

const NUM = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
function numWords(n) {
  n = Number(n); if (!Number.isFinite(n) || n < 0 || n > 999999) return String(n);
  if (n < 10) return NUM[n];
  const two = (x, full) => {
    const t = Math.floor(x / 10), u = x % 10; let s = '';
    if (t === 0) return (full ? 'lẻ ' : '') + NUM[u];
    s = t === 1 ? 'mười' : NUM[t] + ' mươi';
    if (u === 0) return s;
    if (u === 1) return s + (t === 1 ? ' một' : ' mốt');
    if (u === 5) return s + ' lăm';
    return s + ' ' + NUM[u];
  };
  const three = (x, full) => {
    const h = Math.floor(x / 100), r = x % 100;
    if (h === 0) return two(r, full);
    return NUM[h] + ' trăm' + (r === 0 ? '' : ' ' + two(r, true));
  };
  if (n < 100) return two(n, false);
  if (n < 1000) return three(n, false);
  const k = Math.floor(n / 1000), r = n % 1000;
  return three(k, false) + ' nghìn' + (r === 0 ? '' : ' ' + three(r, true));
}
function normalizeNumbers(t) {
  return t.replace(/(\d+)\s*%/g, (_, n) => numWords(n) + ' phần trăm').replace(/\d+/g, (n) => (n.length > 1 && n[0] === '0') ? n.split('').map((d) => NUM[+d]).join(' ') : numWords(n));
}
function splitScript(text) {
  return String(text).replace(/\r/g, '').split(/\n+/).flatMap((line) => line.trim().split(/(?<=[.!?…])\s+/)).map((s) => s.trim()).filter((s) => /[\p{L}\p{N}]/u.test(s));
}

function register({ ipcMain, defaultOutputDir, sendProgress }) {
  ipcMain.handle('feat:tts-voices', () => ([
    { id: 'vi-VN-HoaiMyNeural', name: 'Hoài My — nữ, chuẩn tin tức/review' },
    { id: 'vi-VN-NamMinhNeural', name: 'Nam Minh — nam, review trầm ấm' }
  ]));

  ipcMain.handle('feat:tts-synth', async (_e, p = {}) => {
    const script = String(p.text || '').trim();
    if (!script) return { ok: false, error: 'Chưa có kịch bản' };
    const voice = /^vi-VN-/.test(p.voiceId) ? p.voiceId : 'vi-VN-HoaiMyNeural';
    const pct = Math.round(((Number(p.rate) || 1) - 1) * 100);
    const rate = (pct >= 0 ? '+' : '') + Math.max(-50, Math.min(100, pct)) + '%';
    let lines = splitScript(p.numNorm === false ? script : normalizeNumbers(script));
    if (p.preview) lines = lines.slice(0, 1);
    if (!lines.length) return { ok: false, error: 'Kịch bản không có nội dung đọc được' };
    if (lines.length > 400) return { ok: false, error: 'Kịch bản quá dài (' + lines.length + ' câu, tối đa 400)' };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sesame-tts-'));
    const cleanup = () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} };
    try {
      const pause = Math.max(0, Math.min(2000, Number(p.pauseMs) || 0)) / 1000;
      const parts = [];
      for (let i = 0; i < lines.length; i++) {
        sendProgress && sendProgress('tts', { percent: Math.round(i / lines.length * 90), text: `Đang đọc câu ${i + 1}/${lines.length}` });
        const mp3 = path.join(tmp, `l${i}.mp3`), wav = path.join(tmp, `l${i}.wav`);
        const s = await speak(lines[i], voice, rate, mp3, path.join(tmp, 'cfg.json'));
        if (!s.ok) return { ok: false, error: `Câu ${i + 1}: ${s.error}` };
        const c = await runFf(['-i', mp3, '-ar', '48000', '-ac', '1', wav]);
        if (!c.ok) return { ok: false, error: 'ffmpeg: ' + c.error };
        parts.push(wav);
      }
      const sil = path.join(tmp, 'sil.wav');
      if (pause > 0) await runFf(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', String(pause), sil]);
      const list = path.join(tmp, 'list.txt');
      const rows = []; parts.forEach((w, i) => { rows.push(`file '${w.replace(/\\/g, '/')}'`); if (pause > 0 && i < parts.length - 1) rows.push(`file '${sil.replace(/\\/g, '/')}'`); });
      fs.writeFileSync(list, rows.join('\n'), 'utf8');
      const dir = defaultOutputDir(); fs.mkdirSync(dir, { recursive: true });
      const out = path.join(dir, (p.preview ? 'tts_thu_' : 'tts_') + Date.now() + '.wav');
      const af = p.mastering === false ? [] : ['-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000'];
      const r = await runFf(['-f', 'concat', '-safe', '0', '-i', list, ...af, '-ar', '48000', '-ac', '1', out]);
      if (!r.ok) return { ok: false, error: 'Ghép âm thanh: ' + r.error };
      sendProgress && sendProgress('tts', { percent: 100, text: 'Hoàn tất' });
      return { ok: true, outputPath: out, lines: lines.length };
    } finally { cleanup(); }
  });
}
module.exports = { register, _test: { numWords, normalizeNumbers, splitScript } };