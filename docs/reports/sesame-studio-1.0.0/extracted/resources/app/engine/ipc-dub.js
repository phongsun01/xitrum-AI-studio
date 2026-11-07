// Quy trình lồng tiếng: SRT đã dịch -> lồng tiếng TTS (khớp thời gian) -> trộn âm -> render video.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { h264Args } = require('./h264');
const merge = require('./merge');
const translator = require('./toolkit/toolkit-translator');
const tts = require('./toolkit/toolkit-capcut-tts');

const ffmpegPath = () => merge.resolveBin('ffmpeg');
const ffprobePath = () => merge.resolveBin('ffprobe');

function ff(args, onStderr) {
  return new Promise((resolve) => {
    const p = spawn(ffmpegPath(), args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { const s = d.toString(); err = (err + s).slice(-3000); onStderr && onStderr(s); });
    p.on('error', (e) => resolve({ ok: false, error: e.message }));
    p.on('close', (c) => resolve(c === 0 ? { ok: true } : { ok: false, error: `ffmpeg lỗi (mã ${c}): ${err.split('\n').slice(-4).join(' ').trim()}` }));
  });
}
function probe(file) {
  return new Promise((resolve) => {
    execFile(ffprobePath(), ['-v', 'error', '-show_entries', 'stream=codec_type,duration:format=duration', '-of', 'json', file], { windowsHide: true }, (e, out) => {
      if (e) return resolve({ ok: false, error: e.message });
      try { const j = JSON.parse(out); resolve({ ok: true, hasAudio: (j.streams || []).some(s => s.codec_type === 'audio'), duration: parseFloat(j.format && j.format.duration || 0) }); }
      catch (x) { resolve({ ok: false, error: x.message }); }
    });
  });
}
const tc = (t) => { const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t || ''); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4].padEnd(3, '0')) / 1000 : 0; };
function atempoChain(speed) {
  const parts = []; let s = speed;
  while (s > 2.0) { parts.push('atempo=2.0'); s /= 2.0; }
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  parts.push(`atempo=${s.toFixed(4)}`);
  return parts.join(',');
}
const RES = { '720p': 720, '1080p': 1080, '2k': 1440 };
const vieneuTts = require('./vieneu-tts');

function resolvePythonBin() {
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'python3.12.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Python', 'bin', 'python.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe'),
    'python'
  ];
  return candidates.find(p => p === 'python' || fs.existsSync(p)) || 'python';
}

// Edge-TTS qua file JSON (an toàn với tiếng Việt) + thử lại: dịch vụ Microsoft thỉnh thoảng trả "NoAudioReceived".
function edgeOnce(text, voice, out, cfgFile) {
  return new Promise((resolve) => {
    fs.writeFileSync(cfgFile, JSON.stringify({ text, voice, out }), 'utf8');
    const p = spawn(resolvePythonBin(), [path.resolve(__dirname, 'edge_tts_cli.py'), cfgFile], { windowsHide: true });
    let err = ''; p.stderr.on('data', (d) => { err = (err + d).slice(-300); });
    p.on('error', (e) => resolve({ ok: false, error: e.message }));
    p.on('close', (c) => resolve(c === 0 && fs.existsSync(out) && fs.statSync(out).size > 0 ? { ok: true } : { ok: false, error: err.split('\n').filter(Boolean).pop() || `mã ${c}` }));
  });
}
let customSynth = null;
function setSynth(fn) { customSynth = fn; }

async function speak(text, voiceId, out, tmp) {
  if (typeof customSynth === 'function') {
    return await customSynth({ text, voiceId, outPath: out, tmp });
  }
  if (vieneuTts && vieneuTts.isVieneuVoice(voiceId)) {
    try {
      await vieneuTts.synthesizeSpeechToFile(text, out, { voice: voiceId });
      if (fs.existsSync(out) && fs.statSync(out).size > 0) return;
    } catch (_) {}
  }
  if (/^vi-VN-/.test(voiceId)) {
    let last = '';
    for (let t = 0; t < 4; t++) {
      const r = await edgeOnce(text, voiceId, out, path.join(tmp, 'cfg.json'));
      if (r.ok) return;
      last = r.error;
      await new Promise(r => setTimeout(r, 300 * (t + 1)));
    }
    try {
      await vieneuTts.synthesizeSpeechToFile(text, out, { voice: 'Quỳnh Anh' });
      if (fs.existsSync(out) && fs.statSync(out).size > 0) return;
    } catch (_) {}
    throw new Error('Edge-TTS lỗi: ' + last);
  }
  await tts.synthesizeVoice({ text, voiceId, outPath: out });
}

