/**
 * VIENEU-TTS V3 TURBO (48kHz) ENGINE FOR Sesame Studio
 * Lồng giọng đọc AI truyền cảm 48kHz chạy trực tiếp trên máy (ONNX / vieneu_tts_cli.py)
 * Hỗ trợ 9 giọng kể chuyện & thuyết minh:
 *   Quỳnh Anh, Mỹ Duyên, Ngọc Linh, Thục Đoan, Ngọc Huyền, Kim Thanh, Thiện Minh, Đức Trí, Hải Đăng
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');
const merger = require('./merge');
const { h264Args } = require('./h264');

const VIENEU_VOICES = [
  { id: 'vieneu:Quỳnh Anh', name: 'Quỳnh Anh', gender: 'nữ', label: 'Quỳnh Anh (48kHz) — Nữ · truyền cảm, ngôn tình / hiện đại' },
  { id: 'vieneu:Mỹ Duyên', name: 'Mỹ Duyên', gender: 'nữ', label: 'Mỹ Duyên (48kHz) — Nữ · miền Nam, ngọt ngào, cảm xúc' },
  { id: 'vieneu:Ngọc Linh', name: 'Ngọc Linh', gender: 'nữ', label: 'Ngọc Linh (48kHz) — Nữ · sâu lắng, kể chuyện đêm khuya' },
  { id: 'vieneu:Thục Đoan', name: 'Thục Đoan', gender: 'nữ', label: 'Thục Đoan (48kHz) — Nữ · thanh lịch, cổ trang / cung đấu' },
  { id: 'vieneu:Ngọc Huyền', name: 'Ngọc Huyền', gender: 'nữ', label: 'Ngọc Huyền (48kHz) — Nữ · tự nhiên, ấm áp, đời thường' },
  { id: 'vieneu:Kim Thanh', name: 'Kim Thanh', gender: 'nữ', label: 'Kim Thanh (48kHz) — Nữ · sắc sảo, review / chốt đơn' },
  { id: 'vieneu:Thiện Minh', name: 'Thiện Minh', gender: 'nam', label: 'Thiện Minh (48kHz) — Nam · trầm ấm, tổng tài / thuyết minh' },
  { id: 'vieneu:Đức Trí', name: 'Đức Trí', gender: 'nam', label: 'Đức Trí (48kHz) — Nam · đĩnh đạc, kịch tính, điểm tin' },
  { id: 'vieneu:Hải Đăng', name: 'Hải Đăng', gender: 'nam', label: 'Hải Đăng (48kHz) — Nam · miền Nam, hào sảng, năng động' }
];

const VIENEU_NAME_SET = new Set(VIENEU_VOICES.map(v => v.name.toLowerCase()));

function isVieneuVoice(voice = '') {
  const raw = String(voice || '').trim();
  if (!raw) return false;
  if (raw.toLowerCase().startsWith('vieneu:')) return true;
  return VIENEU_NAME_SET.has(raw.toLowerCase());
}

function cleanVieneuVoiceName(voice = '') {
  const raw = String(voice || '').trim();
  if (!raw) return 'Quỳnh Anh';
  const stripped = raw.replace(/^vieneu:/i, '').trim();
  const hit = VIENEU_VOICES.find(v => v.name.toLowerCase() === stripped.toLowerCase());
  return hit ? hit.name : (stripped || 'Quỳnh Anh');
}

function resolvePython312Bin() {
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'python3.12.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Python', 'bin', 'python.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe'),
    'python'
  ];
  return candidates.find(p => p === 'python' || fs.existsSync(p)) || 'python';
}

function resolveFfmpegBin(name = 'ffmpeg') {
  const isMac = process.platform === 'darwin';
  const exe = isMac ? name : `${name}.exe`;
  const candidates = [
    path.join('C:\\tools\\ffmpeg\\ffmpeg-9.0.2-full_build\\bin', exe),
    process.resourcesPath && path.join(process.resourcesPath, 'bin', exe),
    path.join(__dirname, '..', 'bin', exe),
    merger.resolveBin ? merger.resolveBin(name) : ''
  ].filter(Boolean);
  return candidates.find(p => fs.existsSync(p)) || name;
}

function runFfmpeg(args, { timeoutMs = 300000 } = {}) {
  const ffmpeg = resolveFfmpegBin('ffmpeg');
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, ['-nostdin', '-y', ...args]);
    let stderr = '';
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) {}
      reject(new Error('FFmpeg timeout'));
    }, timeoutMs);
    proc.stderr.on('data', d => { stderr = (stderr + String(d)).slice(-3000); });
    proc.on('error', e => { clearTimeout(timer); reject(e); });
    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(stderr.trim().split('\n').slice(-2).join(' ') || `FFmpeg lỗi ${code}`));
      }
      resolve({ ok: true });
    });
  });
}

function probeDuration(filePath) {
  const ffprobe = resolveFfmpegBin('ffprobe');
  return new Promise(resolve => {
    if (!filePath || !fs.existsSync(filePath)) return resolve(0);
    execFile(ffprobe, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      filePath
    ], { timeout: 10000 }, (err, out) => {
      if (err) return resolve(0);
      const n = parseFloat(String(out || '').trim());
      resolve(Number.isFinite(n) && n > 0 ? n : 0);
    });
  });
}

function probeHasAudio(filePath) {
  const ffprobe = resolveFfmpegBin('ffprobe');
  return new Promise(resolve => {
    if (!filePath || !fs.existsSync(filePath)) return resolve(false);
    execFile(ffprobe, [
      '-v', 'error',
      '-select_streams', 'a',
      '-show_entries', 'stream=index',
      '-of', 'csv=p=0',
      filePath
    ], { timeout: 10000 }, (err, out) => {
      resolve(!err && String(out || '').trim() !== '');
    });
  });
}

// Chạy vieneu_tts_cli.py. Thử offline từ cache trước (nhanh, không phụ thuộc mạng), lỗi thì thử lại bình thường.
// Lỗi luôn kèm phần cuối stderr để biết nguyên nhân thật.
function runVieneuCliOnce(py, script, payload, extraEnv) {
  return new Promise((resolve, reject) => {
    execFile(py, [script, payload], {
      timeout: 240000, windowsHide: true, maxBuffer: 1 << 24,
      env: { ...process.env, PYTHONUTF8: '1', HF_HUB_DISABLE_SYMLINKS_WARNING: '1', ...extraEnv }
    }, (err, _stdout, stderr) => {
      if (!err) return resolve();
      const tail = String(stderr || '').trim().split('\n').slice(-6).join(' | ');
      reject(new Error('VieNeu-TTS lỗi (' + (err.killed ? 'quá thời gian' : 'exit ' + (err.code ?? '?')) + '): ' + (tail || err.message)));
    });
  });
}
async function runVieneuCli(py, script, payload) {
  try { await runVieneuCliOnce(py, script, payload, { HF_HUB_OFFLINE: '1' }); }
  catch (e1) {
    try { await runVieneuCliOnce(py, script, payload, {}); }
    catch (e2) { throw new Error(e2.message + ' [thử offline trước đó: ' + e1.message.slice(0, 200) + ']'); }
  }
}

/**
 * Tổng hợp hàng loạt câu thoại tiếng Việt bằng VieNeu-TTS v3 Turbo (48kHz) chỉ trong 1 lần nạp model ONNX
 */
