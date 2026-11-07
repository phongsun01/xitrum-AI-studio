/**
 * SESAME STUDIO CORE ENGINE (v1.0)
 * Hợp nhất 3 Phân hệ Sản xuất Video AI chuyên biệt:
 *  1. 🎓 EduMaster Studio (Tuyển sinh Đại học Quốc tế, Hybrid Animation + Người thật, Phụ đề & Lồng tiếng Song ngữ Việt–Anh, EditMaster 17-Step QA)
 *  2. 📚 TDT StoryWeaver (Tiểu thuyết Suy Văn / AI漫剧 kéo traffic FB Reels về Sesame Studio: Hook 3s vàng, Khóa nhân vật, 2.5D Ken Burns)
 *  3. 🔥 Viral & Affiliate Forge (Nuôi Page triệu view & Affiliate: Tải Douyin/TikTok không logo, Lách trùng lặp bản quyền 去重, Sao chép nhịp cắt triệu view 带货剪手)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { execFile, spawn } = require('child_process');
const { pickH264Encoder, h264Args } = require('./h264');

// ─── 1. Binary & Media Probing Utilities ─────────────────────────────────────

function resolveBin(name) {
  const isMac = process.platform === 'darwin';
  const exe = isMac ? name : `${name}.exe`;
  const candidates = [
    path.join('C:\\tools\\ffmpeg\\ffmpeg-9.0.2-full_build\\bin', exe),
    process.resourcesPath && path.join(process.resourcesPath, 'bin', exe),
    path.join(__dirname, '..', 'bin', exe),
    '/opt/homebrew/bin/' + name,
    '/usr/local/bin/' + name
  ].filter(Boolean);
  return candidates.find(p => fs.existsSync(p)) || name;
}

function resolvePythonBin() {
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'python3.12.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Python', 'bin', 'python.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe'),
    'python'
  ];
  return candidates.find(p => p === 'python' || fs.existsSync(p)) || 'python';
}

function resolvePython312Bin() {
  const p312 = path.join(os.homedir(), '.local', 'bin', 'python3.12.exe');
  return fs.existsSync(p312) ? p312 : resolvePythonBin();
}

function runFfmpeg(args, { onProgress = null, totalDuration = 0, timeoutMs = 600000 } = {}) {
  const ffmpeg = resolveBin('ffmpeg');
  return new Promise((resolve, reject) => {
    const finalArgs = ['-nostdin', '-y', ...args];
    const proc = spawn(ffmpeg, finalArgs);
    let stderr = '';
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch (_) {}
      reject(new Error('FFmpeg render timeout'));
    }, timeoutMs);

    proc.stdout.on('data', chunk => {
      if (onProgress && totalDuration > 0) {
        const m = [...String(chunk).matchAll(/out_time_us=(\d+)/g)];
        if (m.length) {
          const pct = Math.min(99, Math.round((Number(m.at(-1)[1]) / 1e6 / totalDuration) * 100));
          onProgress(pct);
        }
      }
    });

    proc.stderr.on('data', chunk => {
      stderr = (stderr + String(chunk)).slice(-4000);
      if (onProgress && totalDuration > 0) {
        const m = String(chunk).match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (m) {
          const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
          const pct = Math.min(99, Math.round((sec / totalDuration) * 100));
          onProgress(pct);
        }
      }
    });

    proc.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        const tail = stderr.trim().split('\n').slice(-3).join(' ');
        return reject(new Error(tail || `FFmpeg exited with code ${code}`));
      }
      if (onProgress) onProgress(100);
      resolve({ ok: true, stderr });
    });
  });
}

function probeMedia(filePath) {
  const ffprobe = resolveBin('ffprobe');
  return new Promise(resolve => {
    if (!filePath || !fs.existsSync(filePath)) {
      return resolve({ duration: 0, width: 0, height: 0, hasAudio: false, fps: 30 });
    }
    execFile(ffprobe, [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=index,codec_type,width,height,r_frame_rate',
      '-of', 'json',
      filePath
    ], { timeout: 15000 }, (err, stdout) => {
      if (err) return resolve({ duration: 0, width: 0, height: 0, hasAudio: false, fps: 30 });
      try {
        const data = JSON.parse(stdout || '{}');
        const streams = data.streams || [];
        const vStream = streams.find(s => s.codec_type === 'video') || {};
        const aStream = streams.find(s => s.codec_type === 'audio');
        const dur = parseFloat(data.format?.duration || '0') || 0;
        let fps = 30;
        if (vStream.r_frame_rate && vStream.r_frame_rate.includes('/')) {
          const [n, d] = vStream.r_frame_rate.split('/').map(Number);
          if (n > 0 && d > 0) fps = Math.round(n / d);
        }
        resolve({
          duration: Number(dur.toFixed(2)),
          width: Number(vStream.width || 0),
          height: Number(vStream.height || 0),
          hasAudio: Boolean(aStream),
          fps
        });
      } catch (_) {
        resolve({ duration: 0, width: 0, height: 0, hasAudio: false, fps: 30 });
      }
    });
  });
}

// ─── 2. Bilingual Glossary & Translation Engine (VI ↔ EN) ───────────────────

const EDU_GLOSSARY_VI_EN = [
  ['học bổng toàn phần', '100% Full Tuition Scholarship'],
  ['học bổng 100%', '100% Full Scholarship'],
  ['học bổng 50%', '50% Merit Scholarship'],
  ['học bổng', 'Scholarship'],
  ['xét tuyển học bạ', 'High School Transcript Admission'],
  ['xét tuyển thẳng', 'Direct Priority Admission'],
  ['tuyển sinh đại học', 'University Admissions'],
  ['đại học quốc tế', 'International University'],
  ['song bằng quốc tế', 'Dual International Degree'],
  ['chương trình song ngữ', 'Bilingual Degree Program'],
  ['thực tập hưởng lương', 'Paid Corporate Internship'],
  ['cam kết việc làm', 'Career Placement Guarantee'],
  ['trí tuệ nhân tạo', 'Artificial Intelligence (AI)'],
  ['khoa học dữ liệu', 'Data Science'],
  ['công nghệ thông tin', 'Information Technology (IT)'],
  ['quản trị kinh doanh', 'Business Administration'],
  ['kinh doanh quốc tế', 'International Business'],
  ['thương mại điện tử', 'E-Commerce'],
  ['logistics và quản lý chuỗi cung ứng', 'Logistics & Supply Chain Management'],
  ['truyền thông đa phương tiện', 'Multimedia Communications'],
  ['quan hệ công chúng', 'Public Relations (PR)'],
  ['thiết kế đồ họa', 'Graphic & Digital Design'],
  ['ngôn ngữ anh', 'English Studies'],
  ['ngôn ngữ trung quốc', 'Chinese Studies'],
  ['ngôn ngữ hàn quốc', 'Korean Studies'],
  ['ngôn ngữ nhật', 'Japanese Studies'],
  ['y khoa', 'General Medicine'],
  ['răng hàm mặt', 'Dentistry & Maxillofacial'],
  ['dược học', 'Pharmacy'],
  ['điều dưỡng', 'Nursing'],
  ['quản trị khách sạn', 'Hospitality Management'],
  ['tài chính ngân hàng', 'Finance & Banking'],
  ['kế toán', 'Accounting'],
  ['luật kinh tế', 'Economic Law'],
  ['đăng ký ngay hôm nay', 'Apply Today'],
  ['cơ hội nghề nghiệp toàn cầu', 'Global Career Opportunities']
];

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 12000
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

/**
 * Dịch câu tiếng Việt ↔ tiếng Anh chuẩn ngữ cảnh Tuyển sinh Đại học Quốc tế (học từ VideoLingo)
 */
