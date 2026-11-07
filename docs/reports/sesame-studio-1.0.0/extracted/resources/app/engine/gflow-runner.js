/**
 * GOOGLE FLOW RUNNER — Tự động hóa tạo video/ảnh trên Google Flow (flow.google / Veo 3.1 / Omni Flash).
 * Nâng cấp Động cơ Lõi v2 (tích hợp công nghệ từ FrameWeaver & 26Flow):
 *  1. Ưu tiên gọi trực tiếp API nội bộ `/_/AiSandboxAngularFrontend/data/batchexecute` ngay trong phiên CDP
 *     kèm tự động ký mã `reCAPTCHA Enterprise` (6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV) và `WIZ_global_data`.
 *     - Hỗ trợ: Text-to-Video (YhhmEf), First-Frame I2V (eb1hJf), First+Last Frame (nprQif),
 *       Ingredients / Giữ đồng nhất nhân vật (MZZa6b), Tạo ảnh Nano Banana Pro (ogiZ0b), Upload ảnh tham chiếu (maseQ).
 *     - Tải thẳng file MP4 gốc từ `flow-content.google/video/...` qua RPC polling (jwpduf + Zzl0ze + as29s),
 *       không cần bấm nút Download ZIP hay sợ lỗi cuộn trang Virtual Scroll.
 *  2. Hỗ trợ Khóa nối cảnh liên tục (End-Frame Continuity Lock): tự cắt frame cuối Cảnh N làm frame đầu Cảnh N+1.
 *  3. Tự động Fallback về cơ chế DOM ProseMirror + Download ZIP nếu Google thay đổi mã RPC.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { extractTags } = require('./muse-runner');
const {
  materializeTaskImages,
  splitMultiScenePrompt,
  extractVideoEndFrame,
  applySceneContinuity
} = require('./scene-helper');
const merger = require('./merge');

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Nhật ký chẩn đoán Google Flow (để biết vì sao không nhận clip): %TEMP%\sesame-gflow-debug.log
const dbg = m => { try { fs.appendFileSync(path.join(os.tmpdir(), 'sesame-gflow-debug.log'), new Date().toLocaleTimeString() + ' ' + String(m).slice(0, 600) + '\n'); } catch (_) {} };

const RPC = {
  GEN_IMAGE: 'ogiZ0b',
  GEN_VIDEO: 'eb1hJf',
  GEN_VIDEO_TEXT: 'YhhmEf',
  GEN_VIDEO_FIRST_LAST: 'nprQif',
  GEN_VIDEO_REFERENCES: 'MZZa6b',
  OPERATION: 'jwpduf',
  PROJECT_MEDIA: 'Zzl0ze',
  MEDIA: 'as29s',
  UPLOAD_IMAGE: 'maseQ'
};

const CAPTCHA_SLOT = '__CAPTCHA__';
const FULL_FRAME_CROP = [null, 0.0038759689922481244, 1, 0.9961240310077519];
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function clientUuid() {
  return crypto.randomUUID().toUpperCase();
}

function buildContext(projectId) {
  return [null, 22, null, null, null, projectId, null, null, null, null, [CAPTCHA_SLOT, 1]];
}

function buildEnvelope(rpcid, inner) {
  return JSON.stringify([[[rpcid, JSON.stringify(inner), null, 'generic']]]);
}

function resolveVideoAspectCode(ratio = '9:16') {
  const isPortrait = ratio === '9:16' || ratio === '3:4';
  return isPortrait ? 1 : 2;
}

function resolveImageAspectCode(ratio = '9:16') {
  if (ratio === '1:1') return 1;
  if (ratio === '9:16') return 2;
  if (ratio === '16:9') return 3;
  if (ratio === '3:4') return 4;
  if (ratio === '4:3') return 5;
  return 2;
}

function resolveOmniDuration(timeRange = '', prompt = '') {
  const str = `${timeRange} ${prompt}`;
  const m = str.match(/(\d+)\s*[-–—]\s*(\d+)\s*s?/i);
  if (m) {
    const diff = Math.abs(parseInt(m[2], 10) - parseInt(m[1], 10));
    if ([4, 6, 8, 10].includes(diff)) return diff;
  }
  const mSec = str.match(/\b(4|6|8|10)\s*(?:s|sec|giây)\b/i);
  if (mSec) return parseInt(mSec[1], 10);
  return 8;
}

/**
 * Giải mã phản hồi batchexecute (`)]}'\n...` kèm các gói `["wrb.fr", rpcid, payload]`)
 */
function parseBatchEnvelope(text) {
  if (!text || typeof text !== 'string') return [];
  const body = text.startsWith(")]}'") ? text.slice(text.indexOf('\n') + 1) : text;
  const results = [];
  const lines = body.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('[')) continue;
    try {
      const chunk = JSON.parse(trimmed);
      if (!Array.isArray(chunk)) continue;
      for (const entry of chunk) {
        if (!Array.isArray(entry) || entry[0] !== 'wrb.fr') continue;
        const rpcid = entry[1] || '?';
        const payloadRaw = entry[2];
        if (payloadRaw == null) {
          results.push({ rpcid, ok: false, data: null, error: entry[5] || true });
        } else {
          const parsed = typeof payloadRaw === 'string' ? JSON.parse(payloadRaw) : payloadRaw;
          results.push({ rpcid, ok: true, data: parsed, error: null });
        }
      }
    } catch (_) {}
  }
  return results;
}

function walkStrings(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) {
    for (const item of node) walkStrings(item, out);
  }
  return out;
}

function downloadUrlToFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      },
      timeout: 90000
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const nextUrl = new URL(res.headers.location, url).href;
        return downloadUrlToFile(nextUrl, destPath).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(destPath)));
      file.on('error', err => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Timeout downloading Flow media')));
    req.on('error', reject);
  });
}

/**
 * Cài đặt cầu nối `window.__sesameFlowRpc` bên trong MAIN world của tab Google Flow
 * để tự động lấy mã reCAPTCHA Enterprise và gọi `/_/AiSandboxAngularFrontend/data/batchexecute`
 */