async function synthesizeBatchSpeech(items = [], { speed = 1.03 } = {}) {
  if (!Array.isArray(items) || !items.length) return [];
  const cliScript = path.join(__dirname, 'vieneu_tts_cli.py');
  const py312 = resolvePython312Bin();
  const tempDir = path.dirname(items[0].outPath);
  fs.mkdirSync(tempDir, { recursive: true });

  const rawItems = items.map((it, idx) => ({
    text: String(it.text || '').replace(/\s+/g, ' ').trim(),
    voice: cleanVieneuVoiceName(it.voice),
    rawWav: path.join(tempDir, `sesame_vieneu_raw_${Date.now()}_${idx}.wav`),
    finalPath: it.outPath
  }));

  const payloadFile = path.join(tempDir, `sesame_vieneu_batch_${Date.now()}.json`);
  fs.writeFileSync(payloadFile, JSON.stringify({
    items: rawItems.map(r => ({ text: r.text, voice: r.voice, outPath: r.rawWav }))
  }), 'utf8');

  try {
    await runVieneuCli(py312, cliScript, payloadFile);

    const atempo = Math.max(0.90, Math.min(1.20, Number(speed) || 1.03)).toFixed(2);
    for (const r of rawItems) {
      if (fs.existsSync(r.rawWav) && fs.statSync(r.rawWav).size > 800) {
        const isWavOut = /\.wav$/i.test(r.finalPath);
        await runFfmpeg([
          '-i', r.rawWav,
          '-af', `silenceremove=start_periods=1:start_silence=0.03:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_silence=0.06:start_threshold=-45dB,areverse,atempo=${atempo}`,
          '-ar', '48000',
          ...(isWavOut ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'libmp3lame', '-q:a', '1']),
          r.finalPath
        ]);
        try { fs.unlinkSync(r.rawWav); } catch (_) {}
      }
    }
  } finally {
    try { if (fs.existsSync(payloadFile)) fs.unlinkSync(payloadFile); } catch (_) {}
    for (const r of rawItems) {
      try { if (fs.existsSync(r.rawWav)) fs.unlinkSync(r.rawWav); } catch (_) {}
    }
  }
  return items.map(i => i.outPath);
}