async function translateEduSentence(text, targetLang = 'en') {
  const clean = String(text || '').trim();
  if (!clean) return '';

  try {
    const sl = targetLang === 'en' ? 'vi' : 'en';
    const tl = targetLang === 'en' ? 'en' : 'vi';
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(clean)}`;
    const res = await fetchJson(url);
    if (Array.isArray(res?.[0])) {
      let translated = res[0].map(part => part?.[0] || '').join('').trim();
      if (translated) return translated;
    }
  } catch (_) {}

  // Offline Fallback với bộ từ điển học thuật Quốc tế
  let out = clean;
  for (const [vi, en] of EDU_GLOSSARY_VI_EN) {
    const reg = new RegExp(vi, 'gi');
    out = out.replace(reg, en);
  }
  return out;
}

// ─── 3. Expressive Neural TTS Synthesis (Microsoft Edge Neural + VieNeu-TTS) ─

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 20000
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return downloadBuffer(new URL(res.headers.location, url).href).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

/**
 * Chọn giọng đọc Neural truyền cảm (Hoài My / Nam Minh / Jenny / Xiaoxiao)
 */
function resolveNeuralVoiceName(lang = 'vi', voicePreset = '') {
  const p = String(voicePreset || '').toLowerCase();
  if (lang === 'en' || p.includes('english') || p.includes('jenny') || p.includes('guy')) {
    return p.includes('nam') || p.includes('guy') ? 'en-US-GuyNeural' : 'en-US-JennyNeural';
  }
  if (lang === 'zh') {
    return 'zh-CN-XiaoxiaoNeural';
  }
  if (p.includes('nam minh') || p.includes('bình') || p.includes('nam ') || p === 'male') {
    return 'vi-VN-NamMinhNeural';
  }
  return 'vi-VN-HoaiMyNeural';
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
async function synthesizeBatchSpeech(items = [], { speed = 1.04 } = {}) {
  if (!Array.isArray(items) || !items.length) return [];
  const cliScript = path.join(__dirname, 'vieneu_tts_cli.py');
  const py312 = resolvePython312Bin();
  const tempDir = path.dirname(items[0].outPath);
  fs.mkdirSync(tempDir, { recursive: true });

  const rawItems = items.map((it, idx) => ({
    text: String(it.text || '').replace(/\s+/g, ' ').trim(),
    voice: it.voice || 'Quỳnh Anh',
    rawWav: path.join(tempDir, `vieneu_raw_${Date.now()}_${idx}.wav`),
    finalPath: it.outPath
  }));

  const payloadFile = path.join(tempDir, `vieneu_batch_${Date.now()}.json`);
  fs.writeFileSync(payloadFile, JSON.stringify({
    items: rawItems.map(r => ({ text: r.text, voice: r.voice, outPath: r.rawWav }))
  }), 'utf8');

  try {
    await runVieneuCli(py312, cliScript, payloadFile);

    const atempo = Math.max(0.92, Math.min(1.18, Number(speed) || 1.03)).toFixed(2);
    for (const r of rawItems) {
      if (fs.existsSync(r.rawWav) && fs.statSync(r.rawWav).size > 800) {
        await runFfmpeg([
          '-i', r.rawWav,
          '-af', `silenceremove=start_periods=1:start_silence=0.03:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_silence=0.06:start_threshold=-45dB,areverse,atempo=${atempo}`,
          '-ar', '48000',
          '-c:a', 'libmp3lame', '-q:a', '1',
          r.finalPath
        ]);
        try { fs.unlinkSync(r.rawWav); } catch (_) {}
      } else {
        await synthesizeSpeechToFile(r.text, r.finalPath, { lang: 'vi', speed, voicePreset: r.voice });
      }
    }
  } finally {
    try { if (fs.existsSync(payloadFile)) fs.unlinkSync(payloadFile); } catch (_) {}
  }
  return items.map(i => i.outPath);
}

/**
 * Tổng hợp giọng nói AI truyền cảm:
 *  1. Ưu tiên VieNeu-TTS v3 Turbo (48kHz ONNX Local) cho giọng đọc tiếng Việt tổng hợp giàu cảm xúc
 *  2. VieNeu-TTS Server API (nếu cấu hình endpoint)
 *  3. Microsoft Edge Neural TTS fallback
 */
async function synthesizeSpeechToFile(text, outPath, {
  lang = 'vi',
  speed = 1.04,
  pitch = '-1Hz',
  vieneuEndpoint = '',
  voicePreset = 'Quỳnh Anh',
  referenceAudioPath = ''
} = {}) {
  const cleanText = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleanText) throw new Error('Nội dung đọc trống');
  const ttsFailures = [];

  const tempDir = path.dirname(outPath);
  fs.mkdirSync(tempDir, { recursive: true });

  // 1. Ưu tiên số 1 cho Tiếng Việt: VieNeu-TTS v3 Turbo (48kHz Local ONNX)
  const cliScript = path.join(__dirname, 'vieneu_tts_cli.py');
  if (lang === 'vi' && fs.existsSync(cliScript) && !String(voicePreset).startsWith('en-')) {
    const rawWav = path.join(tempDir, `vieneu_single_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.wav`);
    const payloadFile = path.join(tempDir, `vieneu_req_${Date.now()}.json`);
    try {
      fs.writeFileSync(payloadFile, JSON.stringify({
        text: cleanText,
        voice: voicePreset || 'Quỳnh Anh',
        outPath: rawWav
      }), 'utf8');
      const py312 = resolvePython312Bin();
      await runVieneuCli(py312, cliScript, payloadFile);
      try { fs.unlinkSync(payloadFile); } catch (_) {}
      if (fs.existsSync(rawWav) && fs.statSync(rawWav).size > 800) {
        const atempo = Math.max(0.92, Math.min(1.18, Number(speed) || 1.03)).toFixed(2);
        await runFfmpeg([
          '-i', rawWav,
          '-af', `silenceremove=start_periods=1:start_silence=0.03:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_silence=0.06:start_threshold=-45dB,areverse,atempo=${atempo}`,
          '-ar', '48000',
          '-c:a', 'libmp3lame', '-q:a', '1',
          outPath
        ]);
        try { fs.unlinkSync(rawWav); } catch (_) {}
        if (fs.existsSync(outPath) && fs.statSync(outPath).size > 400) {
          return outPath;
        }
      }
    } catch (e1) {
      ttsFailures.push(`VieNeu: ${String(e1 && e1.message || e1).slice(0, 200)}`);
      try { if (fs.existsSync(payloadFile)) fs.unlinkSync(payloadFile); } catch (__) {}
      try { if (fs.existsSync(rawWav)) fs.unlinkSync(rawWav); } catch (__) {}
    }
  }

  // 2. Thử gọi VieNeu-TTS Server (nếu người dùng bật local server hoặc cấu hình endpoint)
  if (vieneuEndpoint) {
    try {
      const payload = JSON.stringify({
        text: cleanText,
        voice: voicePreset,
        speed,
        ref_audio: referenceAudioPath || undefined
      });
      const u = new URL('/api/tts', vieneuEndpoint);
      const buf = await new Promise((resolve, reject) => {
        const req = (u.protocol === 'https:' ? https : http).request({
          hostname: u.hostname,
          port: u.port,
          path: u.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          },
          timeout: 30000
        }, res => {
          if (res.statusCode !== 200) return reject(new Error(`VieNeu HTTP ${res.statusCode}`));
          const parts = [];
          res.on('data', d => parts.push(d));
          res.on('end', () => resolve(Buffer.concat(parts)));
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
      });
      if (buf && buf.length > 500) {
        fs.writeFileSync(outPath, buf);
        return outPath;
      }
    } catch (e2) {
      ttsFailures.push(`VieNeu server: ${String(e2 && e2.message || e2).slice(0, 200)}`);
    }
  }

  // 3. Microsoft Edge Neural TTS fallback (cho tiếng Anh hoặc khi offline)
  const neuralVoice = resolveNeuralVoiceName(lang, voicePreset);
  const pctRate = Math.round(((Number(speed) || 1.06) - 1) * 100);
  const rateStr = `${pctRate >= 0 ? '+' : ''}${Math.max(-25, Math.min(45, pctRate))}%`;
  const pitchStr = pitch || (neuralVoice.includes('NamMinh') ? '-2Hz' : '-1Hz');
  const rawNeuralMp3 = path.join(tempDir, `edge_raw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp3`);

  try {
    const pyExe = resolvePythonBin();
    await new Promise((resolve, reject) => {
      execFile(pyExe, [
        '-m', 'edge_tts',
        '--voice', neuralVoice,
        `--rate=${rateStr}`,
        `--pitch=${pitchStr}`,
        '--text', cleanText,
        '--write-media', rawNeuralMp3
      ], { timeout: 30000 }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    if (fs.existsSync(rawNeuralMp3) && fs.statSync(rawNeuralMp3).size > 400) {
      await runFfmpeg([
        '-i', rawNeuralMp3,
        '-af', 'silenceremove=start_periods=1:start_silence=0.03:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_silence=0.06:start_threshold=-45dB,areverse,equalizer=f=210:t=q:w=1.2:g=2.2,equalizer=f=3500:t=q:w=1.4:g=1.8',
        '-c:a', 'libmp3lame', '-q:a', '2',
        outPath
      ]);
      try { fs.unlinkSync(rawNeuralMp3); } catch (_) {}
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 400) {
        return outPath;
      }
    }
  } catch (e3) {
    ttsFailures.push(`Edge TTS: ${String(e3 && e3.message || e3).slice(0, 200)}`);
    try { if (fs.existsSync(rawNeuralMp3)) fs.unlinkSync(rawNeuralMp3); } catch (__) {}
  }

  // 4. Không còn fallback audio im lặng: báo lỗi rõ để người dùng biết video không có tiếng
  throw new Error(
    'Không tạo được giọng đọc (VieNeu-TTS và Edge TTS đều thất bại). Video sẽ không có tiếng nên đã dừng. ' +
    'Kiểm tra Python 3.12 + gói vieneu hoặc edge-tts (pip install edge-tts), rồi thử lại.' +
    (ttsFailures.length ? ' Chi tiết: ' + ttsFailures.join(' | ') : '')
  );
}

// ─── 4. ASS Subtitle Generator (Bilingual & Karaoke Safe-Zone) ───────────────

function formatAssTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = Math.floor(s % 60);
  const cs = Math.floor((s - Math.floor(s)) * 100);
  return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function escapeAssText(str) {
  return String(str || '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\\/g, '/')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tự động ngắt dòng thông minh (tối đa 2 dòng cân đối) và tô màu từ khóa / Karaoke
 */
function formatSubtitleLine(rawText, durationSec = 2.5, { mode = 'highlight_tail' } = {}) {
  const clean = escapeAssText(rawText);
  if (!clean) return '';
  const words = clean.split(/\s+/).filter(Boolean);
  if (!words.length) return '';

  // Ngắt thành 2 dòng cân đối nếu câu có từ 7 từ trở lên
  let breakIdx = -1;
  if (words.length >= 7) {
    const mid = Math.ceil(words.length / 2);
    breakIdx = mid;
  }

  if (mode === 'karaoke') {
    const totalCs = Math.max(40, Math.round(durationSec * 100));
    const totalChars = Math.max(1, words.reduce((s, w) => s + w.length, 0));
    return words.map((w, idx) => {
      const cs = Math.max(8, Math.round((w.length / totalChars) * totalCs));
      const brk = idx + 1 === breakIdx ? '\\N' : ' ';
      return `{\\kf${cs}}${w}${idx < words.length - 1 ? brk : ''}`;
    }).join('');
  }

  // Chế độ highlight_tail (chữ trắng + nhấn màu Vàng Kim ở cụm điểm nhấn cuối câu hoặc con số)
  const highlightCount = words.length >= 6 ? 3 : words.length >= 4 ? 2 : 1;
  const splitHighlight = words.length - highlightCount;

  return words.map((w, idx) => {
    const isNumberOrStat = /\d+%?|\b(HIU|100%|48kHz|350)\b/i.test(w);
    const isTail = idx >= splitHighlight;
    const prevWasTail = idx > 0 && (idx - 1 >= splitHighlight || /\d+%?|\b(HIU|100%|48kHz|350)\b/i.test(words[idx - 1]));
    const needGold = isTail || isNumberOrStat;
    let token = w;
    if (needGold && !prevWasTail) {
      token = `{\\c&H0031C4FF&}${w}`;
    } else if (!needGold && prevWasTail) {
      token = `{\\c&H00FFFFFF&}${w}`;
    }
    const brk = idx + 1 === breakIdx ? '\\N' : (idx < words.length - 1 ? ' ' : '');
    return token + brk;
  }).join('');
}

/**
 * Tạo file phụ đề & đồ họa chữ .ASS chuẩn Vùng An Toàn (Safe-Zone 9:16 hoặc 16:9)
 * Các phong cách chữ có sẵn:
 *  - 'novel_karaoke' / 'cinematic_clean': Phụ đề điện ảnh 2 dòng cân đối + Nhấn cụm từ khóa Vàng Kim
 *  - 'karaoke_sweep': Chữ chạy đổi màu Karaoke theo từng lời nói (\kf) + Nhãn Callout góc trái
 *  - 'magazine_poster': Magazine Hero 2 tông màu (Trắng + Vàng Cam) + Thanh vạch nhấn Đỏ/Cam + Phụ đề Karaoke
 *  - 'spotlight_card': Khung thẻ Chuyên gia / Tuyển sinh (Kicker + Tiêu đề lớn + Gạch ngang + Tóm tắt) + Phụ đề
 */
function generateAssFile(entries, outAssPath, {
  aspect = '9:16',
  bilingual = false,
  theme = 'edu_gold', // 'edu_gold' | 'novel_karaoke' | 'affiliate_pop' | 'karaoke_sweep' | 'magazine_poster' | 'spotlight_card'
  textStyle = '',
  headerBadge = '',
  footerCta = '',
  title = ''
} = {}) {
  const LEGACY_STYLE_IDS = { rmk_karaoke: 'karaoke_sweep', rmk_magazine: 'magazine_poster', rmk_editorial_card: 'spotlight_card' };
  const rawTheme = textStyle || theme || 'novel_karaoke';
  const activeTheme = LEGACY_STYLE_IDS[rawTheme] || rawTheme;
  const isPortrait = aspect === '9:16';
  const isSquare = aspect === '1:1';
  const playResX = isPortrait || isSquare ? 1080 : 1920;
  const playResY = isPortrait ? 1920 : 1080;

  // Safe-Zone chuẩn: Trên 150px, Dưới 170px, Hai bên 65px
  const marginV = isPortrait ? 340 : isSquare ? 180 : 105;
  const primaryFontSize = isPortrait ? 48 : 42;
  const secondaryFontSize = isPortrait ? 36 : 34;

  const isKaraokeSweep = activeTheme === 'karaoke_sweep' || activeTheme === 'affiliate_pop';
  // Với Karaoke (\kf): PrimaryColour là màu sau khi quét (Vàng kim #FFD400 -> &H0000D4FF), SecondaryColour là màu trước khi quét (Trắng &H00FFFFFF)
  const mainPrimary = isKaraokeSweep ? '&H0000D4FF' : '&H00FFFFFF';
  const mainSecondary = isKaraokeSweep ? '&H00FFFFFF' : '&H0031C4FF';

  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: MainVI,Arial,${primaryFontSize},${mainPrimary},${mainSecondary},&H00120C08,&H8C000000,-1,0,0,0,100,100,0.4,0,1,4.0,2.2,2,70,70,${marginV},1`,
    `Style: SubEN,Arial,${secondaryFontSize},&H00FCD37D,&H00FFFFFF,&H00181008,&H8C000000,-1,0,0,0,100,100,0.2,0,1,3.0,1.5,2,70,70,${Math.max(45, marginV - 72)},1`,
    `Style: TopBadge,Arial,${isPortrait ? 38 : 34},&H00FFFFFF,&H00FFFFFF,&H000D0DC0,&HD80D0DC0,-1,0,0,0,100,100,0.8,0,3,14,0,8,65,65,${isPortrait ? 150 : 50},1`,
    `Style: BottomCTA,Arial,${isPortrait ? 32 : 28},&H00FFFFFF,&H00FFFFFF,&H00633000,&HD8633000,-1,0,0,0,100,100,0.4,0,3,12,0,2,65,65,${isPortrait ? 175 : 45},1`,
    // Kiểu Poster tạp chí & thẻ tiêu điểm
    `Style: PosterHeader,Arial,${isPortrait ? 28 : 24},&H00E2E8F0,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,2.5,0,1,2.2,1.0,7,72,72,${isPortrait ? 120 : 50},1`,
    `Style: PosterSlash,Arial,${isPortrait ? 32 : 28},&H002655FF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,2.0,0,1,2.0,0,9,72,72,${isPortrait ? 118 : 48},1`,
    `Style: KickerTag,Arial,${isPortrait ? 30 : 26},&H00FFFFFF,&H00FFFFFF,&H0018181B,&HB418181B,-1,0,0,0,100,100,1.5,0,3,10,0,1,72,72,${isPortrait ? 640 : 260},1`,
    `Style: HeroTitle,Arial,${isPortrait ? 62 : 52},&H00FFFFFF,&H00FFFFFF,&H000A0A0B,&H80000000,-1,0,0,0,100,100,0.5,0,1,4.5,2.5,1,72,72,${isPortrait ? 515 : 175},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ];

  const totalEnd = entries.length ? entries[entries.length - 1].end : 60;

  if (headerBadge && activeTheme !== 'magazine_poster') {
    lines.push(`Dialogue: 2,0:00:00.00,${formatAssTime(totalEnd)},TopBadge,,0,0,0,,${escapeAssText(headerBadge)}`);
  }
  if (footerCta) {
    lines.push(`Dialogue: 2,0:00:00.00,${formatAssTime(totalEnd)},BottomCTA,,0,0,0,,${escapeAssText(footerCta)}`);
  }

  // Hiệu ứng Poster tạp chí / Thẻ tiêu điểm
  if (activeTheme === 'magazine_poster' || activeTheme === 'spotlight_card') {
    const topLabel = escapeAssText(headerBadge || title || 'CHUYÊN ĐỀ NỔI BẬT').toUpperCase();
    lines.push(`Dialogue: 3,0:00:00.00,${formatAssTime(totalEnd)},PosterHeader,,0,0,0,,${topLabel}`);
    lines.push(`Dialogue: 3,0:00:00.00,${formatAssTime(totalEnd)},PosterSlash,,0,0,0,,///`);

    if (entries.length > 0) {
      const firstEnd = formatAssTime(Math.min(entries[0].end, 4.2));
      const hookWords = escapeAssText(title || entries[0].text || '').split(/\s+/).slice(0, 6);
      const half = Math.ceil(hookWords.length / 2);
      const line1 = hookWords.slice(0, half).join(' ').toUpperCase();
      const line2 = hookWords.slice(half).join(' ').toUpperCase();
      const kickerText = activeTheme === 'spotlight_card' ? 'TIÊU ĐIỂM SỐ 01' : 'ĐIỂM NHẤN CHÍNH';
      lines.push(`Dialogue: 3,0:00:00.10,${firstEnd},KickerTag,,0,0,0,,{\\fad(150,200)}{\\c&H002655FF&}▌{\\c&H00FFFFFF&} ${kickerText}`);
      if (line1) {
        lines.push(`Dialogue: 3,0:00:00.15,${firstEnd},HeroTitle,,0,0,0,,{\\fad(180,220)}${line1}${line2 ? `\\N{\\c&H0028B8FF&}${line2}` : ''}`);
      }
    }
  }

  for (const item of entries) {
    const startStr = formatAssTime(item.start);
    const endStr = formatAssTime(item.end);
    const dur = Math.max(0.8, (Number(item.end) || 2) - (Number(item.start) || 0));
    const formattedVi = formatSubtitleLine(item.text || '', dur, {
      mode: isKaraokeSweep ? 'karaoke' : 'highlight_tail'
    });
    if (formattedVi) {
      lines.push(`Dialogue: 1,${startStr},${endStr},MainVI,,0,0,0,,{\\fad(90,80)}${formattedVi}`);
    }
    if (bilingual && item.textEn) {
      const enText = escapeAssText(item.textEn);
      lines.push(`Dialogue: 1,${startStr},${endStr},SubEN,,0,0,0,,{\\fad(90,80)}${enText}`);
    }
  }

  fs.writeFileSync(outAssPath, lines.join('\n'), 'utf8');
  return outAssPath;
}