// Tạo đường âm thanh thuyết minh trên trục thời gian gốc.
// timeSync: nén (tối đa 1.6x) nếu đọc dài hơn khung thoại; nếu vẫn dài thì cắt đúng mốc kết thúc khung (fade-out 80ms).
// Luôn ép âm thanh cuối dài đúng bằng video (videoDuration).
async function buildDub(cues, voiceId, outFile, { timeSync, videoDuration, onProgress } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dub-tts-'));
  const segs = [];
  const failed = [];
  let compressedCount = 0;
  let cutCount = 0;

  try {
    if (typeof customSynth !== 'function' && vieneuTts && vieneuTts.isVieneuVoice(voiceId) && typeof vieneuTts.synthesizeBatchSpeech === 'function') {
      const batchItems = cues.map((c, idx) => ({
        text: String(c.text || '').replace(/\s+/g, ' ').trim(),
        voice: voiceId,
        outPath: path.join(tmp, `c${idx}.mp3`)
      })).filter(it => it.text);
      if (batchItems.length) {
        onProgress && onProgress({ step: 'tts', current: 1, total: cues.length });
        try {
          await vieneuTts.synthesizeBatchSpeech(batchItems);
        } catch (_) {}
      }
    }

    for (let i = 0; i < cues.length; i++) {
      const c = cues[i];
      const text = String(c.text || '').replace(/\s+/g, ' ').trim();
      onProgress && onProgress({ step: 'tts', current: i + 1, total: cues.length });
      if (!text) continue;
      const seg = path.join(tmp, `c${i}.mp3`);
      if (!fs.existsSync(seg) || fs.statSync(seg).size < 400) {
        try {
          await speak(text, voiceId, seg, tmp);
        } catch (e) {
          failed.push(`Câu ${i + 1}: ${e.message}`);
          continue;
        }
      }
      const start = tc(c.startTime);
      const next = cues[i + 1] ? tc(cues[i + 1].startTime) : (videoDuration ? videoDuration : start + 8);
      let tempo = 1;
      let cutSlot = 0;
      if (timeSync) {
        const pr = await probe(seg);
        const slot = Math.max(0.4, Math.min(tc(c.endTime) - start || 0.4, next - start));
        if (pr.ok && pr.duration > slot) {
          tempo = Math.min(1.6, pr.duration / slot);
          if (tempo > 1.01) compressedCount++;
          const effDur = pr.duration / tempo;
          if (effDur > slot + 0.05) {
            cutCount++;
            cutSlot = slot;
          }
        }
      }
      segs.push({ file: seg, start, tempo, cutSlot });
    }

    if (!segs.length) {
      return {
        ok: false,
        error: failed.length
          ? ('Không tạo được giọng đọc cho ' + failed.length + ' câu: ' + failed.join('; '))
          : 'Không có câu nào để đọc. Kiểm tra phụ đề.'
      };
    }
    if (failed.length) {
      return {
        ok: false,
        error: 'Không tạo được giọng đọc cho ' + failed.length + ' câu: ' + failed.join('; ')
      };
    }

    const inputs = [];
    const fc = [];
    segs.forEach((s, k) => {
      inputs.push('-i', s.file);
      const d = Math.round(s.start * 1000);
      let filter = '';
      if (s.tempo > 1.01) filter += atempoChain(s.tempo) + ',';
      if (s.cutSlot > 0) {
        const fadeSt = Math.max(0, s.cutSlot - 0.08).toFixed(3);
        filter += `atrim=0:${s.cutSlot.toFixed(3)},afade=t=out:st=${fadeSt}:d=0.08,asetpts=PTS-STARTPTS,`;
      }
      filter += `adelay=${d}|${d}[a${k}]`;
      fc.push(`[${k}:a]${filter}`);
    });

    let tailFilter = '';
    if (typeof videoDuration === 'number' && videoDuration > 0) {
      tailFilter = `,atrim=0:${videoDuration.toFixed(3)}`;
    }
    fc.push(`${segs.map((_, k) => `[a${k}]`).join('')}amix=inputs=${segs.length}:dropout_transition=0:normalize=0${tailFilter}[out]`);
    const r = await ff(['-y', ...inputs, '-filter_complex', fc.join(';'), '-map', '[out]', '-c:a', 'pcm_s16le', outFile]);
    return r.ok
      ? { ok: true, count: segs.length, failed: 0, compressed: compressedCount, cut: cutCount }
      : r;
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }
}

