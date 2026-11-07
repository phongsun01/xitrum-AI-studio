const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');

const ROOT_DIR = path.resolve(__dirname);
let _logFile = '';
function log(msg) {
  try {
    if (!_logFile) {
      const dir = require('electron').app.getPath('userData');
      fs.mkdirSync(dir, { recursive: true });
      _logFile = path.join(dir, 'boot.log');
      try { if (fs.statSync(_logFile).size > 512 * 1024) fs.writeFileSync(_logFile, ''); } catch (_) {}
    }
    fs.appendFileSync(_logFile, msg + '\n');
  } catch (_) {}
}
log('main.js starting at ' + new Date().toISOString());

const { app, BrowserWindow, ipcMain, dialog, shell, powerSaveBlocker } = require('electron');
// Cổng gỡ lỗi từ xa mặc định ĐÓNG (an toàn cho người dùng cuối). Nhà phát triển bật bằng biến môi trường SESAME_DEBUG_PORT
// hoặc tạo file trống "enable-debug-port" trong thư mục dữ liệu của app.
try {
  const dbgFlag = fs.existsSync(path.join(app.getPath('userData'), 'enable-debug-port'));
  if (app && app.commandLine && (process.env.SESAME_DEBUG_PORT || dbgFlag)) {
    app.commandLine.appendSwitch('remote-debugging-port', String(process.env.SESAME_DEBUG_PORT || '9226'));
  }
} catch (_) {}

process.on('uncaughtException', (err) => {
  log('uncaughtException: ' + (err.stack || err.message));
});
process.on('unhandledRejection', (reason) => {
  log('unhandledRejection: ' + (reason?.stack || reason));
});

const core = require('./engine/sesame-core');
const aiVideoEngine = require('./engine/ai-video-engine');
const configManager = require('./engine/config-manager');
const fbPoster = require('./engine/facebook-poster');
const merger = require('./engine/merge');
const vieneuTts = require('./engine/vieneu-tts');
const sceneCompose = require('./engine/scene-compose');
const dramaCompiler = require('./engine/drama-compiler');
const scriptJudge = require('./engine/script-judge');
const CrmServer = require('./engine/crm-server');
const { scrapeLadiPage } = require('./engine/ladi-crawler');
const { generateScriptsFromProduct } = require('./engine/product-ai');
const TaskStore = require('./engine/task-store');
const { Chrome } = require('./engine/chrome');
const { MusePage } = require('./engine/muse-page');
const { ensureLogin } = require('./engine/muse-runner');
const { AccountStore } = require('./engine/accounts');
const { parseProxy, parseList, checkProxy, pickProxy } = require('./engine/proxy');
const { Pool } = require('./engine/pool');
const { StudioStore } = require('./engine/studio-store');
const { usable, pausedUntil } = require('./engine/scheduler');
const { dispatchTask } = require('./engine/multi-engine');
const { SEEDANCE_URL } = require('./engine/seedance-runner');
const { DOLA_URL } = require('./engine/dola-runner');
const { FilmProjectStore } = require('./engine/film-project-store');
const { FilmProjectService } = require('./engine/film-project-service');
const {
  generateFlowProjectFromIdea,
  buildScenePrompt,
  buildChatGptHelperPrompt,
  parseExternalScriptToScenes
} = require('./engine/flow-builder-ai');
const { extractVideoEndFrame } = require('./engine/scene-helper');

let mainWindow = null;
let crmServer = null;
let taskStore = null;
let accountStore = null;
let pool = null;
let studioStore = null;
let filmProjectStore = null;
let filmProjectService = null;
const pages = new Map(); // accountId → MusePage (mỗi tài khoản 1 Chrome, profile riêng)
const logins = new Map();

// Thư mục xuất mặc định: Videos\\Sesame Studio (luôn ghi được). Nếu thư mục "output" cạnh app đã có dữ liệu và ghi được
// (máy phát triển / bản cũ) thì vẫn dùng nó để không mất thư viện cũ.
function resolveDefaultOutputDir() {
  const legacy = path.join(ROOT_DIR, 'output');
  try {
    if (fs.existsSync(legacy) && fs.readdirSync(legacy).length) { fs.accessSync(legacy, fs.constants.W_OK); return legacy; }
  } catch (_) {}
  let base = '';
  try { base = app.getPath('videos'); } catch (_) {}
  if (!base) { try { base = app.getPath('documents'); } catch (_) {} }
  return path.join(base || os.homedir(), 'Sesame Studio');
}
function defaultOutputDir() {
  const custom = configManager.get().outputDir;
  const dir = (custom && typeof custom === 'string') ? custom : resolveDefaultOutputDir();
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return dir;
}

function runConfig() {
  const c = configManager.get();
  const n = (v, lo, hi, def) => Math.min(Math.max(parseInt(v, 10) || def, lo), hi);
  return {
    outputDir: defaultOutputDir(),
    maxAttempts: n(c.maxAttempts, 1, 5, 2),
    limits: {
      image: n(c.imageTimeoutMin, 1, 60, 5),
      video: n(c.videoTimeoutMin, 5, 120, 30)
    }
  };
}

function sendUI(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function handleVideoFinished(localPath, originalUrl = 'sesame') {
  if (!localPath) return;
  const item = {
    localPath,
    filename: path.basename(localPath),
    originalUrl,
    timestamp: Date.now()
  };
  sendUI('video-completed', item);
  if (crmServer) {
    const list = crmServer.museStatus.completedVideos || [];
    crmServer.updateStatus({ completedVideos: [item, ...list] });
  }
}

// Trình duyệt chạy trong Google Chrome thật (profile riêng từng tài khoản theo provider), điều khiển qua CDP (điều khiển qua CDP).
// Mỗi tài khoản dùng profile riêng trong thư mục dữ liệu của Sesame Studio.
function resolveProfileDir(id) {
  const candidates = [
    path.join(app.getPath('appData'), 'Sesame Studio', 'profiles', id),
    path.join(app.getPath('userData'), 'profiles', id)
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'Default', 'Network', 'Cookies')) || fs.existsSync(path.join(dir, 'Default', 'Preferences'))) {
      return dir;
    }
  }
  if (fs.existsSync(candidates[0])) return candidates[0];
  return candidates[candidates.length - 1];
}

function pageFor(id) {
  const acc = accountStore ? accountStore.get(id) : null;
  if (!acc) return Object.assign(new MusePage(null), { removed: true });
  if (!pages.has(id)) {
    const provider = acc.provider || 'muse';
    let url = 'https://muse.ai';
    if (provider === 'google_flow') url = 'https://flow.google.com/';
    else if (provider === 'seedance') url = SEEDANCE_URL;
    else if (provider === 'dola') url = DOLA_URL;
    const profileDir = resolveProfileDir(id);
    pages.set(id, new MusePage(new Chrome({ profileDir, url, resolveProxy: () => proxyFor(id) }), { provider, account: () => accountStore.get(id) }));
  }
  return pages.get(id);
}

const poolText = () => (accountStore?.settings?.usePool ? accountStore.settings.proxies : '');
const proxyHealth = new Map();
const deadProxies = () => new Set([...proxyHealth].filter(([, h]) => !h.ok).map(([line]) => line));
const testProxy = async p => {
  const h = { ...await checkProxy(p), checkedAt: Date.now() };
  proxyHealth.set(p.line, h);
  pushStatus();
  return h;
};

async function proxyFor(id) {
  for (;;) {
    const acc = accountStore.get(id);
    const { proxy, auto } = pickProxy(acc, accountStore.list(), poolText(), deadProxies());
    if (auto !== acc.proxyAuto) accountStore.update(id, { proxyAuto: auto });
    if (!proxy) return null;
    const h = await testProxy(proxy);
    if (h.ok) return proxy;
    if (acc.proxy) throw new Error(`Proxy ${proxy.host}:${proxy.port} của ${acc.name} không dùng được: ${h.error}`);
  }
}