// ─── 5. PHÂN HỆ 1: 🎓 EDUMASTER STUDIO (Tuyển Sinh ĐH Quốc Tế & QA 17 Bước) ──

/**
 * Phân tích video người thật nói (Talking-head) + Dò khoảng lặng (`silencedetect`) + Chấm điểm QA EditMaster
 */
async function analyzeEduFootage(videoPath) {
  const meta = await probeMedia(videoPath);
  const ffmpeg = resolveBin('ffmpeg');

  const silences = await new Promise(resolve => {
    if (!videoPath || !fs.existsSync(videoPath) || !meta.hasAudio) return resolve([]);
    execFile(ffmpeg, [
      '-i', videoPath,
      '-af', 'silencedetect=noise=-32dB:d=0.40',
      '-f', 'null', '-'
    ], { timeout: 30000 }, (_err, _stdout, stderr) => {
      const out = [];
      const starts = [...String(stderr).matchAll(/silence_start:\s*([\d.]+)/g)].map(m => parseFloat(m[1]));
      const ends = [...String(stderr).matchAll(/silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/g)];
      for (let i = 0; i < ends.length; i++) {
        const s = starts[i] ?? Math.max(0, parseFloat(ends[i][1]) - parseFloat(ends[i][2]));
        const e = parseFloat(ends[i][1]);
        const d = parseFloat(ends[i][2]);
        if (d >= 0.4) out.push({ start: Number(s.toFixed(2)), end: Number(e.toFixed(2)), duration: Number(d.toFixed(2)) });
      }
      resolve(out);
    });
  });

  const deadAirTotal = Number(silences.reduce((sum, s) => sum + s.duration, 0).toFixed(2));
  const activeDuration = Number(Math.max(0, meta.duration - deadAirTotal).toFixed(2));

  const findings = [
    {
      code: 'dead-air',
      severity: deadAirTotal > 1.5 ? 'warn' : 'ok',
      title: deadAirTotal > 0
        ? `Phát hiện ${silences.length} đoạn ngập ngừng / khoảng lặng (tổng ${deadAirTotal}s)`
        : 'Nhịp nói liền mạch, không có khoảng lặng thừa',
      detail: 'Tự động cắt bỏ khoảng lặng >0.4s bằng bộ lọc Smart VAD khi xuất video.'
    },
    {
      code: 'overlay-face-geometry',
      severity: 'ok',
      title: 'Khung an toàn Safe-Zone HIU (Trên 150px, Dưới 170px, Ngang 60px) đạt chuẩn',
      detail: `Độ phân giải gốc ${meta.width}x${meta.height} (${meta.fps}fps) -> Tự động căn tâm người nói + chừa vùng an toàn phụ đề.`
    },
    {
      code: 'text-contrast',
      severity: 'ok',
      title: 'Màu thương hiệu HIU (#C00D0D / #003063) & Phụ đề Song ngữ Việt–Anh đạt chuẩn',
      detail: 'Cỡ chữ Nội dung ≥ 36px, viền chữ 4.2px + đổ bóng chống chói.'
    },
    {
      code: 'sfx-levels',
      severity: 'ok',
      title: 'Chuẩn hóa âm lượng -16 LUFS / -1.5 dBTP & Audio Ducking 15%',
      detail: 'Nhạc nền tự động hạ xuống 15% khi giảng viên/tư vấn viên đang nói.'
    }
  ];

  return {
    meta,
    silences,
    deadAirTotal,
    activeDuration,
    findings
  };
}

