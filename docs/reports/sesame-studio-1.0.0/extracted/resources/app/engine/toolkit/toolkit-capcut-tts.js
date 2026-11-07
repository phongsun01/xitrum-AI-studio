const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');

function getFfmpegPath() {
  const dirs = [
    path.resolve(__dirname, '..', '..', 'bin', 'ffmpeg.exe'),
    process.resourcesPath && path.join(process.resourcesPath, 'bin', 'ffmpeg.exe')
  ].filter(Boolean);
  for (const p of dirs) {
    if (fs.existsSync(p)) return p;
  }
  return 'ffmpeg';
}

function getFfprobePath() {
  const dirs = [
    path.resolve(__dirname, '..', '..', 'bin', 'ffprobe.exe'),
    process.resourcesPath && path.join(process.resourcesPath, 'bin', 'ffprobe.exe')
  ].filter(Boolean);
  for (const p of dirs) {
    if (fs.existsSync(p)) return p;
  }
  return 'ffprobe';
}

// Danh sách các giọng đọc chuẩn Voice Studio (Tiếng Việt + Đa ngôn ngữ)
const TOOLKIT_FEATURED_VOICES = [
  { id: 'vi-VN-HoaiMyNeural', name: 'Hoài My — Nữ Miền Bắc (Truyền cảm · Review & Ngôn tình)', gender: 'female', lang: 'vi-VN', engine: 'edge', edgeVoice: 'vi-VN-HoaiMyNeural', rateOffset: 0, pitchOffset: '+0Hz' },
  { id: 'vi-VN-NamMinhNeural', name: 'Nam Minh — Nam Miền Bắc (Trầm ấm · Tổng tài & Kể chuyện)', gender: 'male', lang: 'vi-VN', engine: 'edge', edgeVoice: 'vi-VN-NamMinhNeural', rateOffset: 0, pitchOffset: '+0Hz' },
  { id: 'BV562_streaming', name: 'Thanh Mai — Nữ trẻ năng động (Nhịp nhanh · Reels & Shorts)', gender: 'female', lang: 'vi-VN', engine: 'capcut', edgeVoice: 'vi-VN-HoaiMyNeural', rateOffset: 8, pitchOffset: '+2Hz' },
  { id: 'BV560_streaming', name: 'Hải Nam — Nam dứt khoát (Thuyết minh & Tóm tắt phim)', gender: 'male', lang: 'vi-VN', engine: 'capcut', edgeVoice: 'vi-VN-NamMinhNeural', rateOffset: 6, pitchOffset: '-2Hz' },
  { id: 'BV421_vivn_streaming', name: 'Ngọc Linh — Nữ nhẹ nhàng (Đọc truyện đêm khuya)', gender: 'female', lang: 'vi-VN', engine: 'capcut', edgeVoice: 'vi-VN-HoaiMyNeural', rateOffset: -5, pitchOffset: '+1Hz' },
  { id: 'vieneu:Quỳnh Anh', name: 'Quỳnh Anh — VieNeu 48kHz (Nữ chuẩn phòng thu)', gender: 'female', lang: 'vi-VN', engine: 'vieneu', edgeVoice: 'vi-VN-HoaiMyNeural', rateOffset: 0, pitchOffset: '+0Hz' },
  { id: 'vieneu:Hải Đăng', name: 'Hải Đăng — VieNeu 48kHz (Nam chuẩn phòng thu)', gender: 'male', lang: 'vi-VN', engine: 'vieneu', edgeVoice: 'vi-VN-NamMinhNeural', rateOffset: 0, pitchOffset: '+0Hz' },
  { id: 'en-US-AriaNeural', name: 'Aria — Nữ Tiếng Anh Mỹ (Tự nhiên · Quốc tế)', gender: 'female', lang: 'en-US', engine: 'edge', edgeVoice: 'en-US-AriaNeural', rateOffset: 0, pitchOffset: '+0Hz' },
  { id: 'en-US-GuyNeural', name: 'Guy — Nam Tiếng Anh Mỹ (Trầm rõ · Thuyết minh)', gender: 'male', lang: 'en-US', engine: 'edge', edgeVoice: 'en-US-GuyNeural', rateOffset: 0, pitchOffset: '+0Hz' },
  { id: 'zh-CN-XiaoxiaoNeural', name: 'Xiaoxiao — Nữ Tiếng Trung Quan Thoại', gender: 'female', lang: 'zh-CN', engine: 'edge', edgeVoice: 'zh-CN-XiaoxiaoNeural', rateOffset: 0, pitchOffset: '+0Hz' },
  { id: 'zh-CN-YunxiNeural', name: 'Yunxi — Nam Tiếng Trung Quan Thoại', gender: 'male', lang: 'zh-CN', engine: 'edge', edgeVoice: 'zh-CN-YunxiNeural', rateOffset: 0, pitchOffset: '+0Hz' },
  { id: 'ja-JP-NanamiNeural', name: 'Nanami — Nữ Tiếng Nhật', gender: 'female', lang: 'ja-JP', engine: 'edge', edgeVoice: 'ja-JP-NanamiNeural', rateOffset: 0, pitchOffset: '+0Hz' },
  { id: 'ko-KR-SunHiNeural', name: 'SunHi — Nữ Tiếng Hàn', gender: 'female', lang: 'ko-KR', engine: 'edge', edgeVoice: 'ko-KR-SunHiNeural', rateOffset: 0, pitchOffset: '+0Hz' }
];