function reapplyProxies() {
  for (const [id, page] of pages) {
    const acc = accountStore.get(id);
    if (!acc || !page.chrome?.proc || pool?.busy(id) || logins.has(id)) continue;
    let want = null;
    try { want = pickProxy(acc, accountStore.list(), poolText(), deadProxies()).proxy; } catch {}
    if ((want?.line || '') !== (page.chrome.proxy?.line || '')) page.chrome.close().catch(() => {});
  }
}

function blockedReason() {
  if (!accountStore) return '';
  const s = accountStore.settings, now = Date.now();
  const all = accountStore.list();
  const on = all.filter(a => a.enabled);
  if (!on.length) return 'Chưa bật tài khoản nào';

  const PROVIDER_LABEL = { muse: 'Muse AI', google_flow: 'Google Flow', seedance: 'Seedance 2.5', dola: 'Dola (Seedance 2.0)' };
  const paused = studioStore ? studioStore.pausedProjects() : new Set();
  const waiting = (taskStore ? taskStore.list('queued') : []).filter(t => !t.held && !paused.has(t.project || 'default'));

  for (const t of waiting) {
    const want = t.engine && t.engine !== 'auto' ? t.engine : '';
    if (!want) continue;
    const matchOn = on.filter(a => (a.provider || 'muse') === want);
    if (!matchOn.length) return `Chưa bật tài khoản ${PROVIDER_LABEL[want] || want}`;
    if (!matchOn.some(a => usable(a, s, now))) {
      if (matchOn.every(a => a.loggedIn === false)) return `Chưa đăng nhập ${PROVIDER_LABEL[want] || want}`;
      return `${PROVIDER_LABEL[want] || want} hết hạn mức`;
    }
  }

  if (on.some(a => usable(a, s, now))) return '';
  if (on.every(a => a.loggedIn === false)) return 'Chưa đăng nhập tài khoản AI';
  const until = Math.min(...on.map(a => pausedUntil(a, s, now)).filter(Boolean));
  return Number.isFinite(until) ? `Hết hạn mức tới ${new Date(until).toLocaleDateString('vi-VN')}` : 'Hết hạn mức';
}

function accountsView() {
  if (!accountStore) initStores();
  const running = {};
  if (pool?.running) {
    for (const id of pool.running.values()) running[id] = (running[id] || 0) + 1;
  }
  const settings = accountStore.settings, now = Date.now();
  const proxyNow = id => { const c = pages.get(id)?.chrome; return c?.proc && c.proxy ? `${c.proxy.host}:${c.proxy.port}` : ''; };
  const proxyFixed = a => {
    if (!a.proxy || a.proxy === 'none') return null;
    const p = parseProxy(a.proxy);
    return { label: p.error ? '' : `${p.host}:${p.port}`, error: p.error || '', health: proxyHealth.get(p.line) || null };
  };
  const accounts = accountStore.list().map(a => ({
    ...a,
    pausedUntil: pausedUntil(a, settings, now),
    proxyNow: proxyNow(a.id),
    proxyFixed: proxyFixed(a)
  }));
  const proxies = parseList(poolText()).map(p => ({
    line: p.line,
    label: p.error ? p.line : `${p.host}:${p.port}`,
    error: p.error || '',
    health: proxyHealth.get(p.line) || null
  }));
  return { accounts, settings, running, proxies, blocked: blockedReason(), now };
}

let pushQueued = false;
function pushStatus() {
  if (pushQueued) return;
  pushQueued = true;
  setImmediate(() => {
    pushQueued = false;
    const view = accountsView();
    const isConnected = view.accounts.some(a => a.enabled && a.loggedIn);
    sendUI('status-update', { isConnected });
    sendUI('accounts-update', view);
    crmServer?.updateStatus({
      isConnected,
      accounts: view.accounts.map(({ id, name, enabled, loggedIn, quota }) => ({ id, name, enabled, loggedIn, quota, running: view.running[id] || 0 }))
    });
  });
}

function loginAccount(id) {
  const acc = accountStore?.get(id);
  if (!acc) return Promise.resolve(false);
  if (logins.has(id)) { pageFor(id).show().catch(() => {}); return logins.get(id); }
  const job = (async () => {
    try {
      const ok = await ensureLogin(pageFor(id));
      if (accountStore.get(id)) accountStore.update(id, { loggedIn: ok });
      if (ok) {
        pushStatus();
        await pageFor(id).hide().catch(() => {});
        await pool.refreshQuota(id);
        pool.pump();
        pushStatus();
      } else {
        pushStatus();
      }
      return ok;
    } catch (e) {
      console.warn('[Main] Chrome lỗi:', e.message);
      if (accountStore.get(id)) accountStore.update(id, { loggedIn: false });
      pushStatus();
      return false;
    } finally {
      logins.delete(id);
    }
  })();
  logins.set(id, job);
  return job;
}

async function startAccounts() {
  const on = accountStore.list().filter(a => a.enabled);
  const single = accountStore.list().length === 1 && on.length === 1;
  await Promise.all(on.map(async a => {
    const ok = await pool.checkLogin(a.id, 10);
    if (ok) await pool.refreshQuota(a.id);
    else if (single) await loginAccount(a.id);
    else if (!logins.has(a.id)) await pageFor(a.id).chrome?.close().catch(() => {});
  }));
  pool.pump();
  pushStatus();
  setInterval(() => { pool.pump(); pushStatus(); }, 60e3);
}

function fetchImageAsDataUrl(imgUrl) {
  if (!imgUrl) return Promise.resolve(null);
  if (imgUrl.startsWith('data:')) return Promise.resolve(imgUrl);
  return new Promise((resolve) => {
    try {
      const client = imgUrl.startsWith('https') ? https : http;
      client.get(imgUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36' }, timeout: 20000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          fetchImageAsDataUrl(new URL(res.headers.location, imgUrl).href).then(resolve);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          resolve(null);
          return;
        }
        const contentType = res.headers['content-type'] || 'image/jpeg';
        if (contentType.includes('text/html')) {
          res.resume();
          resolve(null);
          return;
        }
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve(`data:${contentType};base64,${buffer.toString('base64')}`);
        });
      }).on('timeout', function () {
        this.destroy(new Error('timeout'));
      }).on('error', () => resolve(null));
    } catch (_) {
      resolve(null);
    }
  });
}

