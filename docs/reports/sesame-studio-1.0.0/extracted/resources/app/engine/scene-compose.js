/**
 * DỰNG HẬU KỲ THEO TỪNG CẢNH (hình khớp tiếng của chính cảnh đó)
 *
 * Khác với lồng giọng lên video đã ghép sẵn (giọng nối liền, phụ đề tính theo giọng, giọng phải tăng tốc khi dài hơn video):
 *  - Mỗi cảnh có độ dài = lời đọc của cảnh + 0,45s thở.
 *  - Clip dài hơn lời đọc thì cắt; ngắn hơn thì làm chậm tối đa 1,25 lần, còn thiếu thì giữ khung cuối. Không bao giờ tăng tốc giọng.
 *  - Phụ đề căn theo từng cảnh nên luôn khớp hình.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const vt = require('./vieneu-tts');
const merger = require('./merge');
const { h264Args } = require('./h264');

const FPS = 30;
const PAD_SEC = 0.45;      // khoảng thở sau câu đọc
const MIN_SCENE_SEC = 3.0; // không để cảnh quá ngắn
const MAX_SLOW = 1.25;     // làm chậm clip tối đa
const SUB_MAX_CHARS = 78;  // một lượt phụ đề tối đa ~2 dòng

/** Quyết định cách khớp một clip với lời đọc. */
function planScene(srcDur, voiceDur, plannedSec) {
  // plannedSec: thời lượng đạo diễn đã lên kế hoạch (beat theo giây). Không cắt ngắn hơn, để không mất beat.
  const target = Math.max(MIN_SCENE_SEC, (Number(voiceDur) || 0) + PAD_SEC, Number(plannedSec) || 0);
  let src = Number(srcDur) || 0;
  if (src <= 0) src = target;
  if (src >= target) return { target, ratio: 1, freeze: 0, action: 'trim' };
  const ratio = Math.min(MAX_SLOW, target / src);
  const freeze = Math.max(0, target - src * ratio);
  return { target, ratio, freeze, action: freeze > 0.02 ? 'slow+freeze' : 'slow' };
}

/** Cắt lời bình dài thành các lượt phụ đề ngắn, chia thời gian theo độ dài chữ. */
function splitSubtitleParts(text, start, dur) {
  const full = String(text || '').replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
  if (!full) return [];
  const parts = full.length > SUB_MAX_CHARS ? full.split(/(?<=[,.;!?…—])\s+/).filter(Boolean) : [full];
  if (parts.length === 1) return [{ start, end: start + dur, text: parts[0] }];
  const total = parts.reduce((a, p) => a + p.length, 0) || 1;
  const out = [];
  let cur = start;
  parts.forEach((p, i) => {
    const d = i === parts.length - 1 ? start + dur - cur : Math.max(0.9, (p.length / total) * dur);
    out.push({ start: Number(cur.toFixed(2)), end: Number(Math.min(start + dur, cur + d).toFixed(2)), text: p });
    cur += d;
  });
  return out;
}

function probeVideo(ffprobe, file) {
  return new Promise(resolve => {
    execFile(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file],
      { timeout: 15000, windowsHide: true }, (err, out) => {
        if (err) return resolve({ duration: 0, width: 0, height: 0, hasAudio: false });
        try {
          const j = JSON.parse(out || '{}');
          const v = (j.streams || []).find(s => s.codec_type === 'video') || {};
          resolve({ duration: parseFloat(j.format?.duration) || 0, width: v.width || 0, height: v.height || 0, hasAudio: (j.streams || []).some(s => s.codec_type === 'audio') });
        } catch (_) { resolve({ duration: 0, width: 0, height: 0, hasAudio: false }); }
      });
  });
}

function outputSize(w, h) {
  if (!w || !h) return { W: 1080, H: 1920 };
  if (h > w * 1.1) return { W: 1080, H: 1920 };
  if (w > h * 1.1) return { W: 1920, H: 1080 };
  return { W: 1080, H: 1080 };
}

/** Các đoạn có tiếng nói trong file giọng đọc (tách theo quãng im thật). */
function detectSpeechSegments(ffmpeg, file, totalDur) {
  return new Promise(resolve => {
    execFile(ffmpeg, ['-hide_banner', '-nostdin', '-i', file, '-af', 'silencedetect=noise=-38dB:d=0.14', '-f', 'null', '-'],
      { timeout: 30000, windowsHide: true, maxBuffer: 1 << 22 }, (_err, _out, stderr) => {
        const text = String(stderr || '');
        const starts = [...text.matchAll(/silence_start:\s*(-?[\d.]+)/g)].map(m => Math.max(0, parseFloat(m[1])));
        const ends = [...text.matchAll(/silence_end:\s*([\d.]+)/g)].map(m => parseFloat(m[1]));
        const segs = [];
        let cur = 0;
        starts.forEach((st, i) => {
          if (st - cur > 0.12) segs.push({ start: cur, end: st });
          cur = ends[i] != null ? ends[i] : totalDur;
        });
        if (totalDur - cur > 0.12) segs.push({ start: cur, end: totalDur });
        resolve(segs);
      });
  });
}

