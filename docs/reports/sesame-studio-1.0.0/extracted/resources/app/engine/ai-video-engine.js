/**
 * NATIVE AI VIDEO ENGINE CHO SESAME STUDIO & HIU STUDIO
 * Tích hợp trực tiếp 3 nền tảng tạo Video AI qua Chrome CDP:
 *   1. Google Flow (Veo 3.1 / Imagen 3)
 *   2. Muse AI (Grok / Muse Video)
 *   3. Seedance 2.5 (BytePlus / Dreamina)
 * Tích hợp sẵn Bộ Tiêu Chuẩn Công Nghiệp 20 Quy Tắc Làm Phim AI (V4.0 Strict):
 *   - Chống chữ rác 2 lớp (no text/subtitles/watermark + no legible writing on signs or walls)
 *   - Khóa nhân vật 1 câu đồng nhất, không đính ảnh 2 người vào cảnh đơn (chống lỗi đơ 2 người)
 *   - 1 bối cảnh / 1 chuyển động camera / tối đa 2 beat hành động mỗi clip
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Chrome } = require('./chrome');
const { MusePage } = require('./muse-page');
const { dispatchTask } = require('./multi-engine');
const { SEEDANCE_URL } = require('./seedance-runner');
const { DOLA_URL } = require('./dola-runner');

const pagesCache = new Map();

function getProfilesRoot() {
  const localProfiles = path.join(os.homedir(), 'AppData', 'Roaming', 'sesame-studio', 'profiles');
  fs.mkdirSync(localProfiles, { recursive: true });
  return localProfiles;
}

function getAccountsList() {
  const accFile = path.join(os.homedir(), 'AppData', 'Roaming', 'sesame-studio', 'accounts.json');
  if (fs.existsSync(accFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(accFile, 'utf8'));
      if (Array.isArray(parsed.accounts) && parsed.accounts.length) return parsed.accounts;
    } catch (_) {}
  }
  return [
    { id: 'default', name: 'Muse AI Default', provider: 'muse', enabled: true },
    { id: 'acc_flow_1', name: 'Google Flow 1', provider: 'google_flow', enabled: true },
    { id: 'acc_dola_1', name: 'Dola AI (Seedance 2.0 Fast)', provider: 'dola', enabled: true },
    { id: 'acc_seedance_1', name: 'Seedance 2.5', provider: 'seedance', enabled: true }
  ];
}

function getPageForProvider(preferredProvider = 'muse') {
  const accounts = getAccountsList();
  const acc = accounts.find(a => a.enabled && (a.provider || 'muse') === preferredProvider);
  if (!acc) {
    throw new Error(`[Sesame AI] Không tìm thấy tài khoản nào đang bật cho provider '${preferredProvider}'. Vui lòng kiểm tra tab Tài khoản, tuyệt đối không được tự ý fallback sang engine khác.`);
  }

  const id = acc.id;
  const provider = acc.provider || 'muse';
  if (!pagesCache.has(id)) {
    let url = 'https://muse.ai';
    if (provider === 'google_flow') url = 'https://flow.google.com/';
    else if (provider === 'seedance') url = SEEDANCE_URL;
    else if (provider === 'dola') url = DOLA_URL;
    const profileDir = path.join(getProfilesRoot(), id);
    const chrome = new Chrome({ profileDir, url });
    const page = new MusePage(chrome, { provider, account: () => acc });
    pagesCache.set(id, { page, accountId: id, provider });
  }
  return pagesCache.get(id);
}

/**
 * Chuẩn hóa Prompt theo đúng 20 Quy Tắc Làm Phim AI (V4.0 Strict - Sesame-V5.1-Rules)
 */