function register({ ipcMain, defaultOutputDir, sendProgress }) {
  ipcMain.handle('feat:voices', () => tts.TOOLKIT_FEATURED_VOICES);

  ipcMain.handle('feat:dub-run', async (_e, p = {}) => {
    const { videoPath, dub = true, burnSub = true, timeSync = true } = p;
    const voiceId = p.voice || p.voiceId || 'vi-VN-HoaiMyNeural';
    let rawCues = Array.isArray(p.cues) ? p.cues : [];
    if (!rawCues.length && p.srtPath && fs.existsSync(p.srtPath)) {
      try {
        rawCues = translator.parseSrt(fs.readFileSync(p.srtPath, 'utf8').replace(/^\uFEFF/, ''));
      } catch (_) {}
    }
    const cues = rawCues.map((c, idx) => ({
      index: c.index || idx + 1,
      startTime: c.startTime || c.start || '00:00:00,500',
      endTime: c.endTime || c.end || '00:00:02,500',
      text: c.trans || c.translatedText || c.text || c.orig || ''
    })).filter(c => String(c.text || '').trim());
    const origVol = Math.max(0, Math.min(1, (+p.origVol || 0) / 100));
    const dubVol = Math.max(0, Math.min(3, (p.dubVol == null ? 100 : +p.dubVol) / 100));
    const speed = Math.max(0.5, Math.min(2, +p.speed || 1));
    if (!videoPath || !fs.existsSync(videoPath)) return { ok: false, error: 'Chưa chọn video hoặc file không tồn tại' };
    if (!cues.length && (dub || burnSub)) return { ok: false, error: 'Chưa có phụ đề. Hãy nhập SRT (và bấm Dịch nếu cần) trước khi xử lý.' };
    const info = await probe(videoPath); if (!info.ok) return { ok: false, error: 'Không đọc được video: ' + info.error };
    const prog = (o) => sendProgress && sendProgress('dub', o);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dub-'));
    try {
      const srtFile = path.join(tmp, 'sub.srt'); fs.writeFileSync(srtFile, translator.cuesToSrt(cues), 'utf8');
      let dubFile = '';
      let dubStats = { compressed: 0, cut: 0 };
      if (dub) {
        dubFile = path.join(tmp, 'dub.wav');
        const d = await buildDub(cues, voiceId, dubFile, {
          timeSync,
          videoDuration: info.duration || 0,
          onProgress: (o) => prog({ ...o, text: `Đang lồng tiếng ${o.current}/${o.total}` })
        });
        if (!d.ok) return d;
        dubStats = { compressed: d.compressed || 0, cut: d.cut || 0 };
        if (dubStats.compressed || dubStats.cut) {
          prog({ step: 'warn', text: `${dubStats.compressed} câu bị nén, ${dubStats.cut} câu bị cắt cho vừa khung thoại` });
        }
      }
      prog({ step: 'render', text: 'Đang xuất video…' });
      const vf = [];
      if (p.mirror) vf.push('hflip');
      if (burnSub && cues.length) {
        const esc = srtFile.replace(/\\/g, '/').replace(/:/g, '\\:');
        vf.push(`subtitles='${esc}':force_style='FontName=Arial,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=30'`);
      }
      if (RES[p.res]) vf.push(`scale=-2:${RES[p.res]}`);
      if (speed !== 1) vf.push(`setpts=PTS/${speed}`);
      const args = ['-y', '-i', videoPath]; const fc = [`[0:v]${vf.length ? vf.join(',') : 'null'}[v]`];
      const post = speed !== 1 ? ',' + atempoChain(speed) : '';
      if (dubFile) args.push('-i', dubFile);
      if (dubFile && info.hasAudio) fc.push(`[0:a]volume=${origVol}[o];[1:a]volume=${dubVol}[d];[o][d]amix=inputs=2:duration=longest:normalize=0${post}[a]`);
      else if (dubFile) fc.push(`[1:a]volume=${dubVol}${post}[a]`);
      else if (info.hasAudio) fc.push(`[0:a]volume=${origVol || 1}${post}[a]`);
      const outFile = p.outputPath || path.join(defaultOutputDir(), `LongTieng_${path.basename(videoPath).replace(/\.[^.]+$/, '')}_${Date.now()}.mp4`);
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      args.push('-filter_complex', fc.join(';'), '-map', '[v]');
      if (fc.some(x => x.endsWith('[a]'))) args.push('-map', '[a]', '-c:a', 'aac', '-b:a', '192k');
      args.push(...h264Args(ffmpegPath(), { crf: 19, bitrate: '6000k' }), '-movflags', '+faststart', outFile);
      const total = (info.duration || 1) / speed;
      const r = await ff(args, (s) => { const m = /time=(\d+):(\d+):(\d+\.?\d*)/.exec(s); if (m) prog({ step: 'render', percent: Math.min(99, Math.round(((+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3])) / total * 100)) }); });
      if (!r.ok) return r;
      prog({ step: 'done', percent: 100, text: 'Hoàn tất' });
      return { ok: true, outputPath: outFile, compressed: dubStats.compressed, cut: dubStats.cut };
    } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} }
  });
}

module.exports = { register, buildDub, atempoChain, setSynth, speak, probe, ff };
