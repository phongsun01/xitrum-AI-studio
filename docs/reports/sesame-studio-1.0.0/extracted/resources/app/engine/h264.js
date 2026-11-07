/**
 * H264 ENCODER PICKER
 * ffmpeg đóng gói theo app (bin/) chỉ có libopenh264, còn bản full build mới có libx264.
 * Module này dò encoder thật sự có trong binary đang dùng và trả đúng tham số,
 * để render không lỗi khi chạy trên máy không có C:\tools\ffmpeg.
 */
const { execFileSync } = require('child_process');

// Thứ tự ưu tiên: libx264 -> libopenh264 -> NVENC -> AMD AMF -> MediaFoundation -> QSV
const PREFERRED = ['libx264', 'libopenh264', 'h264_nvenc', 'h264_amf', 'h264_mf', 'h264_qsv'];

const cache = new Map();

function resolveDefaultFfmpeg() {
  try {
    const merger = require('./merge');
    if (typeof merger.resolveBin === 'function') return merger.resolveBin('ffmpeg');
  } catch (_) {}
  return 'ffmpeg';
}

function listEncoders(ffmpegPath) {
  try {
    return execFileSync(ffmpegPath, ['-hide_banner', '-encoders'], {
      encoding: 'utf8', timeout: 15000, windowsHide: true
    });
  } catch (_) {
    return '';
  }
}

/** Trả về tên encoder H.264 dùng được. Không dò được thì kiểm tra binary hoặc trả 'libopenh264'. */
function pickH264Encoder(ffmpegPath) {
  const bin = ffmpegPath || resolveDefaultFfmpeg();
  if (cache.has(bin)) return cache.get(bin);
  const out = listEncoders(bin);
  let chosen = 'libopenh264';
  if (out) {
    const found = PREFERRED.find(name => new RegExp(`\\s${name}\\s`).test(out));
    if (found) chosen = found;
  }
  cache.set(bin, chosen);
  return chosen;
}

/**
 * Tham số video cho encoder tương ứng.
 *  libx264      -> -preset/-crf
 *  còn lại      -> không có crf/preset nên dùng bitrate
 */
function h264Args(ffmpegPath, { crf = 19, preset = 'veryfast', bitrate = '6000k', encoder } = {}) {
  const enc = encoder || pickH264Encoder(ffmpegPath);
  if (enc === 'libx264') return ['-c:v', 'libx264', '-preset', preset, '-crf', String(crf)];
  return ['-c:v', enc, '-b:v', bitrate];
}

module.exports = { pickH264Encoder, h264Args, PREFERRED };