async function loadImage(img) {
  const src = img.imageLocalPath || img.imageUrl || '(ảnh)';
  if (img.imageLocalPath && fs.existsSync(img.imageLocalPath)) {
    const ext = path.extname(img.imageLocalPath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return { mimeType, dataBase64: fs.readFileSync(img.imageLocalPath).toString('base64') };
  }
  const m = img.imageUrl && /^data:([^;]+);base64,(.*)$/s.exec((await fetchImageAsDataUrl(img.imageUrl)) || '');
  if (!m) throw new Error('Không tải được ảnh: ' + src);
  return { mimeType: m[1], dataBase64: m[2] };
}

const pump = () => setImmediate(() => pool?.pump());

function submitTask(input = {}) {
  if (!taskStore) initStores();
  const st = studioStore.get();
  const isFilmId = typeof input.project === 'string' && /^film_[a-f0-9]{16,64}$/.test(input.project);
  const project = isFilmId && filmProjectStore?.hasProject(input.project)
    ? input.project : st.projects.some(p => p.id === input.project) ? input.project : st.current;
  const images = (Array.isArray(input.images) ? input.images : []).map(img => {
    if (typeof img === 'string') return { imageLocalPath: img };
    return img;
  });
  const task = taskStore.add({ ...input, images, project });
  pump();
  return task;
}

function cancelTask(id) {
  return pool ? pool.cancel(id) : null;
}

function retryTask(id) {
  if (!taskStore) initStores();
  const task = taskStore.get(id);
  if (!task || task.status === 'queued' || task.status === 'processing') return task || null;
  taskStore.update(id, { status: 'queued', step: '', error: '', files: [], startedAt: 0, finishedAt: 0, sessionId: '', accountId: '', attempts: 0, held: false });
  pump();
  return task;
}

function removeTask(id) {
  cancelTask(id);
  return taskStore ? taskStore.remove(id) : false;
}

function getApiKey(regenerate = false) {
  let key = configManager.get().apiKey;
  if (!key || regenerate) {
    key = 'msk_' + require('crypto').randomBytes(20).toString('hex');
    configManager.save({ apiKey: key });
  }
  return key;
}

function createWindow() {
  log('createWindow executing...');
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    title: 'Sesame Studio | Cộng Đồng Sáng Tạo Video AI (Bản Miễn Phí)',
    backgroundColor: '#0f172a',
    show: false,
    icon: path.join(__dirname, 'ui', 'assets', 'sesame_icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    log('ready-to-show: window shown cleanly');
  });

  mainWindow.webContents.on('did-finish-load', () => {
    try {
      mainWindow.webContents.setZoomFactor(1.0);
      sendUI('sesame:zoom-changed', 100);
    } catch (_) {}
    log('did-finish-load: Page loaded successfully!');
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (input.type === 'keyDown' && (input.control || input.meta)) {
      const k = String(input.key || '');
      const c = String(input.code || '');
      let cur = mainWindow.webContents.getZoomFactor() || 1.0;
      if (k === '+' || k === '=' || c === 'Equal' || c === 'NumpadAdd') {
        event.preventDefault();
        cur = Math.min(2.0, Math.round((cur + 0.1) * 10) / 10);
        mainWindow.webContents.setZoomFactor(cur);
        sendUI('sesame:zoom-changed', Math.round(cur * 100));
      } else if (k === '-' || k === '_' || c === 'Minus' || c === 'NumpadSubtract') {
        event.preventDefault();
        cur = Math.max(0.6, Math.round((cur - 0.1) * 10) / 10);
        mainWindow.webContents.setZoomFactor(cur);
        sendUI('sesame:zoom-changed', Math.round(cur * 100));
      } else if (k === '0' || c === 'Digit0' || c === 'Numpad0') {
        event.preventDefault();
        mainWindow.webContents.setZoomFactor(1.0);
        sendUI('sesame:zoom-changed', 100);
      }
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function sendProgress(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sesame:progress', { channel, ...data });
  }
}

// Toolkit IPC Registration
const toolkitCore = require('./engine/toolkit/toolkit-core');
require('./engine/ipc-features').register({ ipcMain, dialog, app, getWindow: () => mainWindow, defaultOutputDir, sendProgress });

function initStores() {
  if (taskStore && accountStore && pool) return;
  const userData = app.getPath('userData');
  try { fs.mkdirSync(userData, { recursive: true }); } catch (_) {}

  taskStore = new TaskStore();
  accountStore = new AccountStore(userData);
  studioStore = new StudioStore(userData);
  studioStore.on('update', data => sendUI('studio-update', data));
  filmProjectStore = new FilmProjectStore(userData);
  filmProjectService = new FilmProjectService({
    store: filmProjectStore,
    studioStore,
    taskStore,
    submitTask
  });
  pool = new Pool({
    tasks: taskStore,
    accounts: accountStore,
    pageFor,
    config: runConfig,
    loadImage,
    run: dispatchTask,
    onNeedLogin: id => loginAccount(id),
    skip: t => studioStore.pausedProjects().has(t.project || 'default'),
    onFiles: files => {
      for (const f of files) {
        if (f.endsWith('.mp4')) handleVideoFinished(f, 'muse');
      }
    }
  });
  taskStore.on('update', task => {
    sendUI('task-update', { task, blocked: blockedReason() });
    pushStatus();
  });
  accountStore.on('change', pushStatus);
}

app.whenReady().then(() => {
  try { powerSaveBlocker.start('prevent-app-suspension'); } catch (_) {}
  initStores();
  createWindow();
  startAccounts().catch(e => console.error('[Main] Khởi động tài khoản lỗi:', e));

  try {
    crmServer = new CrmServer(48900, {
      onJobReceived: (jobData) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('crm-job-received', jobData);
        return submitTask({ prompt: jobData.prompt, source: 'crm', label: jobData.topicId || '' });
      },
      apiKey: () => getApiKey(),
      tasks: {
        list: (status) => taskStore.list(status),
        get: (id) => taskStore.get(id),
        submit: (input) => submitTask({ ...input, source: 'api' }),
        cancel: cancelTask,
        retry: retryTask,
        remove: removeTask
      }
    });
    crmServer.start();
  } catch (e) {
    console.warn('[Main] CRM Server start error:', e.message);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  taskStore?.flush();
  accountStore?.flush();
  for (const page of pages.values()) page.chrome?.close();
});

app.on('window-all-closed', async () => {
  if (crmServer) crmServer.stop();
  await aiVideoEngine.closeAllAiBrowsers();
  if (process.platform !== 'darwin') app.quit();
});

// ====================================================================
// 1. CÀI ĐẶT, HỆ THỐNG & FILE PICKERS
// ====================================================================
ipcMain.handle('sesame:get-output-dir', () => defaultOutputDir());
ipcMain.handle('sesame:paths-exist', (_e, paths) => (Array.isArray(paths) ? paths : []).filter(p => typeof p === 'string' && !fs.existsSync(p)));
ipcMain.handle('sesame:env-check', () => core.checkEnvironment());

ipcMain.handle('sesame:list-outputs', async (_e, dirPath) => {
  const dir = dirPath || defaultOutputDir();
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => /\.(mp4|mov|mkv|webm)$/i.test(f))
      .map(f => {
        const full = path.join(dir, f);
        const st = fs.statSync(full);
        return { name: f, path: full, sizeMB: (st.size / (1024 * 1024)).toFixed(1), mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch (_) {
    return [];
  }
});

ipcMain.handle('sesame:pick-file', async (_e, opts = {}) => {
  const filters = opts.filters
    ? opts.filters
    : opts.type === 'audio'
      ? [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg'] }]
      : opts.type === 'image'
        ? [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
        : [{ name: 'Media Files', extensions: ['mp4', 'mov', 'mkv', 'webm', 'srt', 'txt', 'jpg', 'jpeg', 'png', 'webp'] }];
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters });
  return res.canceled ? '' : (res.filePaths[0] || '');
});

ipcMain.handle('sesame:pick-files', async (_e, opts = {}) => {
  const filters = opts.filters
    ? opts.filters
    : opts.type === 'image'
    ? [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    : [{ name: 'Media Files', extensions: ['mp4', 'mov', 'jpg', 'jpeg', 'png', 'webp'] }];
  const res = await dialog.showOpenDialog(mainWindow, { title: opts.title, properties: ['openFile', 'multiSelections'], filters });
  return res.canceled ? [] : (res.filePaths || []);
});

ipcMain.handle('sesame:pick-folder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'], defaultPath: defaultOutputDir() });
  return res.canceled ? '' : (res.filePaths[0] || '');
});

ipcMain.handle('select-folder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'], defaultPath: defaultOutputDir() });
  return res.canceled ? null : (res.filePaths[0] || null);
});

ipcMain.handle('sesame:open-path', async (_e, targetPath) => {
  const p = targetPath || defaultOutputDir();
  if (fs.existsSync(p) && fs.statSync(p).isFile()) shell.showItemInFolder(p);
  else await shell.openPath(p);
  return { ok: true };
});

