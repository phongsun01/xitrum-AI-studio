// IPC bổ sung cho các tab Cắt video / Tách âm / Dịch SRT. Không đụng logic cũ.
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { h264Args } = require('./h264');
const merge = require('./merge');
const translator = require('./toolkit/toolkit-translator');

function ffmpegPath() {
  return merge.resolveBin('ffmpeg');
}
function ffprobePath() {
  return merge.resolveBin('ffprobe');
}

function run(args, onLine) {
  return new Promise((resolve) => {
    const p = spawn(ffmpegPath(), args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { const s = d.toString(); err = (err + s).slice(-4000); onLine && onLine(s); });
    p.on('error', (e) => resolve({ ok: false, error: e.message }));
    p.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: `ffmpeg lỗi (mã ${code}): ${err.split('\n').slice(-4).join(' ').trim()}` }));
  });
}

function probeAudio(file) {
  return new Promise((resolve) => {
    execFile(ffprobePath(), ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels,duration', '-of', 'json', file],
      { windowsHide: true }, (e, out) => {
        if (e) return resolve({ ok: false, error: e.message });
        try { const s = JSON.parse(out).streams?.[0]; resolve(s ? { ok: true, channels: s.channels, duration: parseFloat(s.duration || 0) } : { ok: false, error: 'Không có luồng âm thanh' }); }
        catch (x) { resolve({ ok: false, error: x.message }); }
      });
  });
}

// atempo chỉ nhận 0.5–2.0 mỗi bước
function atempoChain(speed) {
  const parts = []; let s = speed;
  while (s > 2.0) { parts.push('atempo=2.0'); s /= 2.0; }
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  parts.push(`atempo=${s.toFixed(4)}`);
  return parts.join(',');
}