async function ensureFlowRpcBridge(chrome) {
  return chrome.evaluate(`(() => {
    if (window.__sesameFlowRpc) return true;
    const SITE_KEY = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
    let captchaTail = Promise.resolve();
    let widgetPromise = null;

    function resolveSitekey() {
      try {
        const clients = (window.___grecaptcha_cfg || {}).clients || {};
        for (const k of Object.keys(clients)) {
          if (clients[k] && clients[k].sitekey) return clients[k].sitekey;
        }
      } catch (_) {}
      return SITE_KEY;
    }

    function waitForGrecaptcha(timeout = 20000) {
      return new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
          if (window.grecaptcha?.enterprise?.execute) return resolve();
          if (Date.now() - start > timeout) return reject(new Error('GRECAPTCHA_UNAVAILABLE'));
          setTimeout(tick, 200);
        };
        tick();
      });
    }

    function waitReady(timeout = 4000) {
      return new Promise(resolve => {
        let done = false;
        const fin = () => { if (!done) { done = true; resolve(); } };
        try { window.grecaptcha?.enterprise?.ready?.(fin); } catch (_) {}
        setTimeout(fin, timeout);
      });
    }

    function ensureWidget(sitekey) {
      if (widgetPromise) return widgetPromise;
      widgetPromise = (async () => {
        await waitReady(4000);
        let host = document.getElementById('sesame-flow-recaptcha-host');
        if (!host) {
          host = document.createElement('div');
          host.id = 'sesame-flow-recaptcha-host';
          host.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;';
          document.documentElement.appendChild(host);
        }
        return await new Promise((resolve, reject) => {
          try {
            const wid = window.grecaptcha.enterprise.render(host, {
              sitekey,
              size: 'invisible',
              callback: () => {},
              'error-callback': m => reject(new Error('render_error:' + m))
            });
            resolve(wid);
          } catch (e) {
            reject(e);
          }
        });
      })().catch(e => { widgetPromise = null; throw e; });
      return widgetPromise;
    }

    async function mintCaptcha(action) {
      const prev = captchaTail.catch(() => {});
      let release;
      captchaTail = new Promise(r => { release = r; });
      await prev;
      try {
        await waitForGrecaptcha();
        const sitekey = resolveSitekey();
        for (let i = 0; i < 2; i++) {
          try {
            await waitReady(2500);
            const wid = await ensureWidget(sitekey);
            const token = await Promise.race([
              window.grecaptcha.enterprise.execute(wid, { action }),
              new Promise((_, rej) => setTimeout(() => rej(new Error('CAPTCHA_TIMEOUT')), 9000))
            ]);
            if (token) return String(token);
          } catch (_) {}
          await new Promise(r => setTimeout(r, 500));
        }
        throw new Error('CAPTCHA_MINT_FAILED');
      } finally {
        release();
      }
    }

    window.__sesameFlowRpc = {
      getProjectId() {
        const m = location.pathname.match(/\\/project\\/([0-9a-f-]{36})/i);
        if (m) return m[1];
        const a = document.querySelector('a[href*="/project/"]');
        const m2 = a?.getAttribute('href')?.match(/\\/project\\/([0-9a-f-]{36})/i);
        return m2 ? m2[1] : '';
      },
      async callBatch({ rpcid, freq, captchaAction, match }) {
        const wiz = globalThis.WIZ_global_data || {};
        const at = wiz.SNlM0e;
        const sid = wiz.FdrFJe;
        const bl = wiz.cfb2h;
        if (!at) return { error: 'NO_AT_TOKEN' };

        let finalFreq = freq;
        if (captchaAction) {
          const token = await mintCaptcha(captchaAction);
          finalFreq = finalFreq.split('__CAPTCHA__').join(token);
        }

        const reqid = Math.floor(Math.random() * 900000) + 100000;
        const sourcePath = location.pathname || '/';
        const hl = (document.documentElement.lang || navigator.language || 'en').split('-')[0];
        const url =
          '/_/AiSandboxAngularFrontend/data/batchexecute?rpcids=' + encodeURIComponent(rpcid) +
          '&source-path=' + encodeURIComponent(sourcePath) +
          '&bl=' + encodeURIComponent(bl || '') +
          '&f.sid=' + encodeURIComponent(sid || '') +
          '&hl=' + encodeURIComponent(hl) +
          '&_reqid=' + reqid + '&rt=c';

        const resp = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'x-same-domain': '1'
          },
          body: new URLSearchParams({ 'f.req': finalFreq, at })
        });
        const text = await resp.text();
        if (match) {
          const idx = text.indexOf(match);
          return {
            status: resp.status,
            matched: idx !== -1,
            text: idx === -1 ? '' : text.slice(Math.max(0, idx - 40), idx + 850)
          };
        }
        return { status: resp.status, text: text.slice(0, 8000000) };
      }
    };
    return true;
  })()`);
}

async function callFlowBatchRpc(chrome, { rpcid, freq, captchaAction = null, match = null }) {
  await ensureFlowRpcBridge(chrome);
  const res = await chrome.evaluate(
    `window.__sesameFlowRpc.callBatch(${JSON.stringify({ rpcid, freq, captchaAction, match })})`,
    120000
  );
  if (!res || res.error) {
    throw new Error(res?.error || `RPC_${rpcid}_FAILED`);
  }
  if (match) return res;
  const envelopes = parseBatchEnvelope(res.text || '');
  const found = envelopes.find(e => e.rpcid === rpcid);
  if (!found) throw new Error(`NO_${rpcid}_ENVELOPE`);
  if (!found.ok) throw new Error(`${rpcid}_RPC_ERROR:${JSON.stringify(found.error)}`);
  return found.data;
}

/**
 * Tải ảnh local lên dự án Google Flow qua RPC `maseQ` để lấy `mediaId`
 */
async function uploadImageViaBatchRpc(chrome, projectId, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const b64 = fs.readFileSync(filePath).toString('base64');
  const fileName = path.basename(filePath);
  const freq = buildEnvelope(RPC.UPLOAD_IMAGE, [
    buildContext(projectId),
    b64,
    mimeType,
    1,
    null, null, null, null,
    fileName,
    null,
    clientUuid(),
    clientUuid()
  ]);
  const payload = await callFlowBatchRpc(chrome, {
    rpcid: RPC.UPLOAD_IMAGE,
    freq,
    captchaAction: 'IMAGE_GENERATION'
  });
  const record = Array.isArray(payload) ? payload[0] : null;
  const mediaId = Array.isArray(record) ? record[0] : null;
  if (!mediaId || typeof mediaId !== 'string') {
    throw new Error('UPLOAD_NO_MEDIA_ID');
  }
  return mediaId;
}

/**
 * Sinh video hoặc ảnh trực tiếp bằng giao thức `batchexecute` RPC của Google Flow (công nghệ FrameWeaver)
 */