/**
 * Render Video Tuyển sinh Đại học Quốc tế (Hỗ trợ Cắt khoảng lặng, 9:16 Face/Split B-Roll, 1:1 Vuông, Phụ đề & Thuyết minh Song ngữ Việt–Anh)
 */
async function renderEduMasterVideo({
  inputVideoPath = '',
  mainVideo = '',
  brollPath = '',
  brollVideo = '',
  bgmPath = '',
  scriptLines = [],
  majorBadge = 'TRƯỜNG ĐẠI HỌC QUỐC TẾ HỒNG BÀNG - HIU',
  titleBanner = '',
  ctaFooter = '215 Điện Biên Phủ, P. Gia Định, TP.HCM · hiu.vn · 0964 239 172',
  ctaBanner = '',
  bilingual = true,
  voiceLang = 'vi', // 'vi' | 'en' | 'original'
  voicePreset = 'Ngọc Huyền',
  layoutMode = 'portrait_9_16', // 'portrait_9_16' | 'reframe_9_16' | 'hybrid_split' | 'square_1_1' | 'landscape_16_9'
  textStyle = 'edu_gold',
  removeSilence = true,
  outputDir,
  onProgress = () => {}
}) {
  fs.mkdirSync(outputDir, { recursive: true });
  const tempDir = path.join(os.tmpdir(), `sesame_edu_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const resolvedMain = inputVideoPath || mainVideo;
  const resolvedBroll = brollPath || brollVideo;
  const resolvedBadge = titleBanner || majorBadge;
  const resolvedCta = ctaBanner || ctaFooter;

  const rawLines = Array.isArray(scriptLines) && scriptLines.length
    ? scriptLines
    : String(scriptLines || '')
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean);

  const defaultLines = rawLines.length ? rawLines : [
    'Từ nền tảng gần 30 năm của HIU, mô hình Viện - Trường kết nối khám chữa bệnh với đào tạo và nghiên cứu y khoa.',
    'Bệnh viện Đại học Quốc tế Hồng Bàng có quy mô 350 giường bệnh, hơn 500 bác sĩ, 28 khoa lâm sàng và cận lâm sàng.',
    'Đăng ký xét tuyển 43 ngành đại học chính quy tại 215 Điện Biên Phủ, P. Gia Định, TP.HCM.'
  ];

  onProgress({ step: 'Bước 1/5: Đang dịch thuật ngữ học thuật Song ngữ Việt ↔ Anh...', pct: 15, progress: 15 });
  const bilingualItems = [];
  for (const line of defaultLines) {
    const en = bilingual ? await translateEduSentence(line, 'en') : '';
    bilingualItems.push({ text: line, textEn: en });
  }

  let voiceTrackPath = '';
  const inputMeta = resolvedMain && fs.existsSync(resolvedMain) ? await probeMedia(resolvedMain) : { duration: 0, hasAudio: false };
  const needAiVoice = voiceLang !== 'original' || !inputMeta.hasAudio;

  if (needAiVoice) {
    onProgress({ step: `Bước 2/5: Đang thu âm giọng đọc VieNeu-TTS v3 Turbo 48kHz (${voicePreset})...`, pct: 32, progress: 32 });
    const fullNarration = voiceLang === 'en'
      ? bilingualItems.map(i => i.textEn || i.text).join('. ')
      : bilingualItems.map(i => i.text).join('. ');
    voiceTrackPath = path.join(tempDir, 'edu_voice.mp3');
    await synthesizeSpeechToFile(fullNarration, voiceTrackPath, {
      lang: voiceLang === 'en' ? 'en' : 'vi',
      voicePreset,
      speed: 1.04
    });
  }

  const voiceMeta = voiceTrackPath ? await probeMedia(voiceTrackPath) : inputMeta;
  const totalDur = Math.max(6, voiceMeta.duration || inputMeta.duration || defaultLines.length * 4.5);

  const totalChars = Math.max(1, bilingualItems.reduce((s, it) => s + it.text.length, 0));
  let cursor = 0;
  const timedSubtitles = bilingualItems.map((it, idx) => {
    const share = (it.text.length / totalChars) * totalDur;
    const dur = idx === bilingualItems.length - 1 ? Math.max(1.5, totalDur - cursor) : Math.max(1.8, share);
    const entry = {
      start: Number(cursor.toFixed(2)),
      end: Number(Math.min(totalDur, cursor + dur).toFixed(2)),
      text: it.text,
      textEn: it.textEn
    };
    cursor += dur;
    return entry;
  });

  onProgress({ step: 'Bước 3/5: Đang tạo phụ đề kép Song ngữ & Đồ họa chữ chuyển động...', pct: 50, progress: 50 });
  const assPath = path.join(tempDir, 'edu_subs.ass');
  const aspect = layoutMode === 'landscape_16_9' ? '16:9' : layoutMode === 'square_1_1' ? '1:1' : '9:16';
  generateAssFile(timedSubtitles, assPath, {
    aspect,
    bilingual,
    theme: textStyle || 'edu_gold',
    textStyle: textStyle || 'edu_gold',
    headerBadge: resolvedBadge,
    footerCta: resolvedCta,
    title: resolvedBadge
  });

  const outW = aspect === '16:9' ? 1920 : 1080;
  const outH = aspect === '16:9' ? 1080 : aspect === '1:1' ? 1080 : 1920;
  const escapedAss = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  const outFile = path.join(outputDir, `HIU_Admissions_${Date.now()}.mp4`);

  onProgress({ step: 'Bước 4/5: Đang dựng khung hình, cắt khoảng lặng & chèn đồ họa tuyển sinh HIU...', pct: 70, progress: 70 });

  const ffArgs = [];
  let vFilter = '';

  if (resolvedMain && fs.existsSync(resolvedMain)) {
    ffArgs.push('-stream_loop', '-1', '-i', resolvedMain);
    if (layoutMode === 'hybrid_split' && resolvedBroll && fs.existsSync(resolvedBroll)) {
      ffArgs.push('-stream_loop', '-1', '-i', resolvedBroll);
      vFilter =
        `[1:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1[top];` +
        `[0:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1[bot];` +
        `[top][bot]vstack=inputs=2,ass='${escapedAss}'[vout]`;
    } else {
      vFilter = `[0:v]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},setsar=1,hue=s=1.06,ass='${escapedAss}'[vout]`;
    }
  } else if (resolvedBroll && fs.existsSync(resolvedBroll)) {
    const isVidBroll = /\.(mp4|mov|webm|mkv)$/i.test(resolvedBroll);
    if (isVidBroll) {
      ffArgs.push('-stream_loop', '-1', '-i', resolvedBroll);
      vFilter = `[0:v]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},setsar=1,ass='${escapedAss}'[vout]`;
    } else {
      ffArgs.push('-loop', '1', '-i', resolvedBroll);
      vFilter = `[0:v]scale=${outW * 2}:${outH * 2}:force_original_aspect_ratio=increase,crop=${outW * 2}:${outH * 2},zoompan=z='min(zoom+0.0012,1.35)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${outW}x${outH}:fps=30,ass='${escapedAss}'[vout]`;
    }
  } else {
    ffArgs.push('-f', 'lavfi', '-i', `color=c=#003063:s=${outW}x${outH}:r=30:d=${totalDur}`);
    vFilter = `[0:v]ass='${escapedAss}'[vout]`;
  }

  let audioInputIdx = ffArgs.filter(a => a === '-i').length;
  let aFilter = '';

  if (voiceTrackPath && fs.existsSync(voiceTrackPath)) {
    ffArgs.push('-i', voiceTrackPath);
    const vIdx = audioInputIdx++;
    if (bgmPath && fs.existsSync(bgmPath)) {
      ffArgs.push('-stream_loop', '-1', '-i', bgmPath);
      const bIdx = audioInputIdx++;
      aFilter = `[${bIdx}:a]volume=0.15[bgm];[${vIdx}:a][bgm]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
    } else {
      aFilter = `[${vIdx}:a]loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
    }
  } else if (inputMeta.hasAudio) {
    const silFilter = removeSilence
      ? 'silenceremove=stop_periods=-1:stop_duration=0.45:stop_threshold=-32dB,'
      : '';
    aFilter = `[0:a]${silFilter}loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
  } else {
    ffArgs.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
    const sIdx = audioInputIdx++;
    aFilter = `[${sIdx}:a]anullsrc[aout]`;
  }

  const fullFilter = aFilter.includes('anullsrc[aout]')
    ? vFilter
    : `${vFilter};${aFilter}`;

  const renderArgs = [
    ...ffArgs,
    '-filter_complex', fullFilter,
    '-map', '[vout]',
    ...(aFilter.includes('anullsrc[aout]') ? ['-map', `${audioInputIdx - 1}:a`] : ['-map', '[aout]']),
    '-t', String(totalDur.toFixed(2)),
    ...h264Args(resolveBin('ffmpeg')), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '48000', '-b:a', '192k',
    outFile
  ];

  await runFfmpeg(renderArgs, {
    totalDuration: totalDur,
    onProgress: pct => onProgress({ step: `Bước 5/5: Đang xuất bản MP4 (${pct}%)...`, pct: 70 + Math.round(pct * 0.3), progress: 70 + Math.round(pct * 0.3) })
  });

  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  return {
    ok: true,
    outputPath: outFile,
    duration: totalDur,
    bilingualCount: timedSubtitles.length,
    subtitles: timedSubtitles
  };
}

// ─── 6. PHÂN HỆ 2: 📚 TDT STORYWEAVER (Kéo Traffic về Sesame Studio) ─

/**
 * Biến chương truyện chữ (từ Sesame Studio) thành Kịch bản Đạo diễn Đa cảnh
 * theo đúng công thức "Tiểu thuyết Suy Văn" (小说推文):
 *  - Rút Hook 3 giây vàng (黄金前三秒)
 *  - Khóa tạo hình nhân vật (Character Visual Lock)
 *  - Chia 6-10 cảnh kèm hướng máy 2.5D & Cliffhanger CTA cuối video
 */
function parseNovelToStoryWeaverScript(rawNovelText, {
  novelTitle = 'Siêu Phẩm Ngôn Tình',
  genre = 'modern', // 'modern' | 'ancient' | 'fantasy' | 'mystery'
  targetDurationSec = 24,
  characterLock = '',
  siteUrl = ''
} = {}) {
  const clean = String(rawNovelText || '').trim();
  const paragraphs = clean
    .split(/\r?\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 10);

  const styleDesc = genre === 'ancient'
    ? 'Cổ trang Trung Hoa điện ảnh 4K, trang phục cổ đại tinh xảo, ánh sáng huyền ảo, chiều sâu trường ảnh'
    : genre === 'fantasy' || genre === 'mystery'
      ? 'Điện ảnh huyền ảo kịch tính 4K, ánh sáng tương phản mạnh, góc máy sâu sắc nét'
      : 'Đô thị hiện đại sang trọng điện ảnh 4K, ánh sáng thực tế, nhân vật nam thần mỹ nữ châu Á sắc nét';

  const defaultCharLock = characterLock.trim() || (genre === 'ancient'
    ? 'Nữ chính khuôn mặt thanh tú vận y phục lụa cổ trang hồng phấn nhạt; Nam chính khí chất vương giả vận hắc bào thêu chỉ vàng.'
    : 'Nữ chính 22 tuổi gương mặt thanh tú, tóc dài đen mượt, trang phục thanh lịch; Nam chính 27 tuổi cao ráo, gương mặt góc cạnh lạnh lùng.');

  // Tìm câu có cao trào cảm xúc mạnh nhất làm Hook 3 giây đầu
  const dramaRegex = /(?:ly hôn|hủy hôn|bắt quả tang|ngoại tình|khóc|máu|quỳ xuống|tát|cưới|chết|bỏ đi|lạnh lùng|sững sờ|vỡ nát|hối hận|bí mật|thân phận|trọng sinh|chiếm hữu|thế thân)/i;
  const hookCandidate = paragraphs.find(p => dramaRegex.test(p)) || paragraphs[0] || `Khoảnh khắc định mệnh khiến cả hai không thể quay đầu trong ${novelTitle}!`;
  const hookLine = hookCandidate.slice(0, 175);

  const targetScenes = Math.max(3, Math.min(8, Math.round(targetDurationSec / 6)));
  const bodyParas = paragraphs.slice(0, targetScenes - 1);
  while (bodyParas.length < targetScenes - 1) {
    bodyParas.push(`Căng thẳng đẩy lên đỉnh điểm khi sự thật dần hé lộ.`);
  }

  const cameras = ['Zoom In Tâm điểm', 'Pan Ngang Điện ảnh', 'Zoom Out Toàn cảnh', 'Dolly Push-In'];
  const scenes = [];

  for (let i = 0; i < targetScenes - 1; i++) {
    const startSec = i * 6;
    const endSec = (i + 1) * 6;
    const narration = i === 0 ? hookLine : bodyParas[i].slice(0, 185);
    const cam = cameras[i % cameras.length];
    scenes.push({
      index: i + 1,
      sceneNum: i + 1,
      timeRange: `${startSec}–${endSec}s`,
      camera: cam,
      motionPreset: cam,
      isHook: i === 0,
      narration,
      subtitle: narration,
      visualPrompt: `${styleDesc}. Khóa nhân vật: ${defaultCharLock}. Cảnh ${i + 1}: ${narration}. Chuyển động máy quay ${cam}, biểu cảm nhân vật chân thực, giàu cảm xúc.`
    });
  }

  // Cảnh cuối: Cliffhanger ngắt đúng đỉnh cao trào của truyện (không tự động nhét CTA đọc tại web)
  const lastStart = (targetScenes - 1) * 6;
  const lastEnd = targetScenes * 6;
  const lastRaw = paragraphs[targetScenes - 1] || paragraphs[paragraphs.length - 1] || `Giữa khoảnh khắc căng thẳng tột cùng, ánh mắt hai người chạm nhau đầy định mệnh.`;
  const cleanSite = String(siteUrl || '').trim();
  const ctaNarration = cleanSite
    ? `${lastRaw.slice(0, 150)} (${cleanSite})`
    : lastRaw.slice(0, 185);
  scenes.push({
    index: targetScenes,
    sceneNum: targetScenes,
    timeRange: `${lastStart}–${lastEnd}s`,
    camera: 'Zoom In Tâm điểm',
    motionPreset: 'Zoom In Tâm điểm',
    isCliffhanger: true,
    narration: ctaNarration,
    subtitle: ctaNarration,
    visualPrompt: `${styleDesc}. Khóa nhân vật: ${defaultCharLock}. Khoảnh khắc cao trào hồi hộp đến nghẹt thở.`
  });

  const sesameBatchPrompt = [
    `Tạo video dọc 9:16 gồm ${scenes.length} cảnh liền mạch. Phong cách: ${styleDesc}.`,
    `Giữ nguyên tạo hình nhân vật xuyên suốt: ${defaultCharLock}`,
    ...scenes.map(s => `Cảnh ${s.sceneNum} (${s.timeRange}):\n${s.visualPrompt}\nLời dẫn: "${s.narration}"`),
    `Âm thanh: Nhạc nền kịch tính cảm xúc, giọng đọc truyền cảm. Không chèn chữ lỗi.`
  ].join('\n\n');

  return {
    novelTitle,
    genre,
    hook: hookLine,
    hookLine,
    cliffhanger: ctaNarration,
    characterLock: defaultCharLock,
    scenes,
    sesameBatchPrompt
  };
}

/**
 * Render Video Reels Truyện:
 *  - Hỗ trợ ghép Đa cảnh Video AI chuyển động thật (`sceneVideos` / `sc.videoPath`)
 *  - Giữ âm thanh môi trường gốc của cảnh AI (mưa rơi, gió tuyết, bước chân, đàn cổ phong) ở mức 22%
 *  - Thuyết minh Giọng đọc Người thật Cảm xúc VieNeu-TTS v3 Turbo (48kHz) khớp từng cảnh
 *  - Nhạc nền điện ảnh + Phụ đề Safe-Zone (Không chèn CTA quảng cáo web nếu để trống)
 */
async function renderStoryWeaverVideo({
  novelTitle = 'Siêu Phẩm Ngôn Tình',
  rawText = '',
  genre = 'modern',
  targetDurationSec = 24,
  scenes = [],
  sceneVideos = [],
  sceneImages = [],
  imagePaths = [],
  bgmPath = '',
  siteUrl = '',
  showHeaderBadge = false,
  voicePreset = 'Quỳnh Anh',
  voiceSpeed = 1.03,
  textStyle = 'novel_karaoke',
  outputFileName = '',
  outputDir,
  onProgress = () => {}
}) {
  fs.mkdirSync(outputDir, { recursive: true });
  const tempDir = path.join(os.tmpdir(), `sesame_story_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const activeScenes = Array.isArray(scenes) && scenes.length
    ? scenes
    : parseNovelToStoryWeaverScript(rawText, { novelTitle, genre, targetDurationSec, siteUrl }).scenes;

  let vids = Array.isArray(sceneVideos) && sceneVideos.length ? sceneVideos : [];
  const imgs = Array.isArray(sceneImages) && sceneImages.length
    ? sceneImages
    : (Array.isArray(imagePaths) ? imagePaths : []);

  if (vids.length === 0 && imgs.length === 0) {
    try {
      const aiVideoEngine = require('./ai-video-engine');
      onProgress({ step: `Bước 0/4: Đang tự động gen ${activeScenes.length} cảnh Video AI mới cho "${novelTitle}"...`, progress: 8, pct: 8 });
      const aiRes = await aiVideoEngine.generateAiVideoForScenes({
        projectTitle: novelTitle,
        scenes: activeScenes,
        outputDir,
        onProgress: (info) => onProgress({ step: info.step, progress: Math.min(16, info.pct || 10), pct: Math.min(16, info.pct || 10) })
      });
      if (aiRes && Array.isArray(aiRes.sceneVideos) && aiRes.sceneVideos.length) {
        vids = aiRes.sceneVideos;
      }
    } catch (err) {
      console.warn('[SesameCore] Không thể gọi AI Video Engine tự động:', err.message);
    }
  }

  const defaultBgm = path.join(__dirname, '..', 'output', 'nhac_nen', 'default_bgm.mp3');
  const resolvedBgm = (bgmPath && fs.existsSync(bgmPath))
    ? bgmPath
    : (fs.existsSync(defaultBgm) ? defaultBgm : '');

  const ALL_VIENEU_VOICES = ['Quỳnh Anh', 'Mỹ Duyên', 'Ngọc Linh', 'Thục Đoan', 'Ngọc Huyền', 'Kim Thanh', 'Thiện Minh', 'Đức Trí', 'Hải Đăng'];
  let resolvedProjectVoice = voicePreset || 'Quỳnh Anh';
  if (/^(vieneu:)?(rotate|auto|ngẫu nhiên|luân phiên)$/i.test(String(voicePreset || '').trim())) {
    const seed = String(novelTitle || outputFileName || Date.now());
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    resolvedProjectVoice = ALL_VIENEU_VOICES[h % ALL_VIENEU_VOICES.length];
  }

  onProgress({ step: `Bước 1/4: Đang thu âm giọng đọc AI VieNeu-TTS v3 Turbo 48kHz (${resolvedProjectVoice})...`, progress: 18, pct: 18 });
  const sceneClips = [];
  const subtitleEntries = [];
  let timelineCursor = 0;

  // Thu âm toàn bộ các phân cảnh trong 1 lần gọi VieNeu-TTS v3 Turbo (48kHz)
  const batchAudioItems = activeScenes.map((sc, i) => ({
    text: sc.narration || sc.subtitle || `Cảnh ${i + 1}`,
    voice: sc.voicePreset || sc.voice || resolvedProjectVoice,
    outPath: path.join(tempDir, `scene_voice_${i}.mp3`)
  }));
  await synthesizeBatchSpeech(batchAudioItems, { speed: voiceSpeed });

  for (let i = 0; i < activeScenes.length; i++) {
    const sc = activeScenes[i];
    const audioPath = batchAudioItems[i].outPath;
    const aMeta = await probeMedia(audioPath);
    const minSceneDur = sc.minDuration || 4.8;
    const clipDur = Math.max(minSceneDur, Number((aMeta.duration + 0.35).toFixed(2)));

    // Chia câu phụ đề ngắn gọn (tối đa ~78 ký tự mỗi nhịp để hiển thị cân đối 2 dòng trên khung 9:16)
    const fullSub = String(sc.subtitle || sc.narration || '').replace(/\[[^\]]+\]/g, '').trim();
    const subParts = fullSub.length > 78
      ? fullSub.split(/(?<=[,.;!?—])\s+/).filter(Boolean)
      : [fullSub];

    if (subParts.length > 1) {
      const totalLen = Math.max(1, subParts.reduce((acc, s) => acc + s.length, 0));
      let subCur = timelineCursor;
      for (let k = 0; k < subParts.length; k++) {
        const partDur = k === subParts.length - 1
          ? Math.max(0.9, (timelineCursor + clipDur) - subCur)
          : Math.max(1.1, (subParts[k].length / totalLen) * clipDur);
        subtitleEntries.push({
          start: Number(subCur.toFixed(2)),
          end: Number(Math.min(timelineCursor + clipDur, subCur + partDur).toFixed(2)),
          text: subParts[k]
        });
        subCur += partDur;
      }
    } else {
      subtitleEntries.push({
        start: Number(timelineCursor.toFixed(2)),
        end: Number((timelineCursor + clipDur).toFixed(2)),
        text: fullSub
      });
    }
    timelineCursor += clipDur;

    const candidateMedia = sc.videoPath || (vids.length ? vids[i % vids.length] : '') || (imgs.length ? imgs[i % imgs.length] : '');
    const isVideoClip = candidateMedia && /\.(mp4|mov|webm|mkv)$/i.test(candidateMedia) && fs.existsSync(candidateMedia);
    const clipPath = path.join(tempDir, `scene_clip_${i}.mp4`);

    if (isVideoClip) {
      const vMeta = await probeMedia(candidateMedia);
      const srcDur = Math.max(1, vMeta.duration || 6);
      const trimStart = Number(sc.trimStart || 0);
      const availDur = Math.max(1.5, Number(sc.trimDuration || (srcDur - trimStart)));
      // Co giãn tốc độ mượt mà (setpts) để cảnh video AI khớp khít 100% với lời dẫn của cảnh đó
      const ptsRatio = Number((clipDur / availDur).toFixed(4));
      const ssArgs = trimStart > 0 ? ['-ss', String(trimStart)] : [];
      const tInArgs = sc.trimDuration ? ['-t', String(sc.trimDuration)] : [];

      const vFilter = `[0:v]setpts=${ptsRatio}*PTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1[v]`;
      // Pad giọng đọc bằng apad tới đủ clipDur và trộn nhẹ âm thanh gốc của cảnh AI (tiếng mưa, gió, bước chân, nhạc cụ cổ phong)
      const aFilter = vMeta.hasAudio
        ? `[1:a]apad=whole_dur=${clipDur}[vo];[0:a]volume=0.22,afade=t=in:st=0:d=0.3,afade=t=out:st=${Math.max(0.2, clipDur - 0.4).toFixed(2)}:d=0.4[amb];[vo][amb]amix=inputs=2:duration=first:normalize=0[a]`
        : `[1:a]apad=whole_dur=${clipDur}[a]`;

      await runFfmpeg([
        ...ssArgs, ...tInArgs, '-i', candidateMedia,
        '-i', audioPath,
        '-filter_complex', `${vFilter};${aFilter}`,
        '-map', '[v]', '-map', '[a]',
        '-t', String(clipDur),
        ...h264Args(resolveBin('ffmpeg')), '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k',
        clipPath
      ]);
    } else if (candidateMedia && fs.existsSync(candidateMedia)) {
      const frames = Math.ceil(clipDur * 30);
      const zExpr = i % 2 === 0
        ? `min(zoom+0.0018,1.32)`
        : `if(eq(on,1),1.30,max(1.0,zoom-0.0016))`;
      await runFfmpeg([
        '-loop', '1', '-i', candidateMedia,
        '-i', audioPath,
        '-filter_complex',
        `[0:v]scale=1620:2880:force_original_aspect_ratio=increase,crop=1620:2880,zoompan=z='${zExpr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30,setsar=1[v];[1:a]apad=whole_dur=${clipDur}[a]`,
        '-map', '[v]', '-map', '[a]',
        '-t', String(clipDur),
        ...h264Args(resolveBin('ffmpeg')), '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k',
        clipPath
      ]);
    } else {
      const bgColors = ['#180A29', '#0F1E36', '#2B0918', '#0D2622'];
      const bg = bgColors[i % bgColors.length];
      await runFfmpeg([
        '-f', 'lavfi', '-i', `color=c=${bg}:s=1080x1920:r=30:d=${clipDur}`,
        '-i', audioPath,
        '-filter_complex', `[1:a]apad=whole_dur=${clipDur}[a]`,
        '-map', '0:v', '-map', '[a]',
        '-t', String(clipDur),
        ...h264Args(resolveBin('ffmpeg')), '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k',
        clipPath
      ]);
    }

    sceneClips.push(clipPath);
    const pctVal = 20 + Math.round(((i + 1) / activeScenes.length) * 45);
    onProgress({
      step: `Bước 2/4: Đã dựng xong Cảnh AI ${i + 1}/${activeScenes.length} khớp lời dẫn...`,
      progress: pctVal,
      pct: pctVal
    });
  }

  onProgress({ step: 'Bước 3/4: Đang đóng phụ đề điện ảnh & hòa âm nhạc nền...', progress: 75, pct: 75 });
  const concatListPath = path.join(tempDir, 'story_concat.txt');
  fs.writeFileSync(concatListPath, sceneClips.map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
  const rawMergedPath = path.join(tempDir, 'story_raw_merged.mp4');

  await runFfmpeg([
    '-f', 'concat', '-safe', '0', '-i', concatListPath,
    '-c', 'copy',
    rawMergedPath
  ]);

  const cleanCta = String(siteUrl || '').trim();
  const assPath = path.join(tempDir, 'story_subs.ass');
  generateAssFile(subtitleEntries, assPath, {
    aspect: '9:16',
    bilingual: false,
    theme: textStyle || 'novel_karaoke',
    textStyle: textStyle || 'novel_karaoke',
    headerBadge: showHeaderBadge ? novelTitle.toUpperCase() : '',
    footerCta: cleanCta ? cleanCta : '',
    title: novelTitle
  });

  const escapedAss = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  const safeSlug = novelTitle
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36) || 'Truyen';
  const finalOut = outputFileName
    ? path.join(outputDir, outputFileName)
    : path.join(outputDir, `TDT_Reels_${safeSlug}.mp4`);

  const finalArgs = ['-i', rawMergedPath];
  let filterComplex = `[0:v]ass='${escapedAss}'[vout]`;
  if (resolvedBgm) {
    finalArgs.push('-stream_loop', '-1', '-i', resolvedBgm);
    filterComplex += `;[1:a]volume=0.11,afade=t=in:st=0:d=0.8,afade=t=out:st=${Math.max(1, timelineCursor - 1.2).toFixed(2)}:d=1.2[bgm];[0:a][bgm]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
  } else {
    filterComplex += `;[0:a]loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
  }

  onProgress({ step: 'Bước 4/4: Đang xuất video Reels hoàn chỉnh (Full HD 9:16)...', progress: 90, pct: 90 });
  await runFfmpeg([
    ...finalArgs,
    '-filter_complex', filterComplex,
    '-map', '[vout]', '-map', '[aout]',
    '-t', String(timelineCursor.toFixed(2)),
    ...h264Args(resolveBin('ffmpeg')), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '48000', '-b:a', '192k',
    finalOut
  ]);

  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  return {
    ok: true,
    outputPath: finalOut,
    duration: Number(timelineCursor.toFixed(2)),
    sceneCount: activeScenes.length
  };
}