ipcMain.handle('sesame:delete-file', async (_e, filePath) => {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return { ok: true };
    }
    return { ok: false, error: 'File không tồn tại' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ====================================================================
// 2. GHÉP VIDEO, NHẠC NỀN, VIENEU-TTS V3 48KHZ & SCENE COMPOSE
// ====================================================================
const IS_MAC = process.platform === 'darwin';
const bin = n => {
  const custom = [path.join(process.resourcesPath || '', 'bin'), path.join(ROOT_DIR, 'bin')]
    .map(d => path.join(d, IS_MAC ? n : n + '.exe')).find(p => fs.existsSync(p));
  return custom || n;
};

ipcMain.handle('sesame:merge-videos', async (_e, payload = {}) => {
  try {
    const files = (payload.files || payload.filePaths || []).filter(p => typeof p === 'string' && fs.existsSync(p));
    if (files.length < 2) return { ok: false, success: false, error: 'Cần ít nhất 2 video để ghép' };
    const out = payload.outputPath || merger.safeName(defaultOutputDir(), payload.outputName || `Merged_${Date.now()}`);
    if (typeof merger.merge === 'function') {
      const r = await merger.merge({
        ffmpeg: bin('ffmpeg'),
        ffprobe: bin('ffprobe'),
        files,
        out,
        tmpDir: os.tmpdir(),
        normalize: true,
        onProgress: pct => sendUI('merge-progress', pct)
      });
      if (r.success && r.path) handleVideoFinished(r.path, 'merged');
      return { ...r, ok: r.success, outputPath: r.path };
    }
    await merger.mergeVideos(files, out, { tmpDir: os.tmpdir() });
    handleVideoFinished(out, 'merged');
    return { ok: true, success: true, path: out, outputPath: out };
  } catch (err) {
    return { ok: false, success: false, error: err.message };
  }
});

ipcMain.handle('merge-videos', async (_event, paths = [], name = '', opts = {}) => {
  const files = (Array.isArray(paths) ? paths : []).filter(p => typeof p === 'string' && fs.existsSync(p));
  if (files.length < 2) return { success: false, error: 'Cần ít nhất 2 video' };
  const r = await merger.merge({
    ffmpeg: bin('ffmpeg'),
    ffprobe: bin('ffprobe'),
    files,
    out: merger.safeName(defaultOutputDir(), name),
    tmpDir: os.tmpdir(),
    normalize: opts?.normalize ?? true,
    onProgress: pct => sendUI('merge-progress', pct)
  });
  if (r.success && opts?.voice && vieneuTts.isVieneuVoice(opts.voice) && (opts?.voiceText || opts?.scenes?.length)) {
    const dubRes = await vieneuTts.dubVideoWithVieneu({
      videoPath: r.path,
      scenes: opts.scenes || [],
      text: opts.voiceText || '',
      voice: opts.voice,
      keepAmbient: Boolean(opts.keepAmbient),
      outDir: defaultOutputDir()
    });
    if (dubRes.success && dubRes.path) {
      handleVideoFinished(dubRes.path, 'vieneu-merged');
      return { ...r, path: dubRes.path, voice: dubRes.voice };
    }
  }
  if (r.success) handleVideoFinished(r.path, 'merged');
  return r;
});

ipcMain.handle('vieneu-voices', () => vieneuTts.VIENEU_VOICES);
ipcMain.handle('vieneu-preview', async (_event, payload = {}) => {
  try { return await vieneuTts.previewVieneuVoice(payload); }
  catch (err) { return { success: false, error: err.message || String(err) }; }
});
ipcMain.handle('vieneu-dub-video', async (_event, payload = {}) => {
  try {
    const r = await vieneuTts.dubVideoWithVieneu({ ...payload, outDir: payload.outDir || defaultOutputDir() });
    if (r.success && r.path) handleVideoFinished(r.path, 'vieneu-tts');
    return r;
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

ipcMain.handle('compose-scenes-voice', async (_event, payload = {}) => {
  try {
    const r = await sceneCompose.composeScenesWithVoice({
      ...payload,
      outDir: payload.outDir || defaultOutputDir(),
      onProgress: p => sendUI('compose-progress', p)
    });
    if (r.success && r.path) handleVideoFinished(r.path, 'scene-compose');
    return r;
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
});

ipcMain.handle('drama-verify', (_event, payload = {}) => {
  const v = dramaCompiler.validate(payload.spec);
  const paths = Array.isArray(payload.paths) ? payload.paths : [];
  return { errors: v.errors, warnings: v.warnings, missing: paths.filter(p => typeof p === 'string' && !fs.existsSync(p)) };
});

const musicDir = () => { const d = path.join(defaultOutputDir(), 'Nhạc nền'); fs.mkdirSync(d, { recursive: true }); return d; };
ipcMain.handle('open-music-folder', () => { shell.openPath(musicDir()); return merger.musicFiles ? merger.musicFiles(musicDir()).length : 0; });
ipcMain.handle('add-music', async (_event, video) => {
  if (typeof video !== 'string' || !fs.existsSync(video)) return { success: false, error: 'Không thấy file video' };
  const songs = merger.musicFiles ? merger.musicFiles(musicDir()) : [];
  if (!songs.length) return { success: false, error: 'Thư mục "Nhạc nền" chưa có bài nào (mp3/m4a/wav). Bỏ nhạc vào rồi bấm "Thử lại".' };
  const music = songs[Math.floor(Math.random() * songs.length)];
  const r = await merger.addMusic({
    ffmpeg: bin('ffmpeg'),
    ffprobe: bin('ffprobe'),
    video,
    music,
    out: merger.safeName(path.dirname(video), path.basename(video, path.extname(video)) + ' - nhạc nền')
  });
  if (r.success) handleVideoFinished(r.path, 'music');
  return r;
});

// ====================================================================
// 3. TƯ LIỆU, DỰ ÁN, FILM PROJECT V1 (SHOT BOARD) & GIÁM KHẢO AI
// ====================================================================
ipcMain.handle('studio-get', () => (studioStore ? studioStore.get() : {}));
ipcMain.handle('studio-save', (_event, patch = {}) => {
  if (!studioStore) return {};
  const { characters, bible, templates, model, rotate } = patch;
  return studioStore.save(Object.fromEntries(Object.entries({ characters, bible, templates, model, rotate }).filter(([, v]) => v !== undefined)));
});
ipcMain.handle('studio-add-image', (_event, src) => (studioStore ? studioStore.addImage(src) : null));
ipcMain.handle('project-add', (_event, name) => (studioStore ? studioStore.addProject(name) : null));
ipcMain.handle('project-update', (_event, id, patch) => {
  if (!studioStore) return {};
  studioStore.updateProject(id, patch);
  return studioStore.get();
});
ipcMain.handle('project-current', (_event, id) => {
  if (!studioStore) return {};
  studioStore.setCurrent(id);
  return studioStore.get();
});
ipcMain.handle('project-remove', (_event, id) => {
  if (!studioStore || !studioStore.removeProject(id)) return false;
  taskStore?.list().filter(t => t.project === id).forEach(t => removeTask(t.id));
  return true;
});

const filmReady = () => {
  if (!filmProjectService) initStores();
  if (!filmProjectService) throw new Error('Film Project đang khởi tạo, thử lại sau vài giây.');
  return filmProjectService;
};
ipcMain.handle('film-list', () => filmReady().list());
ipcMain.handle('film-get', (_event, id) => filmReady().get(id));
ipcMain.handle('film-create', (_event, payload) => filmReady().create(payload));
ipcMain.handle('film-replace', (_event, id, changes, revision) => filmReady().replace(id, changes, revision));
ipcMain.handle('film-mark-shot', (_event, id, shotId, patch, revision) => filmReady().updateShot(id, shotId, patch, revision));
ipcMain.handle('film-import-director', (_event, id, spec, revision) => {
  if (Buffer.byteLength(JSON.stringify(spec || {})) > 1000000) throw new Error('Spec Đạo diễn quá lớn (tối đa 1 MB).');
  return filmReady().importDirector(id, spec, revision);
});
ipcMain.handle('film-choose-asset', async (_event, id, characterId) => {
  const p = filmReady().get(id);
  if (!p.characters.some(c => c.id === characterId)) throw new Error('Nhân vật không tồn tại trong dự án.');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn ảnh tham chiếu cho nhân vật (sao chép vào dự án)',
    filters: [{ name: 'Ảnh', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths?.[0]) return null;
  return filmReady().attachAsset(id, characterId, result.filePaths[0]);
});
ipcMain.handle('film-hold-shot', (_event, id, shotId, revision) => filmReady().holdShot(id, shotId, revision));
ipcMain.handle('film-check-duplicate', (_event, id, text) => filmReady().checkDuplicate(id, text));

ipcMain.handle('script-judge', (_event, specOrScenes) => scriptJudge.judgeScript(specOrScenes));
ipcMain.handle('script-judge-prompt', (_event, text, genre) => scriptJudge.buildJudgePrompt(text, genre));
ipcMain.handle('drama-optimize-v51', (_event, payload = {}) => ({
  ok: true,
  prompt: dramaCompiler.optimizeRawPromptV51(payload.prompt || '', payload),
  timing: payload.totalMinutes ? dramaCompiler.computeTimingEngine(payload.totalMinutes, payload.seconds || 10) : null
}));

let lastLadi = null;
ipcMain.handle('scrape-and-analyze-ladi', async (_event, url, opts = {}) => {
  try {
    const rawData = opts.reuse && lastLadi && lastLadi.url === url ? lastLadi.raw : await scrapeLadiPage(url);
    lastLadi = { url, raw: rawData };
    const analyzed = generateScriptsFromProduct(rawData, opts);
    return { success: true, data: analyzed };
  } catch (err) {
    console.error('[Main] Lỗi phân tích LadiPage:', err);
    return { success: false, error: err.message };
  }
});

// ====================================================================
// 4. HÀNG ĐỢI TASK, TÀI KHOẢN & THƯ VIỆN (MUSE AI)
// ====================================================================
ipcMain.handle('select-image-file', async (_event, multi = false) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn ảnh tham chiếu',
    filters: [{ name: 'Image Files (*.jpg, *.png, *.webp, *.jpeg)', extensions: ['jpg', 'png', 'webp', 'jpeg', 'bmp'] }],
    properties: multi ? ['openFile', 'multiSelections'] : ['openFile']
  });
  if (result.canceled || !result.filePaths?.length) return multi ? [] : null;
  const files = result.filePaths.map(filePath => {
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return { filePath, name: path.basename(filePath), filename: path.basename(filePath), dataUrl: `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}` };
  });
  return multi ? files : files[0];
});

ipcMain.handle('open-output-folder', async () => {
  const dir = defaultOutputDir();
  await shell.openPath(dir);
  return dir;
});

ipcMain.handle('get-app-config', () => ({
  outputDir: defaultOutputDir(),
  version: '2.5.1',
  crmEndpoint: 'http://127.0.0.1:48900'
}));

const queueFile = () => path.join(app.getPath('userData'), 'queue.json');
ipcMain.handle('queue-load', () => {
  if (!fs.existsSync(queueFile())) return null;
  try { return JSON.parse(fs.readFileSync(queueFile(), 'utf8')); } catch (e) { return { error: e.message }; }
});
ipcMain.handle('queue-save', (_e, data) => {
  try {
    const tmp = queueFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, queueFile());
    return true;
  } catch (_) { return false; }
});

ipcMain.handle('task-submit', (_ev, input = {}) => submitTask({ ...input, source: 'ui' }));
ipcMain.handle('task-list', () => {
  if (!taskStore) initStores();
  return { tasks: taskStore.list(), blocked: blockedReason() };
});
ipcMain.handle('task-cancel', (_ev, id) => cancelTask(id));
ipcMain.handle('task-retry', (_ev, id) => retryTask(id));
ipcMain.handle('task-remove', (_ev, id) => removeTask(id));
ipcMain.handle('task-resume', () => { pump(); return true; });
ipcMain.handle('task-run', (_ev, ids = []) => {
  if (!taskStore) initStores();
  for (const id of ids) {
    const t = taskStore.get(id);
    if (t?.status === 'queued' && t.held) taskStore.update(id, { held: false });
    else if (t && t.status !== 'queued' && t.status !== 'processing') retryTask(id);
  }
  pump();
  return true;
});
ipcMain.handle('task-stop-all', () => {
  if (!taskStore) initStores();
  taskStore.list().filter(t => t.status === 'queued' || t.status === 'processing').forEach(t => cancelTask(t.id));
  return true;
});
ipcMain.handle('task-clear-finished', () => {
  if (!taskStore) initStores();
  taskStore.list().filter(t => t.status !== 'queued' && t.status !== 'processing').forEach(t => taskStore.remove(t.id));
  return true;
});

const firstAccount = () => {
  if (!accountStore) initStores();
  return (accountStore.list().find(a => a.enabled) || accountStore.list()[0])?.id || 'default';
};
const ACCOUNT_FIELDS = ['name', 'enabled', 'threads', 'proxy', 'provider', 'apiKey'];

ipcMain.handle('list-accounts', () => accountsView().accounts);
ipcMain.handle('accounts-list', () => accountsView());
ipcMain.handle('account-add', (_e, name, provider = 'muse') => {
  if (!accountStore) initStores();
  const acc = accountStore.add(name || 'Tài khoản mới', provider);
  loginAccount(acc.id);
  return acc;
});
ipcMain.handle('account-update', (_e, id, patch = {}) => {
  if (!accountStore) initStores();
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => ACCOUNT_FIELDS.includes(k)));
  const acc = accountStore.update(id, clean);
  if ('proxy' in clean) reapplyProxies();
  if (acc?.enabled && acc.loggedIn === null) pool.checkLogin(id).then(ok => ok && pool.refreshQuota(id)).finally(pump);
  pump();
  return acc;
});
ipcMain.handle('account-remove', async (_e, id) => {
  if (!accountStore) initStores();
  if (!accountStore.get(id)) return { ok: false, error: 'Không có tài khoản này' };
  if (accountStore.list().length <= 1) return { ok: false, error: 'Phải còn ít nhất 1 tài khoản' };
  if (pool.busy(id)) return { ok: false, error: 'Tài khoản đang chạy task. Dừng task trước rồi xoá.' };
  pool.releaseAccount(id);
  accountStore.remove(id);
  const page = pages.get(id);
  pages.delete(id);
  if (page) { page.removed = true; await page.chrome?.close().catch(() => {}); }
  const dir = path.join(app.getPath('userData'), 'profiles', id);
  if (fs.existsSync(dir)) await shell.trashItem(dir).catch(() => {});
  pump();
  return { ok: true };
});
ipcMain.handle('account-login', (_e, id) => { loginAccount(id); return true; });
ipcMain.handle('account-show', (_e, id) => pageFor(id).show().then(() => true, () => false));
ipcMain.handle('account-logout', async (_e, id) => {
  if (pool.busy(id)) return { ok: false, error: 'Tài khoản đang chạy task. Dừng task trước.' };
  await pageFor(id).logout();
  accountStore.update(id, { loggedIn: false });
  return { ok: true };
});
ipcMain.handle('accounts-settings', (_e, patch) => {
  if (!accountStore) initStores();
  const s = accountStore.setSettings(patch || {});
  if ('proxies' in (patch || {}) || 'usePool' in (patch || {})) reapplyProxies();
  pump();
  return s;
});
ipcMain.handle('proxies-check', async () => {
  if (!accountStore) initStores();
  const own = accountStore.list().filter(a => a.proxy && a.proxy !== 'none').map(a => parseProxy(a.proxy)).filter(p => !p.error);
  await Promise.all([...new Map([...parseList(poolText()), ...own].map(p => [p.line, p])).values()].map(testProxy));
  reapplyProxies();
  pump();
  return accountsView();
});
ipcMain.handle('accounts-check-quota', async (_e, id) => {
  if (!accountStore) initStores();
  const ids = id ? [id] : accountStore.list().filter(a => a.enabled && a.loggedIn).map(a => a.id);
  await Promise.all(ids.map(i => pool.refreshQuota(i)));
  pump();
  return accountsView();
});
ipcMain.handle('accounts-check-login', async () => {
  if (!accountStore) initStores();
  await Promise.all(accountStore.list().filter(a => a.enabled).map(a => pool.checkLogin(a.id, 10)));
  pump();
  pushStatus();
  return accountsView();
});
ipcMain.handle('open-muse-login', () => {
  const id = firstAccount();
  if (accountStore.get(id)?.loggedIn) pageFor(id).show().catch(() => {});
  else loginAccount(id);
  return true;
});
ipcMain.handle('check-muse-status', async () => pool.checkLogin(firstAccount(), 2));
ipcMain.handle('logout-muse', async () => {
  const id = firstAccount();
  await pageFor(id).logout();
  accountStore.update(id, { loggedIn: false });
  return true;
});

ipcMain.handle('list-library', () => {
  const dir = defaultOutputDir();
  const read = (d, re, kind) => {
    try {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
      return fs.readdirSync(d).filter(f => re.test(f)).map(filename => {
        const localPath = path.join(d, filename), st = fs.statSync(localPath);
        return { kind, filename, localPath, timestamp: st.mtimeMs, size: st.size };
      });
    } catch { return []; }
  };
  return [...read(dir, /\.(mp4|mov|webm|m4v)$/i, 'video'), ...read(path.join(dir, 'storyboard'), /\.(png|jpe?g|webp)$/i, 'image')]
    .sort((a, b) => b.timestamp - a.timestamp);
});

ipcMain.handle('get-library-videos', async () => {
  try {
    const dir = defaultOutputDir();
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => /\.(mp4|mov|webm|m4v)$/i.test(f))
      .map(filename => {
        const fullPath = path.join(dir, filename);
        const stat = fs.statSync(fullPath);
        return { filename, localPath: fullPath, timestamp: stat.mtimeMs, size: stat.size };
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  } catch (_) {
    return [];
  }
});

ipcMain.handle('reveal-file', (_event, p) => {
  if (p && fs.existsSync(p)) shell.showItemInFolder(p);
  return true;
});

ipcMain.handle('trash-files', async (_event, paths = []) => {
  let n = 0;
  for (const p of paths) {
    if (typeof p === 'string' && fs.existsSync(p)) {
      await shell.trashItem(p).then(() => n++, () => {});
    }
  }
  return n;
});

// ====================================================================
// 5. ĐĂNG FACEBOOK REELS & CÀI ĐẶT CHUNG 
// ====================================================================
function getFbConfigFile() {
  const dataDir = app.getPath('userData');
  try { fs.mkdirSync(dataDir, { recursive: true }); } catch (_) {}
  return path.join(dataDir, 'facebook-config.json');
}

function readFbConfig() {
  try {
    const f = getFbConfigFile();
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) {}
  return { fbToken: '', fbPages: [], selectedPageId: '', selectedPageName: '', selectedPageAccessToken: '', selectedPageAvatar: '' };
}

function saveFbConfig(cfg = {}) {
  try {
    const f = getFbConfigFile();
    const merged = { ...readFbConfig(), ...cfg };
    fs.writeFileSync(f, JSON.stringify(merged, null, 2), 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

ipcMain.handle('get-user-config', () => readFbConfig());
ipcMain.handle('sesame:fb-get-config', () => readFbConfig());

ipcMain.handle('save-user-config', (_e, cfg) => saveFbConfig(cfg));
ipcMain.handle('sesame:fb-save-config', (_e, cfg) => ({ ok: saveFbConfig(cfg), success: saveFbConfig(cfg) }));

async function handleFetchFbPages(token) {
  try {
    const pages = await fbPoster.fetchFacebookPages(token);
    return { success: true, ok: true, data: pages, pages };
  } catch (err) {
    return { success: false, ok: false, error: err.message };
  }
}
ipcMain.handle('fetch-fb-pages', (_e, token) => handleFetchFbPages(token));
ipcMain.handle('sesame:fb-fetch-pages', (_e, token) => handleFetchFbPages(token));

async function handleVerifyFbToken(payload = {}) {
  try {
    const pageId = payload.pageId;
    const token = payload.token || payload.pageAccessToken;
    const info = await fbPoster.verifyFacebookPageToken(pageId, token);
    return { success: true, ok: true, data: info, ...info };
  } catch (err) {
    return { success: false, ok: false, error: err.message };
  }
}
ipcMain.handle('verify-fb-token', (_e, payload) => handleVerifyFbToken(payload));
ipcMain.handle('sesame:fb-verify-token', (_e, payload) => handleVerifyFbToken(payload));

async function handlePublishFbReel(payload = {}) {
  try {
    const { filePath, caption, pageId } = payload;
    const token = payload.token || payload.pageAccessToken;
    const res = await fbPoster.publishFacebookReels(filePath, caption, pageId, token);
    return { success: true, ok: true, data: res, ...res };
  } catch (err) {
    return { success: false, ok: false, error: err.message };
  }
}
ipcMain.handle('publish-fb-reels', (_e, payload) => handlePublishFbReel(payload));
ipcMain.handle('sesame:fb-publish-reel', (_e, payload) => handlePublishFbReel(payload));

ipcMain.handle('select-video-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Chọn file video MP4 để đăng lên Facebook Reels',
    defaultPath: defaultOutputDir(),
    filters: [{ name: 'Video Files (*.mp4, *.mov)', extensions: ['mp4', 'mov', 'm4v', 'webm'] }],
    properties: ['openFile']
  });
  return (!result.canceled && result.filePaths && result.filePaths[0]) ? result.filePaths[0] : null;
});

const SETTING_KEYS = ['outputDir', 'maxAttempts', 'imageTimeoutMin', 'videoTimeoutMin'];
ipcMain.handle('get-settings', () => {
  const cfg = configManager.get();
  return {
    maxAttempts: cfg.maxAttempts || 2,
    imageTimeoutMin: cfg.imageTimeoutMin || 6,
    videoTimeoutMin: cfg.videoTimeoutMin || 15,
    outputDir: defaultOutputDir()
  };
});
ipcMain.handle('save-settings', (_event, patch = {}) => {
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => SETTING_KEYS.includes(k)));
  configManager.save(clean);
  const cfg = configManager.get();
  return {
    maxAttempts: cfg.maxAttempts || 2,
    imageTimeoutMin: cfg.imageTimeoutMin || 6,
    videoTimeoutMin: cfg.videoTimeoutMin || 15,
    outputDir: defaultOutputDir()
  };
});