async function generateGoogleFlowViaBatchRpc(chrome, {
  prompt,
  images = [],
  continuityStartFrame = '',
  ratio = '9:16',
  kind = 'video',
  timeRange = '',
  label = '',
  project = 'default',
  outputDir,
  update = () => {},
  isLive = () => true,
  timeoutMs = 300000
}) {
  await ensureFlowRpcBridge(chrome);
  const projectId = await chrome.evaluate(`window.__sesameFlowRpc.getProjectId()`).catch(() => '');
  if (!projectId || !UUID_RE.test(projectId)) {
    throw new Error('NO_FLOW_PROJECT_ID');
  }

  const validPaths = images
    .map(img => (typeof img === 'string' ? img : img?.imageLocalPath || ''))
    .filter(p => p && fs.existsSync(p))
    .slice(0, 4);

  // 1. Upload ảnh tham chiếu / ảnh mở đầu lên project nếu có
  const uploadedMediaIds = [];
  for (let i = 0; i < validPaths.length; i++) {
    if (!isLive()) return null;
    update({ step: `Google Flow RPC: Đang nạp ảnh tham chiếu (${i + 1}/${validPaths.length})...` });
    const mid = await uploadImageViaBatchRpc(chrome, projectId, validPaths[i]);
    uploadedMediaIds.push(mid);
  }

  const safePrompt = String(prompt || '').trim();

  // 2. Nếu là lệnh Tạo Ảnh (Nano Banana Pro - GEM_PIX_2 / RPC ogiZ0b)
  if (kind === 'image') {
    update({ step: 'Google Flow RPC: Đang tạo ảnh Nano Banana Pro...' });
    const aspectCode = resolveImageAspectCode(ratio);
    const seed = Math.floor(Math.random() * 900000000) + 10000000;
    const imageInputs = uploadedMediaIds.length
      ? uploadedMediaIds.map(mid => [mid, null, null, null, 1])
      : null;
    const item = [
      null, null, imageInputs, seed, aspectCode,
      'GEM_PIX_2', null, buildContext(projectId), [[[safePrompt]]],
      null, null, null, clientUuid(), clientUuid()
    ];
    const freq = buildEnvelope(RPC.GEN_IMAGE, [null, [item], 1, buildContext(projectId), [clientUuid()]]);
    const payload = await callFlowBatchRpc(chrome, {
      rpcid: RPC.GEN_IMAGE,
      freq,
      captchaAction: 'IMAGE_GENERATION'
    });
    const urls = walkStrings(payload).filter(s => s.includes('flow-content.google/image/') || s.includes('storage.googleapis.com'));
    if (!urls.length) throw new Error('IMAGE_RPC_NO_URL');

    const { timeTag, sceneTag, cleanPrj } = extractTags(label || prompt, project);
    const prefix = [cleanPrj || (project !== 'default' ? project : ''), sceneTag, timeTag].filter(Boolean).join('_');
    const finalPath = path.join(outputDir, `${prefix ? prefix + '_' : ''}GoogleFlow_${Date.now()}.jpg`);
    await downloadUrlToFile(urls[0], finalPath);
    update({ step: 'Hoàn thành tạo ảnh Google Flow RPC' });
    return finalPath;
  }

  // 3. Nếu là lệnh Tạo Video: Chọn đúng RPC tối ưu theo ảnh đầu vào
  const aspectCode = resolveVideoAspectCode(ratio);
  const durationSec = resolveOmniDuration(timeRange, safePrompt);
  let rpcid = RPC.GEN_VIDEO_TEXT;
  let freq = '';

  if (uploadedMediaIds.length === 0) {
    // Text-to-Video (YhhmEf - abra_t2v_<N>s)
    const model = `abra_t2v_${durationSec}s`;
    const reqItem = [
      [null, null, [[[safePrompt]]]],
      model,
      aspectCode,
      null,
      [null, null, null, null, clientUuid(), clientUuid()]
    ];
    freq = buildEnvelope(RPC.GEN_VIDEO_TEXT, [
      [reqItem],
      buildContext(projectId),
      [clientUuid(), 1]
    ]);
    rpcid = RPC.GEN_VIDEO_TEXT;
  } else if (continuityStartFrame || uploadedMediaIds.length === 1) {
    // First-Frame Image-to-Video (eb1hJf - abra_i2v_<N>s) — chuẩn cho Khóa nối cảnh liên tục & Storyboard
    const model = `abra_i2v_${durationSec}s`;
    const reqItem = [
      [null, null, [[[safePrompt]]]],
      model,
      aspectCode,
      null,
      [null, uploadedMediaIds[0], null, null, null, FULL_FRAME_CROP],
      [null, null, null, null, clientUuid(), clientUuid()]
    ];
    freq = buildEnvelope(RPC.GEN_VIDEO, [
      [reqItem],
      buildContext(projectId),
      [clientUuid(), 2]
    ]);
    rpcid = RPC.GEN_VIDEO;
  } else {
    // Nhiều ảnh tham chiếu (Nhân vật + Sản phẩm) -> Ingredients Reference-to-Video (MZZa6b - abra_r2v_<N>s)
    const model = `abra_r2v_${durationSec}s`;
    const reqItem = [
      [null, null, [[[safePrompt]]]],
      uploadedMediaIds.map(mid => [null, mid]),
      model,
      aspectCode,
      null,
      [null, null, null, null, clientUuid(), clientUuid()]
    ];
    freq = buildEnvelope(RPC.GEN_VIDEO_REFERENCES, [
      [reqItem],
      buildContext(projectId),
      [clientUuid(), 2]
    ]);
    rpcid = RPC.GEN_VIDEO_REFERENCES;
  }

  const beforeVideoIds = new Set((await listProjectVideos(chrome, { idsOnly: true }).catch(() => null))?.allIds || []);
  update({ step: `Google Flow RPC: Đang gửi lệnh render video (${durationSec}s)...` });
  const submitPayload = await callFlowBatchRpc(chrome, {
    rpcid,
    freq,
    captchaAction: 'VIDEO_GENERATION'
  });

  // Đọc operation_id từ kết quả trả về
  let operationId = '';
  if (rpcid === RPC.GEN_VIDEO_TEXT) {
    const records = Array.isArray(submitPayload) && submitPayload.length > 3 ? submitPayload[3] : null;
    const rec = Array.isArray(records) ? records[0] : null;
    operationId = Array.isArray(rec) ? (rec[0] || rec[2] || '') : '';
  } else {
    const records = Array.isArray(submitPayload) && submitPayload.length > 2 ? submitPayload[2] : null;
    const rec = Array.isArray(records) ? records[0] : null;
    operationId = Array.isArray(rec) ? (rec[0] || '') : '';
  }

  if (!operationId || typeof operationId !== 'string') {
    throw new Error('SUBMIT_NO_OPERATION_ID');
  }

  // 4. Dò trạng thái Operation (jwpduf -> Zzl0ze -> as29s) để lấy link MP4 trực tiếp
  update({ step: 'Google Flow RPC: Đang render video...' });
  const startAt = Date.now();
  let mediaId = '';
  let videoUrl = '';
  let round = 0;

  while (Date.now() - startAt < timeoutMs) {
    if (!isLive()) return null;
    await sleep(4500);
    round++;

    if (!mediaId) {
      let opDone = round % 2 === 0;
      try {
        const opPayload = await callFlowBatchRpc(chrome, {
          rpcid: RPC.OPERATION,
          freq: buildEnvelope(RPC.OPERATION, [null, null, [[operationId]]])
        });
        const rec = opPayload?.[2]?.[0];
        if (Array.isArray(rec) && rec[3] === 'CAE') opDone = true;
      } catch (_) {
        opDone = true;
      }

      if (opDone) {
        try {
          const listRes = await callFlowBatchRpc(chrome, {
            rpcid: RPC.PROJECT_MEDIA,
            freq: buildEnvelope(RPC.PROJECT_MEDIA, [`projects/${projectId}`, null, null, null, [1]]),
            match: operationId
          });
          if (listRes?.matched && listRes.text) {
            const mSlot = listRes.text.match(/null,null,\\?"([0-9a-fA-F-]{36})\\?"/);
            if (mSlot) mediaId = mSlot[1];
          }
        } catch (_) {}
      }
    }

    if (mediaId) {
      try {
        const mediaPayload = await callFlowBatchRpc(chrome, {
          rpcid: RPC.MEDIA,
          freq: buildEnvelope(RPC.MEDIA, [mediaId])
        });
        const allStrings = walkStrings(mediaPayload);
        const foundVid = allStrings.find(s =>
          s.startsWith('https://') &&
          (s.includes('flow-content.google/video/') || s.includes('storage.googleapis.com') && s.includes('.mp4'))
        );
        if (foundVid) {
          videoUrl = foundVid;
          break;
        }
      } catch (_) {}
    }
  }

  if (!videoUrl) {
    try {
      const after = await listProjectVideos(chrome, { skipIds: beforeVideoIds });
      const fresh = after.videos[0];
      if (fresh) videoUrl = fresh.url;
    } catch (_) {}
  }

  // Lệnh render đã được Flow nhận (có operationId). Từ đây mọi lỗi phải đánh dấu "đã gửi" để KHÔNG gửi lại prompt
  // (gửi lại = tạo thêm 1 clip trùng, tốn thêm điểm Flow) — chỉ chờ clip mới xuất hiện trong project rồi tải về.
  const markSubmitted = e => { e.flowSubmitted = true; e.flowBeforeIds = [...beforeVideoIds]; return e; };

  if (!videoUrl) {
    throw markSubmitted(new Error(`Quá thời gian chờ Google Flow RPC render video (${operationId.slice(0, 8)}).`));
  }

  update({ step: 'Google Flow RPC: Đang tải MP4 gốc về máy...' });
  const { timeTag, sceneTag, cleanPrj } = extractTags(label || prompt, project);
  const prefix = [cleanPrj || (project !== 'default' ? project : ''), sceneTag, timeTag].filter(Boolean).join('_');
  const finalFilename = prefix
    ? `${prefix}_GoogleFlow_${Date.now()}.mp4`
    : `GoogleFlow_${Date.now()}.mp4`;
  const finalPath = path.join(outputDir, finalFilename);

  try {
    await downloadUrlToFile(videoUrl, finalPath);
  } catch (_) {
    // Fallback tải bằng fetch có cookie ngay trong trang Chrome
    try {
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
    } catch (dlErr) {
      throw markSubmitted(dlErr);
    }
  }

  update({ step: 'Hoàn thành tải clip Google Flow' });
  return finalPath;
}