/** Cắt lời thành các cụm theo dấu câu; cụm quá ngắn gộp với cụm sau. */
function splitPhrases(text) {
  const raw = String(text || '').replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim().split(/(?<=[,.;!?…—:])\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    let p = raw[i];
    while (p.length < 14 && i + 1 < raw.length) { p += ' ' + raw[++i]; }
    out.push(p);
  }
  return out;
}

/**
 * Căn từng cụm vào đoạn tiếng nói thật. Số đoạn khác số cụm thì gộp đoạn cách nhau ngắn nhất;
 * vẫn không khớp thì quay về chia theo độ dài chữ. Trả về các mục phụ đề thời gian tuyệt đối.
 */
function alignPhraseEntries(text, segments, voiceDur, sceneStart, sceneDur) {
  const phrases = splitPhrases(text);
  if (!phrases.length) return [];
  let segs = segments.map(x => ({ ...x }));
  while (segs.length > phrases.length && segs.length > 1) {
    let k = 0, best = Infinity;
    for (let i = 0; i < segs.length - 1; i++) { const gap = segs[i + 1].start - segs[i].end; if (gap < best) { best = gap; k = i; } }
    segs.splice(k, 2, { start: segs[k].start, end: segs[k + 1].end });
  }
  if (segs.length !== phrases.length) return splitSubtitleParts(text, sceneStart, sceneDur); // không khớp: cách cũ
  const out = [];
  phrases.forEach((p, i) => {
    const st = i === 0 ? 0 : segs[i].start - Math.min(0.08, (segs[i].start - segs[i - 1].end) / 2);
    const en = i === phrases.length - 1 ? sceneDur : segs[i + 1].start - Math.min(0.08, (segs[i + 1].start - segs[i].end) / 2);
    out.push(...splitSubtitleParts(p, Number((sceneStart + Math.max(0, st)).toFixed(2)), Math.max(0.6, en - Math.max(0, st))));
  });
  return out;
}

const escFilterPath = p => p.replace(/\\/g, '/').replace(/:/g, '\\:');

/** Bóc tách các câu thoại phân vai từ cảnh (nếu có) */
function parseDialogueTurns(sc = {}) {
  const dlg = sc.dialogue || sc.drama?.dialogue || [];
  if (!Array.isArray(dlg) || !dlg.length) return null;
  return dlg.map(d => {
    if (typeof d === 'string') {
      const m = d.match(/^([^:]+):\s*(.+)$/);
      if (m) return { speaker: m[1].trim(), text: m[2].trim() };
      return { speaker: '', text: d.trim() };
    }
    return { speaker: d.speaker || d.castId || d.character || '', text: String(d.text || '').trim(), voice: d.voice || '' };
  }).filter(t => t.text);
}

/** Giọng do người dùng gán theo nhân vật; không ép tên hay giới tính vào vài giọng mặc định. */
function resolveSpeakerVoice(speaker, charVoices = {}, defaultVoice = 'Quỳnh Anh') {
  const key = String(speaker || '').trim().toLocaleLowerCase('vi');
  if (key) {
    for (const [name, voice] of Object.entries(charVoices || {})) {
      if (name.trim().toLocaleLowerCase('vi') === key && String(voice || '').trim()) {
        return vt.cleanVieneuVoiceName(voice);
      }
    }
  }
  return defaultVoice;
}

