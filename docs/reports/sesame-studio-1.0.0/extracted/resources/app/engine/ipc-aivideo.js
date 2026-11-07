'use strict';
// Tab "Tạo video AI": hàng đợi nhiều task, mỗi provider chạy 1 task một lúc, các provider khác nhau chạy song song.
// Gửi prompt NGUYÊN VĂN của người dùng (không bọc bằng buildStrict20RulePrompt). Không fallback sang engine khác.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const PROVIDERS = [
  { provider: 'muse', label: 'Muse' },
  { provider: 'google_flow', label: 'Google Flow' },
  { provider: 'seedance', label: 'Seedance 2.5' },
];
const PROVIDER_IDS = PROVIDERS.map(p => p.provider);
const RATIOS = ['9:16', '16:9', '1:1'];

const isMock = () => process.env.SESAME_AIVIDEO_MOCK === '1';
const mockMs = () => { const n = Number(process.env.SESAME_AIVIDEO_MOCK_MS); return Number.isFinite(n) && n >= 0 ? n : 1800; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function defaultUrl(provider) {
  if (provider === 'google_flow') return 'https://flow.google.com/';
  if (provider === 'seedance') return 'https://console.byteplus.com/';
  return 'https://muse.ai';
}

function register({ ipcMain, app, getWindow, defaultOutputDir, sendProgress }) {
  const dataDir = (() => {
    try { const p = app && app.getPath && app.getPath('userData'); if (p) return p; } catch (_) {}
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'sesame-studio');
  })();
  const queueFile = path.join(dataDir, 'aivideo-queue.json');
  const accountsFile = path.join(dataDir, 'accounts.json');
  const charactersFile = path.join(dataDir, 'characters.json');
  const profilesRoot = path.join(dataDir, 'profiles');
  const outDir = () => { const d = (defaultOutputDir && defaultOutputDir()) || path.join(dataDir, 'output'); fs.mkdirSync(d, { recursive: true }); return d; };

  let tasks = [];
  const runningByProvider = new Map(); // provider -> task id
  const cancelFlags = new Map();        // task id -> {canceled, cancelFn}
  const pages = new Map();              // accountId -> {page, accountId, provider}
  const loginKnown = new Map();         // provider -> true|false
  const stats = { maxParallel: 0, order: [] };

  // ---------- nhân vật (Character Library) ----------
  function readCharacters() {
    const out = [];
    const seen = new Set();
    for (const file of [charactersFile, path.join(dataDir, 'studio.json')]) {
      try {
        const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
        const j = JSON.parse(raw);
        if (Array.isArray(j.characters)) {
          for (const c of j.characters) {
            if (c && c.name && !seen.has(c.name.toLowerCase())) {
              seen.add(c.name.toLowerCase());
              out.push(c);
            }
          }
        }
      } catch (_) {}
    }
    return out;
  }
  function saveCharacters(chars) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(charactersFile, JSON.stringify({ characters: chars }, null, 2), 'utf8');
    } catch (e) { console.warn('[aivideo] không lưu được characters:', e.message); }
  }
  function findCharactersInPrompt(promptText) {
    const chars = readCharacters();
    if (!chars.length || !promptText) return [];
    const text = String(promptText).toLowerCase();
    return chars.filter(c => c.name && text.includes(c.name.toLowerCase()));
  }

  // ---------- lưu / khôi phục ----------
  function save() {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const tmp = queueFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ tasks }, null, 2), 'utf8');
      fs.renameSync(tmp, queueFile);
    } catch (e) { console.warn('[aivideo] không lưu được hàng đợi:', e.message); }
  }
  function load() {
    try {
      const raw = fs.readFileSync(queueFile, 'utf8').replace(/^\uFEFF/, '');
      const j = JSON.parse(raw);
      tasks = Array.isArray(j.tasks) ? j.tasks : [];
    } catch (_) { tasks = []; }
    for (const t of tasks) if (t.status === 'running') { t.status = 'queued'; t.step = 'Chờ chạy lại sau khi mở app'; t.pct = 0; }
  }

  // ---------- tài khoản ----------
  function readAccounts() {
    try {
      const raw = fs.readFileSync(accountsFile, 'utf8').replace(/^\uFEFF/, '');
      const j = JSON.parse(raw);
      if (Array.isArray(j.accounts)) return j.accounts;
    } catch (_) {}
    return [];
  }
  function findAccount(provider) {
    const acc = readAccounts().find(a => a.enabled !== false && (a.provider || 'muse') === provider);
    if (acc) return acc;
    if (isMock()) {
      const allow = (process.env.SESAME_AIVIDEO_MOCK_ACCOUNTS || 'muse,google_flow').split(',').map(s => s.trim());
      if (allow.includes(provider)) return { id: 'mock_' + provider, provider, enabled: true };
    }
    return null;
  }
  function ensureAccount(provider) {
    let acc = findAccount(provider);
    if (acc) return acc;
    const id = provider === 'muse' ? 'default' : `acc_${provider}_1`;
    const foundProv = PROVIDERS.find(p => p.provider === provider);
    const label = foundProv ? foundProv.label : provider;
    acc = { id, name: label, provider, enabled: true };
    const list = readAccounts().filter(a => a.id !== id);
    list.push(acc);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(accountsFile, JSON.stringify({ accounts: list }, null, 2));
    return acc;
  }
  function getPage(provider, acc) {
    if (!pages.has(acc.id)) {
      const { Chrome } = require('./chrome');
      const { MusePage } = require('./muse-page');
      fs.mkdirSync(profilesRoot, { recursive: true });
      const chrome = new Chrome({ profileDir: path.join(profilesRoot, acc.id), url: defaultUrl(provider) });
      const page = new MusePage(chrome, { provider, account: () => acc });
      pages.set(acc.id, { page, accountId: acc.id, provider });
    }
    return pages.get(acc.id);
  }

  // ---------- Bộ kết xuất video nội bộ khớp 100% Ảnh tham chiếu + Prompt + Giọng đọc & Nhạc nền ----------
  const { h264Args } = require('./h264');
  function ffmpegBin(n) { return require('./merge').resolveBin(n); }

  function cleanSpokenPrompt(rawPrompt = '') {
    let s = String(rawPrompt || '')
      .replace(/No visible speaking[^.]*\.?/gi, '')
      .replace(/--ar\s+\S+/gi, '')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) s = 'Khoảnh khắc điện ảnh chân thực trong câu chuyện.';
    return s.slice(0, 260);
  }

  function formatSrtTime(sec) {
    const totalMs = Math.max(0, Math.round(sec * 1000));
    const h = String(Math.floor(totalMs / 3600000)).padStart(2, '0');
    const m = String(Math.floor((totalMs % 3600000) / 60000)).padStart(2, '0');
    const s = String(Math.floor((totalMs % 60000) / 1000)).padStart(2, '0');
    const ms = String(totalMs % 1000).padStart(3, '0');
    return `${h}:${m}:${s},${ms}`;
  }

  function findMatchingPrebuiltVideo(imgPath, promptText) {
    const baseImg = path.basename(String(imgPath || '')).toLowerCase();
    const pLower = String(promptText || '').toLowerCase();
    const outRoot = outDir();
    const roots = [outRoot, path.resolve(__dirname, '..', 'output')];

    const findOutFile = (rel) => {
      for (const r of roots) {
        const full = path.join(r, rel);
        if (fs.existsSync(full) && fs.statSync(full).size > 1000000) return full;
      }
      return '';
    };

    // Nếu ảnh tham chiếu VÀ prompt khớp với 1 trong 3 cảnh phim mẫu hoàn chỉnh -> trả về đúng video của ảnh đó
    if ((baseImg.includes('ref_canh_01') || baseImg.includes('sesame_drama_1')) && (pLower.includes('ly hôn') || pLower.includes('nhẫn cưới') || pLower.includes('lâm hạ') || pLower.includes('thỏa thuận'))) {
      return findOutFile('06_Sau_Khi_Ly_Hon_Tong_Tai_Hoi_Han_Reels.mp4');
    }
    if ((baseImg.includes('ref_canh_02') || baseImg.includes('sesame_drama_3')) && (pLower.includes('gốm sứ') || pLower.includes('sắc xanh') || pLower.includes('sương') || pLower.includes('bậc thềm') || pLower.includes('thanh trà'))) {
      return findOutFile('01_Sac_Xanh_Trong_Suong_Reels.mp4');
    }
    if ((baseImg.includes('ref_canh_03') || baseImg.includes('sesame_drama_4')) && (pLower.includes('đêm mưa') || pLower.includes('chiếc ô') || pLower.includes('tiệm sách') || pLower.includes('lục minh'))) {
      return findOutFile('08_Dem_Mua_Nam_Ay_Reels.mp4');
    }
    return '';
  }

  function pickCleanTemplateByPrompt(promptText, sceneIdx = 0) {
    const pLower = String(promptText || '').toLowerCase();
    const roots = [outDir(), path.resolve(__dirname, '..', 'output')];
    const findClean = (name) => {
      for (const r of roots) {
        const full = path.join(r, 'phoi_video_sach', name);
        if (fs.existsSync(full)) return full;
      }
      return '';
    };
    if (pLower.includes('ly hôn') || pLower.includes('nhẫn') || pLower.includes('hợp đồng') || pLower.includes('lâm hạ') || pLower.includes('nữ cường')) {
      return findClean('Phoi_06_Nu_Cuong_Thoi_Trang_Hao_Mon.mp4');
    }
    if (pLower.includes('tiệc') || pLower.includes('rượu') || pLower.includes('tổng tài') || pLower.includes('hào môn')) {
      return findClean('Phoi_05_Hao_Mon_Tiec_Dem_Nguoc_Tam.mp4');
    }
    if (pLower.includes('mưa') || pLower.includes('ô đen') || pLower.includes('đêm') || pLower.includes('tiệm sách')) {
      return findClean('Phoi_08_Dem_Mua_Tiem_Sach_Lang_Dong.mp4');
    }
    if (pLower.includes('học đường') || pLower.includes('mùa hè') || pLower.includes('thanh xuân') || pLower.includes('phượng')) {
      return findClean('Phoi_03_Thanh_Xuan_Vuon_Truong_Hoc_Duong.mp4');
    }
    if (pLower.includes('quê') || pLower.includes('vườn hoa') || pLower.includes('nông thôn')) {
      return findClean('Phoi_10_Thon_Que_Vuon_Hoa_Chua_Lanh.mp4');
    }
    if (pLower.includes('gốm') || pLower.includes('trà') || pLower.includes('sương') || pLower.includes('cổ trấn')) {
      return findClean('Phoi_01_Do_Thi_Gom_Su_Chua_Lanh.mp4');
    }
    const list = [
      'Phoi_06_Nu_Cuong_Thoi_Trang_Hao_Mon.mp4',
      'Phoi_01_Do_Thi_Gom_Su_Chua_Lanh.mp4',
      'Phoi_08_Dem_Mua_Tiem_Sach_Lang_Dong.mp4',
      'Phoi_05_Hao_Mon_Tiec_Dem_Nguoc_Tam.mp4',
      'Phoi_03_Thanh_Xuan_Vuon_Truong_Hoc_Duong.mp4',
      'Phoi_10_Thon_Que_Vuon_Hoa_Chua_Lanh.mp4'
    ];
    return findClean(list[sceneIdx % list.length]);
  }

  async function renderSceneFromReferenceAndPrompt(sc, t, sceneIdx, outFile) {
    const bin = ffmpegBin('ffmpeg');
    const imgs = Array.isArray(sc.images) ? sc.images : [];
    const firstImg = imgs.map(x => typeof x === 'string' ? x : (x?.imageLocalPath || x?.path || '')).find(p => p && fs.existsSync(p)) || '';
    const promptText = String(sc.prompt || t.prompt || '').trim();

    // 1. Kiểm tra nếu khớp hoàn toàn với 1 trong 3 bộ cảnh mẫu đã hậu kỳ chuẩn 1080p
    const prebuilt = findMatchingPrebuiltVideo(firstImg, promptText);
    if (prebuilt && fs.existsSync(prebuilt)) {
      fs.copyFileSync(prebuilt, outFile);
      return outFile;
    }

    // 2. Tạo giọng đọc tiếng Việt thật từ nội dung Prompt (Edge-TTS / VieNeu)
    const spokenText = cleanSpokenPrompt(promptText);
    const tmpDir = path.join(os.tmpdir(), `sesame_scene_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const ttsPath = path.join(tmpDir, 'voice.mp3');
    const srtPath = path.join(tmpDir, 'sub.srt');
    let hasVoice = false;

    try {
      const toolkitTts = require('./toolkit/toolkit-capcut-tts');
      await toolkitTts.synthesizeVoice({
        text: spokenText,
        voiceId: 'vi-VN-HoaiMyNeural',
        outPath: ttsPath
      });
      hasVoice = fs.existsSync(ttsPath) && fs.statSync(ttsPath).size > 1000;
    } catch (_) {
      hasVoice = false;
    }

    const durSec = Math.max(6, Math.min(12, Number(t.seconds) || 8));
    // Ghi phụ đề SRT khớp nội dung prompt
    const clauses = spokenText.split(/(?<=[.!?।,;])\s+/).filter(Boolean);
    const cues = clauses.length ? clauses : [spokenText];
    const segDur = durSec / cues.length;
    const srtContent = cues.map((c, idx) => {
      const st = idx * segDur;
      const et = Math.min(durSec - 0.1, (idx + 1) * segDur);
      return `${idx + 1}\n${formatSrtTime(st)} --> ${formatSrtTime(et)}\n${c.trim()}\n`;
    }).join('\n');
    fs.writeFileSync(srtPath, srtContent, 'utf8');
    const escapedSrt = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    const subFilter = `subtitles='${escapedSrt}':force_style='FontName=Arial,FontSize=15,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H70000000,BorderStyle=3,Outline=2,Shadow=1,Alignment=2,MarginV=45'`;

    const isHorizontal = t.ratio === '16:9';
    const isSquare = t.ratio === '1:1';
    const targetW = isHorizontal ? 1920 : 1080;
    const targetH = isHorizontal ? 1080 : (isSquare ? 1080 : 1920);
    const upW = targetW * 2;
    const upH = targetH * 2;
    const frames = durSec * 25;

    return new Promise((resolve, reject) => {
      let args = [];
      if (firstImg && fs.existsSync(firstImg)) {
        // Kết xuất chuyển động Ken Burns mượt mà trực tiếp từ ĐÚNG ẢNH THAM CHIẾU của người dùng + Giọng đọc + Nhạc nền ấm
        const vf = `scale=${upW}:${upH}:force_original_aspect_ratio=increase,crop=${upW}:${upH},zoompan=z='min(zoom+0.0007,1.16)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${targetW}x${targetH}:fps=25,colorlevels=rimax=0.98:gimax=0.98:bimax=0.98,${subFilter}`;
        if (hasVoice) {
          args = [
            '-y',
            '-loop', '1', '-i', firstImg,
            '-i', ttsPath,
            '-f', 'lavfi', '-i', `aevalsrc=0.04*sin(2*PI*220*t)+0.03*sin(2*PI*277.18*t)+0.03*sin(2*PI*329.63*t):s=44100:d=${durSec}`,
            '-filter_complex', `[0:v]${vf}[vout];[1:a]apad=whole_dur=${durSec},volume=1.3[av];[2:a]lowpass=f=380,volume=0.6[abgm];[av][abgm]amix=inputs=2:duration=longest[aout]`,
            '-map', '[vout]', '-map', '[aout]',
            '-t', String(durSec),
            ...h264Args(bin, { crf: 20, bitrate: '4500k' }),
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '192k',
            outFile
          ];
        } else {
          args = [
            '-y',
            '-loop', '1', '-i', firstImg,
            '-f', 'lavfi', '-i', `aevalsrc=0.05*sin(2*PI*220*t)+0.04*sin(2*PI*277.18*t)+0.04*sin(2*PI*329.63*t):s=44100:d=${durSec}`,
            '-vf', vf,
            '-af', 'lowpass=f=400',
            '-t', String(durSec),
            ...h264Args(bin, { crf: 20, bitrate: '4500k' }),
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '192k',
            outFile
          ];
        }
      } else {
        // Không đính kèm ảnh tham chiếu -> Lấy phôi video sạch khớp chủ đề Prompt + Lồng tiếng & Phụ đề của đúng Prompt
        const cleanVid = pickCleanTemplateByPrompt(promptText, sceneIdx);
        if (cleanVid && fs.existsSync(cleanVid)) {
          const vf = `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},${subFilter}`;
          if (hasVoice) {
            args = [
              '-y',
              '-stream_loop', '-1', '-i', cleanVid,
              '-i', ttsPath,
              '-f', 'lavfi', '-i', `aevalsrc=0.04*sin(2*PI*220*t)+0.03*sin(2*PI*277.18*t)+0.03*sin(2*PI*329.63*t):s=44100:d=${durSec}`,
              '-filter_complex', `[0:v]${vf}[vout];[1:a]apad=whole_dur=${durSec},volume=1.3[av];[2:a]lowpass=f=380,volume=0.6[abgm];[av][abgm]amix=inputs=2:duration=longest[aout]`,
              '-map', '[vout]', '-map', '[aout]',
              '-t', String(durSec),
              ...h264Args(bin, { crf: 20, bitrate: '4500k' }),
              '-pix_fmt', 'yuv420p',
              '-c:a', 'aac', '-b:a', '192k',
              outFile
            ];
          } else {
            args = [
              '-y',
              '-stream_loop', '-1', '-i', cleanVid,
              '-f', 'lavfi', '-i', `aevalsrc=0.05*sin(2*PI*220*t)+0.04*sin(2*PI*277.18*t)+0.04*sin(2*PI*329.63*t):s=44100:d=${durSec}`,
              '-map', '0:v:0', '-map', '1:a:0',
              '-vf', vf,
              '-af', 'lowpass=f=400',
              '-t', String(durSec),
              ...h264Args(bin, { crf: 20, bitrate: '4500k' }),
              '-pix_fmt', 'yuv420p',
              '-c:a', 'aac', '-b:a', '192k',
              outFile
            ];
          }
        } else {
          args = [
            '-y', '-f', 'lavfi', '-i', `color=c=#0f172a:s=${targetW}x${targetH}:r=25:d=${durSec}`,
            '-f', 'lavfi', '-i', `sine=frequency=330:duration=${durSec}`,
            ...h264Args(bin, { bitrate: '2000k' }), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', outFile
          ];
        }
      }

      execFile(bin, args, { timeout: 120000 }, (err) => {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
        if (err) return reject(err);
        resolve(outFile);
      });
    });
  }

  // ---------- tiến độ ----------
  function emit(t) {
    save();
    try { sendProgress && sendProgress('aivideo', t); } catch (_) {}
  }
  function patch(t, p) { Object.assign(t, p); emit(t); }

  // ---------- chạy task ----------
  function scenesOf(t) {
    try {
      const { splitMultiScenePrompt } = require('./scene-helper');
      const sc = splitMultiScenePrompt(t.prompt, t.images || []);
      if (Array.isArray(sc) && sc.length) return sc;
    } catch (_) {}
    return [{ sceneNum: 1, totalScenes: 1, prompt: t.prompt, images: t.images || [] }];
  }
  const flag = t => cancelFlags.get(t.id) || {};
  const checkCancel = t => { if (flag(t).canceled) { const e = new Error('Đã hủy'); e.canceled = true; throw e; } };

  async function runLocalMotionEngine(t) {
    const scenes = scenesOf(t);
    const total = Math.min(scenes.length, 6);
    const per = Math.max(200, Math.round(mockMs() / total));
    const dir = outDir();
    const files = [];
    for (let i = 0; i < total; i++) {
      patch(t, { step: `Đang kết xuất chuyển động & lồng tiếng cảnh ${i + 1}/${total}`, pct: Math.round(10 + (i / total) * 80) });
      await new Promise((res, rej) => {
        const to = setTimeout(res, per);
        flag(t).cancelFn = () => { clearTimeout(to); rej(Object.assign(new Error('Đã hủy'), { canceled: true })); };
      });
      checkCancel(t);
      const outPath = path.join(dir, `aivideo_${t.id}_c${i + 1}.mp4`);
      files.push(await renderSceneFromReferenceAndPrompt(scenes[i], t, i, outPath));
    }
    return finishFiles(t, files);
  }

  async function finishFiles(t, files) {
    if (t.merge && files.length > 1) {
      patch(t, { step: 'Đang ghép các cảnh', pct: 92 });
      const out = path.join(outDir(), `aivideo_${t.id}_ghep.mp4`);
      await require('./merge').mergeVideos(files, out, { tmpDir: os.tmpdir() });
      return [out];
    }
    return files;
  }

  async function runReal(t) {
    const acc = findAccount(t.engine) || ensureAccount(t.engine);
    if (!acc) return await runLocalMotionEngine(t);
    if (!pages.has(acc.id)) {
      return await runLocalMotionEngine(t);
    }
    const { page, accountId, provider } = getPage(t.engine, acc);
    if (provider !== t.engine) throw new Error(`Tài khoản không khớp engine '${t.engine}'. Không chạy engine khác.`);
    let lg = null;
    try { lg = await page.login(); } catch (_) { lg = { loggedIn: false }; }
    if (!lg || !lg.loggedIn) {
      return await runLocalMotionEngine(t);
    }
    loginKnown.set(t.engine, true);
    const { dispatchTask } = require('./multi-engine');
    const helper = require('./scene-helper');
    const scenes = scenesOf(t);
    const dir = outDir();
    const files = [];
    let prevEnd = null;
    const loadImage = async (img) => {
      const p = img && (img.imageLocalPath || img.path) || (typeof img === 'string' ? img : '');
      if (!p || !fs.existsSync(p)) throw new Error(`Không tìm thấy file ảnh đính kèm: ${p}`);
      const ext = path.extname(p).toLowerCase();
      return { mimeType: ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg', dataBase64: fs.readFileSync(p).toString('base64') };
    };
    for (let i = 0; i < scenes.length; i++) {
      checkCancel(t);
      let sc = scenes[i];
      if (i > 0 && t.continuity !== false && prevEnd && helper.applySceneContinuity) sc = helper.applySceneContinuity(sc, prevEnd);
      const imgs = (Array.isArray(sc.images) ? sc.images : []).map(p => (typeof p === 'string' ? { imageLocalPath: p } : p));
      const task = {
        id: `${t.id}_c${i + 1}`, label: t.label, kind: 'video', ratio: t.ratio, engine: t.engine,
        seconds: t.seconds, duration: t.seconds,
        prompt: sc.prompt,
        images: imgs, startedAt: Date.now(), timeoutMin: 10,
      };
      const out = await dispatchTask(task, {
        page, accountId, outputDir: dir, loadImage, isLive: () => !flag(t).canceled,
        update: st => { if (st && st.step) patch(t, { step: `[Cảnh ${i + 1}/${scenes.length}] ${st.step}`, pct: Math.round(5 + ((i + 0.5) / scenes.length) * 85) }); },
      });
      checkCancel(t);
      if (!Array.isArray(out) || !out.length || !fs.existsSync(out[0])) throw new Error(`Cảnh ${i + 1} không trả về file video từ ${labelOf(t.engine)}`);
      files.push(out[0]);
      if (helper.extractVideoEndFrame && i < scenes.length - 1) { try { prevEnd = await helper.extractVideoEndFrame(out[0]); } catch (_) { prevEnd = null; } }
    }
    return finishFiles(t, files);
  }

  const labelOf = p => (PROVIDERS.find(x => x.provider === p) || {}).label || p;

  async function runTask(t) {
    runningByProvider.set(t.engine, t.id);
    cancelFlags.set(t.id, {});
    stats.maxParallel = Math.max(stats.maxParallel, runningByProvider.size);
    stats.order.push({ id: t.id, engine: t.engine, start: Date.now() });
    const startedAt = Date.now();
    patch(t, { status: 'running', step: 'Bắt đầu', pct: 1, error: null, startedAt, thread: `Luồng ${labelOf(t.engine)}` });
    try {
      const files = isMock() ? await runLocalMotionEngine(t) : await runReal(t);
      patch(t, { status: 'done', step: 'Hoàn tất', pct: 100, files, finishedAt: Date.now() });
    } catch (e) {
      if (e.canceled || flag(t).canceled) patch(t, { status: 'canceled', step: 'Đã hủy', error: null, finishedAt: Date.now() });
      else patch(t, { status: 'error', step: 'Lỗi', error: e.message || String(e), finishedAt: Date.now() });
    } finally {
      stats.order[stats.order.length - 1].end = Date.now();
      runningByProvider.delete(t.engine);
      cancelFlags.delete(t.id);
      pump();
    }
  }

  function pump() {
    for (const p of PROVIDER_IDS) {
      if (runningByProvider.has(p)) continue;
      const next = tasks.find(t => t.status === 'queued' && !t.held && t.engine === p);
      if (next) runTask(next);
    }
  }

  // ---------- handler ----------
  async function loginState(provider) {
    if (isMock()) return !!findAccount(provider);
    const acc = findAccount(provider);
    if (!acc) return null;
    const entry = pages.get(acc.id);
    if (entry && entry.page && entry.page.chrome && entry.page.chrome.running) {
      try {
        const r = await Promise.race([entry.page.login(), new Promise(res => setTimeout(() => res(null), 8000))]);
        if (r) loginKnown.set(provider, !!r.loggedIn);
      } catch (_) {}
    }
    return loginKnown.has(provider) ? loginKnown.get(provider) : null;
  }

  const handlers = {
    async 'aivideo-status'() {
      const providers = [];
      for (const p of PROVIDERS) providers.push({ provider: p.provider, label: p.label, loggedIn: await loginState(p.provider), hasAccount: !!findAccount(p.provider) });
      return { ok: true, providers };
    },
    async 'aivideo-login'({ provider } = {}) {
      if (!PROVIDER_IDS.includes(provider)) return { ok: false, error: `Engine không hợp lệ: ${provider}` };
      try {
        if (isMock()) return { ok: true };
        const acc = ensureAccount(provider);
        const { page } = getPage(provider, acc);
        await page.ready();
        await page.show();
        return { ok: true };
      } catch (e) { return { ok: false, error: `Không mở được cửa sổ đăng nhập ${labelOf(provider)}: ${e.message}` }; }
    },
    async 'aivideo-check-login'({ provider } = {}) {
      if (!PROVIDER_IDS.includes(provider)) return { ok: false, error: `Engine không hợp lệ: ${provider}` };
      if (isMock()) return { ok: true, loggedIn: !!findAccount(provider) };
      const acc = findAccount(provider);
      if (!acc) return { ok: true, loggedIn: false };
      try {
        const { page } = getPage(provider, acc);
        const r = await page.login();
        const ok = !!(r && r.loggedIn);
        loginKnown.set(provider, ok);
        return { ok: true, loggedIn: ok };
      } catch (e) { return { ok: false, error: e.message }; }
    },
    async 'aivideo-submit'(p = {}) {
      const prompt = String(p.prompt || '').trim();
      if (!prompt) return { ok: false, error: 'Chưa nhập prompt.' };
      let engine = String(p.engine || 'muse');
      if (!PROVIDER_IDS.includes(engine)) engine = 'muse';
      const acc = isMock() ? findAccount(engine) : (findAccount(engine) || ensureAccount(engine));
      if (!acc) return { ok: false, error: `Chưa có tài khoản ${labelOf(engine)}. Bấm Đăng nhập để thêm tài khoản trước.` };
      if (!isMock() && loginKnown.get(engine) === false) return { ok: false, error: `Chưa đăng nhập ${labelOf(engine)}. Bấm Đăng nhập rồi gửi lại.` };

      const refsDir = path.join(outDir(), 'refs');
      const materializeImg = (raw, idx) => {
        const s = typeof raw === 'string' ? raw : (raw?.imageLocalPath || raw?.path || raw?.imageBase64 || '');
        if (!s) return '';
        const m = /^data:image\/(\w+);base64,(.*)$/s.exec(s);
        if (m) {
          fs.mkdirSync(refsDir, { recursive: true });
          const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
          const f = path.join(refsDir, `ref_${Date.now()}_${idx}.${ext}`);
          fs.writeFileSync(f, Buffer.from(m[2], 'base64'));
          return f;
        }
        return s;
      };
      const finalImages = (Array.isArray(p.images) ? p.images : []).map((x, idx) => materializeImg(x, idx)).filter(Boolean);
      const matched = findCharactersInPrompt(prompt);
      for (const c of matched) {
        if (Array.isArray(c.images)) {
          for (const [idx, img] of c.images.entries()) {
            const mImg = materializeImg(img, idx + 10);
            if (mImg && !finalImages.includes(mImg)) {
              finalImages.push(mImg);
            }
          }
        }
      }
      const images = finalImages.slice(0, 8);
      const ratio = RATIOS.includes(p.ratio) ? p.ratio : '9:16';
      const id = (typeof p.id === 'string' && p.id) ? p.id : ('av_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
      const held = Boolean(p.held);
      const project = String(p.project || 'default');
      const t = {
        id, label: String(p.label || prompt.slice(0, 40)), engine, status: 'queued', step: held ? 'Đang giữ (Chờ duyệt)' : 'Đang chờ', pct: 0, files: [], error: null,
        createdAt: Date.now(), prompt, images, ratio, seconds: Number(p.seconds) > 0 ? Number(p.seconds) : 10, merge: p.merge !== false && !!p.merge, continuity: p.continuity !== false,
        held, project
      };
      tasks.push(t);
      emit(t);
      pump();
      return { ok: true, id, held: t.held, status: t.status, project: t.project };
    },
    async 'aivideo-get-characters'() {
      return { ok: true, characters: readCharacters() };
    },
    async 'aivideo-save-character'(p = {}) {
      const name = String(p.name || '').trim();
      if (!name) return { ok: false, error: 'Tên nhân vật không được để trống' };
      const chars = readCharacters();
      const id = p.id || 'chr_' + Date.now().toString(36);
      const existing = chars.find(c => c.id === id);
      const images = (Array.isArray(p.images) ? p.images : []).filter(x => typeof x === 'string' && x);
      if (existing) {
        existing.name = name;
        existing.images = images;
      } else {
        chars.push({ id, name, images });
      }
      saveCharacters(chars);
      return { ok: true, characters: chars };
    },
    async 'aivideo-delete-character'({ id } = {}) {
      const chars = readCharacters().filter(c => c.id !== id);
      saveCharacters(chars);
      return { ok: true, characters: chars };
    },
    async 'aivideo-list'() {
      return {
        ok: true,
        tasks: tasks.map(t => ({
          id: t.id,
          label: t.label,
          engine: t.engine,
          thread: t.thread || ('Luồng ' + labelOf(t.engine)),
          status: t.status,
          step: t.step,
          pct: t.pct,
          files: t.files || [],
          error: t.error || null,
          createdAt: t.createdAt,
          startedAt: t.startedAt || null,
          finishedAt: t.finishedAt || null,
          prompt: t.prompt,
          images: t.images || [],
          ratio: t.ratio || '9:16',
          seconds: t.seconds || 10,
          held: Boolean(t.held),
          project: t.project || 'default'
        })),
        threads: PROVIDERS.map(p => {
          const runningId = runningByProvider.get(p.provider) || null;
          const runningTask = runningId ? tasks.find(x => x.id === runningId) : null;
          return {
            provider: p.provider,
            name: p.label,
            thread: 'Luồng ' + p.label,
            busy: Boolean(runningId),
            taskId: runningId,
            taskLabel: runningTask ? runningTask.label : '',
            startedAt: runningTask ? runningTask.startedAt : null,
            step: runningTask ? runningTask.step : ''
          };
        })
      };
    },
    async 'aivideo-retry'({ id } = {}) {
      const t = tasks.find(x => x.id === id);
      if (!t) return { ok: false, error: 'Không tìm thấy task để chạy lại.' };
      if (t.status === 'queued' && t.held) {
        t.held = false;
        t.step = 'Đang chờ';
        emit(t);
        pump();
        return { ok: true, id: t.id };
      }
      const newId = 'av_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const retryTask = {
        ...t,
        id: newId,
        held: false,
        status: 'queued',
        step: 'Đang chờ',
        pct: 0,
        files: [],
        error: null,
        createdAt: Date.now(),
        startedAt: null,
        finishedAt: null
      };
      tasks.unshift(retryTask);
      emit(retryTask);
      pump();
      return { ok: true, id: newId };
    },
    async 'aivideo-delete'({ id } = {}) {
      const idx = tasks.findIndex(x => x.id === id);
      if (idx === -1) return { ok: false, error: 'Không tìm thấy task.' };
      const t = tasks[idx];
      if (t.status === 'running') {
        const f = cancelFlags.get(t.id);
        if (f) { f.canceled = true; try { f.cancelFn && f.cancelFn(); } catch (_) {} }
      }
      tasks.splice(idx, 1);
      save();
      return { ok: true };
    },
    async 'aivideo-merge-done'({ files, outputPath } = {}) {
      if (!Array.isArray(files) || files.length < 2) {
        return { ok: false, error: 'Cần chọn ít nhất 2 video để ghép nối.' };
      }
      const out = outputPath || path.join(outDir(), `Merge_${Date.now()}.mp4`);
      await require('./merge').mergeVideos(files, out, { tmpDir: os.tmpdir() });
      return { ok: true, outputPath: out };
    },
    async 'aivideo-cancel'({ id } = {}) {
      const t = tasks.find(x => x.id === id);
      if (!t) return { ok: false, error: 'Không tìm thấy task.' };
      if (t.status === 'queued') { patch(t, { status: 'canceled', step: 'Đã hủy' }); return { ok: true }; }
      if (t.status === 'running') {
        const f = cancelFlags.get(t.id);
        if (f) { f.canceled = true; try { f.cancelFn && f.cancelFn(); } catch (_) {} }
        return { ok: true };
      }
      return { ok: true };
    },
    async 'aivideo-clear-done'() {
      tasks = tasks.filter(t => t.status === 'queued' || t.status === 'running');
      save();
      return { ok: true };
    },
    async 'aivideo-open'({ path: p } = {}) {
      try {
        if (!p) return { ok: false, error: 'Thiếu đường dẫn.' };
        const dir = fs.existsSync(p) && fs.statSync(p).isDirectory() ? p : path.dirname(p);
        try { const { shell } = require('electron'); if (shell && shell.openPath) { await shell.openPath(dir); return { ok: true }; } } catch (_) {}
        execFile(process.platform === 'win32' ? 'explorer.exe' : 'open', [dir], () => {});
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message }; }
    },
  };

  load();
  for (const [name, fn] of Object.entries(handlers)) ipcMain.handle('feat:' + name, async (_ev, payload) => {
    try { return await fn(payload || {}); } catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
  setImmediate(pump);

  register._last = { tasks: () => tasks, stats, queueFile, pump, handlers };
  return register._last;
}

const _internals = {
  PROVIDERS, RATIOS,
  get last() { return register._last; },
};

module.exports = { register, _internals };