function register({ ipcMain, dialog, getWindow, app, defaultOutputDir, sendProgress }) {
  const settingsFile = () => path.join(app.getPath('userData'), 'features-settings.json');
  const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch (_) { return {}; } };

  ipcMain.handle('feat:pick', async (_e, { kind = 'video' } = {}) => {
    const filters = {
      video: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi'] }],
      media: [{ name: 'Âm thanh / Video', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'mp4', 'mov', 'mkv', 'webm'] }],
      srt: [{ name: 'Phụ đề / Video', extensions: ['srt', 'mp4', 'mov', 'mkv'] }]
    }[kind] || [];
    // Chỉ dùng khi chạy thử tự động: thay hộp thoại chọn file gốc của Windows bằng đường dẫn đặt sẵn (SESAME_E2E_PICK={"video":"...","srt":"..."})
    if (process.env.SESAME_E2E_PICK) { try { const m = JSON.parse(process.env.SESAME_E2E_PICK); if (m[kind]) return m[kind]; } catch (_) {} }
    const r = await dialog.showOpenDialog(getWindow(), { properties: ['openFile'], filters });
    return r.canceled ? '' : (r.filePaths[0] || '');
  });

  ipcMain.handle('feat:read-text', async (_e, file) => {
    try { return { ok: true, text: fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '') }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('feat:save-text', async (_e, { defaultName = 'phude.srt', text = '' } = {}) => {
    const r = await dialog.showSaveDialog(getWindow(), { defaultPath: path.join(defaultOutputDir(), defaultName), filters: [{ name: 'SRT', extensions: ['srt'] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, text, 'utf8');
    return { ok: true, path: r.filePath };
  });

  ipcMain.handle('feat:copy-save', async (_e, { src, defaultName }) => {
    const r = await dialog.showSaveDialog(getWindow(), { defaultPath: path.join(defaultOutputDir(), defaultName || path.basename(src)) });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.copyFileSync(src, r.filePath);
    return { ok: true, path: r.filePath };
  });

  ipcMain.handle('feat:get-settings', () => { const s = readSettings(); return { provider: s.provider || 'local', hasKey: !!s.apiKey }; });
  ipcMain.handle('feat:save-settings', (_e, p = {}) => {
    const s = { ...readSettings() };
    if (p.provider) s.provider = p.provider;
    if (typeof p.apiKey === 'string' && p.apiKey.trim()) s.apiKey = p.apiKey.trim();
    fs.writeFileSync(settingsFile(), JSON.stringify(s), 'utf8');
    return { ok: true };
  });

  // Cắt + tốc độ + độ phân giải (mã hoá lại để cắt chính xác từng khung)
  ipcMain.handle('feat:cut-export', async (_e, p = {}) => {
    const { videoPath, startSec = 0, endSec, speed = 1, res = 'source' } = p;
    if (!videoPath || !fs.existsSync(videoPath)) return { ok: false, error: 'Không tìm thấy video' };
    if (!(endSec > startSec)) return { ok: false, error: 'Khoảng cắt không hợp lệ (kết thúc phải sau bắt đầu)' };
    const out = p.outputPath || path.join(defaultOutputDir(), `${path.basename(videoPath, path.extname(videoPath))}_cut_${Date.now()}.mp4`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const sp = Math.min(4, Math.max(0.25, Number(speed) || 1));
    const vf = [];
    if (sp !== 1) vf.push(`setpts=PTS/${sp}`);
    const h = { '720p': 720, '1080p': 1080, '2k': 1440 }[res];
    if (h) vf.push(`scale=-2:${h}`);
    const args = ['-y', '-ss', String(startSec), '-to', String(endSec), '-i', videoPath];
    if (vf.length) args.push('-vf', vf.join(','));
    if (sp !== 1) args.push('-af', atempoChain(sp));
    args.push(...h264Args(ffmpegPath()), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out);
    const r = await run(args, (s) => { const m = s.match(/time=(\d+):(\d+):([\d.]+)/); if (m) sendProgress('feat', { stage: 'cut', sec: +m[1] * 3600 + +m[2] * 60 + +m[3] }); });
    return r.ok ? { ok: true, outputPath: out } : r;
  });

  // Tách giọng / nhạc nền bằng bộ lọc ffmpeg (xấp xỉ: triệt/giữ kênh giữa). KHÔNG phải AI như Demucs.
  ipcMain.handle('feat:audio-separate', async (_e, p = {}) => {
    const { inputPath } = p;
    if (!inputPath || !fs.existsSync(inputPath)) return { ok: false, error: 'Không tìm thấy file' };
    const info = await probeAudio(inputPath);
    if (!info.ok) return info;
    if (info.channels < 2) return { ok: false, error: 'File là mono nên không tách được bằng cách triệt kênh giữa. Cần file stereo (hoặc dùng model AI như Demucs).' };
    const dir = path.join(defaultOutputDir(), `tach_am_${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    const base = path.basename(inputPath, path.extname(inputPath));
    const vocal = path.join(dir, `${base}_vocal.wav`);
    const bgm = path.join(dir, `${base}_bgm.wav`);
    const enhanced = p.quality === 'enhanced';
    const vAf = 'pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1,highpass=f=100,lowpass=f=8000' + (enhanced ? ',afftdn=nf=-25,dynaudnorm' : ',dynaudnorm');
    const bAf = 'pan=stereo|c0=c0-c1|c1=c1-c0,volume=1.6' + (enhanced ? ',dynaudnorm' : '');
    sendProgress('feat', { stage: 'audio', step: 1, total: 2 });
    const r1 = await run(['-y', '-i', inputPath, '-vn', '-af', vAf, '-ar', '44100', vocal]);
    if (!r1.ok) return r1;
    sendProgress('feat', { stage: 'audio', step: 2, total: 2 });
    const r2 = await run(['-y', '-i', inputPath, '-vn', '-af', bAf, '-ar', '44100', bgm]);
    if (!r2.ok) return r2;
    return { ok: true, vocalPath: vocal, bgmPath: bgm, dir, method: 'ffmpeg-center-channel' };
  });

  ipcMain.handle('feat:translate', async (_e, { cues = [], genre = 'modern', provider } = {}) => {
    const s = readSettings();
    const prov = provider || s.provider || 'local';
    const res = await translator.translateCues(cues, { genre, provider: prov, apiKey: s.apiKey || '' });
    return res && res.ok ? { ok: true, cues: res.cues, method: res.method || prov, usedKey: !!s.apiKey && prov !== 'local' } : (res || { ok: false, error: 'Dịch thất bại' });
  });

  ipcMain.handle('feat:parse-srt', (_e, text) => ({ ok: true, cues: translator.parseSrt(String(text || '')) }));
  ipcMain.handle('feat:cues-to-srt', (_e, cues) => ({ ok: true, text: translator.cuesToSrt(cues || []) }));
  require('./ipc-dub').register({ ipcMain, defaultOutputDir, sendProgress });
  require('./ipc-tts').register({ ipcMain, defaultOutputDir, sendProgress });
  require('./ipc-tools').register({ ipcMain, dialog, getWindow, defaultOutputDir, sendProgress });
  require('./ipc-review').register({ ipcMain, readSettings, sendProgress });
}

module.exports = { register };