const NUM_VI = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
function numberToVietnameseWords(n) {
  n = Number(n);
  if (!Number.isFinite(n) || n < 0 || n > 999999) return String(n);
  if (n < 10) return NUM_VI[n];
  const two = (x, full) => {
    const t = Math.floor(x / 10), u = x % 10;
    if (t === 0) return (full ? 'lẻ ' : '') + NUM_VI[u];
    const s = t === 1 ? 'mười' : NUM_VI[t] + ' mươi';
    if (u === 0) return s;
    if (u === 1) return s + (t === 1 ? ' một' : ' mốt');
    if (u === 5) return s + ' lăm';
    return s + ' ' + NUM_VI[u];
  };
  const three = (x, full) => {
    const h = Math.floor(x / 100), r = x % 100;
    if (h === 0) return two(r, full);
    return NUM_VI[h] + ' trăm' + (r === 0 ? '' : ' ' + two(r, true));
  };
  if (n < 100) return two(n, false);
  if (n < 1000) return three(n, false);
  const k = Math.floor(n / 1000), r = n % 1000;
  return three(k, false) + ' nghìn' + (r === 0 ? '' : ' ' + three(r, true));
}

/**
 * Chuẩn hóa văn bản thông minh trước khi đọc (chỉnh dấu câu, nhịp nghỉ, số đếm và văn nói tự nhiên)
 */
function normalizeTextForTts(rawText = '') {
  let text = String(rawText || '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';

  // Bảo toàn các thẻ điều khiển nhịp nghỉ của người dùng
  const savedTags = [];
  text = text.replace(/(\[(?:nghỉ|nhấn mạnh|đọc chậm|đọc nhanh|giọng trầm)[^\]]*\]|<#\d+(?:\.\d+)?#>)/gi, (m) => {
    savedTags.push(m);
    return `__TTS_TAG_${savedTags.length - 1}__`;
  });

  // Chuẩn hóa khoảng trắng và dấu câu
  text = text
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*([,.;:!?…])\s*/g, '$1 ')
    .replace(/\.{3,}/g, '… ')
    .replace(/(\d+)\s*%/g, (_, d) => `${numberToVietnameseWords(d)} phần trăm`)
    .replace(/\b(\d{1,4})\s*(tỷ|triệu|nghìn|ngàn|năm|tháng|ngày|giờ|phút|giây|tập|phần)\b/gi, (_, d, unit) => `${numberToVietnameseWords(d)} ${unit}`);

  // Chuyển các cụm từ văn viết cứng sang văn nói tự nhiên
  const spokenReplacements = [
    [/\bTuy nhiên,/gi, 'Thế nhưng,'],
    [/\bBởi vì\b/gi, 'Vì'],
    [/\bDo đó,/gi, 'Vì vậy,'],
    [/\bKhông những thế,/gi, 'Chưa dừng lại ở đó,'],
    [/\bNgay lập tức,/gi, 'Ngay lúc đó,']
  ];
  for (const [pattern, rep] of spokenReplacements) {
    text = text.replace(pattern, rep);
  }

  // Tách dòng và đảm bảo mỗi câu kết thúc bằng dấu chấm câu rõ ràng để giọng đọc có nhịp nghỉ tự nhiên
  const paragraphs = text
    .split(/\n+/)
    .map(line => {
      let s = line.trim();
      if (!s) return '';
      // Nếu câu dài trên 95 ký tự mà chưa có dấu phẩy/chấm, tự chèn nhịp nghỉ nhẹ trước các từ nối
      if (s.length > 85 && !s.includes(',')) {
        s = s.replace(/\s+(nhưng|mà|khiến|để|nên|rằng|vì)\s+/i, ', $1 ');
      }
      if (!/[.!?…]$/.test(s) && !/__TTS_TAG_\d+__$/.test(s)) {
        s += '.';
      }
      return s;
    })
    .filter(Boolean);

  let finalOut = paragraphs.join('\n');
  finalOut = finalOut.replace(/__TTS_TAG_(\d+)__/g, (_, idx) => savedTags[Number(idx)] || '');
  return finalOut.replace(/ +/g, ' ').trim();
}