/**
 * Sau khi Flow ĐÃ nhận lệnh render nhưng app chưa lấy được clip: chỉ chờ clip mới (id chưa có lúc gửi) rồi tải về.
 * Không gửi lại prompt. Trả null nếu bấm Dừng; ném lỗi nếu hết giờ.
 */
async function recoverSubmittedClip(chrome, { beforeIds = [], label = '', prompt = '', project = 'default', outputDir, update = () => {}, isLive = () => true, waitMs = 600000 }) {
  const before = new Set(beforeIds);
  const startAt = Date.now();
  update({ step: 'Google Flow: Lệnh đã gửi — đang chờ clip xuất hiện trong project (không gửi lại)...' });
  while (Date.now() - startAt < waitMs) {
    if (!isLive()) return null;
    try {
      const r = await listProjectVideos(chrome, { skipIds: before });
      const fresh = r.videos[0];
      if (fresh) {
        const tg = extractTags(label || prompt, project);
        const pre = [tg.cleanPrj || (project !== 'default' ? project : ''), tg.sceneTag, tg.timeTag].filter(Boolean).join('_');
        update({ step: 'Google Flow: Đang tải MP4 gốc về máy...' });
        const saved = await saveFlowVideoUrl(fresh.url, outputDir, (pre ? pre + '_' : '') + 'GoogleFlow');
        update({ step: 'Hoàn thành tải clip Google Flow' });
        return saved;
      }
    } catch (_) { /* thử lại ở vòng sau */ }
    await sleep(8000);
  }
  throw new Error('Flow đã nhận lệnh nhưng sau ' + Math.round(waitMs / 60000) + ' phút vẫn chưa có clip mới trong project. Mở Chrome của tài khoản Flow kiểm tra; app KHÔNG gửi lại để tránh trừ điểm trùng.');
}

