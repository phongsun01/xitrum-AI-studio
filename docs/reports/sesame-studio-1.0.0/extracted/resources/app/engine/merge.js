/**
 * GHÉP VIDEO — ffmpeg concat + chống tua nhanh (normalize timeline) + % tiến độ.
 */
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { h264Args } = require('./h264');

// Tên file ra: bỏ ký tự cấm, thêm .mp4, trùng thì -2, -3...
function safeName(dir, name) {
  let base = String(name || '').trim().replace(/\.mp4$/i, '');
  if (!base) base = `Muse_${Date.now()}_ghep`;
  base = base.replace(/[\/\\:*?"<>|\x00-\x1f]/g, '-').replace(/^\.+/, '').slice(0, 100) || 'ghep';
  let out = path.join(dir, base + '.mp4');
  for (let k = 2; fs.existsSync(out); k++) out = path.join(dir, `${base}-${k}.mp4`);
  return out;
}

const concatList = files => files.map(p => `file '${p.replace(/'/g, `'\\''`)}'`).join('\n');

const parseDuration = s => { const n = parseFloat(s); return Number.isFinite(n) && n > 0 ? n : 0; };

// Đoạn stdout của -progress → % (tối đa 99 tới khi xong); không biết tổng → null
function progressPct(chunk, total) {
  const all = [...String(chunk).matchAll(/out_time_us=(\d+)/g)];
  if (!total || !all.length) return null;
  return Math.min(99, Math.round(Number(all.at(-1)[1]) / 1e6 / total * 100));
}

const duration = (ffprobe, file) => new Promise(r => {
  if (!ffprobe) return r(0);
  execFile(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], (err, out) => r(err ? 0 : parseDuration(out)));
});

const streamMeta = (ffprobe, file) => new Promise(r => {
  if (!ffprobe) return r({});
  execFile(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate,time_base,width,height', '-of', 'json', file], (err, out) => {
    try {
      const s = JSON.parse(out).streams?.[0] || {};
      r({ fps: s.r_frame_rate || '', timeBase: s.time_base || '', width: s.width || 0, height: s.height || 0 });
    } catch {
      r({});
    }
  });
});

// Ghép video an toàn: tự động phát hiện lệch framerate/timebase để chuẩn hóa timeline 30fps chống tua nhanh
async function merge({ ffmpeg, ffprobe, files, out, tmpDir, normalize = false, onProgress = () => {} }) {
  let total = 0;
  for (const f of files) total += await duration(ffprobe, f);
  const listFile = path.join(tmpDir, `sesame_concat_${Date.now()}.txt`);
  fs.writeFileSync(listFile, concatList(files));

  let shouldReencode = Boolean(normalize);
  if (!shouldReencode && ffprobe && files.length > 1) {
    try {
      const metas = await Promise.all(files.map(f => streamMeta(ffprobe, f)));
      const base = metas[0];
      for (let i = 1; i < metas.length; i++) {
        if (metas[i].fps !== base.fps || metas[i].timeBase !== base.timeBase || metas[i].width !== base.width || metas[i].height !== base.height) {
          shouldReencode = true;
          break;
        }
      }
    } catch {}
  }

  // Khi re-encode: dùng libx264 veryfast 30fps CFR, âm thanh 44.1kHz AAC chống tua nhanh tuyệt đối
  // Khi copy: thêm -avoid_negative_ts make_zero -fflags +genpts để khử lỗi giật timestamp
  const args = shouldReencode
    ? ['-y', '-f', 'concat', '-safe', '0', '-i', listFile,
       ...h264Args(ffmpeg, { crf: 20 }), '-r', '30', '-pix_fmt', 'yuv420p',
       '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
       '-c:a', 'aac', '-b:a', '192k', '-ar', '44100',
       '-avoid_negative_ts', 'make_zero', '-fflags', '+genpts',
       '-progress', 'pipe:1', '-nostats', out]
    : ['-y', '-f', 'concat', '-safe', '0', '-i', listFile,
       '-c', 'copy',
       '-avoid_negative_ts', 'make_zero', '-fflags', '+genpts',
       '-progress', 'pipe:1', '-nostats', out];

  return new Promise(resolve => {
    const p = spawn(ffmpeg, args);
    let err = '';
    p.stdout.on('data', d => { const pct = progressPct(d, total); if (pct !== null) onProgress(pct); });
    p.stderr.on('data', d => { err = (err + d).slice(-2000); });
    p.on('error', e => { err = e.message; });
    p.on('close', code => {
      fs.unlink(listFile, () => {});
      if (code !== 0) return resolve({ success: false, error: err.trim().split('\n').slice(-2).join(' ') || `ffmpeg lỗi ${code}` });
      onProgress(100);
      resolve({ success: true, path: out, reencoded: shouldReencode });
    });
  });
}

// NHẠC NỀN — phân loại theo cảm xúc, lặp/cắt cho vừa video, hòa âm thông minh (sidechain ducking).
const MUSIC_EXT = /\.(mp3|m4a|aac|wav|ogg|flac)$/i;
const MOOD_ALIASES = {
  emotional: ['cam_dong', 'tinh_cam', 'sad', 'piano', 'tam_trang', 'xuc_dong', 'romance'],
  dramatic: ['kich_tinh', 'cang_thang', 'suspense', 'action', 'epic', 'climax', 'chase'],
  funny: ['hai_huoc', 'vui_tuoi', 'comedy', 'happy', 'fun', 'upbeat'],
  horror: ['kinh_di', 'bi_an', 'scary', 'dark', 'creep'],
  inspiring: ['truyen_cam_hung', 'hao_hung', 'hope', 'lifestyle', 'corporate']
};

function musicFiles(dir, mood = '') {
  if (!dir || typeof dir !== 'string') return [];
  try {
    const all = [];
    const scan = (d, depth = 0) => {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const full = path.join(d, e.name);
        if (e.isFile() && MUSIC_EXT.test(e.name)) all.push(full);
        else if (e.isDirectory() && depth < 2) scan(full, depth + 1);
      }
    };
    scan(dir);
    if (!all.length) return [];
    if (!mood) return all;

    const mLow = mood.toLowerCase().trim();
    const aliases = MOOD_ALIASES[mLow] || [mLow];
    const matched = all.filter(p => {
      const pLow = p.toLowerCase();
      return aliases.some(a => pLow.includes(a));
    });
    return matched.length ? matched : all;
  } catch (e) {
    return [];
  }
}

// Núm chỉnh: mức nhạc dưới giọng đọc. Video câm → 80%.
const MUSIC_UNDER_VOICE = 0.15, MUSIC_ALONE = 0.8;
function musicArgs({ video, music, out, secs, hasAudio, smartDucking = true }) {
  const fade = Math.max(0, secs - 2).toFixed(2);
  let filter;
  if (hasAudio) {
    if (smartDucking) {
      // Dynamic sidechain ducking: khi có tiếng nói thì nhạc tự nén hạ xuống nhẹ nhàng,
      // khi người đọc dừng hoặc đoạn cao trào cuối thì nhạc tự dâng lên đầy đặn!
      filter = `[1:a]volume=0.40,afade=t=in:d=1,afade=t=out:st=${fade}:d=2[bgm_in];` +
        `[bgm_in][0:a]sidechaincompress=threshold=0.08:ratio=4.5:attack=150:release=650[ducked];` +
        `[0:a][ducked]amix=inputs=2:duration=first:normalize=0[a]`;
    } else {
      const m = `[1:a]volume=${MUSIC_UNDER_VOICE},afade=t=in:d=1,afade=t=out:st=${fade}:d=2`;
      filter = `${m}[m];[0:a][m]amix=inputs=2:duration=first:normalize=0[a]`;
    }
  } else {
    filter = `[1:a]volume=${MUSIC_ALONE},afade=t=in:d=1,afade=t=out:st=${fade}:d=2[a]`;
  }
  return ['-y', '-i', video, '-stream_loop', '-1', '-i', music, '-filter_complex', filter,
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', String(secs), out];
}

const hasAudioStream = (ffprobe, file) => new Promise(r =>
  execFile(ffprobe, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file], (err, out) => r(!err && out.trim() !== '')));

async function addMusic({ ffmpeg, ffprobe, video, music, out, smartDucking = true }) {
  const secs = await duration(ffprobe, video);
  if (!secs) return { success: false, error: 'Không đọc được thời lượng video' };
  const args = musicArgs({ video, music, out, secs, hasAudio: await hasAudioStream(ffprobe, video), smartDucking });
  return new Promise(resolve => execFile(ffmpeg, args, { maxBuffer: 1 << 24 }, err =>
    resolve(err ? { success: false, error: String(err.message).trim().split('\n').slice(-2).join(' ') } : { success: true, path: out, music })));
}

const os = require('os');
function resolveBin(n) {
  const isMac = process.platform === 'darwin';
  const exe = isMac ? n : n + '.exe';
  const dirs = [
    process.resourcesPath && path.join(process.resourcesPath, 'bin'),
    path.join(__dirname, '..', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin'
  ].filter(Boolean);
  const found = dirs.map(d => path.join(d, exe)).find(p => fs.existsSync(p));
  return found || n;
}

async function mergeVideos(files, out, opts = {}) {
  return merge({
    ffmpeg: opts.ffmpeg || resolveBin('ffmpeg'),
    ffprobe: opts.ffprobe || resolveBin('ffprobe'),
    files,
    out,
    tmpDir: opts.tmpDir || os.tmpdir(),
    normalize: opts.normalize ?? true,
    onProgress: opts.onProgress || (() => {})
  });
}

module.exports = { safeName, concatList, parseDuration, progressPct, merge, mergeVideos, resolveBin, musicFiles, musicArgs, addMusic };
