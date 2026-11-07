/**
 * DOLA RUNNER — Tự động hóa tạo video trên Dola AI (dola.com / Dreamina Seedance 2.0 Fast / ByteDance)
 *
 * Chạy qua Chrome thật điều khiển bằng CDP (profile riêng từng tài khoản).
 * Quy trình:
 *  1. Mở dola.com/chat/create-image, kiểm tra đăng nhập.
 *  2. Chọn tab Video (Model Dreamina Seedance 2.0 Fast).
 *  3. Chọn tỷ lệ khung hình (mặc định 9:16 dọc điện ảnh, hoặc 16:9, 1:1...).
 *  4. Upload ảnh tham chiếu (1-3 ảnh) qua CDP DOM.setFileInputFiles.
 *  5. Nhập prompt vào vùng soạn thảo [contenteditable="true"] bằng Input.insertText.
 *  6. Bấm gửi (submit) và theo dõi tiến trình tạo video.
 *  7. Khi video hoàn thành ("Your video is ready"), mở khung chi tiết, lấy URL MP4 đã ký sẵn từ v16-dola.dola.com.
 *  8. Tải file MP4 về máy ngay lập tức (Referer: https://www.dola.com/).
 *  9. Kiểm tra codec: nếu là HEVC (H.265) thì tự động chuyển mã sang H.264 qua ffmpeg để tương thích trình phát và ghép nối.
 *
 * QUY TẮC AN TOÀN:
 *  - Tuyệt đối KHÔNG tự động fallback sang Muse hay trừ quota nền tảng khác nếu task chỉ định engine='dola'.
 *  - Không dùng máy chủ ngoài để lấy selector, chỉ dùng selector chuẩn dò trực tiếp trên DOM.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { execSync, execFile } = require('child_process');
const { extractTags } = require('./muse-runner');
const {
  materializeTaskImages,
  splitMultiScenePrompt,
  extractVideoEndFrame,
  applySceneContinuity
} = require('./scene-helper');
const merger = require('./merge');
const { h264Args } = require('./h264');

const sleep = ms => new Promise(r => setTimeout(r, ms));

const DOLA_URL = 'https://www.dola.com/chat/create-image';
const DOLA_BASE = 'https://www.dola.com';

/**
 * Tải file trực tiếp từ URL đã ký với Header bảo mật
 */
function downloadUrlToFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Referer': 'https://www.dola.com/'
      },
      timeout: 120000
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const nextUrl = new URL(res.headers.location, url).href;
        return downloadUrlToFile(nextUrl, destPath).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Tải file từ Dola trả về HTTP ${res.statusCode}`));
      }
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(destPath)));
      file.on('error', err => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Hết thời gian chờ tải video từ Dola')));
    req.on('error', reject);
  });
}

/**
 * Kiểm tra codec video và chuyển đổi HEVC sang H.264 nếu cần
 */
async function ensureH264Compatible(videoPath, outPath) {
  const ffmpeg = merger.resolveBin('ffmpeg');
  const ffprobe = merger.resolveBin('ffprobe');

  // Kiểm tra codec hiện tại
  let isHevc = false;
  try {
    const probeOut = execSync(`"${ffprobe}" -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`, { encoding: 'utf8' }).trim();
    if (probeOut.toLowerCase().includes('hevc') || probeOut.toLowerCase().includes('h265')) {
      isHevc = true;
    }
  } catch (_) {}

  if (!isHevc) {
    if (videoPath !== outPath) {
      fs.copyFileSync(videoPath, outPath);
    }
    return outPath;
  }

  // Chuyển mã sang H.264 chuẩn
  const args = [
    '-y', '-i', videoPath,
    ...h264Args(ffmpeg, { crf: 20, preset: 'fast' }),
    '-pix_fmt', 'yuv420p',
    '-c:a', 'copy',
    outPath
  ];

  await new Promise((resolve, reject) => {
    execFile(ffmpeg, args, (err) => {
      if (err) return reject(new Error(`Lỗi chuyển mã H.264: ${err.message}`));
      resolve(outPath);
    });
  });

  return outPath;
}

/**
 * Đảm bảo tab tạo video của Dola sẵn sàng
 */
async function ensureDolaReady(chrome, { ratio = '9:16' } = {}) {
  if (!chrome.running) {
    await chrome.start();
  }

  let currentUrl = await chrome.evaluate('location.href').catch(() => '');
  if (!currentUrl.includes('dola.com')) {
    await chrome.cmd('Page.navigate', { url: DOLA_URL }, chrome.sessionId);
    await sleep(6000);
    currentUrl = await chrome.evaluate('location.href').catch(() => '');
  }

  // Chờ trang Dola nạp xong khung nhập hoặc nút đăng nhập (tối đa 15s)
  for (let i = 0; i < 15; i++) {
    const readyDom = await chrome.evaluate(`Boolean(document.querySelector('[contenteditable="true"], textarea, button[aria-label*="Sign in" i], a[href*="login"]'))`).catch(() => false);
    if (readyDom) break;
    await sleep(1000);
  }

  // Kiểm tra đăng nhập
  const isSignedOut = await chrome.evaluate(`(() => {
    const href = location.href.toLowerCase();
    if (href.includes('login') || href.includes('signin')) return true;
    const hasSignInBtn = Boolean(document.querySelector('button[aria-label*="Sign in" i], [class*="signIn" i], a[href*="login"]'));
    return hasSignInBtn;
  })()`).catch(() => false);

  if (isSignedOut) {
    throw new Error('Tài khoản Dola chưa đăng nhập trên dola.com. Vui lòng bấm Đăng nhập ở tab Tài khoản.');
  }

  // Nếu đang ở chat thường (không phải create-image), bấm link AI Creation hoặc điều hướng
  if (!currentUrl.includes('create-image')) {
    await chrome.evaluate(`(() => {
      const link = document.querySelector('a[href*="create-image"], button[aria-label*="AI Creation" i]');
      if (link) link.click();
    })()`).catch(() => {});
    await sleep(2000);
    currentUrl = await chrome.evaluate('location.href').catch(() => '');
    if (!currentUrl.includes('create-image')) {
      await chrome.cmd('Page.navigate', { url: DOLA_URL }, chrome.sessionId);
      await sleep(4000);
    }
  }

  // Đảm bảo tab Video được chọn — Radix Tabs chỉ nhận chuột thật (pointerdown), .click() của JS không đổi tab.
  // Không bật được Video thì DỪNG, tuyệt đối không gửi lệnh ở tab Image (sẽ ra ảnh Seedream thay vì video).
  let videoOk = false;
  for (let k = 0; k < 6 && !videoOk; k++) {
    const st = await chrome.evaluate(`(() => {
      const b = document.querySelector('[data-testid="creation-skill-switch-tab-video"]')
        || Array.from(document.querySelectorAll('button[role="tab"]')).find(x => x.textContent.trim() === 'Video');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      const model = Array.from(document.querySelectorAll('button')).map(x => x.innerText || '').find(t => /^Model/i.test(t.trim())) || '';
      return { active: b.getAttribute('data-state') === 'active', x: r.x + r.width / 2, y: r.y + r.height / 2, model };
    })()`).catch(() => null);
    if (st && st.active && /seedance/i.test(st.model)) { videoOk = true; break; }
    if (st) await clickAt(chrome, st.x, st.y);
    await sleep(1200);
  }
  if (!videoOk) throw new Error('Không bật được chế độ Video (Seedance 2.0) trên Dola — dừng để tránh tạo nhầm ảnh.');

  // Tỷ lệ khung hình: nút có dạng "Auto · 10s" / "9:16 · 10s"
  if (ratio) {
    const rb = await chrome.evaluate(`((want) => {
      const b = Array.from(document.querySelectorAll('button')).find(x => /^(Auto|\\d+:\\d+)\\s*·/i.test((x.innerText || '').trim()));
      if (!b) return null;
      if ((b.innerText || '').includes(want)) return { done: true };
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })(${JSON.stringify(ratio)})`).catch(() => null);
    if (rb && !rb.done) {
      await clickAt(chrome, rb.x, rb.y);
      await sleep(800);
      const it = await chrome.evaluate(`((want) => {
        const els = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], [role="radio"], [data-radix-popper-content-wrapper] button, [data-radix-popper-content-wrapper] div'));
        const m = els.find(e => (e.innerText || '').trim() === want) || els.find(e => (e.innerText || '').trim().startsWith(want));
        if (!m) return null;
        const r = m.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })(${JSON.stringify(ratio)})`).catch(() => null);
      if (it) await clickAt(chrome, it.x, it.y);
      await sleep(500);
      await chrome.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, chrome.sessionId).catch(() => {});
      await chrome.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, chrome.sessionId).catch(() => {});
      await sleep(400);
    }
  }
}

async function clickAt(chrome, x, y) {
  await chrome.cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, chrome.sessionId).catch(() => {});
  await chrome.cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, chrome.sessionId);
  await chrome.cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, chrome.sessionId);
}

/**
 * Tải lên ảnh tham chiếu cho Dola
 */
async function uploadDolaReferenceImages(chrome, imagePaths = []) {
  const validPaths = imagePaths
    .map(img => (typeof img === 'string' ? img : img?.imageLocalPath || ''))
    .filter(p => p && fs.existsSync(p))
    .slice(0, 3); // Dola hỗ trợ tối ưu 1-3 ảnh tham chiếu

  if (!validPaths.length) return;

  // Xoá ảnh tham chiếu cũ nếu còn trên khung nhập
  await chrome.evaluate(`(() => {
    const removeBtns = document.querySelectorAll('button[aria-label*="remove" i], button[aria-label*="delete" i], [class*="remove-image" i]');
    removeBtns.forEach(b => { try { b.click(); } catch (_) {} });
  })()`).catch(() => {});
  await sleep(400);

  const { root } = await chrome.cmd('DOM.getDocument', { depth: -1 }, chrome.sessionId);
  const { nodeId } = await chrome.cmd('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: 'input[type="file"][accept*="jpg"], input[type="file"][accept*="png"], input[type="file"]'
  }, chrome.sessionId);

  if (nodeId) {
    await chrome.cmd('DOM.setFileInputFiles', {
      nodeId,
      files: validPaths
    }, chrome.sessionId);
    await sleep(3000); // Chờ ảnh upload lên Dola
  }
}

/**
 * Tạo 1 clip trên Dola AI (Seedance 2.0 Fast)
 */
async function generateDolaClip(chrome, {
  prompt,
  images = [],
  ratio = '9:16',
  label = '',
  project = 'default',
  outputDir,
  update = () => {},
  isLive = () => true,
  timeoutMs = 600000
}) {
  await ensureDolaReady(chrome, { ratio });

  if (images && images.length) {
    update({ step: 'Dola AI: Đang tải ảnh tham chiếu...' });
    await uploadDolaReferenceImages(chrome, images);
  }

  update({ step: 'Dola AI: Đang nhập prompt...' });
  const beforeUrls = await chrome.evaluate(`(() => {
    const urls = [];
    document.querySelectorAll('video').forEach(v => { const s = v.currentSrc || v.src || ''; if (s) urls.push(s); });
    document.querySelectorAll('a[download*=".mp4"], a[href*=".mp4"], a[href*="v16-dola.dola.com"]').forEach(a => { if (a.href) urls.push(a.href); });
    return urls;
  })()`).catch(() => []);

  const editorFound = await chrome.evaluate(`(() => {
    const editor = document.querySelector('[contenteditable="true"], textarea');
    if (editor) {
      editor.focus();
      return true;
    }
    return false;
  })()`).catch(() => false);

  if (!editorFound) {
    throw new Error('Không tìm thấy khung nhập prompt trên Dola.com');
  }

  await chrome.cmd('Input.insertText', { text: prompt }, chrome.sessionId);
  await sleep(600);

  update({ step: 'Dola AI: Đang gửi lệnh tạo video...' });
  // Bấm nút gửi
  const submitted = await chrome.evaluate(`(() => {
    const editor = document.querySelector('[contenteditable="true"]');
    const container = editor ? (editor.closest('div[class*="input"], form, div[class*="chat-input"]') || editor.parentElement) : document;
    const sendBtn = (container && container.querySelector('button[class*="send" i], button[class*="submit" i], button[aria-label*="Send" i], button[aria-label*="Submit" i], button[aria-label*="Generate" i], button[class*="generate" i]'))
      || document.querySelector('button[class*="send" i], button[class*="submit" i], button[aria-label*="Send" i], button[aria-label*="Generate" i]')
      || (container && container.querySelector('button:has(svg)'));
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
      return true;
    }
    return false;
  })()`).catch(() => false);

  if (!submitted) {
    // Thử gửi bằng Enter
    await chrome.cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter' }, chrome.sessionId).catch(() => {});
    await chrome.cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter' }, chrome.sessionId).catch(() => {});
  }

  update({ step: 'Dola AI: Đang render video (Seedance 2.0 Fast)...' });
  const startAt = Date.now();
  let mediaUrl = null;

  while (Date.now() - startAt < timeoutMs) {
    if (!isLive()) return null;
    await sleep(4000);

    // Kiểm tra xem video mới đã sẵn sàng chưa bằng cách tìm block video hoặc thông báo
    const checkState = await chrome.evaluate(`((oldUrls) => {
      const oldSet = new Set(Array.isArray(oldUrls) ? oldUrls : []);
      // Dola trả lời từ chối (vi phạm chính sách / hết lượt / lỗi) → báo lỗi ngay, không chờ hết giờ
      const mainText = ((document.querySelector('main') || document.body).innerText || '');
      const tail = mainText.slice(-700);
      const errM = tail.match(/can.t generate[^.\\n]*|cannot generate[^.\\n]*|violate[^.\\n]*polic[^.\\n]*|run out of[^.\\n]*|used up[^.\\n]*|no (?:more )?credits[^.\\n]*|insufficient[^.\\n]*|something went wrong[^.\\n]*|failed to generate[^.\\n]*|can.t show you the generated[^.\\n]*|for copyright protection[^.\\n]*/i);
      if (errM) return { ready: false, error: errM[0] };
      const videos = Array.from(document.querySelectorAll('video')).reverse();
      for (const v of videos) {
        const src = v.currentSrc || v.src || '';
        if (src && !oldSet.has(src) && (src.includes('v16-dola.dola.com') || src.includes('.mp4') || src.includes('byteimg') || src.includes('ibytedtos'))) {
          return { ready: true, url: src };
        }
      }

      const dlLinks = Array.from(document.querySelectorAll('a[download*=".mp4"], a[href*=".mp4"], a[href*="v16-dola.dola.com"]')).reverse();
      for (const dlLink of dlLinks) {
        if (dlLink.href && !oldSet.has(dlLink.href)) {
          return { ready: true, url: dlLink.href };
        }
      }

      const blocks = Array.from(document.querySelectorAll('[class*="block-video"], [class*="video-player"], [class*="video-card"], [class*="generation-item"]'));
      if (blocks.length) {
        const lastBlock = blocks[blocks.length - 1];
        try { lastBlock.click(); } catch (_) {}
      }

      return { ready: false, step: 'rendering' };
    })(${JSON.stringify(beforeUrls)})`).catch(() => ({ ready: false }));

    if (checkState.error) {
      const policy = /violate|polic/i.test(checkState.error);
      if (/daily|usage limit/i.test(checkState.error)) {
        throw new Error(`Dola đã hết lượt tạo video miễn phí trong ngày ("${checkState.error}"). Hãy thử lại vào ngày mai hoặc nâng cấp Dola Plus.`);
      }
      if (/copyright|show you the generated/i.test(checkState.error)) {
        throw new Error(`Dola đã tạo video nhưng chặn không cho xem vì âm thanh (bản quyền): "${checkState.error}". Thêm "không nhạc nền, chỉ tiếng môi trường" vào prompt rồi chạy lại.`);
      }
      throw new Error(`Dola từ chối tạo video: "${checkState.error}".${policy ? ' Prompt bị bộ lọc nội dung của Dola chặn — hãy viết lại mô tả trung tính hơn (tránh từ nhạy cảm về quốc tịch/người thật/thương hiệu) rồi chạy lại.' : ''}`);
    }
    if (checkState.ready && checkState.url) {
      mediaUrl = checkState.url;
      break;
    }

    const elapsedMin = Math.round((Date.now() - startAt) / 60000);
    update({ step: `Dola AI: Đang render video (${elapsedMin} phút)...` });
  }

  if (!mediaUrl) {
    throw new Error(`Quá thời gian chờ (${Math.round(timeoutMs / 60000)} phút) Dola AI render video.`);
  }

  update({ step: 'Dola AI: Đang tải video về máy...' });
  const tempFile = path.join(os.tmpdir(), `dola_raw_${Date.now()}.mp4`);
  await downloadUrlToFile(mediaUrl, tempFile);

  const { timeTag, sceneTag, cleanPrj } = extractTags(label || prompt, project);
  const prefix = [cleanPrj || (project !== 'default' ? project : ''), sceneTag, timeTag].filter(Boolean).join('_');
  const finalFilename = prefix 
    ? `${prefix}_Dola_${Date.now()}.mp4`
    : `Dola_${Date.now()}.mp4`;

  const finalPath = path.join(outputDir, finalFilename);

  update({ step: 'Dola AI: Đang chuẩn hóa định dạng H.264...' });
  await ensureH264Compatible(tempFile, finalPath);

  try { fs.unlinkSync(tempFile); } catch (_) {}

  update({ step: 'Hoàn thành tải clip Dola AI' });
  return finalPath;
}

/**
 * Runner tích hợp với Task Store cho Dola
 */
async function runTask(task, context) {
  const page = context.page;
  const chrome = page.chrome;
  const provider = page.provider || 'dola';

  if (provider !== 'dola') {
    throw new Error(`[DolaRunner] Tài khoản được gán có provider='${provider}', không phải 'dola'. Không được fallback sang Muse.`);
  }

  const update = context.update || (() => {});
  const isLive = context.isLive || (() => true);
  const timeoutMs = (task.timeoutMin || context.limits?.video || 10) * 60000;

  await ensureDolaReady(chrome, { ratio: task.ratio || '9:16' });

  const tempRefDir = path.join(os.tmpdir(), 'sesame_dola_refs');
  const localImages = await materializeTaskImages(task.images || [], context.loadImage, tempRefDir);

  const scenes = task.kind === 'image'
    ? [{ sceneNum: 1, totalScenes: 1, timeRange: '', prompt: task.prompt, images: localImages }]
    : splitMultiScenePrompt(task.prompt, localImages);

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

    const saved = await generateDolaClip(chrome, {
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

    if (!saved) return null;
    sceneFiles.push(saved);

    if (scenes.length > 1 && i < scenes.length - 1 && task.kind !== 'image' && task.continuity !== false) {
      sceneUpdate({ step: 'Đang trích xuất khung hình cuối để khóa nối cảnh tiếp theo...' });
      prevEndFramePath = await extractVideoEndFrame(saved, tempRefDir);
    }
  }

  if (sceneFiles.length > 1 && task.kind !== 'image') {
    update({ step: `Dola AI: Đang ghép ${sceneFiles.length} cảnh liền mạch thành 1 video...` });
    const { cleanPrj } = extractTags(task.label || task.prompt, task.project || 'default');
    const mergedName = [cleanPrj, 'Dola_Merged', Date.now()].filter(Boolean).join('_') + '.mp4';
    const mergedPath = path.join(context.outputDir, mergedName);
    const res = await merger.mergeVideos(sceneFiles, mergedPath, { normalize: true });
    if (res?.success && res.path) {
      return [res.path];
    }
  }

  return sceneFiles;
}

module.exports = {
  DOLA_URL,
  ensureDolaReady,
  generateDolaClip,
  runTask
};