function buildStrict20RulePrompt(scene = {}, seriesConfig = {}, idx = 0) {
  const ratio = seriesConfig.ratio || '9:16';
  const durationSec = scene.durationSec || 6;
  const colorGrade = seriesConfig.colorGrade || 'điện ảnh trầm ấm 35mm, ánh sáng tự nhiên chân thực';
  const weather = seriesConfig.weather || 'không khí điện ảnh dịu nhẹ';
  const charLock = String(seriesConfig.charLock || scene.charLock || '')
    .replace(/\[[A-Z0-9_]+\]\s*:?/g, '')
    .trim();
  const setting = String(scene.setting || seriesConfig.setting || 'không gian nội thất điện ảnh sang trọng, ánh sáng tự nhiên')
    .replace(/\[[A-Z0-9_]+\]\s*:?/g, '')
    .trim();

  // Xóa bỏ mọi nhãn VIẾT_HOA_gạch_dưới để tránh AI vẽ chữ lên hình (Quy tắc 1)
  const rawAction = String(scene.visualPrompt || scene.action || scene.narration || '')
    .replace(/\[[A-Z0-9_]+\]\s*:?/g, '')
    .replace(/\b[A-Z]{2,}_[A-Z0-9_]+\b/g, '')
    .trim();

  const beat1 = scene.beat1 || rawAction;
  const beat2 = scene.beat2 || 'chuyển động nhẹ nhàng tự nhiên, ánh mắt có chiều sâu cảm xúc, giữ nguyên bối cảnh';
  const cameraMove = scene.camera || (idx % 2 === 0 ? 'Máy quay push-in chậm rãi' : 'Góc máy trung cảnh tĩnh, lấy nét sâu');
  const finalFrame = scene.finalFrame || `${beat2} trong cùng bối cảnh ${setting}`;
  const halfDur = Math.max(2, Math.floor(durationSec / 2));

  return [
    `Create a ${ratio} aspect ratio video clip, ${durationSec} seconds long. Output aspect ratio: ${ratio}. Match this frame shape exactly. Use a tall portrait composition.`,
    `AUDIO IS REQUIRED: Return a video with audible, synchronized sound; do not make a silent clip. Follow the requested audio direction and make its music and sound effects clearly audible. Do not add spoken dialogue.`,
    `Bối cảnh: ${setting}.`,
    charLock ? `Nhân vật: ${charLock}` : '',
    `${cameraMove}. Chỉ một bối cảnh duy nhất từ đầu đến cuối clip, không chuyển cảnh giữa chừng.`,
    `Timed action beats:`,
    `0-${halfDur}s ${beat1}; ${halfDur}-${durationSec}s ${beat2}.`,
    `Final frame to reach: ${finalFrame}.`,
    `Audio direction: tiếng động môi trường tự nhiên nhẹ nhàng, nhạc cụ mộc trầm ấm. No speech, no singing.`,
    `Cinematic realistic drama, ${ratio}, ${colorGrade}, ${weather}, smooth camera movement, subtle natural motion, no text, no subtitles, no logo, no watermark, no legible writing on signs or walls.`,
    `Avoid: chữ viết trên biển hiệu hoặc tường, morph chuyển cảnh, biến dạng bàn tay, anatomically correct hands, same outfit and hairstyle as the opening frame, no half-cut objects at frame edges, không đổi trang phục hoặc bối cảnh giữa clip.`
  ].filter(Boolean).join('\n\n');
}