async function ensureGflowReady(chrome, projectUrl, { ratio = '9:16', kind = 'video' } = {}) {
  if (!chrome.running) {
    await chrome.start();
  }
  let currentUrl = await chrome.evaluate('location.href').catch(() => '');
  if (projectUrl && !currentUrl.includes('/project/')) {
    await chrome.cmd('Page.navigate', { url: projectUrl }, chrome.sessionId);
    await sleep(6000);
    currentUrl = await chrome.evaluate('location.href').catch(() => '');
  } else if (!currentUrl.includes('flow.google') && !currentUrl.includes('labs.google')) {
    await chrome.cmd('Page.navigate', { url: 'https://flow.google.com/' }, chrome.sessionId);
    await sleep(5000);
    currentUrl = await chrome.evaluate('location.href').catch(() => '');
  }

  // Chờ trang Dashboard hoặc Project tải xong (tối đa 15s) rồi vào thẳng /project/<uuid>
  for (let attempt = 0; attempt < 15; attempt++) {
    currentUrl = await chrome.evaluate('location.href').catch(() => '');
    if (currentUrl.includes('/project/')) break;
    const targetProjectHref = await chrome.evaluate(`(() => {
      // Ưu tiên mở dự án có sẵn của tài khoản (không tạo dự án mới mỗi lần chạy)
      const existingPrj = document.querySelector('a[href*="/project/"]');
      if (existingPrj) {
        const href = existingPrj.getAttribute('href') || '';
        existingPrj.click();
        return href ? new URL(href, location.origin).href : '';
      }

      const startBtn = Array.from(document.querySelectorAll('button, a')).find(el => /create with.*flow/i.test(el.innerText || ''));
      if (startBtn) { startBtn.click(); return ''; }

      const newBtn = Array.from(document.querySelectorAll('button, a')).find(el => /new project|create project|tạo dự án/i.test((el.innerText || '') + ' ' + (el.getAttribute('aria-label') || '')));
      if (newBtn) { newBtn.click(); return 'clicked_new'; }
      return '';
    })()`).catch(() => '');
    if (targetProjectHref && targetProjectHref.startsWith('http')) {
      await sleep(1500);
      const afterClickUrl = await chrome.evaluate('location.href').catch(() => '');
      if (!afterClickUrl.includes('/project/')) {
        await chrome.cmd('Page.navigate', { url: targetProjectHref }, chrome.sessionId);
      }
      break;
    }
    await sleep(1000);
  }

  // Chờ trình soạn thảo div.ProseMirror bên trong /project/ hiện ra
  for (let i = 0; i < 15; i++) {
    const hasEditor = await chrome.evaluate(`Boolean(location.pathname.includes('/project/') && document.querySelector('div.ProseMirror'))`).catch(() => false);
    if (hasEditor) break;
    await sleep(1000);
  }

  // Đảm bảo chế độ Video/Image, tỷ lệ khung hình (9:16 / 16:9) và batch x1 cho cả DOM Fallback
  await chrome.cmd('Runtime.evaluate', {
    expression: `(() => {
      const btn = document.querySelector('button.settings-trigger-button, button[aria-label="Settings trigger"]');
      if (btn) btn.click();
    })()`,
    returnByValue: true
  }, chrome.sessionId).catch(() => {});
  await sleep(800);

  await chrome.cmd('Runtime.evaluate', {
    expression: `((wantKind, wantRatio) => {
      const toggles = Array.from(document.querySelectorAll('button.mat-button-toggle-button'));
      const modeText = wantKind === 'image' ? 'Image' : 'Video';
      const modeBtn = toggles.find(b => b.innerText.includes(modeText));
      if (modeBtn && !modeBtn.parentElement.classList.contains('mat-button-toggle-checked')) modeBtn.click();

      const isPortrait = wantRatio === '9:16' || wantRatio === '3:4';
      const ratioBtn = toggles.find(b => {
        const t = b.innerText.toLowerCase();
        return isPortrait ? (t.includes('9:16') || t.includes('portrait')) : (t.includes('16:9') || t.includes('landscape'));
      });
      if (ratioBtn && !ratioBtn.parentElement.classList.contains('mat-button-toggle-checked')) ratioBtn.click();

      const x1 = toggles.find(b => b.innerText.trim() === 'x1');
      if (x1 && !x1.parentElement.classList.contains('mat-button-toggle-checked')) x1.click();

      const backdrop = document.querySelector('.cdk-overlay-backdrop');
      if (backdrop) backdrop.click();
    })(${JSON.stringify(kind)}, ${JSON.stringify(ratio)})`,
    returnByValue: true
  }, chrome.sessionId).catch(() => {});
  await sleep(800);
}

/**
 * Đính kèm ảnh tham chiếu lên Google Flow qua input[type="file"] (dùng cho DOM Fallback)
 */
async function uploadGflowImages(chrome, images = []) {
  const validPaths = images
    .map(img => (typeof img === 'string' ? img : img?.imageLocalPath || ''))
    .filter(p => p && fs.existsSync(p))
    .slice(0, 4);

  if (!validPaths.length) return;

  try {
    const { root } = await chrome.cmd('DOM.getDocument', { depth: -1 }, chrome.sessionId);
    const { nodeId } = await chrome.cmd('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: 'input[type="file"]'
    }, chrome.sessionId);

    if (nodeId) {
      await chrome.cmd('DOM.setFileInputFiles', {
        nodeId,
        files: validPaths
      }, chrome.sessionId);
      await sleep(2500);
    }
  } catch (e) {
    console.warn('[GoogleFlow] Không đính kèm được ảnh tham chiếu:', e.message);
  }
}

/**
 * Tạo 1 clip trên Google Flow:
 * Ưu tiên gọi thẳng `batchexecute` RPC (FrameWeaver engine) -> nếu lỗi cấu hình/RPC thì tự động chuyển sang DOM Fallback.
 */
