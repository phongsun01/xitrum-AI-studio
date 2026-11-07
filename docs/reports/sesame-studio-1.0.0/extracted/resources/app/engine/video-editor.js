/**
 * ENGINE EDIT / GHÉP VIDEO THEO DỰ ÁN
 * - Dự án lưu thành JSON trong thư mục do main.js truyền vào (userData/edit-projects).
 * - Xuất MP4 bằng ffmpeg: mỗi clip trim/tốc độ/âm lượng -> chuẩn hoá khung hình -> concat
 *   -> chữ / watermark / phụ đề -> trộn nhạc nền + giọng lồng.
 * Bộ lọc được ghi ra file (-filter_complex_script) để không phải escape dòng lệnh.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const merger = require('./merge');
const h264 = require('./h264');
const planner = require('./video-editor-plan');

const FONT_REGULAR = 'C:/Windows/Fonts/arial.ttf';   // có đủ dấu tiếng Việt
const FONT_BOLD = 'C:/Windows/Fonts/arialbd.ttf';

function ffmpegBin() { return merger.resolveBin('ffmpeg'); }
function ffprobeBin() { return merger.resolveBin('ffprobe'); }

function newId() { return 'prj_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function round3(n) { return Math.round(Number(n) * 1000) / 1000; }
function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }

/* ---------------- dự án ---------------- */
function emptyProject(name) {
  return {
    id: newId(), name: name || 'Dự án mới', createdAt: Date.now(), updatedAt: Date.now(),
    aspect: 'source',            // source | 9:16 | 16:9 | 1:1
    clips: [],                   // { id, path, name, duration, srcDuration, in, out, speed, volume, hasAudio, width, height }
    music: { path: '', volume: 30 },
    dub: { path: '', volume: 100 },
    origVolume: 100,
    texts: [],                   // { id, text, start, end, size, color, x, y }   x,y = 0..1 (tâm chữ)
    overlays: [],
    masks: [],
    audioSegs: [],
    watermark: { text: '', image: '', pos: 'br', opacity: 70, size: 28 },
    srt: ''
  };
}

function projectPath(dir, id) { return path.join(dir, String(id).replace(/[^\w-]/g, '') + '.json'); }

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function totalDuration(p) {
  return planner.totalDuration(p);   // đã trừ phần chồng của chuyển cảnh
}
function clipLen(c) {
  const sp = clamp(Number(c.speed) || 1, 0.25, 4);
  return Math.max(0, (Number(c.out) - Number(c.in)) / sp);
}

function listProjects(dir) {
  ensureDir(dir);
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const cover = path.join(dir, p.id + '.jpg');
      let size = 0;
      for (const c of (p.clips || [])) { try { size += fs.statSync(c.path).size; } catch (_) {} }
      out.push({ id: p.id, name: p.name, updatedAt: p.updatedAt, clips: (p.clips || []).length, duration: totalDuration(p), size, cover: fs.existsSync(cover) ? cover : '' });
    } catch (_) { /* file hỏng: bỏ qua */ }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

function loadProject(dir, id) {
  const f = projectPath(dir, id);
  if (!fs.existsSync(f)) return { ok: false, error: 'Không tìm thấy dự án' };
  const p = JSON.parse(fs.readFileSync(f, 'utf8'));
  // báo clip nào đã mất file nguồn (để UI cảnh báo thay vì lỗi lúc xuất)
  const missing = (p.clips || []).filter(c => !fs.existsSync(c.path)).map(c => c.name || c.path);
  return { ok: true, project: p, missing };
}

async function saveProject(dir, project) {
  ensureDir(dir);
  const p = { ...emptyProject(), ...project };
  if (!p.id) p.id = newId();
  p.updatedAt = Date.now();
  fs.writeFileSync(projectPath(dir, p.id), JSON.stringify(p, null, 2), 'utf8');
  // ảnh bìa = khung hình đầu tiên của clip đầu (best effort)
  const first = (p.clips || [])[0];
  if (first && fs.existsSync(first.path)) {
    await new Promise(res => execFile(ffmpegBin(), ['-y', '-ss', String(first.in || 0), '-i', first.path, '-frames:v', '1', '-vf', 'scale=320:-2', path.join(dir, p.id + '.jpg')], { windowsHide: true }, () => res()));
  }
  return { ok: true, id: p.id, duration: totalDuration(p) };
}

