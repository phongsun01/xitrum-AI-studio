const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const h264 = require('../h264');
const toolkitTranslator = require('./toolkit-translator');
const toolkitTts = require('./toolkit-capcut-tts');

// Định vị ffmpeg trong Sesame Studio hoặc PATH hệ thống
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

function timecodeToSeconds(tc) {
  const parts = tc.replace(',', '.').split(':');
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  }
  return 0;
}

/**
 * Trích xuất phụ đề và tạo file âm thanh lồng tiếng hoàn chỉnh
 */
async function generateDubbingTrack(cues, voiceId, outputAudioPath, onProgress = () => {}) {
  const tmpDir = path.join(path.dirname(outputAudioPath), `tmp_tts_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const audioSegments = [];
  const total = cues.length;

  for (let i = 0; i < total; i++) {
    const cue = cues[i];
    const segPath = path.join(tmpDir, `cue_${i}.mp3`);
    onProgress({ stage: 'tts', current: i + 1, total, text: cue.text });

    try {
      await toolkitTts.synthesizeVoice({
        text: cue.text,
        voiceId: voiceId,
        outPath: segPath
      });
      const startSec = timecodeToSeconds(cue.startTime);
      audioSegments.push({ path: segPath, startSec });
    } catch (err) {
      console.warn(`Lỗi tạo TTS cho câu ${i + 1}:`, err.message);
    }
  }

  // Ghép các phân đoạn âm thanh vào trục thời gian bằng FFmpeg amix hoặc concat với delay
  // Dùng filter adelay
  const ffmpeg = getFfmpegPath();
  const filterInputs = [];
  const filterComplex = [];

  audioSegments.forEach((seg, idx) => {
    filterInputs.push('-i', seg.path);
    const delayMs = Math.round(seg.startSec * 1000);
    filterComplex.push(`[${idx}:a]adelay=${delayMs}|${delayMs}[a${idx}]`);
  });

  const mixInputs = audioSegments.map((_, idx) => `[a${idx}]`).join('');
  filterComplex.push(`${mixInputs}amix=inputs=${audioSegments.length}:dropout_transition=0:normalize=0[aout]`);

  const args = [
    '-y',
    ...filterInputs,
    '-filter_complex', filterComplex.join(';'),
    '-map', '[aout]',
    '-c:a', 'aac',
    '-b:a', '192k',
    outputAudioPath
  ];

  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, args, { windowsHide: true });
    p.on('close', (code) => {
      // Dọn dẹp file tạm
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}

      if (code === 0 && fs.existsSync(outputAudioPath)) {
        resolve({ ok: true, outputAudioPath });
      } else {
        reject(new Error(`FFmpeg lỗi trộn âm thanh mã ${code}`));
      }
    });
    p.on('error', reject);
  });
}

const toolkitCut = require('./toolkit-cut');
const toolkitOcr = require('./toolkit-ocr');

module.exports = {
  toolkitTranslator,
  toolkitTts,
  toolkitCut,
  toolkitOcr,
  generateDubbingTrack
};
