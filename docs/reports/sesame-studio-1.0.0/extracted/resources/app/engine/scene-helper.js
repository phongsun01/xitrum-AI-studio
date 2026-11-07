/**
 * SCENE HELPER — Hỗ trợ đồng bộ 100% tính năng của HaoHao (Kịch bản nhiều cảnh, LadiPage,
 * Storyboard, Ảnh sản phẩm từ URL/local, Nhân vật dẫn) sang mọi Engine AI (Muse, Google Flow, Seedance 2.5).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const EXT_MAP = {
  'image/png': 'png',
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif'
};

/**
 * Chuyển đổi danh sách ảnh của task (có thể là đường dẫn local hoặc URL từ LadiPage/API)
 * thành danh sách đường dẫn file thực tế trên ổ cứng để nạp qua CDP DOM.setFileInputFiles.
 */
async function materializeTaskImages(images = [], loadImage = null, tempDir = '') {
  if (!Array.isArray(images) || !images.length) return [];
  const out = [];

  for (let i = 0; i < images.length; i++) {
    const item = images[i];
    if (typeof item === 'string') {
      if (fs.existsSync(item)) out.push(item);
      continue;
    }
    if (item?.imageLocalPath && fs.existsSync(item.imageLocalPath)) {
      out.push(item.imageLocalPath);
      continue;
    }
    if (typeof loadImage === 'function' && (item?.imageUrl || item?.imageLocalPath || item?.imageBase64)) {
      try {
        const { mimeType, dataBase64 } = await loadImage(item);
        if (dataBase64) {
          const dir = tempDir || path.join(os.tmpdir(), 'sesame_temp_refs');
          fs.mkdirSync(dir, { recursive: true });
          const ext = EXT_MAP[mimeType] || 'jpg';
          const filePath = path.join(dir, `ref_${Date.now()}_${i}.${ext}`);
          fs.writeFileSync(filePath, Buffer.from(dataBase64, 'base64'));
          out.push(filePath);
        }
      } catch (e) {
        console.warn('[SceneHelper] Không tải được ảnh tham chiếu:', e.message);
      }
    }
  }

  return out;
}

/**
 * Tách câu lệnh nhiều cảnh (từ Kịch bản / LadiPage / Storyboard của HaoHao) thành từng cảnh độc lập
 * cho các engine render từng clip như Google Flow và Seedance 2.5, sau đó tự động ghép lại bằng ffmpeg.
 */
function splitMultiScenePrompt(prompt, localImages = []) {
  const raw = String(prompt || '').trim();
  if (!raw) return [{ sceneNum: 1, totalScenes: 1, timeRange: '', prompt: '', images: localImages }];

  // Kiểm tra xem có phải lệnh video từ Storyboard không ("Dùng đúng M ảnh storyboard...")
  const isStoryboardVideo = /^Dùng đúng\s+\d+\s+ảnh storyboard/i.test(raw);

  // Tách theo các đoạn cách nhau bởi dòng trống, đồng thời tách các dòng bắt đầu bằng "Cảnh X" hoặc phần kết
  const paragraphs = raw
    .split(/\n\s*\n/)
    .flatMap(p => p.split(/\n(?=\s*Cảnh\s+\d+\b)/i))
    .flatMap(p => p.split(/\n(?=\s*(?:Âm thanh\s*:|Phong cách\s*:|Không chèn chữ|Tránh\s*:|Tự ghép\s+))/i))
    .map(p => p.trim())
    .filter(Boolean);
  const sceneRegex = /^Cảnh\s+(\d+)\s*(?:\(([^)]*)\))?/i;

  const sceneIndices = [];
  paragraphs.forEach((p, idx) => {
    if (sceneRegex.test(p)) sceneIndices.push(idx);
  });

  // Nếu chỉ có 0 hoặc 1 cảnh -> giữ nguyên 1 lệnh duy nhất
  if (sceneIndices.length <= 1) {
    return [{
      sceneNum: 1,
      totalScenes: 1,
      timeRange: '',
      prompt: raw,
      images: localImages
    }];
  }

  const firstSceneIdx = sceneIndices[0];
  const lastSceneIdx = sceneIndices[sceneIndices.length - 1];

  // Phần mở đầu chung (tiền tố, tỉ lệ, sản phẩm, người dẫn...)
  const rawHeader = paragraphs.slice(0, firstSceneIdx).join('\n\n')
    .replace(/Dùng đúng\s+\d+\s+ảnh storyboard[^\n]*\n*/i, 'Giữ nguyên người, trang phục, bối cảnh và sản phẩm đúng như ảnh tham chiếu đính kèm.\n')
    .replace(/tổng\s+\d+s,\s*gồm\s+\d+\s+cảnh/i, 'thời lượng 10s')
    .trim();

  // Phần kết chung (âm thanh, giọng đọc, yêu cầu không chèn phụ đề...)
  const rawFooter = paragraphs.slice(lastSceneIdx + 1).join('\n\n')
    .replace(/Tự ghép[^\n]*\.?/gi, '')
    .trim();

  const totalScenes = sceneIndices.length;

  return sceneIndices.map((pIdx, k) => {
    const block = paragraphs[pIdx];
    const m = sceneRegex.exec(block);
    const sceneNum = m ? parseInt(m[1], 10) : (k + 1);
    const metaParen = m && m[2] ? m[2] : '';

    // Tìm mốc thời gian (VD: "0–10s")
    const timeMatch = metaParen.match(/(\d+\s*[-–—]\s*\d+s?)/i);
    const timeRange = timeMatch ? timeMatch[1].replace(/\s+/g, '') : '';

    // Kiểm tra chỉ định "dùng ảnh X" trong ngoặc của Cảnh
    const imgMatch = metaParen.match(/dùng ảnh\s+(\d+)/i);
    let sceneImages = localImages;

    if (isStoryboardVideo && localImages[k]) {
      // Với Storyboard: mỗi cảnh k dùng đúng ảnh storyboard thứ k làm khung hình mở đầu
      sceneImages = [localImages[k]];
    } else if (imgMatch && localImages.length > 1) {
      const wantIdx = parseInt(imgMatch[1], 10) - 1;
      if (localImages[wantIdx]) {
        sceneImages = [localImages[wantIdx]];
      }
    }

    // Làm sạch dòng tiêu đề Cảnh để gửi cho single-clip generator
    const cleanedBlock = block.replace(/^Cảnh\s+\d+\s*(?:\([^)]*\))?\s*:?\s*\n?/i, '').trim();
    const parts = [
      rawHeader,
      `Cảnh ${sceneNum}/${totalScenes}${timeRange ? ` (${timeRange})` : ''}:\n${cleanedBlock}`,
      rawFooter
    ].filter(Boolean);

    return {
      sceneNum,
      totalScenes,
      timeRange,
      isStoryboardScene: Boolean(isStoryboardVideo && localImages[k]),
      prompt: parts.join('\n\n'),
      images: sceneImages
    };
  });
}