async function generateGoogleFlowClip(chrome, {
  prompt,
  images = [],
  continuityStartFrame = '',
  ratio = '9:16',
  kind = 'video',
  timeRange = '',
  label = '',
  project = 'default',
  outputDir,
  update = () => {},
  isLive = () => true,
  timeoutMs = 300000
}) {
  try {
    const rpcSaved = await generateGoogleFlowViaBatchRpc(chrome, {
      prompt,
      images,
      continuityStartFrame,
      ratio,
      kind,
      timeRange,
      label,
      project,
      outputDir,
      update,
      isLive,
      timeoutMs
    });
    if (rpcSaved || !isLive()) return rpcSaved;
  } catch (rpcErr) {
    // Flow đã nhận lệnh render thì KHÔNG gửi lại prompt (sẽ tạo clip trùng, tốn điểm) — chỉ chờ clip mới rồi tải.
    if (rpcErr && rpcErr.flowSubmitted) {
      console.warn('[GoogleFlow] RPC đã gửi lệnh nhưng chưa lấy được clip, chuyển sang chờ clip mới:', rpcErr.message);
      return recoverSubmittedClip(chrome, { beforeIds: rpcErr.flowBeforeIds || [], label, prompt, project, outputDir, update, isLive, waitMs: Math.max(timeoutMs, 600000) });
    }
    console.warn('[GoogleFlow] Chuyển từ RPC sang DOM Fallback:', rpcErr.message);
  }

  const tempDownloadDir = path.join(os.tmpdir(), 'sesame_gflow_downloads');
  if (!fs.existsSync(tempDownloadDir)) fs.mkdirSync(tempDownloadDir, { recursive: true });

  for (const f of fs.readdirSync(tempDownloadDir)) {
    if (f.endsWith('.zip')) {
      try { fs.unlinkSync(path.join(tempDownloadDir, f)); } catch (_) {}
    }
  }

  try {
    await chrome.cmd('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: tempDownloadDir,
      eventsEnabled: true
    });
  } catch (e) {
    await chrome.cmd('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: tempDownloadDir
    }, chrome.sessionId).catch(() => {});
  }

  const beforeStateRes = await chrome.cmd('Runtime.evaluate', {
    expression: `(() => {
      const c0 = document.querySelector('.batch-container');
      const v0 = c0 ? (c0.querySelector('video')?.src || '') : '';
      const i0 = c0 ? (c0.querySelector('img')?.src || '') : '';
      return {
        count: document.querySelectorAll('.batch-container').length,
        topSig: c0 ? ((c0.innerText || '').trim().slice(0, 120) + '|' + v0 + '|' + i0) : '',
        img0: i0, vid0: v0
      };
    })()`,
    returnByValue: true
  }, chrome.sessionId);
  const beforeState = beforeStateRes?.result?.value || { count: 0, topSig: '' };
  const beforeVideoIds = new Set(((kind !== 'image' && await listProjectVideos(chrome, { idsOnly: true }).catch(() => null))?.allIds) || []);

  if (images && images.length > 0) {
    update({ step: 'Google Flow: Đang tải ảnh tham chiếu...' });
    await uploadGflowImages(chrome, images);
  }

  update({ step: 'Google Flow: Đang nhập prompt...' });

  await chrome.cmd('Runtime.evaluate', {
    expression: `(() => {
      const el = document.querySelector('div.ProseMirror');
      if (el) {
        el.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
      }
    })()`,
    returnByValue: true
  }, chrome.sessionId);

  const safePrompt = String(prompt || '').replace(/\s*\n+\s*/g, ' ').trim();
  await chrome.cmd('Input.insertText', { text: safePrompt }, chrome.sessionId);
  await chrome.cmd('Input.dispatchKeyEvent', { type: 'keyDown', text: ' ' }, chrome.sessionId);
  await chrome.cmd('Input.dispatchKeyEvent', { type: 'keyUp' }, chrome.sessionId);
  await sleep(800);

  update({ step: 'Google Flow: Bắt đầu sinh video...' });

  const clickedRes = await chrome.cmd('Runtime.evaluate', {
    expression: `(() => {
      const btn = document.querySelector('button[aria-label="Start generation"], button.generate-icon-button');
      if (btn && !btn.disabled && !btn.classList.contains('mat-mdc-button-disabled')) {
        btn.click();
        return true;
      }
      return false;
    })()`,
    returnByValue: true
  }, chrome.sessionId);

  if (!clickedRes?.result?.value) {
    throw new Error('Không thể bấm nút "Start generation" trên Google Flow. Nút bị mờ hoặc không tìm thấy.');
  }

  const stopWords = new Set(['a', 'an', 'the', 'cinematic', 'shot', 'of', 'and', 'with', 'for', 'in', 'on', 'at', 'to', '4k', 'ultra', 'realism', 'food', 'vertical', 'video', 'photorealistic', 'scene']);
  // Bỏ dấu tiếng Việt cho CẢ prompt lẫn chữ trên card (trước đây xoá hẳn chữ có dấu → prompt tiếng Việt gần như không khớp được card nào)
  const foldText = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
  const distinctWords = foldText(safePrompt).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w))
    .filter((w, i, a) => a.indexOf(w) === i).slice(0, 8);

  update({ step: 'Google Flow: Đang render video...' });
  const startAt = Date.now();
  let foundTarget = false;
  let domPollTick = 0;

  while (Date.now() - startAt < timeoutMs) {
    if (!isLive()) return null;
    await sleep(4000);

    const checkRes = await chrome.cmd('Runtime.evaluate', {
      expression: `(() => {
        const containers = Array.from(document.querySelectorAll('.batch-container'));
        if (!containers.length) return { ready: false, reason: 'chưa có container' };
        const top = containers[0];
        const v0 = top.querySelector('video')?.src || '';
        const i0 = top.querySelector('img')?.src || '';
        const curSig = (top.innerText || '').trim().slice(0, 120) + '|' + v0 + '|' + i0;
        const t = (top.innerText || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/đ/g, 'd');
        const words = ${JSON.stringify(distinctWords)};
        const matchWords = words.filter(w => t.includes(w));
        // Flow chỉ dựng ~8 card (danh sách ảo hoá) nên số card KHÔNG tăng khi project đã nhiều clip → thêm điều kiện: ảnh/video của card trên cùng đã đổi so với lúc gửi
        const isNewCard = containers.length > ${beforeState.count}
          || Boolean(i0 && i0 !== ${JSON.stringify(beforeState.img0 || '')})
          || Boolean(v0 && v0 !== ${JSON.stringify(beforeState.vid0 || '')});
        const needWords = Math.min(2, words.length);
        // Card phải MỚI thật (số card tăng) VÀ chứa chữ của prompt vừa gửi — không dựa vào link ảnh (link ký tên đổi mỗi lần tải trang)
        if (!isNewCard || matchWords.length < needWords) return { ready: false, reason: 'chưa thấy card của prompt này' };
        const errM = t.match(/unusual activity|something went wrong|couldn.t generate|could not generate|generation failed|failed to generate|violat|policy|try again later|hoạt động bất thường|không thể tạo/i);
        if (errM) return { ready: false, error: errM[0], text: t.slice(0, 160) };
        if (/\\b\\d{1,3}\\s?%/.test(t)) return { ready: false, reason: 'đang render ' + (t.match(/\\d{1,3}\\s?%/) || [''])[0] };
        const dlBtn = top.querySelector('button[aria-label="Download batch"]')
          || top.querySelector('button[aria-label*="Download" i]')
          || top.querySelector('button[aria-label*="Tải" i]')
          || Array.from(top.querySelectorAll('button')).find(b => (b.innerText || b.getAttribute('aria-label') || '').match(/download|tải/i));
        const hasDl = Boolean(dlBtn && !dlBtn.disabled);
        const hasMedia = Boolean((v0 && v0.length > 5) || (i0 && i0.length > 5));
        const hasSpinner = Boolean(top.querySelector('mat-progress-spinner, mat-spinner, [role="progressbar"], .loading'));
        return { ready: (hasDl || hasMedia) && !hasSpinner, text: t.slice(0, 60) };
      })()`,
      returnByValue: true
    }, chrome.sessionId);

    const check = checkRes.result.value || {};
    if (check.error) {
      throw new Error(`Google Flow từ chối tạo video: "${check.error}". ${/unusual/i.test(check.error) ? 'Google đang tạm chặn tài khoản vì "hoạt động bất thường" — mở Chrome của tài khoản (tab Tài khoản → Hiện Chrome), tạo thử 1 video bằng tay để xác minh, rồi chạy lại.' : ''}`);
    }
    if (check.ready) {
      foundTarget = true;
      break;
    }
    // Danh sách card của Flow chỉ hiện ~8 card gần nhất (ảo hoá) nên "số card tăng" không đáng tin khi project đã nhiều clip.
    // Không phụ thuộc card: có clip MỚI (id chưa có lúc gửi) trong danh sách project là xong.
    if (kind !== 'image' && (++domPollTick % 3 === 0)) {
      try {
        const rr = await listProjectVideos(chrome, { skipIds: beforeVideoIds });
        const fresh = rr.videos;
        dbg('LIST total=' + (rr.allIds || []).length + ' before=' + beforeVideoIds.size + ' fresh=' + fresh.length);
        if (fresh.length) { foundTarget = true; break; }
      } catch (e) { dbg('LIST ERROR ' + e.message); }
    }
  }

  if (!foundTarget) {
    throw new Error(`Quá thời gian chờ (${Math.round(timeoutMs / 60000)} phút) Google Flow render clip.`);
  }

  if (kind !== 'image') {
    try {
      update({ step: 'Google Flow: Đang lấy link MP4 trực tiếp...' });
      let picked = null;
      for (let i = 0; i < 8 && !picked && isLive(); i++) {
        const r = await listProjectVideos(chrome, { skipIds: beforeVideoIds });
        picked = r.videos[0] || null;
        if (!picked) await sleep(4000);
      }
      if (picked) {
        const tg = extractTags(label || prompt, project);
        const pre = [tg.cleanPrj || (project !== 'default' ? project : ''), tg.sceneTag, tg.timeTag].filter(Boolean).join('_');
        update({ step: 'Google Flow: Đang tải MP4 gốc về máy...' });
        const savedDirect = await saveFlowVideoUrl(picked.url, outputDir, (pre ? pre + '_' : '') + 'GoogleFlow');
        update({ step: 'Hoàn thành tải clip Google Flow' });
        return savedDirect;
      }
    } catch (e) {
      console.warn('[GoogleFlow] Lấy link MP4 trực tiếp thất bại, chuyển sang nút Download:', e.message);
    }
  }
  update({ step: 'Google Flow: Đang tải video về máy...' });

  for (const f of fs.readdirSync(tempDownloadDir)) {
    if (f.endsWith('.zip') || f.endsWith('.crdownload') || f.endsWith('.tmp')) {
      try { fs.unlinkSync(path.join(tempDownloadDir, f)); } catch (_) {}
    }
  }

  try {
    await chrome.cmd('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: tempDownloadDir,
      eventsEnabled: true
    });
  } catch (e) {
    await chrome.cmd('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: tempDownloadDir
    }, chrome.sessionId).catch(() => {});
  }

  await chrome.cmd('Runtime.evaluate', {
    expression: `(() => {
      const containers = Array.from(document.querySelectorAll('.batch-container'));
      const c0 = containers[0];
      if (!c0) return { error: 'No container 0' };
      const btn = c0.querySelector('button[aria-label="Download batch"]')
        || c0.querySelector('button[aria-label*="Download"]')
        || c0.querySelector('button[aria-label*="Tải"]')
        || Array.from(c0.querySelectorAll('button')).find(b => (b.innerText || '').match(/download|tải/i));
      if (!btn) return { error: 'No download button in container 0' };
      btn.scrollIntoView({ behavior: 'instant', block: 'center' });
      btn.click();
      // Google Flow hiện menu chọn chất lượng: 270p GIF / 720p Original size / 1080p Upscaled / 4K (khóa, cần Upgrade).
      // Trước đây bấm mục ĐẦU TIÊN = GIF nên không bao giờ có .mp4 -> timeout. Giờ chọn 720p gốc (không tốn thêm lượt nâng cấp),
      // không có thì 1080p, tuyệt đối bỏ GIF/4K/Upgrade.
      setTimeout(() => {
        const txt = el => (el.innerText || el.textContent || '').toLowerCase();
        const items = Array.from(document.querySelectorAll('[role="menu"] [role="menuitem"], [role="menu"] button, [role="menuitem"]'));
        const usable = items.filter(el => !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !/gif|4k|upgrade/.test(txt(el)));
        const pick = usable.find(el => /original size|720p/.test(txt(el))) || usable.find(el => /1080p/.test(txt(el))) || usable[0];
        if (pick) pick.click();
      }, 700);
      return { success: true, text: c0.innerText?.slice(0, 60) };
    })()`,
    returnByValue: true
  }, chrome.sessionId);

  let downloadedFile = null;
  const userDownloadsDir = path.join(os.homedir(), 'Downloads');
  const pollStart = Date.now();

  for (let wait = 0; wait < 35; wait++) {
    await sleep(1000);
    for (const d of [tempDownloadDir, userDownloadsDir]) {
      if (!fs.existsSync(d)) continue;
      const files = fs.readdirSync(d);
      const candidates = files.filter(f => {
        const lower = f.toLowerCase();
        if (lower.endsWith('.crdownload') || lower.endsWith('.tmp')) return false;
        if (lower.endsWith('.zip') || lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.png')) {
          if (d === userDownloadsDir) {
            try {
              const stat = fs.statSync(path.join(d, f));
              return stat.mtimeMs >= pollStart - 5000;
            } catch (_) { return false; }
          }
          return true;
        }
        return false;
      });

      if (candidates.length > 0) {
        const p = path.join(d, candidates[0]);
        try {
          const sz1 = fs.statSync(p).size;
          await sleep(1000);
          const sz2 = fs.statSync(p).size;
          if (sz1 > 0 && sz1 === sz2) {
            downloadedFile = p;
            break;
          }
        } catch (_) {}
      }
    }
    if (downloadedFile) break;
  }

  if (!downloadedFile) {
    throw new Error('Tải file video từ Google Flow thất bại hoặc quá thời gian chờ.');
  }

  let rawMediaPath = null;
  if (downloadedFile.endsWith('.zip')) {
    const extractDir = path.join(tempDownloadDir, `extracted_${Date.now()}`);
    fs.mkdirSync(extractDir, { recursive: true });
    try {
      execSync(`tar -xf "${downloadedFile}" -C "${extractDir}"`);
    } catch (err) {
      if (process.platform === 'win32') {
        execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${downloadedFile}' -DestinationPath '${extractDir}' -Force"`);
      } else {
        execSync(`unzip -o -q "${downloadedFile}" -d "${extractDir}"`);
      }
    }

    const extractedFiles = fs.readdirSync(extractDir);
    const mediaName = extractedFiles.find(f => /\.(mp4|png|jpe?g|webp)$/i.test(f));
    if (!mediaName) {
      throw new Error(`Không tìm thấy file kết quả bên trong gói tải về từ Google Flow: ${extractedFiles.join(', ')}`);
    }
    rawMediaPath = path.join(extractDir, mediaName);
  } else {
    rawMediaPath = downloadedFile;
  }

  const ext = path.extname(rawMediaPath).toLowerCase() || '.mp4';

  const { timeTag, sceneTag, cleanPrj } = extractTags(label || prompt, project);
  const prefix = [cleanPrj || (project !== 'default' ? project : ''), sceneTag, timeTag].filter(Boolean).join('_');
  const finalFilename = prefix 
    ? `${prefix}_GoogleFlow_${Date.now()}${ext}`
    : `GoogleFlow_${Date.now()}${ext}`;

  const finalPath = path.join(outputDir, finalFilename);
  fs.copyFileSync(rawMediaPath, finalPath);

  try {
    fs.rmSync(tempDownloadDir, { recursive: true, force: true });
  } catch (_) {}

  update({ step: 'Hoàn thành tải clip Google Flow' });
  return finalPath;
}