async function loadImageAttachment(imgObj) {
  const localPath = imgObj?.imageLocalPath || imgObj?.path || (typeof imgObj === 'string' ? imgObj : '');
  if (localPath && fs.existsSync(localPath)) {
    const ext = path.extname(localPath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return {
      mimeType,
      dataBase64: fs.readFileSync(localPath).toString('base64')
    };
  }
  throw new Error(`Không tìm thấy file ảnh đính kèm: ${localPath}`);
}

/**
 * Tạo hàng loạt clip cảnh AI cho danh sách phân cảnh bằng Engine AI nội bộ (Muse / Google Flow / Seedance)
 */
async function generateAiVideoForScenes({
  projectTitle = 'Sesame_Story',
  scenes = [],
  seriesConfig = {},
  engine = 'muse',
  outputDir,
  onProgress = () => {}
}) {
  const baseOutDir = outputDir || path.join(path.resolve(__dirname, '..'), 'output');
  const safeSlug = String(projectTitle)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36) || 'Project';

  const scenesOutDir = path.join(baseOutDir, 'ai_scenes', safeSlug);
  fs.mkdirSync(scenesOutDir, { recursive: true });

  const { page, accountId, provider } = getPageForProvider(engine === 'auto' ? 'muse' : engine);
  const generatedVideoPaths = [];

  for (let i = 0; i < scenes.length; i++) {
    const destFile = path.join(scenesOutDir, `Canh_${String(i + 1).padStart(2, '0')}.mp4`);
    if (fs.existsSync(destFile) && fs.statSync(destFile).size > 250000) {
      onProgress({
        step: `Đã có sẵn Cảnh ${i + 1}/${scenes.length} (${path.basename(destFile)})`,
        pct: Math.round(10 + (((i + 1) / scenes.length) * 80)),
        sceneIndex: i
      });
      generatedVideoPaths.push(destFile);
      continue;
    }

    const sc = scenes[i];
    // Cảnh do Đạo diễn: dùng đúng prompt đã biên dịch + ảnh tham chiếu của người có mặt; cảnh tự phân tích mới đi qua mẫu cũ
    const isDrama = Boolean(sc.drama && sc.drama.prompt);
    const strictPrompt = isDrama ? sc.drama.prompt : buildStrict20RulePrompt(sc, seriesConfig, i);
    let files = null;
    let lastErr = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      const taskId = `sesame_${safeSlug}_c${i + 1}_${Date.now()}`;
      onProgress({
        step: `Đang tạo Video AI Cảnh ${i + 1}/${scenes.length} qua ${provider.toUpperCase()}${attempt > 1 ? ` (Thử lại lần ${attempt})` : ''}...`,
        pct: Math.round(10 + ((i / scenes.length) * 80)),
        sceneIndex: i
      });

      const task = {
        id: taskId,
        label: `${safeSlug}_Canh_${String(i + 1).padStart(2, '0')}`,
        project: safeSlug,
        kind: 'video',
        ratio: seriesConfig.ratio || '9:16',
        engine: provider,
        prompt: isDrama ? strictPrompt : `Cảnh ${i + 1}: ${strictPrompt}`,
        images: isDrama ? (sc.drama.imagePaths || []).map(p => ({ imageLocalPath: p })) : (Array.isArray(sc.images) ? sc.images : []),
        startedAt: Date.now(),
        timeoutMin: 4
      };

      try {
        files = await dispatchTask(task, {
          page,
          accountId,
          outputDir: scenesOutDir,
          loadImage: loadImageAttachment,
          isLive: () => true,
          update: (st) => {
            if (st?.step) {
              onProgress({
                step: `[Cảnh ${i + 1}/${scenes.length}] ${st.step}`,
                pct: Math.round(12 + (((i + 0.5) / scenes.length) * 80)),
                sceneIndex: i
              });
            }
          }
        });
        if (Array.isArray(files) && files.length > 0 && fs.existsSync(files[0])) {
          break;
        }
      } catch (err) {
        lastErr = err;
        console.warn(`[ai-video-engine] Cảnh ${i + 1} lỗi ở lần thử ${attempt}:`, err.message);
      }
    }

    if (Array.isArray(files) && files.length > 0 && fs.existsSync(files[0])) {
      try {
        fs.copyFileSync(files[0], destFile);
        generatedVideoPaths.push(destFile);
      } catch (_) {
        generatedVideoPaths.push(files[0]);
      }
    } else {
      throw lastErr || new Error(`Cảnh ${i + 1} không trả về file video từ ${provider}`);
    }
  }

  onProgress({
    step: `Đã tạo xong ${generatedVideoPaths.length}/${scenes.length} cảnh Video AI tại ${scenesOutDir}`,
    pct: 100,
    files: generatedVideoPaths
  });

  return {
    ok: true,
    provider,
    scenesOutDir,
    files: generatedVideoPaths,
    sceneVideos: generatedVideoPaths,
    count: generatedVideoPaths.length,
    message: `Đã tạo thành công ${generatedVideoPaths.length} video cảnh AI mới tại ${scenesOutDir}`
  };
}

async function closeAllAiBrowsers() {
  for (const { page } of pagesCache.values()) {
    try { await page.chrome?.close(); } catch (_) {}
  }
  pagesCache.clear();
}

module.exports = {
  buildStrict20RulePrompt,
  generateAiVideoForScenes,
  closeAllAiBrowsers,
  getAccountsList,
  getProfilesRoot,
  getPageForProvider
};