/**
 * Đo thời lượng file âm thanh bằng ffprobe
 */
async function probeAudioDuration(audioPath) {
  if (!audioPath || !fs.existsSync(audioPath)) return 0;
  const ffprobe = getFfprobePath();
  return new Promise((resolve) => {
    execFile(
      ffprobe,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', audioPath],
      { windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(0);
        const d = parseFloat(String(stdout || '').trim());
        resolve(Number.isFinite(d) ? Math.round(d * 100) / 100 : 0);
      }
    );
  });
}

/**
 * Tạo âm thanh qua Edge-TTS (hỗ trợ tốc độ rate và cao độ pitch)
 */
async function synthesizeWithEdgeTts(text, voiceName, outPath, opts = {}) {
  const cleanText = String(text || '').trim();
  if (!cleanText) throw new Error('Nội dung câu trống');

  const ratePct = Math.round(((Number(opts.rate) || 1.0) - 1.0) * 100) + (Number(opts.rateOffset) || 0);
  const clampedRate = Math.max(-50, Math.min(100, ratePct));
  const rateStr = (clampedRate >= 0 ? '+' : '') + clampedRate + '%';

  const pitchHz = Number(opts.pitchHz) || 0;
  const clampedPitch = Math.max(-20, Math.min(20, pitchHz));
  const pitchStr = (clampedPitch >= 0 ? '+' : '') + clampedPitch + 'Hz';

  const cfgPath = outPath + '.cfg.json';
  const cliPath = path.resolve(__dirname, '..', 'edge_tts_cli.py');

  return new Promise((resolve, reject) => {
    const pyScript = `
import asyncio, json, sys, edge_tts
with open(sys.argv[1], 'r', encoding='utf-8') as f:
    d = json.load(f)
async def _run():
    comm = edge_tts.Communicate(d['text'], d['voice'], rate=d.get('rate', '+0%'), pitch=d.get('pitch', '+0Hz'))
    await comm.save(d['out'])
asyncio.run(_run())
`;
    // Ghi file JSON cấu hình tạm sạch (utf-8 không BOM)
    const jsonStr = JSON.stringify({
      text: cleanText,
      voice: voiceName || 'vi-VN-HoaiMyNeural',
      rate: rateStr,
      pitch: pitchStr,
      out: outPath
    });
    fs.writeFileSync(cfgPath, Buffer.from(jsonStr, 'utf8'));

    const p = spawn('python', ['-c', pyScript, cfgPath], { windowsHide: true });
    let errText = '';
    p.stderr.on('data', d => { errText += d.toString(); });
    p.on('close', (code) => {
      try { fs.unlinkSync(cfgPath); } catch (_) {}
      if (code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
        resolve({ ok: true, outPath });
      } else {
        if (/No module named ['"]?edge_tts/i.test(errText)) {
          reject(new Error('Máy đã có Python nhưng chưa cài gói edge-tts. Mở Command Prompt và chạy: pip install edge-tts — hoặc đổi nguồn giọng sang Google.'));
        } else {
          reject(new Error(`Edge-TTS lỗi mã ${code}: ${errText.slice(-200)}`));
        }
      }
    });
    p.on('error', (err) => {
      try { fs.unlinkSync(cfgPath); } catch (_) {}
      if (err && err.code === 'ENOENT') reject(new Error('Chưa tìm thấy Python trên máy. Cài Python 3 từ python.org (nhớ tick "Add Python to PATH"), rồi chạy: pip install edge-tts — hoặc đổi nguồn giọng sang Google (không cần Python).'));
      else reject(err);
    });
  });
}

/**
 * Tạo âm thanh qua VieNeu-TTS v3 Turbo
 */
async function synthesizeWithVieNeu(text, voiceName, outPath) {
  const cliScript = path.resolve(__dirname, '..', 'vieneu_tts_cli.py');
  if (!fs.existsSync(cliScript)) {
    throw new Error('Không tìm thấy vieneu_tts_cli.py');
  }
  const payload = JSON.stringify({
    text: text,
    voice: voiceName.replace('vieneu:', ''),
    outPath: outPath
  });

  return new Promise((resolve, reject) => {
    const p = spawn('python', [cliScript, payload], { windowsHide: true });
    p.on('close', (code) => {
      if (code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
        resolve({ ok: true, outPath });
      } else {
        reject(new Error(`VieNeu-TTS lỗi mã ${code}`));
      }
    });
    p.on('error', (err) => {
      if (err && err.code === 'ENOENT') reject(new Error('Chưa tìm thấy Python 3.12 trên máy nên không dùng được giọng VieNeu. Hãy chọn nguồn giọng Google hoặc Edge.'));
      else reject(err);
    });
  });
}

// Trần tăng tốc khi khớp ô SRT (giữ cao độ bằng atempo)
const MAX_FIT_SPEED = 1.45;
// Cắt khoảng lặng đầu/cuối mỗi câu (giữ lại 60ms cho tự nhiên)
const TRIM_EDGE_SILENCE = 'silenceremove=start_periods=1:start_duration=0.02:start_threshold=-45dB:start_silence=0.06,areverse,silenceremove=start_periods=1:start_duration=0.02:start_threshold=-45dB:start_silence=0.06,areverse';

// Nguồn giọng thật (Edge · Google · VieNeu) nằm ở tts-sources.js
let _ttsSources = null;
function ttsSources() {
  if (!_ttsSources) _ttsSources = require('./tts-sources')({ getFfmpegPath, synthesizeWithEdgeTts, probeAudioDuration, TOOLKIT_FEATURED_VOICES });
  return _ttsSources;
}
async function synthesizeVoice(args) { return ttsSources().synthesizeVoice(args); }
function listVoiceCatalog(opts) { return ttsSources().listVoiceCatalog(opts); }
function previewVoice(opts) { return ttsSources().previewVoice(opts); }

function runFfmpeg(args) {
  const ffmpeg = getFfmpegPath();
  return new Promise((resolve) => {
    execFile(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true, maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, error: String(stderr || err.message).trim().split('\n').pop() });
      } else {
        resolve({ ok: true });
      }
    });
  });
}

