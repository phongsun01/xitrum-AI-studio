/**
 * SEEDANCE 2.5 RUNNER — Tự động hóa tạo video trên BytePlus Seedance 2.5 Playground (ai.byteplus.com)
 * & hỗ trợ song song chế độ BytePlus Ark API Key (nếu tài khoản cấu hình apiKey).
 *
 * Quy trình Web CDP:
 *  1. Mở Chrome profile riêng của tài khoản Seedance tại BytePlus Playground:
 *     https://ai.byteplus.com/en/playground/model/gen_video?model=dreamina-seedance-2-5-260628...
 *  2. Tự động đóng các popup quảng cáo / cookie banner nếu có.
 *  3. Cấu hình Tỷ lệ khung hình (9:16, 16:9, 1:1, 4:3, 3:4), Định dạng MP4, Bật âm thanh (Sound ON), Số lượng 1.
 *  4. Tải lên ảnh tham chiếu (Reference images) qua CDP DOM.setFileInputFiles nếu task có đính kèm ảnh.
 *  5. Nhập prompt vào trình soạn thảo .tiptap.ProseMirror.
 *  6. Bấm nút gửi [data-testid="video-sender-submit-button"] và tự động xác nhận hộp thoại chi phí
 *     [data-testid="gen-video-cost-confirm-ok"] nếu xuất hiện.
 *  7. Theo dõi tiến trình render qua cả DOM (<video>) và Network/Fetch interceptor, tải file MP4 về thư mục lưu
 *     theo chuẩn tên file: [DuAn]_[Canh-XX]_[000s-010s]_Seedance_[timestamp].mp4.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { extractTags } = require('./muse-runner');
const {
  materializeTaskImages,
  splitMultiScenePrompt,
  extractVideoEndFrame,
  applySceneContinuity
} = require('./scene-helper');
const merger = require('./merge');

const SEEDANCE_URL = 'https://ai.byteplus.com/en/playground/model/gen_video?model=dreamina-seedance-2-5-260628&utm_source=google&utm_medium=cpc&utm_campaign=internal_seedance_link_to_modelcenter&utm_term=20260916_pc_seedance_intenal_seedance&utm_content=internal';
const VALID_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Tải file từ URL HTTP/HTTPS về đường dẫn đích (hỗ trợ redirect)
 */