/**
 * Trích xuất khung hình cuối cùng (End-Frame) của video cảnh trước bằng ffmpeg
 * để làm khung hình mở đầu (Start-Frame Continuity Lock) cho cảnh tiếp theo.
 */
function extractVideoEndFrame(videoPath, outDir = '') {
  return new Promise(resolve => {
    if (!videoPath || !fs.existsSync(videoPath)) return resolve(null);
    const { execFile } = require('child_process');
    const merger = require('./merge');
    const ffmpeg = merger.resolveBin('ffmpeg');
    const dir = outDir || path.join(os.tmpdir(), 'sesame_continuity_frames');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    const outPath = path.join(dir, `endframe_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.jpg`);

    // Lấy frame cách cuối video 0.08s để tránh frame đen cuối clip
    execFile(ffmpeg, [
      '-y', '-sseof', '-0.08', '-i', videoPath,
      '-frames:v', '1', '-q:v', '2', outPath
    ], { timeout: 15000 }, err => {
      if (!err && fs.existsSync(outPath) && fs.statSync(outPath).size > 500) {
        return resolve(outPath);
      }
      // Fallback: lấy frame đầu nếu video quá ngắn
      execFile(ffmpeg, [
        '-y', '-ss', '00:00:01', '-i', videoPath,
        '-frames:v', '1', '-q:v', '2', outPath
      ], { timeout: 15000 }, err2 => {
        if (!err2 && fs.existsSync(outPath) && fs.statSync(outPath).size > 500) {
          return resolve(outPath);
        }
        resolve(null);
      });
    });
  });
}

/**
 * Gắn khung hình cuối của cảnh trước vào cảnh tiếp theo kèm chỉ dẫn CONTINUITY LOCK (học từ 26Flow/MuseFlow)
 */
function applySceneContinuity(scene, prevEndFramePath) {
  if (!prevEndFramePath || !fs.existsSync(prevEndFramePath) || scene.isStoryboardScene) {
    return scene;
  }
  const continuityInstruction =
    'CONTINUITY LOCK (KHÓA NỐI CẢNH LIÊN TỤC): Ảnh đính kèm đầu tiên là khung hình cuối cùng chính xác của cảnh trước. ' +
    'Hãy dùng ảnh này làm khung hình mở đầu cho cảnh hiện tại: giữ nguyên danh tính nhân vật, trang phục, tư thế, góc máy, ánh sáng và bối cảnh. ' +
    'Tiếp nối chuyển động mượt mà từ đúng khoảnh khắc đó, không nhảy cảnh hay đổi người đột ngột.';

  const existingImages = Array.isArray(scene.images) ? scene.images : [];
  const mergedImages = [prevEndFramePath, ...existingImages.filter(p => p !== prevEndFramePath)].slice(0, 4);

  return {
    ...scene,
    continuityStartFrame: prevEndFramePath,
    images: mergedImages,
    prompt: `${continuityInstruction}\n\n${scene.prompt}`
  };
}

module.exports = {
  materializeTaskImages,
  splitMultiScenePrompt,
  extractVideoEndFrame,
  applySceneContinuity
};