ipcMain.handle('get-api-key', (_event, regenerate) => {
  let key = configManager.get().apiKey;
  if (!key || regenerate) {
    key = 'msk_' + require('crypto').randomBytes(20).toString('hex');
    configManager.save({ apiKey: key });
  }
  return key;
});

ipcMain.handle('fetch-image-base64', async (_event, imgUrl) => {
  if (!imgUrl) return null;
  if (imgUrl.startsWith('data:')) return imgUrl;
  return new Promise((resolve) => {
    try {
      const client = imgUrl.startsWith('https') ? https : http;
      client.get(imgUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 }, (res) => {
        if (res.statusCode !== 200) { res.resume(); return resolve(null); }
        const contentType = res.headers['content-type'] || 'image/jpeg';
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(`data:${contentType};base64,${Buffer.concat(chunks).toString('base64')}`));
      }).on('error', () => resolve(null));
    } catch (_) { resolve(null); }
  });
});

// ====================================================================
// 6. GOOGLE FLOW BUILDER IPC
// ====================================================================
const flowStateFile = () => path.join(app.getPath('userData'), 'flow_builder.json');
ipcMain.handle('flow-generate-project', (_e, input = {}) => generateFlowProjectFromIdea(input));
ipcMain.handle('flow-build-scene-prompt', (_e, payload = {}) => buildScenePrompt(payload.scene, payload.entities, payload.opts || payload.options || {}));
ipcMain.handle('flow-chatgpt-helper', (_e, input = {}) => buildChatGptHelperPrompt(input));
ipcMain.handle('flow-parse-external', (_e, payload = {}) => parseExternalScriptToScenes(payload));
ipcMain.handle('flow-extract-end-frame', async (_e, payload) => {
  try {
    const videoPath = typeof payload === 'string' ? payload : payload?.videoPath;
    return videoPath ? await extractVideoEndFrame(videoPath) : null;
  } catch (_) { return null; }
});
ipcMain.handle('flow-state-load', () => {
  if (!fs.existsSync(flowStateFile())) return null;
  try { return JSON.parse(fs.readFileSync(flowStateFile(), 'utf8')); } catch (_) { return null; }
});
ipcMain.handle('flow-state-save', (_e, data) => {
  try {
    const tmp = flowStateFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, flowStateFile());
    return true;
  } catch (_) { return false; }
});

