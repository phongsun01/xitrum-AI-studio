const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');
const h264 = require('../h264');

function getFfmpegPath() {
  const dirs = [
    path.resolve(__dirname, '..', '..', 'bin', 'ffmpeg.exe'),
    process.resourcesPath && path.join(process.resourcesPath, 'bin', 'ffmpeg.exe')
  ].filter(Boolean);
  for (const p of dirs) {
    if (fs.existsSync(p)) return p;
  }
  return 'ffmpeg';
}

function getFfprobePath() {
  const dirs = [
    path.resolve(__dirname, '..', '..', 'bin', 'ffprobe.exe'),
    process.resourcesPath && path.join(process.resourcesPath, 'bin', 'ffprobe.exe')
  ].filter(Boolean);
  for (const p of dirs) {
    if (fs.existsSync(p)) return p;
  }
  return 'ffprobe';
}

/**
 * Trích xuất bộ ảnh缩略 (Filmstrip Thumbnails) & biên độ sóng âm (Audio Waveform Peaks) thật từ video
 * dùng cho Timeline (toolkit-review-frames / toolkit-review-peaks)
 */
async function extractTimelineData(videoPath, duration, hasAudio, count = 14, peakCount = 96) {
  const ffmpeg = getFfmpegPath();
  const safeDur = Math.max(1, Number(duration) || 10);
  const tmpDir = path.join(os.tmpdir(), `sesame_strip_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const framesPromise = new Promise((resolve) => {
    const fpsVal = Math.max(0.15, count / safeDur).toFixed(4);
    const outPattern = path.join(tmpDir, 'thumb_%03d.jpg');
    execFile(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-i', videoPath,
      '-vf', `fps=${fpsVal},scale=96:60:force_original_aspect_ratio=increase,crop=96:60`,
      '-frames:v', String(count),
      '-q:v', '6',
      outPattern
    ], { windowsHide: true, timeout: 15000 }, () => {
      try {
        const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.jpg')).sort();
        const urls = files.map(f => {
          const buf = fs.readFileSync(path.join(tmpDir, f));
          return `data:image/jpeg;base64,${buf.toString('base64')}`;
        });
        resolve(urls);
      } catch (_) {
        resolve([]);
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
      }
    });
  });

  const peaksPromise = new Promise((resolve) => {
    if (!hasAudio) {
      return resolve(Array.from({ length: peakCount }, () => 0.05));
    }
    const p = spawn(ffmpeg, [
      '-hide_banner', '-loglevel', 'error',
      '-i', videoPath,
      '-vn', '-ac', '1', '-ar', '2000', '-f', 's16le', '-'
    ], { windowsHide: true });
    const chunks = [];
    p.stdout.on('data', d => chunks.push(d));
    p.on('close', () => {
      try {
        const buf = Buffer.concat(chunks);
        const samples = Math.floor(buf.length / 2);
        if (samples < peakCount) {
          return resolve(Array.from({ length: peakCount }, () => 0.05));
        }
        const step = Math.max(1, Math.floor(samples / peakCount));
        const raw = [];
        let maxPeak = 1;
        for (let i = 0; i < peakCount; i++) {
          let sum = 0, n = 0;
          const start = i * step;
          const end = Math.min(samples, start + step);
          for (let j = start; j < end; j += 2) {
            const v = Math.abs(buf.readInt16LE(j * 2));
            sum += v;
            n++;
          }
          const avg = n ? sum / n : 0;
          if (avg > maxPeak) maxPeak = avg;
          raw.push(avg);
        }
        resolve(raw.map(v => Math.max(0.12, Math.min(0.98, Number((v / maxPeak).toFixed(2))))));
      } catch (_) {
        resolve(Array.from({ length: peakCount }, () => 0.05));
      }
    });
    p.on('error', () => {
      resolve(Array.from({ length: peakCount }, () => 0.05));
    });
  });

  const [frames, peaks] = await Promise.all([framesPromise, peaksPromise]);
  return { frames, peaks };
}

/**
 * Lấy thông số chi tiết video (width, height, fps, duration, sizeMB, codec, hasAudio, frames, peaks)
 */
async function probeVideo(videoPath, opts = {}) {
  if (!videoPath || !fs.existsSync(videoPath)) {
    return { ok: false, error: 'Không tìm thấy file video: ' + (videoPath || '') };
  }
  const ffprobe = getFfprobePath();
  const args = [
    '-v', 'error',
    '-show_entries', 'stream=index,codec_type,codec_name,width,height,r_frame_rate,duration,bit_rate',
    '-show_entries', 'format=duration,size',
    '-of', 'json',
    videoPath
  ];

  return new Promise((resolve) => {
    execFile(ffprobe, args, { windowsHide: true }, async (err, stdout) => {
      if (err) {
        return resolve({ ok: false, error: err.message });
      }
      try {
        const info = JSON.parse(stdout);
        const streams = info.streams || [];
        const vStream = streams.find(s => s.codec_type === 'video') || streams[0] || {};
        const aStream = streams.find(s => s.codec_type === 'audio');
        const fmt = info.format || {};
        const duration = parseFloat(fmt.duration || vStream.duration || 0);
        let fpsNum = 30;
        if (vStream.r_frame_rate && vStream.r_frame_rate.includes('/')) {
          const [n, d] = vStream.r_frame_rate.split('/').map(Number);
          if (d > 0) fpsNum = Math.round((n / d) * 10) / 10;
        }
        const hasAudio = Boolean(aStream);
        let frames = [];
        let peaks = [];
        if (!opts.skipTimeline) {
          const tl = await extractTimelineData(videoPath, duration, hasAudio);
          frames = tl.frames;
          peaks = tl.peaks;
        }
        resolve({
          ok: true,
          videoPath,
          fileName: path.basename(videoPath),
          width: vStream.width || 0,
          height: vStream.height || 0,
          fps: fpsNum,
          fpsRaw: vStream.r_frame_rate || '30/1',
          codec: vStream.codec_name || 'h264',
          hasAudio,
          duration: Math.round(duration * 100) / 100,
          sizeMB: ((Number(fmt.size) || 0) / (1024 * 1024)).toFixed(2),
          frames,
          peaks
        });
      } catch (parseErr) {
        resolve({ ok: false, error: parseErr.message });
      }
    });
  });
}

/**
 * Dò điểm chuyển cảnh tự động bằng FFmpeg select='gt(scene,threshold)',showinfo
 */
async function detectScenes(videoPath, threshold = 0.35) {
  const probe = await probeVideo(videoPath, { skipTimeline: true });
  if (!probe.ok) return probe;

  const ffmpeg = getFfmpegPath();
  const safeThreshold = Math.max(0.08, Math.min(0.9, Number(threshold) || 0.35));
  const args = [
    '-hide_banner',
    '-i', videoPath,
    '-vf', `select='gt(scene,${safeThreshold})',showinfo`,
    '-an',
    '-f', 'null',
    '-'
  ];

  return new Promise((resolve) => {
    const p = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = '';
    p.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    p.on('close', () => {
      const rawTimes = [];
      const regex = /pts_time:\s*([0-9]+(?:\.[0-9]+)?)/g;
      let match;
      while ((match = regex.exec(stderr)) !== null) {
        const t = parseFloat(match[1]);
        if (Number.isFinite(t)) rawTimes.push(t);
      }
      // Lọc các mốc cách đầu/cuối ít nhất 1.0s và cách nhau ít nhất 1.2s
      const filtered = [];
      for (const t of rawTimes) {
        if (t < 1.0 || t > probe.duration - 1.0) continue;
        if (filtered.length === 0 || t - filtered[filtered.length - 1] >= 1.2) {
          filtered.push(Math.round(t * 10) / 10);
        }
      }
      resolve({
        ok: true,
        videoPath,
        duration: probe.duration,
        threshold: safeThreshold,
        sceneCuts: filtered,
        segmentCount: filtered.length + 1
      });
    });
    p.on('error', (err) => {
      resolve({ ok: false, error: err.message, sceneCuts: [] });
    });
  });
}

/**
 * Lập kế hoạch các đoạn cắt 
 */
function planSegments({ duration, mode = 'parts', parts = 3, segmentSeconds = 10, markers = [], sceneCuts = [] }) {
  const total = Math.max(0.1, Number(duration) || 0);
  const ranges = [];

  if (mode === 'parts') {
    const count = Math.max(2, Math.min(50, Math.round(Number(parts) || 3)));
    const step = total / count;
    for (let i = 0; i < count; i++) {
      const start = Math.round(i * step * 100) / 100;
      const end = i === count - 1 ? total : Math.round((i + 1) * step * 100) / 100;
      if (end - start >= 0.3) {
        ranges.push({ index: i + 1, startSec: start, endSec: end, duration: Math.round((end - start) * 100) / 100 });
      }
    }
  } else if (mode === 'duration') {
    const segLen = Math.max(1, Number(segmentSeconds) || 10);
    let cur = 0;
    let idx = 1;
    while (cur < total - 0.2) {
      let next = Math.min(total, Math.round((cur + segLen) * 100) / 100);
      // Nếu phần dư cuối cùng quá ngắn (< 0.8s) thì gộp luôn vào phần hiện tại
      if (total - next < 0.8) {
        next = total;
      }
      ranges.push({ index: idx, startSec: cur, endSec: next, duration: Math.round((next - cur) * 100) / 100 });
      cur = next;
      idx++;
    }
  } else if (mode === 'scene' || mode === 'markers') {
    const rawPoints = (mode === 'scene' ? sceneCuts : markers) || [];
    const points = rawPoints
      .map(Number)
      .filter(t => Number.isFinite(t) && t >= 0.5 && t <= total - 0.5)
      .sort((a, b) => a - b);

    const uniquePoints = [];
    for (const pt of points) {
      if (uniquePoints.length === 0 || pt - uniquePoints[uniquePoints.length - 1] >= 0.5) {
        uniquePoints.push(Math.round(pt * 100) / 100);
      }
    }

    const boundaries = [0, ...uniquePoints, total];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const s = boundaries[i];
      const e = boundaries[i + 1];
      if (e - s >= 0.3) {
        ranges.push({ index: i + 1, startSec: s, endSec: e, duration: Math.round((e - s) * 100) / 100 });
      }
    }
  }

  return ranges;
}

/** Thời điểm các khung hình khoá (keyframe) của video, tăng dần (giây). */
function getKeyframeTimes(videoPath) {
  return new Promise(resolve => {
    execFile(getFfprobePath(), ['-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', videoPath],
      { windowsHide: true, maxBuffer: 1 << 26, timeout: 120000 }, (err, stdout) => {
        if (err) return resolve([]);
        const t = String(stdout).split(/\r?\n/).map(s => parseFloat(s)).filter(Number.isFinite).sort((a, b) => a - b);
        resolve(t);
      });
  });
}

/**
 * Căn kế hoạch cắt vào khung hình khoá gần nhất (cần cho stream copy). Trả về các đoạn đã căn + cảnh báo độ lệch.
 * Mốc trùng nhau sau khi căn thì gộp (nguồn không đủ keyframe thì giảm số phần).
 */
function snapPlanToKeyframes(planned, kfs, duration) {
  const warnings = [];
  if (!kfs.length) return { segments: planned, warnings: ['Không đọc được khung hình khoá — cắt theo thời gian, có thể lệch.'] };
  const nearest = t => kfs.reduce((b, k) => (Math.abs(k - t) < Math.abs(b - t) ? k : b), kfs[0]);
  const bounds = [0];
  for (let i = 1; i < planned.length; i++) {
    const want = planned[i].startSec;
    const k = nearest(want);
    const shift = Math.round((k - want) * 100) / 100;
    if (Math.abs(shift) > 0.05) warnings.push(`Mốc ${want}s căn vào khung hình khoá ${k.toFixed(2)}s (lệch ${shift > 0 ? '+' : ''}${shift}s)`);
    if (k > bounds[bounds.length - 1] + 0.3 && k < duration - 0.3) bounds.push(Math.round(k * 1000) / 1000);
    else warnings.push(`Mốc ${want}s bị gộp vì khung hình khoá quá gần mốc khác`);
  }
  bounds.push(duration);
  const segments = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const s = bounds[i], e = bounds[i + 1];
    segments.push({ index: i + 1, startSec: s, endSec: e, duration: Math.round((e - s) * 100) / 100 });
  }
  return { segments, warnings };
}

/**
 * Cắt 1 đoạn video với tùy chọn Stream Copy hoặc Re-encode (kèm tốc độ, lật hình, tỷ lệ khung hình)
 */
async function cutSingleSegment(videoPath, startSec, endSec, outputPath, opts = {}) {
  const ffmpeg = getFfmpegPath();
  const rawDuration = Math.max(0.2, endSec - startSec);
  const speed = Math.max(0.5, Math.min(2.0, Number(opts.speed) || 1.0));
  const flipH = Boolean(opts.flipH);
  const flipV = Boolean(opts.flipV);
  const rotate = Number(opts.rotate) || 0;
  const origVolume = opts.origVolume != null ? Math.max(0, Math.min(2, Number(opts.origVolume) / 100)) : 1.0;
  const aspect = opts.aspect || 'source';
  const hasVisualChange = speed !== 1.0 || flipH || flipV || rotate !== 0 || origVolume !== 1.0 || (aspect && aspect !== 'source');
  // forceCopy (cutAndExport khi chỉ cắt): mốc đã được căn đúng vào khung hình khoá → stream copy, không mã hoá lại.
  // Các nơi gọi khác giữ quy tắc cũ: mã hoá lại khi có chỉnh hình/tốc độ hoặc đoạn ngắn (< 25s) để không bị đen hình đầu clip do lệch keyframe.
  const useReencode = !opts.forceCopy && (Boolean(opts.reencode) || hasVisualChange || rawDuration < 25);

  // Stream copy: -ss nhảy về khung hình khoá NẰM TRƯỚC hoặc TẠI mốc. Mốc đã căn vào keyframe nhưng bị làm tròn xuống (vd 18.4333→18.433)
  // sẽ rơi vào keyframe cũ → đoạn dài gần gấp đôi. Nên tìm tới sau keyframe 0.01s (nhỏ hơn 1 khung hình) và bù lại ở -t.
  const copySeek = !useReencode && Number(startSec) > 0 ? 0.01 : 0;
  // -t đặt TRƯỚC -i = giới hạn độ dài NGUỒN đọc vào (không phải độ dài đầu ra). Nếu để sau -i, khi đổi tốc độ (1.5x/0.75x)
  // giới hạn tính theo đầu ra → đoạn bị đọc quá/thiếu nguồn, các phần chồng lấn nội dung (đã đo: 1.5x ra 12.77s thay vì 8.5s).
  const args = ['-y', '-ss', (Number(startSec) + copySeek).toFixed(6)];
  if (!opts.openEnded) args.push('-t', (rawDuration - copySeek).toFixed(6));
  args.push('-i', videoPath);

  if (!useReencode) {
    args.push('-map', '0', '-c', 'copy', '-avoid_negative_ts', 'make_zero', outputPath);
  } else {
    const vFilters = [];
    // Không dùng `vflip`: bộ mã hoá openh264 đi kèm sập ("EncodeFrame failed") với khung hình do vflip tạo ra (đã thử thật).
    // lật dọc = xoay 180° rồi lật ngang; lật ngang + dọc = xoay 180°. Cả hai chỉ dùng transpose/hflip nên mã hoá được.
    if (flipH && flipV) vFilters.push('transpose=1,transpose=1');
    else if (flipV) vFilters.push('transpose=1,transpose=1,hflip');
    else if (flipH) vFilters.push('hflip');
    if (rotate === 90) vFilters.push('transpose=1');
    else if (rotate === 180) vFilters.push('transpose=1,transpose=1');
    else if (rotate === 270) vFilters.push('transpose=2');
    if (aspect === '9:16') {
      vFilters.push('scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black');
    } else if (aspect === '16:9') {
      vFilters.push('scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black');
    } else if (aspect === '1:1') {
      vFilters.push('scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2:black');
    }
    if (speed !== 1.0) {
      vFilters.push(`setpts=${(1 / speed).toFixed(4)}*PTS`);
    }
    vFilters.push('format=yuv420p');

    args.push('-vf', vFilters.join(','));
    const aFilters = [];
    if (speed !== 1.0) aFilters.push(`atempo=${speed.toFixed(2)}`);
    if (origVolume !== 1.0) aFilters.push(`volume=${origVolume.toFixed(2)}`);
    if (aFilters.length) args.push('-af', aFilters.join(','));
    args.push(
      ...h264.h264Args(ffmpeg, { crf: 20, bitrate: '4500k' }),
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outputPath
    );
  }

  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, args, { windowsHide: true });
    let errLog = '';
    p.stderr.on('data', (d) => { errLog += d.toString(); });
    p.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve({ ok: true, outputPath });
      } else {
        reject(new Error(`FFmpeg thoát với mã ${code}: ${errLog.slice(-300)}`));
      }
    });
    p.on('error', reject);
  });
}

/**
 * Cắt video theo khoảng thời gian chính xác (startSec, endSec) - tương thích ngược
 */
async function trimVideo(videoPath, startSec, endSec, outputPath, opts = {}) {
  return cutSingleSegment(videoPath, startSec, endSec, outputPath, opts);
}

/**
 * Cắt và xuất hàng loạt theo (Chia đều / Theo thời lượng / Chuyển cảnh / Theo mốc)
 */
async function cutAndExport(payload = {}, onProgress = null) {
  const {
    videoPath,
    mode = 'parts',
    parts = 3,
    segmentSeconds = 10,
    sceneThreshold = 0.35,
    markers = [],
    reencode = false,
    speed = 1.0,
    aspect = 'source',
    flipH = false,
    flipV = false,
    rotate = 0,
    origVolume = 100,
    outputDir = ''
  } = payload;

  const probe = await probeVideo(videoPath, { skipTimeline: true });
  if (!probe.ok) return probe;

  let sceneCuts = Array.isArray(payload.sceneCuts) ? payload.sceneCuts : [];
  if (mode === 'scene' && sceneCuts.length === 0) {
    if (onProgress) onProgress({ percent: 5, status: 'Đang tự động dò điểm chuyển cảnh trên video...' });
    const detected = await detectScenes(videoPath, sceneThreshold);
    sceneCuts = detected.sceneCuts || [];
    // Không bịa mốc: video 1 cảnh liền mạch thì báo rõ để người dùng chỉnh độ nhạy hoặc chọn chế độ khác.
    if (sceneCuts.length === 0) {
      return { ok: false, error: `Không dò thấy điểm chuyển cảnh nào ở độ nhạy ${sceneThreshold}. Hãy giảm độ nhạy (số nhỏ hơn, ví dụ 0.2) hoặc dùng chế độ Chia đều / Theo mốc.` };
    }
  }
  if (mode === 'markers' && !(Array.isArray(markers) && markers.length)) {
    return { ok: false, error: 'Chế độ Theo mốc: chưa đặt mốc nào (sẽ xuất 0 video). Đặt playhead rồi bấm ⚑ Cắm mốc, hoặc nhấp đúp lên thước thời gian.' };
  }

  const planned = planSegments({
    duration: probe.duration,
    mode,
    parts,
    segmentSeconds,
    markers,
    sceneCuts
  });

  if (planned.length === 0) {
    return { ok: false, error: 'Chưa có mốc cắt hợp lệ. Hãy chọn chế độ cắt hoặc đặt ít nhất 1 mốc trên thanh thời gian.' };
  }

  // Chỉ cắt (không lật/xoay/tỉ lệ/tốc độ/âm lượng) → stream copy, mốc căn vào khung hình khoá.
  // Có chỉnh sửa → mã hoá lại H.264, cắt đúng theo mốc đã chọn.
  const hasEdits = Boolean(reencode) || Number(speed) !== 1 || Boolean(flipH) || Boolean(flipV) || (Number(rotate) || 0) !== 0
    || (aspect && aspect !== 'source') || Number(origVolume) !== 100;
  const warnings = [];
  let segments = planned;
  let method = 'reencode';
  if (!hasEdits) {
    method = 'copy';
    if (onProgress) onProgress({ percent: 6, status: 'Đang đọc khung hình khoá (keyframe) để căn mốc cắt...' });
    const kfs = await getKeyframeTimes(videoPath);
    const snapped = snapPlanToKeyframes(planned, kfs, probe.duration);
    segments = snapped.segments;
    warnings.push(...snapped.warnings);
    if (!segments.length) {
      return { ok: false, error: 'Nguồn không đủ khung hình khoá (keyframe) để chia theo yêu cầu. Hãy giảm số phần, tăng độ dài mỗi phần, hoặc bật một tuỳ chỉnh (ví dụ tốc độ) để app mã hoá lại và cắt đúng mốc.' };
    }
  }

  const rawStem = path.basename(videoPath, path.extname(videoPath)).replace(/[^\w\u00C0-\u1EF9\-]+/g, '_');
  const baseOutRoot = outputDir || path.dirname(videoPath);
  const subFolderName = `${rawStem}_Cut`;
  // flat: xuất thẳng vào thư mục xuất (Kho video) để các phần mới thay cho video gốc
  const finalOutDir = payload.flat ? baseOutRoot
    : (path.basename(baseOutRoot) === subFolderName ? baseOutRoot : path.join(baseOutRoot, subFolderName));
  fs.mkdirSync(finalOutDir, { recursive: true });
  // Không ghi đè file đã có: nếu trùng tên thì thêm hậu tố _2, _3…
  let suffix = '';
  for (let n = 2; segments.some(s => fs.existsSync(path.join(finalOutDir, `${rawStem}_Phan_${String(s.index).padStart(2, '0')}${suffix}.mp4`))); n++) suffix = '_' + n;

  const outputs = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const partNo = String(seg.index).padStart(2, '0');
    const outName = `${rawStem}_Phan_${partNo}${suffix}.mp4`;
    const outPath = path.join(finalOutDir, outName);

    const pctStart = Math.round((i / segments.length) * 90) + 5;
    if (onProgress) {
      onProgress({
        percent: pctStart,
        status: `Đang cắt phần ${i + 1}/${segments.length} (${seg.startSec.toFixed(1)}s → ${seg.endSec.toFixed(1)}s)${method === 'copy' ? ' · giữ nguyên chất lượng' : ' · mã hoá lại'}...`
      });
    }

    await cutSingleSegment(videoPath, seg.startSec, seg.endSec, outPath, {
      reencode,
      speed,
      aspect,
      flipH,
      flipV,
      rotate,
      origVolume,
      forceCopy: method === 'copy',
      openEnded: method === 'copy' && i === segments.length - 1 && seg.endSec >= probe.duration - 0.05
    });

    const segProbe = await probeVideo(outPath, { skipTimeline: true });
    outputs.push({
      index: seg.index,
      label: `Phần ${partNo}`,
      path: outPath,
      fileName: outName,
      startSec: seg.startSec,
      endSec: seg.endSec,
      duration: segProbe.ok ? segProbe.duration : seg.duration,
      sizeMB: segProbe.ok ? segProbe.sizeMB : '0.00',
      width: segProbe.ok ? segProbe.width : probe.width,
      height: segProbe.ok ? segProbe.height : probe.height
    });
  }

  if (onProgress) {
    onProgress({
      percent: 100,
      status: `Đã xuất ${outputs.length} video riêng biệt vào ${finalOutDir}`
    });
  }

  return {
    ok: true,
    videoPath,
    outDir: finalOutDir,
    mode,
    sceneCuts,
    method,
    warnings,
    count: outputs.length,
    outputs
  };
}

/**
 * Ghép nhiều đoạn video đã cắt thành 1 video hoàn chỉnh (100% offline bằng FFmpeg)
 */
async function mergeCutVideos(videoPaths = [], outputPath = '') {
  const validPaths = (videoPaths || []).filter(p => p && fs.existsSync(p));
  if (validPaths.length < 2) {
    return { ok: false, error: 'Cần chọn ít nhất 2 đoạn video để ghép nối.' };
  }
  const ffmpeg = getFfmpegPath();
  const outDir = outputPath ? path.dirname(outputPath) : path.dirname(validPaths[0]);
  const finalOut = outputPath || path.join(outDir, `Ghep_${ validPaths.length }_Doan_${ Date.now() }.mp4`);
  const listFile = path.join(outDir, `.concat_${Date.now()}.txt`);

  const listContent = validPaths
    .map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
    .join('\n');
  fs.writeFileSync(listFile, listContent, 'utf8');

  const args = [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', listFile,
    ...h264.h264Args(ffmpeg, { crf: 20, bitrate: '4500k' }),
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    finalOut
  ];

  return new Promise((resolve) => {
    const p = spawn(ffmpeg, args, { windowsHide: true });
    let errLog = '';
    p.stderr.on('data', d => { errLog += d.toString(); });
    p.on('close', async (code) => {
      try { fs.unlinkSync(listFile); } catch (_) {}
      if (code === 0 && fs.existsSync(finalOut)) {
        const probe = await probeVideo(finalOut);
        resolve({
          ok: true,
          outputPath: finalOut,
          fileName: path.basename(finalOut),
          duration: probe.ok ? probe.duration : 0,
          sizeMB: probe.ok ? probe.sizeMB : '0.00',
          width: probe.ok ? probe.width : 1080,
          height: probe.ok ? probe.height : 1920
        });
      } else {
        resolve({ ok: false, error: `Ghép video thất bại (mã ${code}): ${errLog.slice(-250)}` });
      }
    });
    p.on('error', (err) => {
      try { fs.unlinkSync(listFile); } catch (_) {}
      resolve({ ok: false, error: err.message });
    });
  });
}

/**
 * Chia video thành nhiều đoạn bằng nhau (Tương thích ngược)
 */
async function splitVideoIntoSegments(videoPath, segmentSeconds = 60, outputDir = '') {
  const res = await cutAndExport({
    videoPath,
    mode: 'duration',
    segmentSeconds,
    outputDir
  });
  if (!res.ok) throw new Error(res.error);
  return {
    ok: true,
    parts: res.outputs.map(o => o.path),
    outputs: res.outputs,
    outDir: res.outDir,
    count: res.count
  };
}

module.exports = {
  probeVideo,
  detectScenes,
  planSegments,
  trimVideo,
  cutAndExport,
  mergeCutVideos,
  splitVideoIntoSegments
};