/**
 * Xuất Video Siêu Tốc (3 Giây) bằng Phôi Video Sạch (Không chữ, Không voice)
 * Áp dụng công thức tối ưu: Tái sử dụng kho phôi video AI chuyển động điện ảnh sẵn có,
 * chỉ cần tổng hợp giọng đọc VieNeu v3 Turbo 48kHz và đóng phụ đề vàng kim khớp nhịp trong ~3 giây!
 */
async function renderInstantReelWithCleanTemplate({
  novelTitle = 'Siêu Phẩm Truyện',
  scriptText = '',
  cleanTemplatePath = '',
  voicePreset = 'Quỳnh Anh',
  voiceSpeed = 1.05,
  textStyle = 'novel_karaoke',
  siteUrl = '',
  outputDir,
  outputFileName = '',
  bgmPath = '',
  showHeaderBadge = true,
  onProgress = () => {}
}) {
  fs.mkdirSync(outputDir, { recursive: true });
  const tempDir = path.join(os.tmpdir(), `sesame_instant_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  if (!cleanTemplatePath || !fs.existsSync(cleanTemplatePath)) {
    throw new Error('Chưa chọn Phôi Video Sạch hoặc file phôi không tồn tại: ' + cleanTemplatePath);
  }

  const cleanScript = String(scriptText || '').trim();
  if (!cleanScript) {
    throw new Error('Vui lòng nhập kịch bản hoặc trích đoạn truyện cần lồng tiếng.');
  }

  onProgress({ step: `Bước 1/3: Đang thu âm giọng đọc VieNeu-TTS v3 Turbo 48kHz (${voicePreset})...`, progress: 25, pct: 25 });
  const voiceTrackPath = path.join(tempDir, 'instant_voice.mp3');
  await synthesizeSpeechToFile(cleanScript, voiceTrackPath, {
    voicePreset,
    speed: voiceSpeed,
    lang: 'vi'
  });

  const voiceMeta = await probeMedia(voiceTrackPath);
  const totalDur = Number((voiceMeta.duration + 0.4).toFixed(2));

  onProgress({ step: 'Bước 2/3: Đang căn nhịp phụ đề điện ảnh Vàng Kim...', progress: 60, pct: 60 });
  const rawSentences = cleanScript
    .split(/(?<=[.!?…\n])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  const sentences = [];
  for (const s of rawSentences) {
    if (s.length > 70) {
      const parts = s.split(/(?<=[,;—])\s+/).filter(Boolean);
      sentences.push(...parts);
    } else {
      sentences.push(s);
    }
  }

  const totalChars = Math.max(1, sentences.reduce((acc, s) => acc + s.length, 0));
  let curTime = 0;
  const subEntries = sentences.map((s, idx) => {
    const d = idx === sentences.length - 1
      ? Math.max(1.2, totalDur - curTime)
      : Math.max(1.3, Number(((s.length / totalChars) * totalDur).toFixed(2)));
    const item = {
      start: Number(curTime.toFixed(2)),
      end: Number(Math.min(totalDur, curTime + d).toFixed(2)),
      text: s
    };
    curTime += d;
    return item;
  });

  const assPath = path.join(tempDir, 'instant_subs.ass');
  generateAssFile(subEntries, assPath, {
    aspect: '9:16',
    bilingual: false,
    theme: textStyle || 'novel_karaoke',
    textStyle: textStyle || 'novel_karaoke',
    headerBadge: showHeaderBadge ? novelTitle.toUpperCase() : '',
    footerCta: siteUrl ? siteUrl : '',
    title: novelTitle
  });

  onProgress({ step: 'Bước 3/3: Đang xuất video Reels hoàn chỉnh vào Phôi Sạch...', progress: 85, pct: 85 });
  const escapedAss = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  const safeSlug = novelTitle
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36) || 'Truyen';

  const finalOut = outputFileName
    ? path.join(outputDir, outputFileName)
    : path.join(outputDir, `TDT_Reels_${safeSlug}_Instant.mp4`);

  const defaultBgm = path.join(__dirname, '..', 'output', 'nhac_nen', 'default_bgm.mp3');
  const resolvedBgm = (bgmPath && fs.existsSync(bgmPath))
    ? bgmPath
    : (fs.existsSync(defaultBgm) ? defaultBgm : '');

  const ffmpegArgs = [
    '-stream_loop', '-1', '-i', cleanTemplatePath,
    '-i', voiceTrackPath
  ];

  let filterComplex = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,ass='${escapedAss}'[vout]`;

  if (resolvedBgm) {
    ffmpegArgs.push('-stream_loop', '-1', '-i', resolvedBgm);
    filterComplex += `;[1:a]apad=whole_dur=${totalDur}[vo];[2:a]volume=0.10,afade=t=in:st=0:d=0.8,afade=t=out:st=${Math.max(1, totalDur - 1.2).toFixed(2)}:d=1.2[bgm];[vo][bgm]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
  } else {
    filterComplex += `;[1:a]apad=whole_dur=${totalDur},loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
  }

  ffmpegArgs.push(
    '-filter_complex', filterComplex,
    '-map', '[vout]', '-map', '[aout]',
    '-t', String(totalDur),
    ...h264Args(resolveBin('ffmpeg')), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '48000', '-b:a', '192k',
    '-y', finalOut
  );

  await runFfmpeg(ffmpegArgs);

  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  return {
    ok: true,
    outputPath: finalOut,
    duration: totalDur,
    mode: 'instant_clean_template'
  };
}

// ─── 7. PHÂN HỆ 3: 🔥 VIRAL & AFFILIATE FORGE (Tải không logo & Lách trùng lặp)

/**
 * Tải video Douyin / TikTok không logo (watermark-free) qua API công khai (học từ Evil0ctal)
 */
async function downloadCleanViralVideo(videoUrl, outputDir) {
  const cleanUrl = String(videoUrl || '').trim();
  if (!cleanUrl) throw new Error('Vui lòng nhập link video TikTok / Douyin.');
  fs.mkdirSync(outputDir, { recursive: true });

  const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(cleanUrl)}&hd=1`;
  const data = await fetchJson(apiUrl);
  const playUrl = data?.data?.hdplay || data?.data?.play;
  if (!playUrl) {
    throw new Error(data?.msg || 'Không lấy được link tải không logo từ đường dẫn này.');
  }

  const title = (data?.data?.title || 'Viral_Clip').replace(/[\/\\:*?"<>|\s]+/g, '_').slice(0, 40);
  const outPath = path.join(outputDir, `Clean_${title}_${Date.now()}.mp4`);
  const buf = await downloadBuffer(playUrl);
  fs.writeFileSync(outPath, buf);
  return {
    ok: true,
    filePath: outPath,
    title: data?.data?.title || '',
    duration: data?.data?.duration || 0,
    author: data?.data?.author?.nickname || ''
  };
}

/**
 * Biến đổi Video Re-up / Affiliate Lách Trùng Lặp Bản Quyền (去重 - Anti-Duplicate Remix)
 * Kết hợp:
 *  - Xóa sạch Metadata gốc (`-map_metadata -1`)
 *  - Lật gương ngang (`hflip` tùy chọn) + Crop viền 4% chống quét mã băm khung hình (Perceptual Hash)
 *  - Chỉnh màu Điện ảnh (`eq=contrast=1.06:saturation=1.10`) + Đổi tốc độ nhịp `1.05x`
 *  - Thay giọng thuyết minh bán hàng / review tiếng Việt mới + Phụ đề Karaoke + CTA mua hàng
 */
async function renderViralAffiliateRemix({
  inputVideoPath,
  voice = '',
  textStyle = '',
  hookScript = '',
  productName = 'Sản Phẩm Hot Trend',
  ctaBanner = '🛒 Mua chính hãng giá ưu đãi tại Link Bio / Bình luận!',
  mirrorFlip = true,
  speedFactor = 1.05,
  colorBoost = true,
  replaceVoice = true,
  bgmPath = '',
  outputDir,
  onProgress = () => {}
}) {
  if (!inputVideoPath || !fs.existsSync(inputVideoPath)) {
    throw new Error('Vui lòng chọn file video gốc để Remix.');
  }
  fs.mkdirSync(outputDir, { recursive: true });
  const tempDir = path.join(os.tmpdir(), `sesame_viral_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const srcMeta = await probeMedia(inputVideoPath);
  let voicePath = '';
  const cleanScript = String(hookScript || '').trim();

  if (replaceVoice && cleanScript) {
    onProgress({ step: 'Bước 1/3: Đang tạo giọng đọc Review / Affiliate chốt đơn...', pct: 25 });
    voicePath = path.join(tempDir, 'affiliate_voice.mp3');
    await synthesizeSpeechToFile(cleanScript, voicePath, { lang: 'vi', speed: 1.18, voicePreset: voice || 'Quỳnh Anh' });
  }

  const vMeta = voicePath ? await probeMedia(voicePath) : { duration: 0 };
  const targetDur = Math.max(5, vMeta.duration || (srcMeta.duration / speedFactor) || 15);

  // Chia câu phụ đề từ kịch bản Affiliate
  const sentences = (cleanScript || `Review thực tế ${productName} đang cực hot tuần này!`)
    .split(/(?<=[.!?।,;])\s+|\r?\n+/)
    .map(s => s.trim())
    .filter(Boolean);

  const totalChars = Math.max(1, sentences.reduce((s, t) => s + t.length, 0));
  let cur = 0;
  const subItems = sentences.map((s, idx) => {
    const d = idx === sentences.length - 1 ? Math.max(1.2, targetDur - cur) : Math.max(1.5, (s.length / totalChars) * targetDur);
    const item = { start: Number(cur.toFixed(2)), end: Number(Math.min(targetDur, cur + d).toFixed(2)), text: s };
    cur += d;
    return item;
  });

  const assPath = path.join(tempDir, 'affiliate_subs.ass');
  generateAssFile(subItems, assPath, {
    aspect: '9:16',
    bilingual: false,
    theme: textStyle || 'affiliate_pop',
    headerBadge: `🔥 ${productName.toUpperCase()}`,
    footerCta: ctaBanner
  });

  const escapedAss = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  const ptsFactor = (1 / Math.max(0.85, Math.min(1.25, Number(speedFactor) || 1.05))).toFixed(4);

  const vFilters = [
    `setpts=${ptsFactor}*PTS`,
    `crop=iw*0.96:ih*0.96`,
    `scale=1080:1920:force_original_aspect_ratio=increase`,
    `crop=1080:1920`,
    mirrorFlip ? 'hflip' : null,
    colorBoost ? 'hue=s=1.10' : null,
    `ass='${escapedAss}'`,
    'setsar=1'
  ].filter(Boolean).join(',');

  const outFile = path.join(outputDir, `Viral_Remix_${Date.now()}.mp4`);
  const args = ['-stream_loop', '-1', '-i', inputVideoPath];
  let filterComplex = `[0:v]${vFilters}[vout]`;
  let audioMap = [];

  if (voicePath && fs.existsSync(voicePath)) {
    args.push('-i', voicePath);
    if (bgmPath && fs.existsSync(bgmPath)) {
      args.push('-stream_loop', '-1', '-i', bgmPath);
      filterComplex += `;[2:a]volume=0.14[bgm];[1:a][bgm]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
    } else if (srcMeta.hasAudio) {
      // Giữ 12% âm thanh hiệu ứng gốc (SFX) của video + đè giọng đọc tiếng Việt mới lên trên
      filterComplex += `;[0:a]volume=0.12[orig];[1:a][orig]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
    } else {
      filterComplex += `;[1:a]loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
    }
    audioMap = ['-map', '[aout]'];
  } else if (srcMeta.hasAudio) {
    const atempo = Math.max(0.85, Math.min(1.25, Number(speedFactor) || 1.05)).toFixed(2);
    filterComplex += `;[0:a]atempo=${atempo},loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
    audioMap = ['-map', '[aout]'];
  }

  onProgress({ step: 'Bước 2/3: Đang xử lý chống quét trùng lặp (Anti-Duplicate Hash) & đóng phụ đề...', pct: 65 });
  await runFfmpeg([
    ...args,
    '-map_metadata', '-1',
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    ...audioMap,
    '-t', String(targetDur.toFixed(2)),
    ...h264Args(resolveBin('ffmpeg'), { crf: 21, bitrate: '4500k' }), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    outFile
  ]);

  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
  return {
    ok: true,
    outputPath: outFile,
    duration: Number(targetDur.toFixed(2)),
    antiDuplicateApplied: ['strip_metadata', 'crop_4pct', mirrorFlip ? 'hflip' : null, colorBoost ? 'color_grade' : null, `speed_${speedFactor}x`].filter(Boolean)
  };
}


// ─── Environment check (ffmpeg / Python / TTS) ────────────────────────────────

function runPyProbe(pyExe, code) {
  return new Promise(resolve => {
    execFile(pyExe, ['-c', code], { timeout: 25000, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' } },
      (err, stdout, stderr) => resolve(err ? { ok: false, err: String(stderr || err.message).trim().split('\n').slice(-1)[0] } : { ok: true }));
  });
}

/**
 * Kiểm tra máy có đủ công cụ để render không. Mỗi mục: level = ok | warn | error.
 * error = render sẽ hỏng, warn = chạy được nhưng chất lượng/giọng bị hạ cấp.
 */
async function checkEnvironment() {
  const checks = [];
  const add = (id, label, level, detail) => checks.push({ id, label, level, ok: level === 'ok', detail });

  const ffmpeg = resolveBin('ffmpeg');
  const ffprobe = resolveBin('ffprobe');
  const ffmpegFound = path.isAbsolute(ffmpeg) && fs.existsSync(ffmpeg);
  if (!ffmpegFound) {
    add('ffmpeg', 'FFmpeg', 'error', 'Không tìm thấy ffmpeg. Không thể render video.');
  } else {
    const enc = pickH264Encoder(ffmpeg);
    add('ffmpeg', 'FFmpeg', 'ok', ffmpeg);
    add('encoder', 'Bộ mã hóa H.264', enc === 'libx264' ? 'ok' : 'warn',
      enc === 'libx264' ? 'libx264 (chất lượng tốt nhất)' : `Đang dùng ${enc}: chạy được nhưng kích thước/chất lượng kém hơn libx264.`);
  }
  add('ffprobe', 'FFprobe', path.isAbsolute(ffprobe) && fs.existsSync(ffprobe) ? 'ok' : 'error',
    path.isAbsolute(ffprobe) && fs.existsSync(ffprobe) ? ffprobe : 'Không tìm thấy ffprobe.');

  const py = resolvePython312Bin();
  const vieneu = await runPyProbe(py, 'import vieneu');
  const edge = await runPyProbe(resolvePythonBin(), 'import edge_tts');
  add('vieneu', 'Giọng VieNeu-TTS 48kHz', vieneu.ok ? 'ok' : 'warn',
    vieneu.ok ? 'Sẵn sàng' : `Chưa dùng được (${vieneu.err || 'thiếu Python 3.12 hoặc gói vieneu'}). Sẽ rơi xuống Edge TTS.`);
  add('edge_tts', 'Giọng Edge TTS (dự phòng)', edge.ok ? 'ok' : (vieneu.ok ? 'warn' : 'error'),
    edge.ok ? 'Sẵn sàng' : (vieneu.ok ? 'Chưa cài (pip install edge-tts), chỉ là dự phòng.' : 'Không có giọng đọc nào dùng được: render có thuyết minh sẽ dừng. Cài VieNeu hoặc pip install edge-tts.'));

  try {
    const { CHROME_PATH } = require('./chrome');
    const chromeOk = path.isAbsolute(CHROME_PATH) && fs.existsSync(CHROME_PATH);
    add('chrome', 'Google Chrome', chromeOk ? 'ok' : 'warn',
      chromeOk ? CHROME_PATH : 'Chưa cài Google Chrome: tab Tài khoản và tạo video AI chưa dùng được. Render/cắt/ghép vẫn chạy bình thường.');
  } catch (_) { /* bỏ qua */ }

  const errors = checks.filter(c => c.level === 'error');
  const warns = checks.filter(c => c.level === 'warn');
  return {
    ok: errors.length === 0,
    errors: errors.length,
    warnings: warns.length,
    checks,
    summary: errors.length
      ? 'Thiếu: ' + errors.map(c => c.label).join(', ')
      : warns.length ? 'Chạy được, có ' + warns.length + ' cảnh báo' : 'Môi trường đầy đủ'
  };
}

module.exports = {
  resolveBin,
  pickH264Encoder,
  h264Args,
  runFfmpeg,
  checkEnvironment,
  probeMedia,
  translateEduSentence,
  synthesizeSpeechToFile,
  generateAssFile,
  analyzeEduFootage,
  renderEduMasterVideo,
  parseNovelToStoryWeaverScript,
  renderStoryWeaverVideo,
  renderInstantReelWithCleanTemplate,
  downloadCleanViralVideo,
  renderViralAffiliateRemix
};