// ====================================================================
// 7. SESAME & TOOLKIT CORE HANDLERS (TẢI VIDEO, DỊCH SRT, LỒNG TIẾNG)
// ====================================================================
ipcMain.handle('sesame:edu-analyze', async (_e, videoPath) => core.analyzeEduFootage(videoPath));
ipcMain.handle('sesame:edu-translate', async (_e, { lines = [], targetLang = 'en' }) => {
  const out = [];
  for (const line of lines) out.push(await core.translateEduSentence(line, targetLang));
  return out;
});
ipcMain.handle('sesame:edu-render', async (_e, payload = {}) => core.renderEduMasterVideo({
  ...payload,
  outputDir: payload.outputDir || defaultOutputDir(),
  onProgress: info => sendProgress('edu', info)
}));

ipcMain.handle('sesame:story-parse', async (_e, payload = {}) => core.parseNovelToStoryWeaverScript(payload.rawText || '', payload));
ipcMain.handle('sesame:story-render', async (_e, payload = {}) => core.renderStoryWeaverVideo({
  ...payload,
  outputDir: payload.outputDir || defaultOutputDir(),
  onProgress: info => sendProgress('story', info)
}));
ipcMain.handle('sesame:render-instant-clean', async (_e, payload = {}) => core.renderInstantReelWithCleanTemplate({
  ...payload,
  outputDir: payload.outputDir || defaultOutputDir(),
  onProgress: info => sendProgress('story', info)
}));
ipcMain.handle('sesame:list-clean-templates', async () => {
  const dir = path.join(defaultOutputDir(), 'phoi_video_sach');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.mp4')).map(f => ({ name: f, path: path.join(dir, f) }));
});
ipcMain.handle('sesame:story-to-sesame', async (_e, payload = {}) => aiVideoEngine.generateAiVideoForScenes({
  projectTitle: payload.novelTitle || 'Sesame_Story',
  scenes: payload.scenes || [],
  seriesConfig: payload.seriesConfig || {},
  engine: payload.engine || 'muse',
  outputDir: payload.outputDir || defaultOutputDir(),
  onProgress: info => sendProgress('story', info)
}));

