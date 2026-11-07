/**
 * NGUỒN GIỌNG THẬT cho Text to Speech của Sesame Studio:
 *   Edge (online, ~322 giọng) · Google Dịch (online, mỗi ngôn ngữ 1 giọng) · VieNeu (chạy trên máy, tiếng Việt).
 * Không có nguồn giả: nguồn nào chưa dùng được thì catalog báo available=false.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { spawn, execFile } = require('child_process');

module.exports = function createTtsSources(deps) {
  const { getFfmpegPath, synthesizeWithEdgeTts, probeAudioDuration, TOOLKIT_FEATURED_VOICES } = deps;

  const GOOGLE_LANGS = [
    ['vi', 'Tiếng Việt'], ['en', 'English'], ['zh-CN', '中文 (简体)'], ['zh-TW', '中文 (繁體)'], ['ja', '日本語'], ['ko', '한국어'],
    ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['it', 'Italiano'], ['pt', 'Português'], ['ru', 'Русский'],
    ['th', 'ไทย'], ['id', 'Bahasa Indonesia'], ['ms', 'Bahasa Melayu'], ['hi', 'हिन्दी'], ['ar', 'العربية'], ['tr', 'Türkçe'],
    ['nl', 'Nederlands'], ['pl', 'Polski'], ['sv', 'Svenska'], ['uk', 'Українська'], ['km', 'ខ្មែរ'], ['lo', 'ລາວ'], ['fil', 'Filipino'],
    ['cs', 'Čeština'], ['el', 'Ελληνικά'], ['hu', 'Magyar'], ['ro', 'Română'], ['bn', 'বাংলা']
  ];

  function pythonCandidatesForVieneu() {
    const home = os.homedir();
    return [
      path.join(home, '.local', 'bin', 'python3.12.exe'),
      path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
      path.join(home, 'AppData', 'Local', 'Python', 'bin', 'python.exe'),
      path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe')
    ].filter(p => fs.existsSync(p));
  }
  let vieneuReadyCache = null;
  async function isVieneuReady() {
    if (vieneuReadyCache !== null) return vieneuReadyCache;
    for (const py of pythonCandidatesForVieneu()) {
      const ok = await new Promise(resolve => {
        execFile(py, ['-c', 'import importlib.util,sys;sys.exit(0 if importlib.util.find_spec("vieneu") else 1)'], { windowsHide: true, timeout: 15000 }, err => resolve(!err));
      });
      if (ok) { vieneuReadyCache = true; return true; }
    }
    vieneuReadyCache = false;
    return false;
  }

  // ---------- Google Dịch ----------
  function googleFetchMp3(lang, q) {
    return new Promise((resolve, reject) => {
      const url = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=' + encodeURIComponent(lang) + '&q=' + encodeURIComponent(q);
      const req = https.get(url, {
        timeout: 20000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36', 'Referer': 'https://translate.google.com/' }
      }, res => {
        const chunks = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode !== 200 || buf.length < 500) return reject(new Error('Google TTS trả mã ' + res.statusCode + ' (có thể đang bị chặn tạm thời)'));
          resolve(buf);
        });
      });
      req.on('timeout', () => req.destroy(new Error('Google TTS quá thời gian')));
      req.on('error', reject);
    });
  }
  function splitForGoogle(text, max = 170) {
    const pieces = [];
    const sentences = String(text).replace(/\s+/g, ' ').trim().split(/(?<=[.!?…;:。！？])\s+/);
    let cur = '';
    const push = () => { if (cur.trim()) pieces.push(cur.trim()); cur = ''; };
    for (const sen of sentences) {
      if (sen.length > max) {
        push();
        let buf = '';
        for (const w of sen.split(' ')) {
          if ((buf + ' ' + w).trim().length > max) { if (buf) pieces.push(buf.trim()); buf = w; } else buf = (buf + ' ' + w).trim();
        }
        if (buf) pieces.push(buf);
      } else if ((cur + ' ' + sen).trim().length > max) { push(); cur = sen; }
      else cur = (cur + ' ' + sen).trim();
    }
    push();
    return pieces;
  }
  async function synthesizeWithGoogle(text, lang, outPath, rate = 1.0) {
    const parts = splitForGoogle(text);
    if (!parts.length) throw new Error('Nội dung câu trống');
    // Tải từng đoạn vào bộ nhớ, ghép rồi đưa thẳng vào ffmpeg qua stdin (không tạo file tạm).
    const buffers = [];
    for (let i = 0; i < parts.length; i++) {
      let lastErr = null;
      let got = null;
      for (let t = 0; t < 3; t++) {
        try { got = await googleFetchMp3(lang, parts[i]); lastErr = null; break; }
        catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 500 * (t + 1))); }
      }
      if (lastErr) throw lastErr;
      buffers.push(got);
    }
    const tempo = Math.max(0.5, Math.min(2.0, Number(rate) || 1.0));
    const outArgs = [];
    if (Math.abs(tempo - 1) > 0.01) outArgs.push('-af', 'atempo=' + tempo.toFixed(3));
    outArgs.push('-ar', '24000', '-c:a', 'libmp3lame', '-q:a', '4', outPath);
    await ffmpegFromBuffer(Buffer.concat(buffers), outArgs);
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 500) throw new Error('Ghép giọng Google lỗi: không có file kết quả');
    return { ok: true, outPath };
  }
  function ffmpegFromBuffer(buf, outArgs) {
    return new Promise((resolve, reject) => {
      const p = spawn(getFfmpegPath(), ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'mp3', '-i', 'pipe:0', ...outArgs], { windowsHide: true });
      let err = '';
      p.stderr.on('data', d => { err += d.toString(); });
      p.on('error', reject);
      p.stdin.on('error', () => {});
      p.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg mã ' + code + ': ' + err.slice(-200))));
      p.stdin.end(buf);
    });
  }

  // ---------- Edge ----------
  function prettyEdgeName(shortName) {
    const FIX = { HoaiMy: 'Hoài My', NamMinh: 'Nam Minh' };
    const raw = String(shortName).split('-').slice(2).join('-').replace(/Neural$/, '');
    if (FIX[raw]) return FIX[raw];
    return raw.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/-/g, ' ');
  }
  async function loadEdgeVoices(cacheFile) {
    const read = f => { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(j) && j.length ? j : null; } catch (_) { return null; } };
    if (cacheFile && fs.existsSync(cacheFile) && Date.now() - fs.statSync(cacheFile).mtimeMs < 7 * 86400000) {
      const c = read(cacheFile); if (c) return c;
    }
    const dest = cacheFile || path.join(os.tmpdir(), 'sesame-edge-voices.json');
    try {
      await new Promise((resolve, reject) => {
        const py = "import asyncio,json,sys,edge_tts\nv=asyncio.run(edge_tts.list_voices())\nout=[{'id':x['ShortName'],'gender':x.get('Gender',''),'locale':x['Locale'],'localeName':x.get('LocaleName','')} for x in v]\nopen(sys.argv[1],'w',encoding='utf-8').write(json.dumps(out,ensure_ascii=False))";
        const p = spawn('python', ['-c', py, dest], { windowsHide: true });
        let err = '';
        p.stderr.on('data', d => { err += d.toString(); });
        p.on('error', reject);
        p.on('close', code => code === 0 ? resolve() : reject(new Error(err.slice(-200))));
      });
      const c = read(dest); if (c) return c;
    } catch (_) { /* offline → dùng bản cũ hoặc danh sách rút gọn */ }
    const stale = cacheFile && read(cacheFile);
    if (stale) return stale;
    return TOOLKIT_FEATURED_VOICES.filter(v => v.engine === 'edge').map(v => ({ id: v.id, gender: v.gender === 'male' ? 'Male' : 'Female', locale: v.lang, localeName: v.lang }));
  }

  /** Danh mục giọng THẬT + trạng thái từng nguồn. */
  async function listVoiceCatalog({ cacheFile } = {}) {
    const edgeRaw = await loadEdgeVoices(cacheFile);
    const edge = edgeRaw.map(v => ({ source: 'edge', id: v.id, name: prettyEdgeName(v.id), gender: v.gender === 'Male' ? 'm' : 'f', locale: v.locale, localeName: v.localeName }));
    const google = GOOGLE_LANGS.map(([code, label]) => ({ source: 'google', id: 'google:' + code, name: 'Giọng Google', gender: '', locale: code, localeName: label }));
    let vieneu = [];
    try {
      const t = require('../vieneu-tts');
      vieneu = (t.VIENEU_VOICES || []).map(v => ({ source: 'vieneu', id: v.id, name: v.name, gender: v.gender === 'nam' ? 'm' : 'f', locale: 'vi-VN', localeName: 'Vietnamese (Vietnam)' }));
    } catch (_) {}
    const vieneuReady = vieneu.length > 0 && await isVieneuReady();
    const sources = [
      { id: 'edge', name: 'Edge', kind: 'online', available: true, count: edge.length, note: 'Microsoft Edge TTS · cần mạng · chỉnh được tốc độ và cao độ' },
      { id: 'google', name: 'Google', kind: 'online', available: true, count: google.length, note: 'Google Dịch (không chính thức, có thể bị chặn tạm) · mỗi ngôn ngữ 1 giọng · chỉnh được tốc độ, không chỉnh cao độ' },
      { id: 'vieneu', name: 'VieNeu', kind: 'local', available: vieneuReady, count: vieneu.length, note: vieneuReady ? 'Chạy ngay trên máy · chỉ tiếng Việt · 48kHz · mỗi lần nạp model mất vài giây · chỉnh được tốc độ, không chỉnh cao độ' : 'Chưa cài VieNeu (cần Python 3.12 có gói vieneu)' },
      { id: 'piper', name: 'Piper', kind: 'local', available: false, count: 0, note: 'Sesame chưa tích hợp Piper' },
      { id: 'kokoro', name: 'Kokoro', kind: 'local', available: false, count: 0, note: 'Sesame chưa tích hợp Kokoro' },
      { id: 'capcut', name: 'CapCut', kind: 'api', available: false, count: 0, note: 'Sesame chưa nối CapCut TTS' },
      { id: 'fpt', name: 'FPT AI', kind: 'api', available: false, count: 0, note: 'Cần API key — Sesame chưa tích hợp' },
      { id: 'vbee', name: 'Vbee', kind: 'api', available: false, count: 0, note: 'Cần API key — Sesame chưa tích hợp' },
      { id: 'elevenlabs', name: 'ElevenLabs', kind: 'api', available: false, count: 0, note: 'Cần API key — Sesame chưa tích hợp' }
    ];
    return { ok: true, sources, voices: [...edge, ...google, ...vieneu] };
  }

  /** Tạo giọng cho 1 câu theo nguồn (edge | google | vieneu). Không bao giờ tạo tiếng bíp giả. */
  async function synthesizeVoice({ text, voiceId = 'vi-VN-HoaiMyNeural', outPath, rate = 1.0, pitchHz = 0, source = '' }) {
    const cleanText = String(text || '').trim();
    if (!cleanText) throw new Error('Văn bản rỗng');
    const vid = String(voiceId || '');
    const src = source || (vid.startsWith('google:') ? 'google' : vid.startsWith('vieneu:') ? 'vieneu' : 'edge');

    if (src === 'google') {
      const lang = vid.startsWith('google:') ? vid.slice(7) : 'vi';
      return synthesizeWithGoogle(cleanText, lang, outPath, rate);
    }
    if (src === 'vieneu') {
      const t = require('../vieneu-tts');
      await t.synthesizeSpeechToFile(cleanText, outPath, { voice: vid, speed: Math.max(0.9, Math.min(1.2, Number(rate) || 1.0)) });
      return { ok: true, outPath };
    }

    const featured = TOOLKIT_FEATURED_VOICES.find(v => v.id === vid);
    let edgeVoice; let rateOffset = 0;
    if (featured) { edgeVoice = featured.edgeVoice || (featured.gender === 'male' ? 'vi-VN-NamMinhNeural' : 'vi-VN-HoaiMyNeural'); rateOffset = featured.rateOffset || 0; }
    else if (/Neural$/.test(vid) && vid.includes('-')) edgeVoice = vid;
    else edgeVoice = 'vi-VN-HoaiMyNeural';

    const MAX_RETRIES = 5;
    let lastError = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await synthesizeWithEdgeTts(cleanText, edgeVoice, outPath, { rate, rateOffset, pitchHz });
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES - 1) {
          const jitter = Math.floor(Math.random() * 300);
          const delay = Math.min(3000, 400 * Math.pow(1.5, attempt) + jitter);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    throw new Error('TTS thất bại sau ' + MAX_RETRIES + ' lần thử: ' + (lastError ? lastError.message : 'Lỗi không xác định'));
  }

  /** Nghe thử 1 câu mẫu với đúng nguồn/giọng/tốc độ/cao độ đang chọn. */
  async function previewVoice({ source = '', voiceId = '', rate = 1.0, pitchHz = 0, text = '' } = {}) {
    const dir = path.join(os.tmpdir(), 'sesame-tts-preview');
    fs.mkdirSync(dir, { recursive: true });
    const outPath = path.join(dir, 'pv_' + Date.now() + '.mp3');
    try {
      await synthesizeVoice({ text: text || 'Xin chào, đây là giọng đọc thử của Sesame Studio.', voiceId, outPath, rate, pitchHz, source });
      const duration = await probeAudioDuration(outPath);
      return { ok: true, outputPath: outPath, duration };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  }

  /** VieNeu nạp model mất vài giây/lượt → đọc cả lô câu trong 1 lần chạy. Trả Map(câu → file mp3). */
  async function prefetchVieneuBatch(texts, voiceId, rate, outDir) {
    const t = require('../vieneu-tts');
    const items = texts.map((tx, i) => ({ text: tx, voice: voiceId, outPath: path.join(outDir, 'vn_pre_' + i + '.mp3') }));
    await t.synthesizeBatchSpeech(items, { speed: Math.max(0.9, Math.min(1.2, Number(rate) || 1.0)) });
    const out = new Map();
    items.forEach(it => { if (fs.existsSync(it.outPath) && fs.statSync(it.outPath).size > 400) out.set(it.text, it.outPath); });
    return out;
  }

  return { listVoiceCatalog, previewVoice, synthesizeVoice, prefetchVieneuBatch };
};