/**
 * Phân tích văn bản có chứa thẻ [nghỉ 0.5s], [đọc chậm], [đọc nhanh], [nhấn mạnh], [giọng trầm] thành danh sách đơn vị đọc
 */
function parseProseIntoUnits(rawText, defaultPauseSec = 0.25) {
  const tokens = String(rawText || '')
    .replace(/\r\n/g, '\n')
    .split(/(\[nghỉ\s*\d+(?:\.\d+)?s?\]|<#\d+(?:\.\d+)?#>)/gi)
    .map(s => s.trim())
    .filter(Boolean);

  const units = [];
  for (const tok of tokens) {
    const pauseMatch = tok.match(/^\[nghỉ\s*(\d+(?:\.\d+)?)s?\]$/i) || tok.match(/^<#(\d+(?:\.\d+)?)#>$/i);
    if (pauseMatch) {
      const sec = Math.max(0.1, Math.min(5.0, parseFloat(pauseMatch[1]) || 0.5));
      units.push({ type: 'pause', duration: sec });
      continue;
    }

    // Kiểm tra các thẻ sắc thái đầu câu
    let rateMul = 1.0;
    let pitchDelta = 0;
    let cleaned = tok;
    if (/\[đọc chậm\]/i.test(cleaned)) {
      rateMul = 0.88;
      cleaned = cleaned.replace(/\[\/?đọc chậm\]/gi, '');
    }
    if (/\[đọc nhanh\]/i.test(cleaned)) {
      rateMul = 1.15;
      cleaned = cleaned.replace(/\[\/?đọc nhanh\]/gi, '');
    }
    if (/\[giọng trầm\]/i.test(cleaned)) {
      pitchDelta = -4;
      cleaned = cleaned.replace(/\[\/?giọng trầm\]/gi, '');
    }
    if (/\[nhấn mạnh\]/i.test(cleaned)) {
      pitchDelta = 2;
      cleaned = cleaned.replace(/\[\/?nhấn mạnh\]/gi, '');
    }

    // Tách theo dòng và câu
    const sentences = cleaned
      .split(/\n+/)
      .flatMap(line => line.trim().split(/(?<=[.!?…])\s+/))
      .map(s => s.trim())
      .filter(s => /[\p{L}\p{N}]/u.test(s));

    for (let i = 0; i < sentences.length; i++) {
      units.push({
        type: 'speech',
        text: sentences[i],
        rateMul,
        pitchDelta
      });
      if (defaultPauseSec > 0 && i < sentences.length - 1) {
        units.push({ type: 'pause', duration: defaultPauseSec });
      }
    }
  }
  return units;
}

/**
 * Phân tích file SRT hoặc TXT có timecode (00:00:01,000 --> 00:00:03,500)
 */
function parseTimedContent(content = '') {
  const text = String(content || '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  const cues = [];
  // Hỗ trợ cả định dạng dòng đơn: 00:00:01,000 --> 00:00:03,000 | Nội dung
  const pipeLines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const pipeRegex = /^(\d{2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{1,3})\s*\|\s*(.+)$/;
  let matchedPipe = 0;
  for (const line of pipeLines) {
    const m = line.match(pipeRegex);
    if (m) {
      matchedPipe++;
      cues.push({
        index: cues.length + 1,
        startTime: m[1].replace('.', ','),
        endTime: m[2].replace('.', ','),
        startSec: tcToSec(m[1]),
        endSec: tcToSec(m[2]),
        text: m[3].trim()
      });
    }
  }
  if (matchedPipe > 0) return cues;

  // Định dạng SRT chuẩn
  const blocks = text.split(/\n\s*\n/);
  for (const blk of blocks) {
    const lines = blk.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const tcIdx = lines.findIndex(l => l.includes('-->'));
    if (tcIdx === -1) continue;
    const parts = lines[tcIdx].split('-->').map(s => s.trim());
    const body = lines.slice(tcIdx + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (!body) continue;
    cues.push({
      index: cues.length + 1,
      startTime: parts[0],
      endTime: parts[1],
      startSec: tcToSec(parts[0]),
      endSec: tcToSec(parts[1]),
      text: body
    });
  }
  return cues;
}

function tcToSec(tc = '') {
  const clean = String(tc).trim().replace(',', '.');
  const p = clean.split(':');
  if (p.length === 3) {
    return (parseFloat(p[0]) || 0) * 3600 + (parseFloat(p[1]) || 0) * 60 + (parseFloat(p[2]) || 0);
  }
  if (p.length === 2) {
    return (parseFloat(p[0]) || 0) * 60 + (parseFloat(p[1]) || 0);
  }
  return 0;
}

/**
 * Chuyển đổi file WAV 48kHz tổng hợp sang định dạng đầu ra người dùng chọn (WAV / MP3 192kbps / M4A AAC 192kbps)
 */
async function convertToOutputFormat(masterWavPath, finalOutputPath, format = 'mp3') {
  const fmt = String(format || 'mp3').toLowerCase();
  if (fmt === 'wav') {
    const r = await runFfmpeg(['-i', masterWavPath, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', finalOutputPath]);
    return r;
  }
  if (fmt === 'm4a') {
    const r = await runFfmpeg(['-i', masterWavPath, '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '192k', finalOutputPath]);
    return r;
  }
  // Mặc định MP3 192kbps
  return runFfmpeg(['-i', masterWavPath, '-ar', '48000', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k', finalOutputPath]);
}

/**
 * Hàm tổng hợp chính cho trang VOICE STUDIO / Text to Speech (Hỗ trợ cả 3 chế độ: text, txt, file/fit/pro)
 */
async function generateTtsStudio(payload = {}, onProgress = null) {
  const {
    mode = 'text',          // 'text' | 'txt' | 'file'
    readingMode = 'file',   // 'file' (Giữ timeline) | 'fit' (Khớp thời gian tuyệt đối) | 'pro' (Mode Pro đọc liền mạch)
    text = '',
    filePath = '',
    voiceId = 'vi-VN-HoaiMyNeural',
    source: sourceArg = '',
    rate = 1.0,
    pitchHz = 0,
    pauseSec = 0.25,
    format = 'mp3',         // 'wav' | 'mp3' | 'm4a'
    outputDir = ''
  } = payload;

  // Nguồn giọng: ưu tiên giá trị truyền vào; nếu thiếu thì suy ra từ tiền tố của voiceId ("vieneu:", "google:"), còn lại là Edge.
  // (Trước đây thiếu `source` thì "vieneu:..." lặng lẽ chạy bằng Edge.)
  const source = sourceArg || (String(voiceId).startsWith('vieneu:') ? 'vieneu' : String(voiceId).startsWith('google:') ? 'google' : 'edge');
  const ext = ['wav', 'mp3', 'm4a'].includes(String(format).toLowerCase()) ? String(format).toLowerCase() : 'mp3';
  const outRoot = outputDir && fs.existsSync(outputDir) ? outputDir : path.resolve(__dirname, '..', '..', 'output');
  fs.mkdirSync(outRoot, { recursive: true });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sesame-voicestudio-'));
  // VieNeu nạp model mất vài giây mỗi lần → tổng hợp cả lô câu trong 1 lần chạy rồi dùng lại
  const vieneuPre = new Map();
  async function prefetchVieneu(texts) {
    if (source !== 'vieneu') return;
    const uniq = [...new Set(texts.map(t => String(t || '').trim()).filter(Boolean))];
    if (!uniq.length) return;
    const got = await ttsSources().prefetchVieneuBatch(uniq, voiceId, rate, tmpDir);
    got.forEach((p, tx) => vieneuPre.set(tx, p));
  }
  async function synth(args) {
    const key = String(args.text || '').trim();
    if (source === 'vieneu' && vieneuPre.has(key)) { fs.copyFileSync(vieneuPre.get(key), args.outPath); return { ok: true, outPath: args.outPath }; }
    return synthesizeVoice({ ...args, source });
  }
  const cleanup = () => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  };

  try {
    // NHÁNH 1: TỪ FILE CÓ TIMECODE (SRT / TXT TIMECODE) VỚI CHẾ ĐỘ GIỮ TIMELINE HOẶC KHỚP TUYỆT ĐỐI
    if (mode === 'file' && (readingMode === 'file' || readingMode === 'fit')) {
      let rawTimed = text;
      if (filePath && fs.existsSync(filePath)) {
        rawTimed = fs.readFileSync(filePath, 'utf8');
      }
      const cues = parseTimedContent(rawTimed);
      if (cues.length === 0) {
        return { ok: false, error: 'File chưa có mốc thời gian (timecode) hợp lệ. Nếu chỉ có văn bản thuần, hãy chọn chế độ Nhập văn bản hoặc Từ file TXT.' };
      }

      const wavSegments = [];
      const warnings = [];
      if (onProgress && source === 'vieneu') onProgress({ percent: 3, status: 'VieNeu đang nạp model và đọc cả lô câu…' });
      await prefetchVieneu(cues.map(c => c.text));
      for (let i = 0; i < cues.length; i++) {
        const cue = cues[i];
        const pct = Math.round(((i + 1) / cues.length) * 80);
        if (onProgress) {
          onProgress({ percent: pct, status: `Đang tạo giọng câu ${i + 1}/${cues.length}: "${cue.text.slice(0, 42)}..."` });
        }

        const rawMp3 = path.join(tmpDir, `cue_${i}.mp3`);
        const cueWav = path.join(tmpDir, `cue_${i}.wav`);
        await synth({
          text: cue.text,
          voiceId,
          outPath: rawMp3,
          rate: Number(rate) || 1.0,
          pitchHz: Number(pitchHz) || 0
        });

        const slotDur = Math.max(0.5, (cue.endSec || (cue.startSec + 2.5)) - cue.startSec);

        // 1) Cắt khoảng lặng đầu/cuối rồi MỚI đo — đo đúng phần lời thật (trước đây đo cả ~0.9s lặng nên tăng tốc thừa ~15%).
        await runFfmpeg(['-i', rawMp3, '-af', TRIM_EDGE_SILENCE, '-ar', '48000', '-ac', '1', cueWav]);
        let finalWav = cueWav;
        let speechDur = await probeAudioDuration(cueWav);
        let appliedSpeed = 1.0;

        // 2) "Khớp thời gian tuyệt đối": câu dài hơn ô SRT thì tăng tốc (giữ cao độ) trong trần 1.45x, rồi ĐO LẠI sau khi đổi tốc độ.
        if (readingMode === 'fit' && speechDur > slotDur + 0.05) {
          appliedSpeed = Math.min(MAX_FIT_SPEED, Math.max(1.02, speechDur / slotDur));
          const fitWav = path.join(tmpDir, `cue_${i}_fit.wav`);
          await runFfmpeg(['-i', cueWav, '-af', `atempo=${appliedSpeed.toFixed(3)}`, '-ar', '48000', '-ac', '1', fitWav]);
          if (fs.existsSync(fitWav)) { finalWav = fitWav; speechDur = await probeAudioDuration(fitWav); }
        }

        // 3) Báo rõ câu nào vượt ô (không cắt chữ, không giấu): fit = vượt ô dù đã tăng tối đa; giữ timeline = chồng sang câu kế.
        const nextStart = i + 1 < cues.length ? cues[i + 1].startSec : null;
        const limitEnd = readingMode === 'fit' ? (cue.startSec + slotDur) : (nextStart != null ? nextStart : cue.startSec + speechDur);
        const over = (cue.startSec + speechDur) - limitEnd;
        if (over > 0.05) {
          warnings.push({
            cue: i + 1,
            text: cue.text.slice(0, 50),
            overSec: Math.round(over * 100) / 100,
            needSpeed: Math.round((speechDur * appliedSpeed / Math.max(0.3, speechDur - over)) * 100) / 100,
            reason: readingMode === 'fit' ? 'vượt ô SRT dù đã tăng tốc tối đa' : 'chồng sang câu kế'
          });
        }

        wavSegments.push({ path: finalWav, startSec: cue.startSec, endSec: cue.endSec, text: cue.text });
      }

      if (onProgress) onProgress({ percent: 88, status: 'Đang ghép trục thời gian (Timeline Mix) và chuẩn hóa âm lượng...' });

      const masterWav = path.join(tmpDir, 'master_timed.wav');
      const filterInputs = [];
      const filterParts = [];
      wavSegments.forEach((seg, idx) => {
        filterInputs.push('-i', seg.path);
        const delayMs = Math.max(0, Math.round(seg.startSec * 1000));
        filterParts.push(`[${idx}:a]adelay=${delayMs}|${delayMs}[a${idx}]`);
      });
      const mixLabels = wavSegments.map((_, idx) => `[a${idx}]`).join('');
      filterParts.push(`${mixLabels}amix=inputs=${wavSegments.length}:dropout_transition=0:normalize=0,aresample=48000[aout]`);

      const mixRes = await runFfmpeg([
        ...filterInputs,
        '-filter_complex', filterParts.join(';'),
        '-map', '[aout]',
        '-ar', '48000',
        '-ac', '2',
        masterWav
      ]);
      if (!mixRes.ok) {
        return { ok: false, error: 'Lỗi trộn timeline: ' + mixRes.error };
      }

      const stem = filePath ? path.basename(filePath, path.extname(filePath)).replace(/[^\w\u00C0-\u1EF9\-]+/g, '_') : 'Voice_Timeline';
      const finalPath = path.join(outRoot, `${stem}_${readingMode}_${Date.now()}.${ext}`);
      const conv = await convertToOutputFormat(masterWav, finalPath, ext);
      if (!conv.ok) return { ok: false, error: conv.error };

      const duration = await probeAudioDuration(finalPath);
      const sizeKB = Math.round((fs.statSync(finalPath).size / 1024) * 10) / 10;
      if (onProgress) onProgress({ percent: 100, status: `Hoàn tất! Đã xuất ${path.basename(finalPath)} (${duration}s)` });

      return {
        ok: true,
        outputPath: finalPath,
        fileName: path.basename(finalPath),
        format: ext.toUpperCase(),
        duration,
        sizeKB,
        cueCount: cues.length,
        warnings,
        mode,
        readingMode
      };
    }

    // NHÁNH 2: NHẬP VĂN BẢN (text), TỪ FILE TXT (txt), HOẶC MODE PRO ĐỌC LIỀN MẠCH (file + pro)
    let rawProse = text;
    if (mode === 'txt' && filePath && fs.existsSync(filePath)) {
      rawProse = fs.readFileSync(filePath, 'utf8');
    } else if (mode === 'file' && readingMode === 'pro') {
      const srcContent = (filePath && fs.existsSync(filePath)) ? fs.readFileSync(filePath, 'utf8') : text;
      const cues = parseTimedContent(srcContent);
      rawProse = cues.length > 0 ? cues.map(c => c.text).join('\n') : srcContent;
    }

    const effectivePause = mode === 'file' && readingMode === 'pro' ? 0.25 : Math.max(0, Math.min(2.5, Number(pauseSec) || 0.25));
    const units = parseProseIntoUnits(rawProse, effectivePause);
    const speechCount = units.filter(u => u.type === 'speech').length;
    if (speechCount === 0) {
      return { ok: false, error: 'Chưa có nội dung văn bản hợp lệ để chuyển thành giọng nói.' };
    }

    const concatRows = [];
    let speechIdx = 0;
    await prefetchVieneu(units.filter(u => u.type === 'speech').map(u => u.text));

    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.type === 'pause') {
        const silWav = path.join(tmpDir, `sil_${i}.wav`);
        await runFfmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', String(u.duration), silWav]);
        if (fs.existsSync(silWav)) {
          concatRows.push(`file '${silWav.replace(/\\/g, '/')}'`);
        }
        continue;
      }

      speechIdx++;
      const pct = Math.round((speechIdx / speechCount) * 85);
      if (onProgress) {
        onProgress({ percent: pct, status: `Đang tổng hợp câu ${speechIdx}/${speechCount}: "${u.text.slice(0, 45)}..."` });
      }

      const segMp3 = path.join(tmpDir, `seg_${i}.mp3`);
      const segWav = path.join(tmpDir, `seg_${i}.wav`);
      await synth({
        text: u.text,
        voiceId,
        outPath: segMp3,
        rate: (Number(rate) || 1.0) * (u.rateMul || 1.0),
        pitchHz: (Number(pitchHz) || 0) + (u.pitchDelta || 0)
      });

      // Edge/Google chèn ~0.4–0.5s lặng đầu + cuối mỗi câu → "nhịp nghỉ 0.5s" thực tế thành ~1.5s. Cắt lặng 2 đầu để nhịp nghỉ đúng như đã chọn.
      const cRes = await runFfmpeg(['-i', segMp3, '-af', TRIM_EDGE_SILENCE, '-ar', '48000', '-ac', '1', segWav]);
      if (!cRes.ok) {
        return { ok: false, error: `Lỗi xử lý câu ${speechIdx}: ${cRes.error}` };
      }
      concatRows.push(`file '${segWav.replace(/\\/g, '/')}'`);
    }

    if (onProgress) onProgress({ percent: 92, status: 'Đang ghép nối và chuẩn hóa âm lượng (Loudness Mastering)...' });

    const listTxt = path.join(tmpDir, 'concat_list.txt');
    fs.writeFileSync(listTxt, concatRows.join('\n'), 'utf8');
    const masterWav = path.join(tmpDir, 'master_prose.wav');
    const concatRes = await runFfmpeg([
      '-f', 'concat',
      '-safe', '0',
      '-i', listTxt,
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000',
      '-ar', '48000',
      '-ac', '2',
      masterWav
    ]);
    if (!concatRes.ok) {
      return { ok: false, error: 'Lỗi ghép file âm thanh: ' + concatRes.error };
    }

    const stem = filePath
      ? path.basename(filePath, path.extname(filePath)).replace(/[^\w\u00C0-\u1EF9\-]+/g, '_')
      : `Sesame_Voice_${voiceId.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 14)}`;
    const finalPath = path.join(outRoot, `${stem}_${Date.now()}.${ext}`);
    const conv = await convertToOutputFormat(masterWav, finalPath, ext);
    if (!conv.ok) return { ok: false, error: conv.error };

    const duration = await probeAudioDuration(finalPath);
    const sizeKB = Math.round((fs.statSync(finalPath).size / 1024) * 10) / 10;
    if (onProgress) onProgress({ percent: 100, status: `Hoàn tất! Đã tạo giọng đọc ${path.basename(finalPath)} (${duration}s)` });

    return {
      ok: true,
      outputPath: finalPath,
      fileName: path.basename(finalPath),
      format: ext.toUpperCase(),
      duration,
      sizeKB,
      sentenceCount: speechCount,
      mode,
      readingMode
    };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  } finally {
    cleanup();
  }
}

module.exports = {
  TOOLKIT_FEATURED_VOICES,
  normalizeTextForTts,
  parseTimedContent,
  probeAudioDuration,
  synthesizeVoice,
  listVoiceCatalog,
  previewVoice,
  generateTtsStudio
};