ipcMain.handle('sesame:viral-download', async (_e, payload = {}) => core.downloadCleanViralVideo(payload.url, payload.outputDir || defaultOutputDir()));
ipcMain.handle('sesame:viral-render', async (_e, payload = {}) => {
  const lines = Array.isArray(payload.scriptLines) ? payload.scriptLines : [];
  return core.renderViralAffiliateRemix({
    ...payload,
    inputVideoPath: payload.inputVideoPath || payload.inputVideo,
    hookScript: payload.hookScript || lines.join('\n'),
    ctaBanner: payload.ctaBanner != null ? payload.ctaBanner : (payload.affiliateCta || ''),
    productName: payload.productName || undefined,
    outputDir: payload.outputDir || defaultOutputDir(),
    onProgress: info => sendProgress('viral', info)
  });
});

ipcMain.handle('sesame:list-ai-scenes', async () => {
  const scenesDir = path.join(defaultOutputDir(), 'ai_scenes');
  const results = [];
  try {
    if (!fs.existsSync(scenesDir)) return [];
    for (const sub of fs.readdirSync(scenesDir)) {
      const subPath = path.join(scenesDir, sub);
      if (fs.statSync(subPath).isDirectory()) {
        for (const f of fs.readdirSync(subPath).filter(f => /\.(mp4|mov|webm)$/i.test(f))) {
          const full = path.join(subPath, f);
          const st = fs.statSync(full);
          results.push({ name: `${sub} / ${f}`, fileName: f, project: sub, path: full, sizeMB: (st.size / (1024 * 1024)).toFixed(1), mtime: st.mtimeMs });
        }
      }
    }
  } catch (_) {}
  return results.sort((a, b) => b.mtime - a.mtime);
});

ipcMain.handle('sesame:zoom', (_e, action = 'get') => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, pct: 100 };
  let cur = mainWindow.webContents.getZoomFactor() || 1.0;
  if (action === 'in') cur = Math.min(2.0, Math.round((cur + 0.1) * 10) / 10);
  else if (action === 'out') cur = Math.max(0.6, Math.round((cur - 0.1) * 10) / 10);
  else if (action === 'reset') cur = 1.0;
  else if (typeof action === 'number' && action >= 0.5 && action <= 2.5) cur = action;
  mainWindow.webContents.setZoomFactor(cur);
  const pct = Math.round(cur * 100);
  sendUI('sesame:zoom-changed', pct);
  return { ok: true, factor: cur, pct };
});

// (Danh mục phim ngắn 'Hồng Quả' đã được gỡ khỏi bản phát hành: bộ giải mã không kèm theo, số liệu xu hướng trước đây là dữ liệu mẫu.)