/**
 * Runner tích hợp với Task Store
 * Hỗ trợ:
 *  - Đơn cảnh (Studio / từng cảnh 10s)
 *  - Đa cảnh gộp 1 lệnh (Kịch bản / LadiPage 16s..60s, Storyboard) -> tự tách cảnh,
 *    tự động Khóa nối cảnh liên tục (End-Frame Continuity Lock) và ghép bằng ffmpeg.
 */
async function runTask(task, context) {
  const page = context.page;
  const chrome = page.chrome;
  const acc = typeof page?.getAccount === 'function' ? page.getAccount() : context.account;
  const projectUrl = acc?.projectUrl || '';
  const update = context.update || (() => {});
  const isLive = context.isLive || (() => true);
  const timeoutMs = (task.timeoutMin || context.limits?.video || 10) * 60000;

  await ensureGflowReady(chrome, projectUrl, { ratio: task.ratio || '9:16', kind: task.kind || 'video' });

  const tempRefDir = path.join(os.tmpdir(), 'sesame_gflow_refs');
  const localImages = await materializeTaskImages(task.images || [], context.loadImage, tempRefDir);
  const scenes = task.kind === 'image'
    ? [{ sceneNum: 1, totalScenes: 1, timeRange: '', prompt: task.prompt, images: localImages }]
    : splitMultiScenePrompt(task.prompt, localImages);

  const sceneFiles = [];
  let prevEndFramePath = null;

  for (let i = 0; i < scenes.length; i++) {
    if (!isLive()) return null;
    // Nếu là cảnh tiếp theo trong kịch bản nhiều cảnh (và được bật nối cảnh mặc định), gắn End-Frame của cảnh trước vào
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

    const saved = await generateGoogleFlowClip(chrome, {
      prompt: sc.prompt,
      images: sc.images,
      continuityStartFrame: sc.continuityStartFrame || task.continuityStartFrame || '',
      ratio: task.ratio || '9:16',
      kind: task.kind || 'video',
      timeRange: sc.timeRange || task.timeRange || '',
      label: sceneLabel,
      project: task.project || 'default',
      outputDir: context.outputDir,
      update: sceneUpdate,
      isLive,
      timeoutMs
    });

    if (!saved) return null;
    sceneFiles.push(saved);

    // Trích xuất khung hình cuối cùng của cảnh vừa xong để truyền sang cảnh kế tiếp (End-Frame Continuity Lock)
    if (scenes.length > 1 && i < scenes.length - 1 && task.kind !== 'image' && task.continuity !== false) {
      sceneUpdate({ step: 'Đang trích xuất khung hình cuối để khóa nối cảnh tiếp theo...' });
      prevEndFramePath = await extractVideoEndFrame(saved, tempRefDir);
    }
  }

  if (sceneFiles.length > 1 && task.kind !== 'image') {
    update({ step: `Google Flow: Đang ghép ${sceneFiles.length} cảnh liền mạch thành 1 video...` });
    const { cleanPrj } = extractTags(task.label || task.prompt, task.project || 'default');
    const mergedName = [cleanPrj, 'GoogleFlow_Merged', Date.now()].filter(Boolean).join('_') + '.mp4';
    const mergedPath = path.join(context.outputDir, mergedName);
    const res = await merger.mergeVideos(sceneFiles, mergedPath, { normalize: true });
    if (res?.success && res.path) {
      return [res.path];
    }
  }

  return sceneFiles;
}