function downloadUrlToFile(url, destPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        ...headers
      },
      timeout: 60000
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const nextUrl = new URL(res.headers.location, url).href;
        return downloadUrlToFile(nextUrl, destPath, headers).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} khi tải video từ Seedance`));
      }
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(destPath)));
      file.on('error', err => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Quá thời gian tải file video Seedance')));
    req.on('error', reject);
  });
}

/**
 * Đảm bảo trang BytePlus Seedance 2.5 đã sẵn sàng và được cấu hình đúng tỷ lệ khung hình
 */
async function ensureSeedanceReady(chrome, { ratio = '9:16', resolution = '720p' } = {}) {
  if (!chrome.running) {
    await chrome.start();
  }

  const currentUrl = await chrome.evaluate('location.href').catch(() => '');
  if (!currentUrl.includes('ai.byteplus.com') || !currentUrl.includes('gen_video')) {
    await chrome.cmd('Page.navigate', { url: SEEDANCE_URL }, chrome.sessionId);
    await sleep(6000);
  }

  // Chờ khung nhập prompt ProseMirror xuất hiện (tối đa 15s)
  for (let i = 0; i < 15; i++) {
    const hasEditor = await chrome.evaluate(`Boolean(document.querySelector('.ProseMirror'))`).catch(() => false);
    if (hasEditor) break;
    await sleep(1000);
  }

  // Đóng các hộp thoại thông báo / cookie / khuyến mãi nếu có
  await chrome.evaluate(`(() => {
    const closeSelectors = [
      'button.acknowledgeButton_ef9fd',
      'button[aria-label="Close special offer"]',
      '.aml-arco-modal-close-icon',
      'button[aria-label="Close"]'
    ];
    for (const sel of closeSelectors) {
      document.querySelectorAll(sel).forEach(btn => { try { btn.click(); } catch (_) {} });
    }
  })()`).catch(() => {});
  await sleep(400);

  // Mở bảng cấu hình Tỷ lệ / Độ phân giải / Âm thanh
  const targetRatio = VALID_RATIOS.includes(ratio) ? ratio : '9:16';
  await chrome.evaluate(`(() => {
    const trigger = document.querySelector('[data-testid="video-sender-ratio-resolution-config-dropdown"]');
    if (trigger) trigger.click();
  })()`).catch(() => {});
  await sleep(600);

  // Chọn Ratio, Resolution, Format MP4, Sound ON, Quantity 1
  await chrome.evaluate(`(() => {
    const clickRadio = (groupSel, val) => {
      const input = document.querySelector(groupSel + ' input[type="radio"][value="' + val + '"]');
      if (!input) return false;
      const label = input.closest('label') || input;
      label.click();
      return true;
    };
    clickRadio('#generateOptions_ratio', ${JSON.stringify(targetRatio)});
    clickRadio('#generateOptions_resolution', ${JSON.stringify(resolution)});
    clickRadio('#generateOptions_outputFormat', 'mp4');
    clickRadio('#generateOptions_generateAudio', 'true');
    clickRadio('#generateOptions_outputCount', '1');
    // Đóng popover
    const trigger = document.querySelector('[data-testid="video-sender-ratio-resolution-config-dropdown"]');
    if (trigger) trigger.click();
  })()`).catch(() => {});
  await sleep(500);
}

/**
 * Tải ảnh tham chiếu lên khung Reference của Seedance 2.5 qua CDP
 */
async function uploadReferenceImages(chrome, images = []) {
  const validPaths = images
    .map(img => (typeof img === 'string' ? img : img?.imageLocalPath || ''))
    .filter(p => p && fs.existsSync(p))
    .slice(0, 6);

  if (!validPaths.length) return;

  // Xoá ảnh tham chiếu cũ nếu còn tồn đọng trên khung nhập
  await chrome.evaluate(`(() => {
    const uploader = document.querySelector('[data-testid="stacked-reference-uploader"], [data-slot="sender-uploader"]');
    if (!uploader) return;
    uploader.querySelectorAll('[aria-label*="remove" i], [aria-label*="delete" i], [data-slot*="remove" i], [class*="remove" i], [class*="delete" i]').forEach(el => {
      try { el.click(); } catch (_) {}
    });
  })()`).catch(() => {});
  await sleep(400);

  const { root } = await chrome.cmd('DOM.getDocument', { depth: -1 }, chrome.sessionId);
  const { nodeId } = await chrome.cmd('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '[data-testid="stacked-reference-uploader"] input[type="file"], [data-slot="sender-uploader"] input[type="file"], input[type="file"]'
  }, chrome.sessionId);

  if (nodeId) {
    await chrome.cmd('DOM.setFileInputFiles', {
      nodeId,
      files: validPaths
    }, chrome.sessionId);
    // Chờ ảnh tải lên hoàn tất
    await sleep(3000);
  }
}

/**
 * Tạo 1 clip trên giao diện Web BytePlus Seedance 2.5 Playground
 */
async function generateSeedanceClip(chrome, {
  prompt,
  images = [],
  ratio = '9:16',
  label = '',
  project = 'default',
  outputDir,
  update = () => {},
  isLive = () => true,
  timeoutMs = 360000
}) {
  await ensureSeedanceReady(chrome, { ratio });

  // Kiểm tra trạng thái đăng nhập trước khi gửi
  const isSignedOut = await chrome.evaluate(`(() => {
    const signInBtn = document.querySelector('[data-testid="topbar-sign-in"], [data-testid="sidebar-sign-in"], button[class*="signInPill"]');
    return Boolean(signInBtn);
  })()`).catch(() => false);

  if (isSignedOut) {
    throw new Error('Tài khoản Seedance chưa đăng nhập trên BytePlus Playground. Vui lòng bấm Đăng nhập ở tab Tài khoản.');
  }

  // Cài đặt bộ bắt URL video từ cả Fetch/XHR lẫn danh sách thẻ <video> hiện có
  const beforeVideos = await chrome.evaluate(`(() => {
    window.__sesameSeedanceCaptured = [];
    if (!window.__sesameSeedanceHooked) {
      window.__sesameSeedanceHooked = true;
      const scanText = (txt) => {
        if (!txt || typeof txt !== 'string') return;
        const matches = txt.match(/https?:\\/\\/[^"'\\s\\\\]+\\.mp4(?:\\?[^"'\\s\\\\]*)?/gi);
        if (matches && window.__sesameSeedanceCaptured) {
          for (const m of matches) {
            const clean = m.replace(/\\\\u0026/g, '&').replace(/\\\\/g, '');
            if (!window.__sesameSeedanceCaptured.includes(clean)) {
              window.__sesameSeedanceCaptured.push(clean);
            }
          }
        }
      };
      const origFetch = window.fetch;
      window.fetch = async function(...args) {
        const res = await origFetch.apply(this, args);
        try {
          const clone = res.clone();
          clone.text().then(scanText).catch(() => {});
        } catch (_) {}
        return res;
      };
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(...args) {
        this.addEventListener('load', function() {
          try { scanText(this.responseText); } catch (_) {}
        });
        return origOpen.apply(this, args);
      };
      XMLHttpRequest.prototype.send = origSend;
    }
    const vids = Array.from(document.querySelectorAll('video')).map(v => v.src || v.querySelector('source')?.src || '').filter(Boolean);
    return vids;
  })()`) || [];

  if (images && images.length > 0) {
    update({ step: 'Seedance 2.5: Đang tải ảnh tham chiếu...' });
    await uploadReferenceImages(chrome, images);
  }

  update({ step: 'Seedance 2.5: Đang nhập prompt...' });

  // Xoá nội dung cũ và focus vào .tiptap.ProseMirror
  await chrome.evaluate(`(() => {
    const el = document.querySelector('[data-slot="sender-prompt-input"] .ProseMirror, .tiptap.ProseMirror, div.ProseMirror');
    if (el) {
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
    }
  })()`);
  await sleep(200);

  const safePrompt = String(prompt || '').trim();
  try {
    await chrome.cmd('Input.insertText', { text: safePrompt }, chrome.sessionId);
  } catch (_) {
    for (const char of safePrompt) {
      await chrome.cmd('Input.dispatchKeyEvent', { type: 'keyDown', text: char }, chrome.sessionId);
      await chrome.cmd('Input.dispatchKeyEvent', { type: 'keyUp' }, chrome.sessionId);
    }
  }
  await sleep(1000);

  update({ step: 'Seedance 2.5: Bắt đầu gửi lệnh tạo video...' });

  const clicked = await chrome.evaluate(`(() => {
    const btn = document.querySelector('button[data-testid="video-sender-submit-button"]');
    if (btn && !btn.disabled && !btn.classList.contains('aml-arco-btn-disabled')) {
      btn.click();
      return true;
    }
    return false;
  })()`);

  if (!clicked) {
    throw new Error('Không thể bấm nút tạo video trên Seedance 2.5 (nút gửi đang bị khoá hoặc trang chưa sẵn sàng).');
  }

  // Kiểm tra hộp thoại xác nhận chi phí [data-testid="gen-video-cost-confirm-ok"] nếu xuất hiện
  await sleep(1200);
  await chrome.evaluate(`(() => {
    const neverAsk = document.querySelector('[data-testid="gen-video-cost-confirm-never-prompt"] input, [data-testid="gen-video-cost-confirm-never-prompt"]');
    if (neverAsk) { try { neverAsk.click(); } catch (_) {} }
    const okBtn = document.querySelector('[data-testid="gen-video-cost-confirm-ok"]');
    if (okBtn) { try { okBtn.click(); } catch (_) {} }
  })()`).catch(() => {});

  update({ step: 'Seedance 2.5: Đang render video...' });

  const startAt = Date.now();
  let videoUrl = '';

  while (Date.now() - startAt < timeoutMs) {
    if (!isLive()) return null;
    await sleep(4000);

    // Tự động bấm xác nhận nếu modal chi phí hiện trễ
    const statusCheck = await chrome.evaluate(`((beforeList) => {
      const okBtn = document.querySelector('[data-testid="gen-video-cost-confirm-ok"]');
      if (okBtn) { try { okBtn.click(); } catch (_) {} }

      // 1. Kiểm tra URL bắt được từ mạng (Fetch/XHR)
      const captured = (window.__sesameSeedanceCaptured || []).filter(u => !beforeList.includes(u));
      if (captured.length > 0) {
        return { ready: true, url: captured[captured.length - 1], source: 'network' };
      }

      // 2. Kiểm tra thẻ <video> mới xuất hiện trong DOM
      const domVids = Array.from(document.querySelectorAll('video'))
        .map(v => v.src || v.querySelector('source')?.src || '')
        .filter(u => u && !beforeList.includes(u));
      if (domVids.length > 0) {
        return { ready: true, url: domVids[0], source: 'dom' };
      }

      // 3. Kiểm tra thông báo lỗi nếu có
      const errToast = document.querySelector('.aml-arco-message-error, .aml-arco-notification-error');
      if (errToast && errToast.innerText.trim()) {
        return { ready: false, error: errToast.innerText.trim() };
      }

      return { ready: false };
    })(${JSON.stringify(beforeVideos)})`).catch(() => ({ ready: false }));

    if (statusCheck?.error) {
      throw new Error(`Seedance 2.5 báo lỗi: ${statusCheck.error}`);
    }
    if (statusCheck?.ready && statusCheck.url) {
      videoUrl = statusCheck.url;
      break;
    }
  }

  if (!videoUrl) {
    throw new Error(`Quá thời gian chờ (${Math.round(timeoutMs / 60000)} phút) Seedance 2.5 render video.`);
  }

  update({ step: 'Seedance 2.5: Đang tải video về máy...' });

  const { timeTag, sceneTag, cleanPrj } = extractTags(label || prompt, project);
  const prefix = [cleanPrj || (project !== 'default' ? project : ''), sceneTag, timeTag].filter(Boolean).join('_');
  const finalFilename = prefix
    ? `${prefix}_Seedance_${Date.now()}.mp4`
    : `Seedance_${Date.now()}.mp4`;
  const finalPath = path.join(outputDir, finalFilename);

  if (videoUrl.startsWith('http')) {
    try {
      await downloadUrlToFile(videoUrl, finalPath);
    } catch (dlErr) {
      // Fallback: tải qua fetch bên trong trình duyệt (kèm cookie phiên)
      const b64 = await chrome.evaluate(`(async (u) => {
        const r = await fetch(u, { credentials: 'include' });
        const buf = new Uint8Array(await r.arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 32768) {
          s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
        }
        return btoa(s);
      })(${JSON.stringify(videoUrl)})`, 120000);
      fs.writeFileSync(finalPath, Buffer.from(b64, 'base64'));
    }
  } else if (videoUrl.startsWith('blob:')) {
    const b64 = await chrome.evaluate(`(async (u) => {
      const r = await fetch(u);
      const buf = new Uint8Array(await r.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 32768) {
        s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
      }
      return btoa(s);
    })(${JSON.stringify(videoUrl)})`, 120000);
    fs.writeFileSync(finalPath, Buffer.from(b64, 'base64'));
  }

  update({ step: 'Hoàn thành tải clip Seedance 2.5' });
  return finalPath;
}

/**
 * Chế độ API Key (BytePlus ModelArk Content Generation API)
 */
async function generateSeedanceViaApi(apiKey, {
  prompt,
  images = [],
  ratio = '9:16',
  label = '',
  project = 'default',
  outputDir,
  update = () => {},
  isLive = () => true,
  timeoutMs = 360000
}) {
  const safePrompt = String(prompt || '').trim();
  const content = [{ type: 'text', text: `${safePrompt} --ratio ${ratio || '9:16'}` }];

  for (const img of images.slice(0, 2)) {
    const p = typeof img === 'string' ? img : img?.imageLocalPath;
    if (p && fs.existsSync(p)) {
      const ext = path.extname(p).toLowerCase() === '.png' ? 'png' : 'jpeg';
      const b64 = fs.readFileSync(p).toString('base64');
      content.push({
        type: 'image_url',
        image_url: { url: `data:image/${ext};base64,${b64}` }
      });
    }
  }

  update({ step: 'Seedance API: Đang khởi tạo tác vụ...' });

  const postJson = (url, body) => new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(raw);
          if (res.statusCode >= 400) reject(new Error(j.error?.message || `HTTP ${res.statusCode}`));
          else resolve(j);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });

  const getJson = (url) => new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'Authorization': `Bearer ${apiKey.trim()}` }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(raw);
          if (res.statusCode >= 400) reject(new Error(j.error?.message || `HTTP ${res.statusCode}`));
          else resolve(j);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
  });

  const baseUrl = 'https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks';
  const createRes = await postJson(baseUrl, {
    model: 'dreamina-seedance-2-5-260628',
    content
  });

  const remoteId = createRes.id;
  if (!remoteId) throw new Error('Seedance API không trả về ID tác vụ.');

  update({ step: 'Seedance API: Đang render video...' });
  const startAt = Date.now();
  let videoUrl = '';

  while (Date.now() - startAt < timeoutMs) {
    if (!isLive()) return null;
    await sleep(4000);
    const statusRes = await getJson(`${baseUrl}/${remoteId}`);
    if (statusRes.status === 'succeeded') {
      videoUrl = statusRes.content?.video_url || '';
      break;
    }
    if (statusRes.status === 'failed' || statusRes.status === 'cancelled') {
      throw new Error(`Seedance API thất bại: ${statusRes.error?.message || statusRes.status}`);
    }
  }

  if (!videoUrl) {
    throw new Error('Quá thời gian chờ Seedance API render video.');
  }

  update({ step: 'Seedance API: Đang tải video về máy...' });
  const { timeTag, sceneTag, cleanPrj } = extractTags(label || prompt, project);
  const prefix = [cleanPrj || (project !== 'default' ? project : ''), sceneTag, timeTag].filter(Boolean).join('_');
  const finalFilename = prefix
    ? `${prefix}_Seedance_${Date.now()}.mp4`
    : `Seedance_${Date.now()}.mp4`;
  const finalPath = path.join(outputDir, finalFilename);

  await downloadUrlToFile(videoUrl, finalPath);
  update({ step: 'Hoàn thành tải clip Seedance 2.5' });
  return finalPath;
}

/**
 * Runner tích hợp với TaskStore / MultiEngine
 * Hỗ trợ đầy đủ:
 *  - Đơn cảnh (Studio / từng cảnh 10s)
 *  - Đa cảnh gộp 1 lệnh (Kịch bản / LadiPage 16s, 20s, 24s, 30s, 40s, 50s, 60s, Storyboard) -> tự tách cảnh, render từng cảnh trên Seedance 2.5 và ghép nối mượt bằng ffmpeg.
 *  - Ảnh tham chiếu từ cả file máy tính lẫn URL LadiPage/API.
 */
async function runTask(task, context) {
  const page = context.page;
  const acc = typeof page?.getAccount === 'function' ? page.getAccount() : context.account;
  const apiKey = acc?.apiKey || process.env.SEEDANCE_API_KEY;
  const timeoutMs = (task.timeoutMin || context.limits?.video || 10) * 60000;
  const update = context.update || (() => {});
  const isLive = context.isLive || (() => true);

  // Chuyển mọi ảnh tham chiếu (bao gồm cả ảnh URL từ LadiPage / API) thành file local
  const os = require('os');
  const tempRefDir = path.join(os.tmpdir(), 'sesame_seedance_refs');
  const localImages = await materializeTaskImages(task.images || [], context.loadImage, tempRefDir);

  // Tách kịch bản nhiều cảnh (nếu có) để Seedance 2.5 render đủ từng cảnh rồi ghép lại
  const scenes = splitMultiScenePrompt(task.prompt, localImages);
  const sceneFiles = [];
  let prevEndFramePath = null;

  for (let i = 0; i < scenes.length; i++) {
    if (!isLive()) return null;
    const rawSc = scenes[i];
    const sc = (i > 0 && task.continuity !== false && prevEndFramePath)
      ? applySceneContinuity(rawSc, prevEndFramePath)
      : rawSc;

    const partPrefix = scenes.length > 1 ? `[Cảnh ${sc.sceneNum}/${sc.totalScenes}] ` : '';
    const sceneLabel = scenes.length > 1
      ? `${task.label || ''} Cảnh ${sc.sceneNum} ${sc.timeRange || ''}`.trim()
      : (task.label || '');
    const sceneUpdate = patch => {
      if (patch && patch.step && partPrefix) {
        update({ ...patch, step: `${partPrefix}${patch.step}` });
      } else {
        update(patch);
      }
    };

    let saved = null;
    if (apiKey && apiKey.trim()) {
      saved = await generateSeedanceViaApi(apiKey, {
        prompt: sc.prompt,
        images: sc.images,
        ratio: task.ratio || '9:16',
        label: sceneLabel,
        project: task.project || 'default',
        outputDir: context.outputDir,
        update: sceneUpdate,
        isLive,
        timeoutMs
      });
    } else {
      await page.ready();
      saved = await generateSeedanceClip(page.chrome, {
        prompt: sc.prompt,
        images: sc.images,
        ratio: task.ratio || '9:16',
        label: sceneLabel,
        project: task.project || 'default',
        outputDir: context.outputDir,
        update: sceneUpdate,
        isLive,
        timeoutMs
      });
    }

    if (!saved) return null;
    sceneFiles.push(saved);

    if (scenes.length > 1 && i < scenes.length - 1 && task.continuity !== false) {
      sceneUpdate({ step: 'Đang trích xuất khung hình cuối để khóa nối cảnh tiếp theo...' });
      prevEndFramePath = await extractVideoEndFrame(saved, tempRefDir);
    }
  }

  // Nếu kịch bản có nhiều cảnh gộp 1 lệnh -> tự động ghép thành 1 video hoàn chỉnh như Muse
  if (sceneFiles.length > 1) {
    update({ step: `Seedance 2.5: Đang ghép ${sceneFiles.length} cảnh liền mạch thành 1 video...` });
    const { cleanPrj } = extractTags(task.label || task.prompt, task.project || 'default');
    const mergedName = [cleanPrj, 'Seedance_Merged', Date.now()].filter(Boolean).join('_') + '.mp4';
    const mergedPath = path.join(context.outputDir, mergedName);
    const res = await merger.mergeVideos(sceneFiles, mergedPath, { normalize: true });
    if (res?.success && res.path) {
      return [res.path];
    }
  }

  return sceneFiles;
}

module.exports = {
  SEEDANCE_URL,
  ensureSeedanceReady,
  generateSeedanceClip,
  generateSeedanceViaApi,
  runTask
};