function deleteProject(dir, id) {
  for (const ext of ['.json', '.jpg']) {
    const f = path.join(dir, String(id).replace(/[^\w-]/g, '') + ext);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  return { ok: true };
}

/* ---------------- đọc thông số ---------------- */
function probe(file) {
  return new Promise(resolve => {
    if (!file || !fs.existsSync(file)) return resolve({ ok: false, error: 'Không thấy file: ' + file });
    execFile(ffprobeBin(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { windowsHide: true, maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve({ ok: false, error: err.message.slice(0, 200) });
      try {
        const j = JSON.parse(stdout);
        const v = (j.streams || []).find(s => s.codec_type === 'video');
        const a = (j.streams || []).find(s => s.codec_type === 'audio');
        resolve({
          ok: true, path: file, name: path.basename(file),
          duration: round3(Number(j.format && j.format.duration) || 0),
          width: v ? v.width : 0, height: v ? v.height : 0,
          hasVideo: !!v, hasAudio: !!a,
          sizeMB: (Number(j.format && j.format.size || 0) / 1048576).toFixed(2)
        });
      } catch (e) { resolve({ ok: false, error: e.message }); }
    });
  });
}

/* ---------------- dựng bộ lọc: chuyển sang video-editor-plan.js ---------------- */
const buildPlan = planner.buildPlan;

/* ---------------- xuất ---------------- */
function exportProject(project, outPath, onProgress, opts = {}) {
  return new Promise((resolve) => {
    let tmpDir = '';
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sesame-edit-'));
      const plan = buildPlan(project, tmpDir, { preview: !!opts.preview });
      const scriptFile = path.join(tmpDir, 'graph.txt');
      fs.writeFileSync(scriptFile, plan.script, 'utf8');
      const ffmpeg = ffmpegBin();
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      const args = ['-y', '-hide_banner', '-nostats', '-progress', 'pipe:1', ...plan.inputs,
        '-filter_complex_script', scriptFile, '-map', '[vout]', '-map', '[aout]',
        ...(opts.preview ? h264.h264Args(ffmpeg, { crf: 32, bitrate: '900k', preset: 'ultrafast' }) : h264.h264Args(ffmpeg, { crf: 20, bitrate: '5000k' })),
        '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', plan.total.toFixed(3), '-movflags', '+faststart', outPath];
      const p = spawn(ffmpeg, args, { windowsHide: true });
      let err = '';
      p.stderr.on('data', d => { err += d.toString(); if (err.length > 8000) err = err.slice(-8000); });
      p.stdout.on('data', d => {
        const m = /out_time_ms=(\d+)/.exec(d.toString());
        if (m && onProgress) onProgress({ percent: clamp(Math.round(Number(m[1]) / 1e6 / plan.total * 100), 0, 99) });
      });
      p.on('error', e => { cleanup(); resolve({ ok: false, error: e.message }); });
      p.on('close', code => {
        const okFile = code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 0;
        cleanup();
        if (!okFile) return resolve({ ok: false, error: `ffmpeg lỗi (mã ${code}): ` + err.split('\n').filter(Boolean).slice(-4).join(' | ').slice(0, 400) });
        if (onProgress) onProgress({ percent: 100 });
        resolve({ ok: true, outputPath: outPath, duration: round3(plan.total), width: plan.W, height: plan.H });
      });
    } catch (e) { cleanup(); resolve({ ok: false, error: e.message }); }
    function cleanup() { try { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} }
  });
}

module.exports = { emptyProject, listProjects, loadProject, saveProject, deleteProject, probe, exportProject, buildPlan, totalDuration, clipLen };