ipcMain.handle('sesame:toolkit-get-voices', () => toolkitCore.toolkitTts.TOOLKIT_FEATURED_VOICES);
ipcMain.handle('sesame:toolkit-translate-srt', async (_e, payload = {}) => {
  const srtPath = payload.srtPath;
  if (!srtPath || !fs.existsSync(srtPath)) return { ok: false, error: 'File phụ đề SRT không tồn tại' };
  const content = fs.readFileSync(srtPath, 'utf-8');
  const cues = toolkitCore.toolkitTranslator.parseSrt(content);
  const result = await toolkitCore.toolkitTranslator.translateCues(cues, {
    genre: payload.genre || 'modern',
    provider: payload.provider || 'local',
    apiKey: payload.apiKey || ''
  });
  if (result.ok) {
    const outSrtPath = payload.outSrtPath || srtPath.replace(/\.srt$/i, '_vi.srt');
    fs.writeFileSync(outSrtPath, toolkitCore.toolkitTranslator.cuesToSrt(result.cues), 'utf-8');
    return { ok: true, outSrtPath, cues: result.cues, method: result.method };
  }
  return result;
});
ipcMain.handle('sesame:toolkit-dub-track', async (_e, payload = {}) => {
  const { srtPath, voiceId, outputAudioPath } = payload;
  if (!srtPath || !fs.existsSync(srtPath)) return { ok: false, error: 'File phụ đề SRT không tồn tại' };
  const content = fs.readFileSync(srtPath, 'utf-8');
  const cues = toolkitCore.toolkitTranslator.parseSrt(content);
  const finalAudioPath = outputAudioPath || path.join(defaultOutputDir(), `dub_${Date.now()}.aac`);
  return toolkitCore.generateDubbingTrack(cues, voiceId || 'BV562_streaming', finalAudioPath, (info) => sendProgress('toolkit', info));
});
ipcMain.handle('sesame:toolkit-probe-video', async (_e, videoPath) => toolkitCore.toolkitCut.probeVideo(videoPath));
ipcMain.handle('sesame:toolkit-detect-scenes', async (_e, payload = {}) => {
  return toolkitCore.toolkitCut.detectScenes(payload.videoPath, payload.threshold || 0.35);
});
ipcMain.handle('sesame:toolkit-plan-segments', async (_e, payload = {}) => {
  return { ok: true, segments: toolkitCore.toolkitCut.planSegments(payload) };
});
ipcMain.handle('sesame:toolkit-cut-export', async (_e, payload = {}) => {
  const res = await toolkitCore.toolkitCut.cutAndExport(
    { ...payload, outputDir: payload.outputDir || defaultOutputDir() },
    (info) => sendProgress('toolkit-cut', info)
  );
  if (res && res.ok && Array.isArray(res.outputs)) {
    res.outputs.forEach(o => {
      if (o && o.path) handleVideoFinished(o.path, 'toolkit-cut');
    });
    // Thay video trong Kho: chỉ khi nguồn nằm đúng trong thư mục Kho (output) và mọi phần đã xuất xong → nguồn vào Thùng rác (khôi phục được).
    if (payload.replaceSource && payload.videoPath && res.outputs.length > 0
        && path.resolve(path.dirname(payload.videoPath)).toLowerCase() === path.resolve(defaultOutputDir()).toLowerCase()
        && res.outputs.every(o => o.path && fs.existsSync(o.path) && fs.statSync(o.path).size > 0)) {
      try { await shell.trashItem(payload.videoPath); res.sourceTrashed = true; } catch (e) { res.sourceTrashed = false; res.trashError = e.message; }
    }
  }
  return res;
});
ipcMain.handle('sesame:toolkit-merge-cuts', async (_e, payload = {}) => {
  const res = await toolkitCore.toolkitCut.mergeCutVideos(payload.videoPaths || [], payload.outputPath || '');
  if (res && res.ok && res.outputPath) {
    handleVideoFinished(res.outputPath, 'toolkit-cut-merge');
  }
  return res;
});
/* ===== EDIT / GHÉP VIDEO THEO DỰ ÁN ===== */
const videoEditor = require('./engine/video-editor');
const editProjectsDir = () => path.join(app.getPath('userData'), 'edit-projects');
ipcMain.handle('sesame:edit-list', async () => videoEditor.listProjects(editProjectsDir()));
ipcMain.handle('sesame:edit-new', async (_e, name) => {
  const p = videoEditor.emptyProject(name);
  await videoEditor.saveProject(editProjectsDir(), p);
  return { ok: true, project: p };
});
ipcMain.handle('sesame:edit-load', async (_e, id) => videoEditor.loadProject(editProjectsDir(), id));
ipcMain.handle('sesame:edit-save', async (_e, project) => videoEditor.saveProject(editProjectsDir(), project || {}));
ipcMain.handle('sesame:edit-delete', async (_e, id) => videoEditor.deleteProject(editProjectsDir(), id));
ipcMain.handle('sesame:edit-probe', async (_e, files) => {
  const list = Array.isArray(files) ? files : [files];
  const out = [];
  for (const f of list) out.push(await videoEditor.probe(f));
  return out;
});
// Prompt đồng bộ (hàm thuần, không gửi đi đâu)
const promptSync = require('./engine/prompt-sync');
ipcMain.handle('sesame:psync-build', async (_e, project) => { try { return promptSync.buildSyncPrompts(project || {}); } catch (e) { return { scenes: [], warnings: ['Lỗi dựng prompt: ' + e.message], consistency: { ok: false } }; } });
ipcMain.handle('sesame:psync-parse', async (_e, payload = {}) => {
  try {
    const f = String(payload.filePath || '');
    const text = f ? fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '') : String(payload.text || '');
    return { ok: true, project: promptSync.parseSyncPrompts(text) };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('sesame:save-text', async (_e, payload = {}) => {
  const r = await dialog.showSaveDialog(mainWindow, { defaultPath: path.join(defaultOutputDir(), String(payload.defaultName || 'prompt.txt')), filters: [{ name: 'Text', extensions: ['txt'] }] });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(r.filePath, String(payload.text || ''), 'utf8');
  return { ok: true, path: r.filePath };
});
// Sóng âm THẬT của một video (đọc PCM bằng ffmpeg). Trả về mảng 0..1, perSec mẫu mỗi giây; hasAudio=false nếu không có tiếng.
const _waveCache = new Map();
ipcMain.handle('sesame:edit-wave', async (_e, payload = {}) => {
  const file = String(payload.path || ''); const perSec = Math.min(40, Math.max(2, Number(payload.perSec) || 10));
  if (!file || !fs.existsSync(file)) return { ok: false, error: 'Không thấy file' };
  const key = file + '|' + fs.statSync(file).mtimeMs + '|' + perSec;
  if (_waveCache.has(key)) return _waveCache.get(key);
  const { spawn } = require('child_process');
  const ff = path.join(path.dirname(require.resolve('./engine/video-editor.js')), '..', 'bin', 'ffmpeg.exe');
  const bin = fs.existsSync(ff) ? ff : 'ffmpeg';
  const res = await new Promise(resolve => {
    const p = spawn(bin, ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '4000', '-f', 's16le', '-'], { windowsHide: true });
    const chunks = []; p.stdout.on('data', d => chunks.push(d));
    p.on('error', () => resolve({ ok: false, error: 'ffmpeg lỗi' }));
    p.on('close', () => {
      const buf = Buffer.concat(chunks); const n = Math.floor(buf.length / 2);
      if (n < 400) return resolve({ ok: true, hasAudio: false, peaks: [], perSec });
      const win = Math.max(1, Math.floor(4000 / perSec)); const peaks = []; let mx = 1;
      for (let i = 0; i + win <= n; i += win) { let s = 0; for (let j = i; j < i + win; j += 2) s += Math.abs(buf.readInt16LE(j * 2)); const a = s / (win / 2); peaks.push(a); if (a > mx) mx = a; }
      resolve({ ok: true, hasAudio: true, perSec, peaks: peaks.map(v => Math.round(Math.min(1, v / mx) * 100) / 100) });
    });
  });
  if (res.ok) _waveCache.set(key, res);
  return res;
});
ipcMain.handle('sesame:edit-export', async (_e, payload = {}) => {
  const project = payload.project || {};
  const safe = String(payload.outputName || project.name || 'Edit').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Edit';
  const outPath = payload.outputPath || path.join(defaultOutputDir(), `${safe}_${Date.now()}.mp4`);
  const res = await videoEditor.exportProject(project, outPath, (info) => sendProgress('edit-export', info));
  if (res && res.ok) handleVideoFinished(res.outputPath, 'edit-export');
  return res;
});
// Xem trước CẢ TIMELINE: dựng bản nhẹ (1/2 kích thước, chất lượng thấp) bằng ĐÚNG đồ thị của lúc xuất → xem được chuyển cảnh, màu, chữ, lớp phủ, nhạc.
ipcMain.handle('sesame:edit-preview', async (_e, payload = {}) => {
  const project = payload.project || {};
  const dir = path.join(app.getPath('temp'), 'sesame-edit-preview');
  fs.mkdirSync(dir, { recursive: true });
  try { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (Date.now() - fs.statSync(p).mtimeMs > 3600e3) fs.unlinkSync(p); } } catch (_) {}
  const outPath = path.join(dir, `preview_${Date.now()}.mp4`);
  return videoEditor.exportProject(project, outPath, (info) => sendProgress('edit-export', info), { preview: true });
});
ipcMain.handle('sesame:toolkit-trim-video', async (_e, payload = {}) => {
  const outPath = payload.outputPath || path.join(defaultOutputDir(), `trim_${Date.now()}.mp4`);
  return toolkitCore.toolkitCut.trimVideo(payload.videoPath, payload.startSec, payload.endSec, outPath);
});
ipcMain.handle('sesame:toolkit-split-video', async (_e, payload = {}) => toolkitCore.toolkitCut.splitVideoIntoSegments(payload.videoPath, payload.segmentSeconds || 60, defaultOutputDir()));
ipcMain.handle('sesame:toolkit-extract-audio', async (_e, videoPath) => toolkitCore.toolkitOcr.extractAudioFromVideo(videoPath));
ipcMain.handle('sesame:toolkit-tts-normalize', async (_e, payload = {}) => {
  return { ok: true, normalized: toolkitCore.toolkitTts.normalizeTextForTts(payload.text || '') };
});
ipcMain.handle('sesame:toolkit-tts-parse-timed', async (_e, payload = {}) => {
  let content = payload.text || '';
  if (payload.filePath && fs.existsSync(payload.filePath)) {
    content = fs.readFileSync(payload.filePath, 'utf8');
  }
  const cues = toolkitCore.toolkitTts.parseTimedContent(content);
  return { ok: true, cues, count: cues.length, rawText: content };
});
ipcMain.handle('sesame:toolkit-tts-read-txt', async (_e, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, error: 'Không tìm thấy file TXT: ' + (filePath || '') };
  }
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return { ok: true, filePath, fileName: path.basename(filePath), text, charCount: text.length, lineCount: lines.length };
});
ipcMain.handle('sesame:tts-catalog', async () => {
  try { return await toolkitCore.toolkitTts.listVoiceCatalog({ cacheFile: path.join(app.getPath('userData'), 'tts-edge-voices.json') }); }
  catch (e) { return { ok: false, error: e.message || String(e), sources: [], voices: [] }; }
});
ipcMain.handle('sesame:tts-preview', async (_e, payload = {}) => toolkitCore.toolkitTts.previewVoice(payload));
ipcMain.handle('sesame:toolkit-tts-generate', async (_e, payload = {}) => {
  return toolkitCore.toolkitTts.generateTtsStudio(
    { ...payload, outputDir: payload.outputDir || defaultOutputDir() },
    (info) => sendProgress('toolkit-tts', info)
  );
});
