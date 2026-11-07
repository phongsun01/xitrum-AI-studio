const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

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

/**
 * Trích xuất track âm thanh gốc từ video
 */
async function extractAudioFromVideo(videoPath, outputAudioPath) {
  const ffmpeg = getFfmpegPath();
  const outPath = outputAudioPath || path.join(path.dirname(videoPath), `${path.basename(videoPath, path.extname(videoPath))}_extracted.wav`);

  const args = [
    '-y',
    '-i', videoPath,
    '-vn',
    '-acodec', 'pcm_s16le',
    '-ar', '16000',
    '-ac', '1',
    outPath
  ];

  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, args, { windowsHide: true });
    p.on('close', (code) => {
      if (code === 0 && fs.existsSync(outPath)) {
        resolve({ ok: true, audioPath: outPath });
      } else {
        reject(new Error(`Trích xuất âm thanh thất bại mã ${code}`));
      }
    });
    p.on('error', reject);
  });
}

/**
 * Tạo SRT giả định theo khoảng lặng (VAD) khi video không có sẵn SRT
 */
async function generateTimecodeSlots(duration, intervalSec = 3.5) {
  const cues = [];
  let t = 0;
  let id = 1;

  while (t < duration) {
    const startSec = t;
    const endSec = Math.min(t + intervalSec, duration);
    if (endSec - startSec < 1.0) break;

    const formatTc = (sec) => {
      const h = Math.floor(sec / 3600).toString().padStart(2, '0');
      const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
      const s = Math.floor(sec % 60).toString().padStart(2, '0');
      const ms = Math.floor((sec % 1) * 1000).toString().padStart(3, '0');
      return `${h}:${m}:${s},${ms}`;
    };

    cues.push({
      id: String(id),
      startTime: formatTc(startSec),
      endTime: formatTc(endSec),
      text: `[Câu thoại #${id}]`
    });

    t = endSec + 0.3; // nghỉ 300ms
    id++;
  }

  return cues;
}

module.exports = {
  extractAudioFromVideo,
  generateTimecodeSlots
};