/**
 * Tổng hợp 1 đoạn văn bản thành file âm thanh 48kHz bằng VieNeu-TTS v3 Turbo
 */
async function synthesizeSpeechToFile(text, outPath, { voice = 'Quỳnh Anh', speed = 1.03 } = {}) {
  const cleanText = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleanText) throw new Error('Nội dung đọc trống');
  await synthesizeBatchSpeech([{ text: cleanText, voice, outPath }], { speed });
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 400) {
    throw new Error('Không tạo được file âm thanh VieNeu-TTS 48kHz');
  }
  return outPath;
}

/**
 * Làm sạch câu mô tả cảnh thành lời đọc tự nhiên nếu người dùng không nhập riêng trường voiceover
 */
function extractCleanNarrationFromScene(sc = {}) {
  if (sc.voiceover && String(sc.voiceover).trim()) {
    return String(sc.voiceover).replace(/^["'“”]+|["'“”]+$/g, '').trim();
  }
  let raw = String(sc.narration || sc.content || sc.text || '').trim();
  if (!raw) return '';
  // Bỏ tiền tố "Từ ảnh sản phẩm đính kèm:", "0-10s:", "Cảnh 1:", "Hình:"
  raw = raw
    .replace(/^Từ ảnh sản phẩm đính kèm\s*:\s*/i, '')
    .replace(/^\d+\s*[-–]\s*\d+\s*s\s*:\s*/i, '')
    .replace(/^(?:Cảnh|Scene)\s*\d+\s*(?:\([^)]*\))?\s*:\s*/i, '')
    .replace(/^Hình\s*:\s*/i, '')
    .trim();
  // Nếu có phần "Lời: ..." trong câu thì ưu tiên lấy phần sau "Lời:"
  const mLoi = raw.match(/(?:Lời|Thoại|Voiceover| đọc)\s*:\s*["“]?([^"”\n]+)["”]?/i);
  if (mLoi && mLoi[1].trim()) {
    return mLoi[1].trim();
  }
  return raw;
}

/**
 * Nghe thử giọng đọc VieNeu-TTS v3 Turbo (48kHz) — có cache trong thư mục tạm để lần bấm thứ 2 phát tức thì
 */
async function previewVieneuVoice({ voice = 'Quỳnh Anh', text = '' } = {}) {
  const voiceName = cleanVieneuVoiceName(voice);
  const sampleText = String(text || '').trim() ||
    `Xin chào, đây là giọng đọc ${voiceName} trên Sesame Studio Studio, sử dụng mô hình VieNeu TTS v3 Turbo chất lượng cao bốn mươi tám kilohertz.`;
  const hash = Buffer.from(`${voiceName}::${sampleText}`).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  const cacheDir = path.join(os.tmpdir(), 'sesame_vieneu_previews');
  fs.mkdirSync(cacheDir, { recursive: true });
  const outPath = path.join(cacheDir, `preview_${voiceName.replace(/\s+/g, '_')}_${hash}.mp3`);

  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 800) {
    await synthesizeSpeechToFile(sampleText, outPath, { voice: voiceName, speed: 1.03 });
  }
  return { success: true, voice: voiceName, path: outPath };
}

function assTime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.floor((s - Math.floor(s)) * 100);
  return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function escapeAssText(str) {
  return String(str || '')
    .replace(/\\/g, '/')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\r?\n/g, '\\N')
    .trim();
}