/**
 * Liệt kê video đã render trong project Google Flow đang mở (qua RPC, không bấm nút Download).
 * Trả về [{ mediaId, url }] — url là link mp4 đã ký sẵn, tải thẳng được bằng HTTP thường (không cần cookie).
 * Dùng để (1) cứu clip đã render mà lần tải trước thất bại, (2) fallback khi menu Download của Flow không mở.
 */
async function listProjectVideos(chrome, { max = 30, idsOnly = false, skipIds = null } = {}) {
  // idsOnly: chỉ lấy danh sách id media (nhanh, 1 lệnh) — dùng để "chụp" trạng thái trước khi gửi prompt.
  // skipIds: bỏ qua các id đã có (không gọi MEDIA cho chúng) — chỉ hỏi link của media MỚI. Project nhiều clip/ảnh có hàng chục id và thứ tự
  //          không theo thời gian, nên trước đây chỉ hỏi 30 id đầu là bỏ sót clip mới (ids=58 withUrl=10, fresh=0).
  await ensureFlowRpcBridge(chrome);
  const projectId = await chrome.evaluate('window.__sesameFlowRpc.getProjectId()').catch(() => '');
  if (!projectId || !UUID_RE.test(projectId)) throw new Error('NO_FLOW_PROJECT_ID');
  const listPayload = await callFlowBatchRpc(chrome, {
    rpcid: RPC.PROJECT_MEDIA,
    freq: buildEnvelope(RPC.PROJECT_MEDIA, ['projects/' + projectId, null, null, null, [1]])
  });
  const ids = [];
  for (const str of walkStrings(listPayload)) {
    const m = String(str).match(UUID_RE);
    if (m && m[0].toLowerCase() !== projectId.toLowerCase() && !ids.includes(m[0])) ids.push(m[0]);
  }
  const out = [];
  if (idsOnly) { dbg('listProjectVideos idsOnly ids=' + ids.length); return { projectId, videos: [], allIds: ids }; }
  const skip = skipIds ? new Set(skipIds) : null;
  const toFetch = skip ? ids.filter(id => !skip.has(id)) : ids;
  for (const mediaId of toFetch.slice(0, skip ? 60 : max)) {
    try {
      const mediaPayload = await callFlowBatchRpc(chrome, {
        rpcid: RPC.MEDIA,
        freq: buildEnvelope(RPC.MEDIA, [mediaId])
      });
      const url = walkStrings(mediaPayload).find(u =>
        u.startsWith('https://') && (u.includes('flow-content.google/video/') || (u.includes('storage.googleapis.com') && u.includes('.mp4')))
      );
      if (url) out.push({ mediaId, url });
    } catch (_) {}
  }
  dbg('listProjectVideos ids=' + ids.length + ' fetched=' + toFetch.length + ' withUrl=' + out.length);
  return { projectId, videos: out, allIds: ids };
}

/** Tải 1 link mp4 đã ký của Flow về outputDir (kiểm tra kích thước > 100KB). */
async function saveFlowVideoUrl(url, outputDir, name = 'GoogleFlow') {
  fs.mkdirSync(outputDir, { recursive: true });
  const dest = path.join(outputDir, name + '_' + Date.now() + '.mp4');
  await downloadUrlToFile(url, dest);
  const size = fs.statSync(dest).size;
  if (size < 100 * 1024) { try { fs.unlinkSync(dest); } catch (_) {} throw new Error('File tải về quá nhỏ (' + size + ' byte) — link Flow hết hạn?'); }
  return dest;
}

module.exports = {
  listProjectVideos,
  saveFlowVideoUrl,
  ensureGflowReady,
  generateGoogleFlowViaBatchRpc,
  generateGoogleFlowClip,
  runTask
};