async function composeScenesWithVoice({
  videos = [],
  scenes = [],
  voice = 'Quỳnh Anh',
  charVoices = {},
  speed = 1.03,
  keepAmbient = true,
  ambientVolume = 0.2,
  burnSubtitles = true,
  subtitleStyle = 'storytelling',
  outDir = '',
  outName = '',
  synth = vt.synthesizeBatchSpeech, // chỉ để kiểm thử
  onProgress = () => {}
} = {}) {
  const files = videos.filter(p => typeof p === 'string' && fs.existsSync(p));
  if (!files.length || files.length !== videos.length) throw new Error('Thiếu file video của một số cảnh');

  let voiceName = vt.cleanVieneuVoiceName(voice);
  if (/^(vieneu:)?(rotate|auto|ngẫu nhiên|luân phiên)$/i.test(String(voice || '').trim())) {
    let h = 0; const seed = String(files[0]);
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    voiceName = vt.VIENEU_VOICES[h % vt.VIENEU_VOICES.length].name;
  }

  const ffmpeg = vt.resolveFfmpegBin('ffmpeg');
  const ffprobe = vt.resolveFfmpegBin('ffprobe');
  const targetDir = outDir || path.dirname(files[0]);
  fs.mkdirSync(targetDir, { recursive: true });
  const work = path.join(os.tmpdir(), `sesame_scene_compose_${Date.now()}`);
  fs.mkdirSync(work, { recursive: true });

  try {
    // 1. Thu giọng toàn bộ cảnh: hỗ trợ cả lời bình (narration) và thoại phân vai đa giọng (multivoice)
    const voiceFiles = [];
    const synthItems = [];
    const sceneDialogueMap = [];
    const narrations = [];

    for (let i = 0; i < files.length; i++) {
      const sc = scenes[i] || {};
      const dlg = parseDialogueTurns(sc);
      const vPath = path.join(work, `voice_${i}.wav`);
      voiceFiles.push(vPath);

      if (dlg && dlg.length) {
        const turnItems = [];
        dlg.forEach((turn, k) => {
          const tVoice = turn.voice ? vt.cleanVieneuVoiceName(turn.voice) : resolveSpeakerVoice(turn.speaker, charVoices, voiceName);
          const tPath = path.join(work, `dlg_${i}_${k}.wav`);
          const item = { text: turn.text, voice: tVoice, outPath: tPath, speaker: turn.speaker };
          synthItems.push(item);
          turnItems.push(item);
        });
        sceneDialogueMap[i] = turnItems;
        narrations[i] = '';
      } else {
        const text = vt.extractCleanNarrationFromScene(sc);
        narrations[i] = text;
        if (text) {
          synthItems.push({ text, voice: voiceName, outPath: vPath, sceneIdx: i });
        }
        sceneDialogueMap[i] = null;
      }
    }

    if (!synthItems.length) throw new Error('Không có lời đọc hoặc câu thoại cho cảnh nào');

    onProgress({ step: `Đang thu ${synthItems.length} đoạn giọng đọc VieNeu-TTS...`, pct: 8 });
    await synth(synthItems, { speed });

    // Ghép các câu thoại thành file voice_i.wav cho từng cảnh thoại
    for (let i = 0; i < files.length; i++) {
      const turns = sceneDialogueMap[i];
      if (turns && turns.length) {
        const validTurns = turns.filter(t => fs.existsSync(t.outPath) && fs.statSync(t.outPath).size > 200);
        if (validTurns.length === 1) {
          fs.copyFileSync(validTurns[0].outPath, voiceFiles[i]);
        } else if (validTurns.length > 1) {
          const concatInputs = validTurns.flatMap(t => ['-i', t.outPath]);
          const filterArr = validTurns.map((_, idx) => `[${idx}:a]apad=pad_dur=0.15[a${idx}]`).join(';');
          const concatStr = validTurns.map((_, idx) => `[a${idx}]`).join('') + `concat=n=${validTurns.length}:v=0:a=1[aout]`;
          await vt.runFfmpeg([
            ...concatInputs, '-filter_complex', `${filterArr};${concatStr}`, '-map', '[aout]',
            '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', voiceFiles[i]
          ]);
        }
      }
    }

    // 2. Khổ hình theo cảnh đầu
    const first = await probeVideo(ffprobe, files[0]);
    const { W, H } = outputSize(first.width, first.height);

    // 3. Dựng từng cảnh
    const clips = [];
    const subtitles = [];
    let cursor = 0;
    for (let i = 0; i < files.length; i++) {
      const meta = await probeVideo(ffprobe, files[i]);
      const vDur = fs.existsSync(voiceFiles[i]) ? ((await vt.probeDuration(voiceFiles[i])) || 0) : 0;
      const planned = Number((scenes[i] || {}).seconds) || 0;
      const plan = fs.existsSync(voiceFiles[i]) ? planScene(meta.duration, vDur, planned) : { target: Math.max(MIN_SCENE_SEC, planned || meta.duration || 5), ratio: 1, freeze: 0, action: 'trim' };
      const T = Number(plan.target.toFixed(3));

      const vf = [
        plan.ratio !== 1 ? `setpts=${plan.ratio.toFixed(4)}*PTS` : null,
        `scale=${W}:${H}:force_original_aspect_ratio=increase`, `crop=${W}:${H}`, `fps=${FPS}`, 'setsar=1',
        plan.freeze > 0.02 ? `tpad=stop_mode=clone:stop_duration=${plan.freeze.toFixed(3)}` : null
      ].filter(Boolean).join(',');

      const inputs = ['-i', files[i]];
      let fc = `[0:v]${vf}[v]`;
      const mix = [];
      let idx = 1;
      if (fs.existsSync(voiceFiles[i])) { inputs.push('-i', voiceFiles[i]); fc += `;[${idx}:a]aresample=48000,apad=whole_dur=${T}[vo]`; mix.push('[vo]'); idx++; }
      if (keepAmbient && meta.hasAudio) {
        fc += `;[0:a]aresample=48000,volume=${ambientVolume},afade=t=in:st=0:d=0.25,atrim=0:${T},afade=t=out:st=${Math.max(0.2, T - 0.4).toFixed(2)}:d=0.4,apad=whole_dur=${T}[amb]`;
        mix.push('[amb]');
      }
      if (!mix.length) { inputs.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'); fc += `;[${idx}:a]atrim=0:${T}[a]`; }
      else if (mix.length === 1) fc += `;${mix[0]}anull[a]`;
      else fc += `;${mix.join('')}amix=inputs=${mix.length}:duration=longest:normalize=0[a]`;

      const clipOut = path.join(work, `clip_${i}.mp4`);
      await vt.runFfmpeg([
        ...inputs, '-filter_complex', fc, '-map', '[v]', '-map', '[a]', '-t', String(T),
        ...h264Args(ffmpeg, { crf: 18 }), '-pix_fmt', 'yuv420p', '-r', String(FPS),
        '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k', clipOut
      ]);
      clips.push(clipOut);

      // Phụ đề: nếu là hội thoại phân vai
      if (sceneDialogueMap[i]) {
        let offset = 0;
        for (const turn of sceneDialogueMap[i]) {
          if (!fs.existsSync(turn.outPath)) continue;
          const turnDur = (await vt.probeDuration(turn.outPath)) || 1.5;
          const st = Number((cursor + offset).toFixed(2));
          const en = Number((cursor + offset + turnDur).toFixed(2));
          const speakerPrefix = turn.speaker ? `[${turn.speaker}]: ` : '';
          subtitles.push({ start: st, end: en, text: speakerPrefix + turn.text });
          offset += turnDur + 0.15;
        }
      } else if (narrations[i]) {
        const segs = fs.existsSync(voiceFiles[i]) ? await detectSpeechSegments(ffmpeg, voiceFiles[i], vDur) : [];
        subtitles.push(...(segs.length ? alignPhraseEntries(narrations[i], segs, vDur, cursor, T) : splitSubtitleParts(narrations[i], cursor, T)));
      }
      cursor += T;
      onProgress({ step: `Dựng cảnh ${i + 1}/${files.length} (${plan.action})`, pct: 12 + Math.round(((i + 1) / files.length) * 60) });
    }

    // 4. Nối cảnh
    const list = path.join(work, 'list.txt');
    fs.writeFileSync(list, clips.map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
    const raw = path.join(work, 'raw.mp4');
    await vt.runFfmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', raw]);

    // 5. Phụ đề + chuẩn hóa âm lượng
    onProgress({ step: 'Đóng phụ đề và chuẩn hóa âm lượng', pct: 82 });
    const baseName = outName ? String(outName).replace(/\.mp4$/i, '') : `${path.basename(files[0], path.extname(files[0])).replace(/[-_ ]*(canh|scene|part)?[-_ ]*\d+$/i, '') || 'video'} - ${voiceName}`;
    const finalPath = merger.safeName(targetDir, baseName);
    const assPath = path.join(work, 'subs.ass');
    const useSubs = burnSubtitles && subtitles.length;
    if (useSubs) vt.buildCinemaAssFile(subtitles, assPath, { styleMode: subtitleStyle });
    const vFilter = useSubs ? `[0:v]ass='${escFilterPath(assPath)}'[vout]` : '[0:v]null[vout]';
    await vt.runFfmpeg([
      '-i', raw, '-filter_complex', `${vFilter};[0:a]loudnorm=I=-15:TP=-1.5:LRA=11[aout]`,
      '-map', '[vout]', '-map', '[aout]', ...h264Args(ffmpeg, { crf: 18 }), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', finalPath
    ]);
    onProgress({ step: 'Xong', pct: 100 });
    return { success: true, path: finalPath, voice: voiceName, duration: Number(cursor.toFixed(2)), scenes: files.length };
  } finally {
    try { fs.rmSync(work, { recursive: true, force: true }); } catch (_) {}
  }
}

module.exports = { composeScenesWithVoice, planScene, splitSubtitleParts, splitPhrases, alignPhraseEntries, detectSpeechSegments, PAD_SEC, MIN_SCENE_SEC, MAX_SLOW };