function formatCinemaSubtitleLine(rawText, durationSec = 3.5, styleMode = 'storytelling') {
  const clean = escapeAssText(rawText)
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const words = clean.split(' ').filter(Boolean);
  if (!words.length) return '';

  const mid = words.length > 6 ? Math.ceil(words.length / 2) : words.length;

  if (styleMode === 'karaoke') {
    const totalCs = Math.max(80, Math.round(durationSec * 100));
    const totalChars = Math.max(1, words.reduce((s, w) => s + w.length, 0));
    return words.map((w, idx) => {
      const cs = Math.max(8, Math.round((w.length / totalChars) * totalCs));
      const brk = (idx + 1 === mid && words.length > 6) ? '\\N' : (idx < words.length - 1 ? ' ' : '');
      return `{\\kf${cs}}${w}${brk}`;
    }).join('');
  }

  // Mặc định: Phụ đề Kể chuyện 2 dòng cân đối + Nhấn màu Vàng Kim (#FFD400) theo nghĩa:
  // số/phần trăm, tên riêng (viết hoa giữa câu), từ cảm xúc/ngoặt. Không có thì nhấn cụm cuối câu như cũ.
  const EMPH = /^(không|chưa|mãi|hối|hận|sững|sờ|điên|cuồng|chết|máu|phản|bội|bí|mật|đau|yêu|ghét|nghẹn|ngào|khóc|tuyệt|vọng)$/i;
  const semantic = words.map((w, idx) => /\d/.test(w) || (idx > 0 && /^\p{Lu}\p{Ll}+/u.test(w) && !/[.!?…]$/.test(words[idx - 1])) || (EMPH.test(w.replace(/[^\p{L}]/gu, ''))));
  const semCount = semantic.filter(Boolean).length;
  const useSemantic = semCount > 0 && semCount <= Math.ceil(words.length / 2);
  const hlStart = (!useSemantic && words.length >= 4) ? Math.max(1, words.length - 2) : -1;

  return words.map((w, idx) => {
    const isHighlight = useSemantic ? semantic[idx] : (hlStart >= 0 && idx >= hlStart);
    const formatted = isHighlight
      ? `{\\c&H0000D4FF&\\t(0,180,\\fscx108\\fscy108)\\t(180,360,\\fscx100\\fscy100)}${w}{\\c&H00FFFFFF&}`
      : w;
    const brk = (idx + 1 === mid && words.length > 6) ? '\\N' : (idx < words.length - 1 ? ' ' : '');
    return `${formatted}${brk}`;
  }).join('');
}

function buildCinemaAssFile(timedSubtitles = [], assPath, { styleMode = 'storytelling' } = {}) {
  const playResX = 1080;
  const playResY = 1920;
  const marginV = 275;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 1
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Primary,Arial,46,&H00FFFFFF,&H0000D4FF,&H00080808,&H96000000,-1,0,0,0,100,100,0.5,0,1,4.2,2.2,2,65,65,${marginV},1
Style: Karaoke,Arial,48,&H0000D4FF,&H00FFFFFF,&H00080808,&H96000000,-1,0,0,0,100,100,0.6,0,1,4.4,2.4,2,65,65,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const events = [];
  for (const item of timedSubtitles) {
    const st = assTime(item.start);
    const et = assTime(item.end);
    const dur = Math.max(1.2, (item.end || 0) - (item.start || 0));
    const formatted = formatCinemaSubtitleLine(item.text, dur, styleMode);
    if (!formatted) continue;
    const styleName = styleMode === 'karaoke' ? 'Karaoke' : 'Primary';
    events.push(`Dialogue: 2,${st},${et},${styleName},,0,0,0,,{\\fad(120,120)}${formatted}`);
  }

  fs.writeFileSync(assPath, header + events.join('\n') + '\n', 'utf8');
  return assPath;
}

/**
 * Lồng tiếng VieNeu-TTS v3 Turbo (48kHz) vào file video MP4 đã render xong
 * Hỗ trợ:
 *  - Lồng theo danh sách từng cảnh (scenes) căn chỉnh theo mốc thời gian hoặc nối liền mạch
 *  - Hoặc lồng theo 1 đoạn văn bản thuyết minh (text)
 *  - Tự động đóng phụ đề điện ảnh 2 dòng cân đối + tô vàng từ khóa cao trào (burnSubtitles = true)
 *  - Chuẩn hóa âm lượng phát sóng (-15 LUFS) và giữ tiếng môi trường nhẹ dưới nền (keepAmbient = true)
 */
async function dubVideoWithVieneu({
  videoPath,
  scenes = [],
  text = '',
  voice = 'Quỳnh Anh',
  speed = 1.03,
  keepAmbient = true,
  burnSubtitles = true,
  subtitleStyle = 'storytelling',
  outDir = '',
  outName = ''
} = {}) {
  if (!videoPath || !fs.existsSync(videoPath)) {
    return { success: false, error: 'Không tìm thấy file video để lồng tiếng' };
  }

  let voiceName = cleanVieneuVoiceName(voice);
  if (/^(vieneu:)?(rotate|auto|ngẫu nhiên|luân phiên)$/i.test(String(voice || '').trim())) {
    const seedStr = String(videoPath || text || Date.now());
    let h = 0;
    for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
    voiceName = VIENEU_VOICES[h % VIENEU_VOICES.length].name;
  }
  const targetDir = outDir || path.dirname(videoPath);
  fs.mkdirSync(targetDir, { recursive: true });

  const baseName = outName
    ? String(outName).replace(/\.mp4$/i, '')
    : `${path.basename(videoPath, path.extname(videoPath))} - ${voiceName}`;
  const finalVideoPath = merger.safeName(targetDir, baseName);

  const workDir = path.join(os.tmpdir(), `sesame_vieneu_dub_${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });

  try {
    const vidDur = (await probeDuration(videoPath)) || 10;
    const hasOrigAudio = await probeHasAudio(videoPath);

    // Chuẩn bị danh sách câu thoại (hỗ trợ đổi giọng riêng cho từng clip/scene nếu có sc.voice)
    let narrationItems = [];
    if (String(text || '').trim()) {
      narrationItems = String(text)
        .split(/\n+/)
        .map(l => l.trim())
        .filter(Boolean)
        .map(line => ({ text: line, voice: voiceName }));
    } else if (Array.isArray(scenes) && scenes.length > 0) {
      narrationItems = scenes
        .map(sc => ({
          text: extractCleanNarrationFromScene(sc),
          voice: sc?.voice ? cleanVieneuVoiceName(sc.voice) : voiceName
        }))
        .filter(it => Boolean(it.text));
    }

    if (!narrationItems.length) {
      return { success: false, error: 'Không có nội dung lời thoại để lồng tiếng' };
    }

    // Nếu câu quá dài (> 22 từ), tự động tách theo dấu chấm/chấm than để phụ đề 2 dòng luôn gọn đẹp như Sesame Studio
    const expandedItems = [];
    for (const item of narrationItems) {
      const subSentences = item.text
        .split(/(?<=[.!?…。])\s+/)
        .map(s => s.trim())
        .filter(Boolean);
      if (subSentences.length > 1) {
        for (const s of subSentences) expandedItems.push({ text: s, voice: item.voice });
      } else {
        expandedItems.push(item);
      }
    }

    const combinedVoiceWav = path.join(workDir, 'voice_master_48k.wav');
    const timedSubtitles = [];

    if (expandedItems.length === 1) {
      await synthesizeSpeechToFile(expandedItems[0].text, combinedVoiceWav, { voice: expandedItems[0].voice, speed });
      const d = (await probeDuration(combinedVoiceWav)) || vidDur;
      timedSubtitles.push({ start: 0, end: d, text: expandedItems[0].text });
    } else {
      const batchReqs = expandedItems.map((item, idx) => ({
        text: item.text,
        voice: item.voice || voiceName,
        outPath: path.join(workDir, `seg_${idx}.wav`)
      }));
      await synthesizeBatchSpeech(batchReqs, { speed });

      const silenceWav = path.join(workDir, 'pause.wav');
      const pauseSec = 0.18;
      await runFfmpeg([
        '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono',
        '-t', String(pauseSec),
        '-c:a', 'pcm_s16le',
        silenceWav
      ]);

      const concatEntries = [];
      let cursor = 0;
      for (let i = 0; i < batchReqs.length; i++) {
        if (fs.existsSync(batchReqs[i].outPath)) {
          const segDur = (await probeDuration(batchReqs[i].outPath)) || 2.5;
          timedSubtitles.push({
            start: Number(cursor.toFixed(2)),
            end: Number((cursor + segDur).toFixed(2)),
            text: batchReqs[i].text
          });
          cursor += segDur;
          concatEntries.push(`file '${batchReqs[i].outPath.replace(/'/g, "'\\''")}'`);
          if (i < batchReqs.length - 1 && fs.existsSync(silenceWav)) {
            concatEntries.push(`file '${silenceWav.replace(/'/g, "'\\''")}'`);
            cursor += pauseSec;
          }
        }
      }
      const listTxt = path.join(workDir, 'voice_concat.txt');
      fs.writeFileSync(listTxt, concatEntries.join('\n'), 'utf8');
      await runFfmpeg([
        '-f', 'concat', '-safe', '0', '-i', listTxt,
        '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le',
        combinedVoiceWav
      ]);
    }

    const voiceDur = await probeDuration(combinedVoiceWav);
    let tempoRatio = 1.0;
    let tempoFilter = '';
    if (voiceDur > vidDur && vidDur > 2) {
      tempoRatio = Math.min(1.25, Number((voiceDur / Math.max(vidDur - 0.2, 1)).toFixed(3)));
      if (tempoRatio > 1.01) {
        tempoFilter = `,atempo=${tempoRatio}`;
      }
    }

    // Đồng bộ lại mốc thời gian phụ đề nếu âm thanh có co giãn nhịp atempo
    if (tempoRatio > 1.01) {
      for (const sub of timedSubtitles) {
        sub.start = Number((sub.start / tempoRatio).toFixed(2));
        sub.end = Number((sub.end / tempoRatio).toFixed(2));
      }
    }

    const assPath = path.join(workDir, 'cinema_subs.ass');
    if (burnSubtitles && timedSubtitles.length) {
      buildCinemaAssFile(timedSubtitles, assPath, { styleMode: subtitleStyle });
    }
    const escapedAss = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');

    const voiceChain = `[1:a]aresample=48000${tempoFilter},loudnorm=I=-15:TP=-1.5:LRA=11,apad=whole_dur=${vidDur.toFixed(2)}[v_voice]`;
    let aFilter = '';
    if (keepAmbient && hasOrigAudio) {
      aFilter = `[0:a]aresample=48000,volume=0.14[v_amb];${voiceChain};[v_amb][v_voice]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]`;
    } else {
      aFilter = `${voiceChain};[v_voice]anull[aout]`;
    }

    if (burnSubtitles && fs.existsSync(assPath)) {
      const vFilter = `[0:v]ass='${escapedAss}'[vout]`;
      await runFfmpeg([
        '-i', videoPath,
        '-i', combinedVoiceWav,
        '-filter_complex', `${vFilter};${aFilter}`,
        '-map', '[vout]',
        '-map', '[aout]',
        ...h264Args(resolveFfmpegBin('ffmpeg'), { crf: 18 }), '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
        '-t', vidDur.toFixed(2),
        finalVideoPath
      ]);
    } else {
      await runFfmpeg([
        '-i', videoPath,
        '-i', combinedVoiceWav,
        '-filter_complex', aFilter,
        '-map', '0:v:0',
        '-map', '[aout]',
        '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
        '-t', vidDur.toFixed(2),
        finalVideoPath
      ]);
    }

    return {
      success: true,
      path: finalVideoPath,
      voice: voiceName
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || String(err)
    };
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
  }
}

module.exports = {
  VIENEU_VOICES,
  resolveFfmpegBin,
  runFfmpeg,
  probeDuration,
  probeHasAudio,
  extractCleanNarrationFromScene,
  buildCinemaAssFile,
  isVieneuVoice,
  cleanVieneuVoiceName,
  synthesizeSpeechToFile,
  synthesizeBatchSpeech,
  previewVieneuVoice,
  dubVideoWithVieneu
};
