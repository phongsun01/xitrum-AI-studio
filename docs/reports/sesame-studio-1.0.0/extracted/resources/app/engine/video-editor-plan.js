/**
 * ĐỒ THỊ DỰNG CHO EDIT/GHÉP (ffmpeg filter_complex_script)
 * Hỗ trợ: cắt vào/ra, tốc độ, âm lượng clip, BỘ LỌC MÀU theo clip, CHUYỂN CẢNH (xfade/acrossfade),
 * chữ, watermark chữ/logo, LỚP PHỦ ảnh/video, CHE SUB (làm mờ/hộp màu), phụ đề .srt,
 * ĐOẠN ÂM THANH (nhạc nền tách đoạn: bắt đầu, vào/ra, fade, âm lượng), giọng lồng,
 * và chế độ xem trước (cùng đồ thị, độ phân giải thấp).
 */
const fs = require('fs');
const path = require('path');

const FONT_BOLD = 'C:/Windows/Fonts/arialbd.ttf';
// Họ font → [thường, đậm, nghiêng, đậm+nghiêng] (chỉ dùng file có thật trong C:/Windows/Fonts; thiếu biến thể thì lùi về bản gần nhất)
const FONT_FAMILIES = {
  'Arial': ['arial', 'arialbd', 'ariali', 'arialbi'],
  'Segoe UI': ['segoeui', 'segoeuib', 'segoeuii', 'segoeuiz'],
  'Times New Roman': ['times', 'timesbd', 'timesi', 'timesbi'],
  'Tahoma': ['tahoma', 'tahomabd', 'tahoma', 'tahomabd'],
  'Verdana': ['verdana', 'verdanab', 'verdanai', 'verdanaz'],
  'Calibri': ['calibri', 'calibrib', 'calibrii', 'calibriz'],
  'Consolas': ['consola', 'consolab', 'consolai', 'consolaz'],
  'Impact': ['impact', 'impact', 'impact', 'impact']
};
function fontFile(family, bold, italic) {
  const fam = FONT_FAMILIES[family];
  if (!fam) return FONT_BOLD;
  const i = (bold ? 1 : 0) + (italic ? 2 : 0);
  for (const k of [i, bold ? 1 : 0, 0]) { const f = 'C:/Windows/Fonts/' + fam[k] + '.ttf'; if (fs.existsSync(f)) return f; }
  return FONT_BOLD;
}
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const round3 = n => Math.round(Number(n) * 1000) / 1000;
const num = (v, d) => (v === undefined || v === null || v === '' || !isFinite(Number(v))) ? d : Number(v);
const esc = p => String(p).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

const TRANSITIONS = ['fade', 'fadeblack', 'dissolve', 'wipeleft', 'wiperight', 'slideleft', 'slideright', 'circleopen', 'circleclose', 'pixelize'];
const PRESETS = {
  none: '',
  bw: 'hue=s=0',
  sepia: 'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131:0',
  warm: 'colorbalance=rs=.12:gs=.02:bs=-.12:rm=.08:bm=-.08',
  cool: 'colorbalance=rs=-.1:bs=.14:rm=-.06:bm=.1',
  // ffmpeg đóng gói trong app KHÔNG có filter `eq` → dùng lutyuv (sáng/tương phản trên kênh Y) + hue (bão hoà)
  vivid: "hue=s=1.45,lutyuv=y='clip((val-128)*1.08+128,0,255)'",
  faded: "hue=s=0.7,lutyuv=y='clip((val-128)*0.92+128+10,0,255)'"
};

function clipLen(c) {
  const sp = clamp(num(c.speed, 1), 0.25, 4);
  return Math.max(0, (num(c.out, 0) - num(c.in, 0)) / sp);
}

/** Thời lượng chuyển cảnh thực dùng cho clip i (i>0): bị chặn để không dài hơn 90% clip ngắn nhất trong cặp. */
function transDur(clips, i) {
  if (i <= 0) return 0;
  const t = clips[i].transition;
  if (!t || !t.type || t.type === 'none' || !TRANSITIONS.includes(t.type)) return 0;
  const d = num(t.dur, 0);
  if (d <= 0) return 0;
  return Math.max(0, Math.min(d, 0.9 * Math.min(clipLen(clips[i - 1]), clipLen(clips[i]))));
}

function totalDuration(p) {
  const clips = (p.clips || []).filter(c => c.path);
  let s = 0;
  clips.forEach((c, i) => { s += clipLen(c); if (i > 0) s -= transDur(clips, i); });
  return round3(Math.max(0, s));
}

/** Lật / xoay hình của một clip (trước khi co về khung xuất). Rỗng nếu không đặt gì. */
function geoFilter(c) {
  const parts = [];
  if (c.flipH) parts.push('hflip');
  if (c.flipV) parts.push('vflip');
  const r = ((num(c.rot, 0) % 360) + 360) % 360;
  if (r === 90) parts.push('transpose=1');
  else if (r === 180) parts.push('hflip,vflip');
  else if (r === 270) parts.push('transpose=2');
  return parts.length ? parts.join(',') + ',' : '';
}

function atempoChain(speed) {
  const parts = []; let s = speed;
  while (s > 2.0) { parts.push('atempo=2.0'); s /= 2.0; }
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  parts.push('atempo=' + s.toFixed(4));
  return parts.join(',');
}

function targetSize(p) {
  const clips = p.clips || [];
  if (p.aspect === '9:16') return [1080, 1920];
  if (p.aspect === '16:9') return [1920, 1080];
  if (p.aspect === '1:1') return [1080, 1080];
  const c0 = clips.find(c => c.width && c.height) || { width: 1080, height: 1920 };
  return [c0.width % 2 ? c0.width - 1 : c0.width, c0.height % 2 ? c0.height - 1 : c0.height];
}

/** Chuỗi bộ lọc màu của một clip (rỗng nếu không chỉnh gì). Kết thúc bằng dấu phẩy khi có nội dung. */
function colorFilter(f) {
  if (!f) return '';
  const parts = [];
  if (f.preset && PRESETS[f.preset]) parts.push(PRESETS[f.preset]);
  const b = clamp(num(f.brightness, 0), -60, 60) / 100 * 255;   // cộng vào kênh Y (0..255)
  const c = clamp(num(f.contrast, 100), 40, 200) / 100;
  const s = clamp(num(f.saturation, 100), 0, 300) / 100;
  if (Math.abs(s - 1) > 0.001) parts.push(`hue=s=${s.toFixed(3)}`);
  if (Math.abs(b) > 0.5 || Math.abs(c - 1) > 0.001) {
    parts.push(`lutyuv=y='clip((val-128)*${c.toFixed(3)}+128+${b.toFixed(2)},0,255)'`);
  }
  // Điều chỉnh dạng slider (-100..100, không phá hủy): nhiệt độ, tông màu, bão hòa, phơi sáng, tương phản, vùng sáng, bóng, điểm trắng, điểm đen
  const A = f.adj || {};
  const a = k => clamp(num(A[k], 0), -100, 100);
  if (a('temp') || a('tint')) {
    const t = a('temp') / 100 * 0.3, g = -a('tint') / 100 * 0.3;
    parts.push(`colorbalance=rs=${t.toFixed(3)}:gs=${g.toFixed(3)}:bs=${(-t).toFixed(3)}:rm=${(t / 2).toFixed(3)}:gm=${(g / 2).toFixed(3)}:bm=${(-t / 2).toFixed(3)}`);
  }
  if (a('sat')) parts.push(`hue=s=${(1 + a('sat') / 100).toFixed(3)}`);
  if (['exp', 'con', 'hi', 'sh', 'wh', 'bl'].some(k => a(k))) {
    let e = 'val/255';
    const bp = a('bl') / 100 * 0.15, wp = 1 - a('wh') / 100 * 0.15;
    if (a('bl') || a('wh')) e = `clip((${e}-${bp.toFixed(4)})/${(wp - bp).toFixed(4)},0,1)`;
    if (a('exp')) e = `(${e})*${Math.pow(2, a('exp') / 100).toFixed(4)}`;
    if (a('con')) e = `((${e})-0.5)*${(1 + a('con') / 100).toFixed(4)}+0.5`;
    if (a('hi')) e = `(${e})+${(a('hi') / 100 * 0.25).toFixed(4)}*clip(((${e})-0.5)*2,0,1)`;
    if (a('sh')) e = `(${e})+${(a('sh') / 100 * 0.25).toFixed(4)}*clip((0.5-(${e}))*2,0,1)`;
    parts.push(`lutyuv=y='clip(255*(${e}),0,255)'`);
  }
  const blur = clamp(num(f.blur, 0), 0, 30);
  if (blur > 0.1) parts.push(`gblur=sigma=${blur.toFixed(2)}`);
  return parts.length ? parts.join(',') + ',' : '';
}

function buildPlan(p, tmpDir, opts = {}) {
  const clips = (p.clips || []).filter(c => c.path);
  if (!clips.length) throw new Error('Dự án chưa có clip nào');
  for (const c of clips) {
    if (!fs.existsSync(c.path)) throw new Error('Mất file nguồn: ' + (c.name || c.path));
    if (!(num(c.out, 0) > num(c.in, 0))) throw new Error('Clip "' + (c.name || '') + '" có điểm ra ≤ điểm vào');
  }
  const [W, H] = targetSize(p);
  const inputs = [];
  const lines = [];
  let idx = 0;
  const lens = clips.map(clipLen);

  /* ---- 1. từng clip: trim/tốc độ/khung/màu + âm thanh ---- */
  clips.forEach((c, i) => {
    const sp = clamp(num(c.speed, 1), 0.25, 4);
    inputs.push('-i', c.path); const n = idx++;
    lines.push(`[${n}:v]trim=start=${num(c.in, 0).toFixed(3)}:end=${num(c.out, 0).toFixed(3)},setpts=(PTS-STARTPTS)/${sp.toFixed(4)},${geoFilter(c)}` +
      `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,${colorFilter(c.filter)}setsar=1,fps=30,format=yuv420p[v${i}]`);
    const vol = clamp(num(c.volume, 100), 0, 300) / 100 * clamp(num(p.origVolume, 100), 0, 300) / 100;
    if (c.hasAudio) {
      lines.push(`[${n}:a]atrim=start=${num(c.in, 0).toFixed(3)}:end=${num(c.out, 0).toFixed(3)},asetpts=PTS-STARTPTS,${atempoChain(sp)},volume=${vol.toFixed(3)},` +
        `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
    } else {
      lines.push(`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${lens[i].toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
    }
  });

  /* ---- 2. nối clip: concat khi không có chuyển cảnh, xfade/acrossfade theo cặp khi có ---- */
  const anyTrans = clips.some((_, i) => transDur(clips, i) > 0);
  const total = totalDuration(p);
  if (!anyTrans) {
    const pairs = clips.map((_, i) => `[v${i}][a${i}]`).join('');
    lines.push(`${pairs}concat=n=${clips.length}:v=1:a=1[vc][ac]`);
  } else {
    let vCur = '[v0]', aCur = '[a0]', acc = lens[0];
    for (let i = 1; i < clips.length; i++) {
      const d = transDur(clips, i);
      const vOut = i === clips.length - 1 ? '[vc]' : `[vj${i}]`;
      const aOut = i === clips.length - 1 ? '[ac]' : `[aj${i}]`;
      if (d > 0.01) {
        const kind = clips[i].transition.type;
        lines.push(`${vCur}[v${i}]xfade=transition=${kind}:duration=${d.toFixed(3)}:offset=${Math.max(0, acc - d).toFixed(3)},fps=30,settb=1/30,format=yuv420p${vOut}`);
        lines.push(`${aCur}[a${i}]acrossfade=d=${d.toFixed(3)}${aOut}`);
        acc = acc + lens[i] - d;
      } else {
        // concat xuất video timebase 1/1000000 còn xfade đòi hai đầu vào cùng timebase → ép fps=30,settb=1/30 ngay sau concat.
        // (Lỗi chỉ lộ khi chuyển cảnh nằm SAU một đoạn cắt thẳng; test cũ chỉ đặt chuyển cảnh ở đầu nên bỏ sót.)
        lines.push(`${vCur}${aCur}[v${i}][a${i}]concat=n=2:v=1:a=1[vcc${i}]${aOut}`);
        lines.push(`[vcc${i}]fps=30,settb=1/30,format=yuv420p${vOut}`);
        acc = acc + lens[i];
      }
      vCur = vOut; aCur = aOut;
    }
  }

  /* ---- 3. lớp lên video: lớp phủ, che sub, chữ, watermark, phụ đề ---- */
  let cur = '[vc]'; let step = 0;
  const next = () => `[vo${step++}]`;
  const win = (s0, s1) => `enable='between(t,${s0.toFixed(3)},${s1.toFixed(3)})'`;

  (p.overlays || []).forEach((o, k) => {
    if (!o.path || !fs.existsSync(o.path)) return;
    const isVid = o.kind === 'video' || /\.(mp4|mov|mkv|webm|avi)$/i.test(o.path);
    const s0 = clamp(num(o.start, 0), 0, total), s1 = clamp(num(o.end, total), s0, total);
    if (s1 - s0 < 0.05) return;
    const op = clamp(num(o.opacity, 100), 0, 100) / 100;
    const wpx = Math.max(16, Math.round(W * clamp(num(o.w, 0.3), 0.02, 1) / 2) * 2);
    const xf = clamp(num(o.x, 0.5), 0, 1), yf = clamp(num(o.y, 0.5), 0, 1);
    if (isVid) inputs.push('-i', o.path); else inputs.push('-loop', '1', '-framerate', '30', '-i', o.path);
    const n = idx++;
    const inn = Math.max(0, num(o.in, 0));
    if (isVid) {
      lines.push(`[${n}:v]trim=start=${inn.toFixed(3)}:end=${(inn + (s1 - s0)).toFixed(3)},setpts=PTS-STARTPTS+${s0.toFixed(3)}/TB,scale=${wpx}:-2,format=rgba,colorchannelmixer=aa=${op.toFixed(2)}[ov${k}]`);
    } else {
      lines.push(`[${n}:v]scale=${wpx}:-2,format=rgba,colorchannelmixer=aa=${op.toFixed(2)},setpts=PTS-STARTPTS[ov${k}]`);
    }
    const out = next();
    lines.push(`${cur}[ov${k}]overlay=x=W*${xf.toFixed(4)}-w/2:y=H*${yf.toFixed(4)}-h/2:${isVid ? 'eof_action=pass:' : ''}${win(s0, s1)}${out}`);
    cur = out;
  });

  (p.masks || []).forEach((m, k) => {
    const s0 = clamp(num(m.start, 0), 0, total), s1 = clamp(num(m.end, total), s0, total);
    if (s1 - s0 < 0.05) return;
    const xf = clamp(num(m.x, 0.1), 0, 0.98), yf = clamp(num(m.y, 0.8), 0, 0.98);
    const wf = clamp(num(m.w, 0.8), 0.02, 1 - xf), hf = clamp(num(m.h, 0.12), 0.02, 1 - yf);
    const ev = v => `trunc(${v}/2)*2`;
    if (m.mode === 'box') {
      const color = /^#?[0-9a-fA-F]{6}$/.test(String(m.color || '')) ? '0x' + String(m.color).replace('#', '') : 'black';
      const out = next();
      lines.push(`${cur}drawbox=x=${ev('iw*' + xf.toFixed(4))}:y=${ev('ih*' + yf.toFixed(4))}:w=${ev('iw*' + wf.toFixed(4))}:h=${ev('ih*' + hf.toFixed(4))}:color=${color}@1:t=fill:${win(s0, s1)}${out}`);
      cur = out;
    } else if (m.mode === 'mosaic') {
      const detail = clamp(num(m.detail, 60), 0, 100);
      const blk = Math.round(4 + (100 - detail) / 100 * 28);
      const a = `[mk${k}a]`, b = `[mk${k}b]`, bl = `[mk${k}c]`;
      lines.push(`${cur}split${a}${b}`);
      lines.push(`${b}crop=w=${ev('iw*' + wf.toFixed(4))}:h=${ev('ih*' + hf.toFixed(4))}:x=${ev('iw*' + xf.toFixed(4))}:y=${ev('ih*' + yf.toFixed(4))},pixelize=w=${blk}:h=${blk}${bl}`);
      const out = next();
      lines.push(`${a}${bl}overlay=x=${ev('W*' + xf.toFixed(4))}:y=${ev('H*' + yf.toFixed(4))}:${win(s0, s1)}${out}`);
      cur = out;
    } else if (m.mode === 'patch') {
      // "Xoá gần đúng": lấy một dải nền ngay phía trên (hoặc phía dưới nếu sát mép) cùng kích thước, làm mịn nhẹ rồi dán lên vùng cần che.
      // KHÔNG phải tái tạo nền bằng AI — chỉ hợp khi nền quanh chữ khá đơn giản.
      const detail = clamp(num(m.detail, 78), 0, 100);
      const sg = (3 + (100 - detail) / 100 * 14).toFixed(1);
      const srcY = (yf - hf >= 0) ? (yf - hf) : Math.min(1 - hf, yf + hf);
      const a = `[mk${k}a]`, b = `[mk${k}b]`, bl = `[mk${k}c]`;
      lines.push(`${cur}split${a}${b}`);
      lines.push(`${b}crop=w=${ev('iw*' + wf.toFixed(4))}:h=${ev('ih*' + hf.toFixed(4))}:x=${ev('iw*' + xf.toFixed(4))}:y=${ev('ih*' + srcY.toFixed(4))},gblur=sigma=${sg}${bl}`);
      const out = next();
      lines.push(`${a}${bl}overlay=x=${ev('W*' + xf.toFixed(4))}:y=${ev('H*' + yf.toFixed(4))}:${win(s0, s1)}${out}`);
      cur = out;
    } else {
      const sigma = (m.detail != null) ? 3 + (100 - clamp(num(m.detail, 60), 0, 100)) / 100 * 60 : clamp(num(m.strength, 25), 3, 80);
      const a = `[mk${k}a]`, b = `[mk${k}b]`, bl = `[mk${k}c]`;
      lines.push(`${cur}split${a}${b}`);
      lines.push(`${b}crop=w=${ev('iw*' + wf.toFixed(4))}:h=${ev('ih*' + hf.toFixed(4))}:x=${ev('iw*' + xf.toFixed(4))}:y=${ev('ih*' + yf.toFixed(4))},gblur=sigma=${sigma.toFixed(1)}${bl}`);
      const out = next();
      lines.push(`${a}${bl}overlay=x=${ev('W*' + xf.toFixed(4))}:y=${ev('H*' + yf.toFixed(4))}:${win(s0, s1)}${out}`);
      cur = out;
    }
  });

  (p.texts || []).forEach((t, k) => {
    if (!String(t.text || '').trim()) return;
    const tf = path.join(tmpDir, `text_${k}.txt`);
    fs.writeFileSync(tf, String(t.text), 'utf8');
    const s0 = clamp(num(t.start, 0), 0, total), s1 = clamp(num(t.end, total) || total, 0, total);
    const x = clamp(num(t.x, 0.5), 0, 1), y = clamp(num(t.y, 0.85), 0, 1);
    const color = /^#?[0-9a-fA-F]{6}$/.test(String(t.color || '')) ? '0x' + String(t.color).replace('#', '') : 'white';
    const out = next();
    lines.push(`${cur}drawtext=fontfile='${esc(FONT_BOLD)}':textfile='${esc(tf)}':fontsize=${clamp(num(t.size, 48), 8, 300)}:fontcolor=${color}:` +
      `borderw=3:bordercolor=black@0.9:x=(w*${x.toFixed(3)})-text_w/2:y=(h*${y.toFixed(3)})-text_h/2:${win(s0, s1)}${out}`);
    cur = out;
  });

  const wm = (p.watermark && p.watermark.show === false) ? {} : (p.watermark || {});
  const hx = (v, d) => { const m = /^#?([0-9a-fA-F]{6})$/.exec(String(v || '')); return '0x' + (m ? m[1] : d); };
  const op = clamp(num(wm.opacity, 70), 0, 100) / 100;
  if (wm.image && fs.existsSync(wm.image)) {
    const posXY = { tl: ['20', '20'], tr: ['W-w-20', '20'], bl: ['20', 'H-h-20'], br: ['W-w-20', 'H-h-20'] }[wm.pos] || ['W-w-20', 'H-h-20'];
    inputs.push('-loop', '1', '-framerate', '30', '-i', wm.image); const n = idx++;
    const sz = clamp(num(wm.size, 28), 8, 400);
    lines.push(`[${n}:v]scale=-2:${Math.round(sz * 3)},format=rgba,colorchannelmixer=aa=${op.toFixed(2)},setpts=PTS-STARTPTS[wmi]`);
    const out = next();
    lines.push(`${cur}[wmi]overlay=${posXY[0]}:${posXY[1]}${out}`); cur = out;
  } else if (String(wm.text || '').trim()) {
    const tf = path.join(tmpDir, 'wm.txt'); fs.writeFileSync(tf, String(wm.text), 'utf8');
    const wmFont = wm.font ? fontFile(wm.font, wm.bold !== false && wm.bold !== undefined ? !!wm.bold : (wm.bold === undefined), !!wm.italic) : FONT_BOLD;
    const T = Math.max(1, total);
    const eff = wm.effect === 'fade' ? `max(0,min(1,min(t,${T.toFixed(2)}-t)))*${op.toFixed(2)}`
      : wm.effect === 'pulse' ? `(0.55+0.45*sin(2*PI*t/1.6))*${op.toFixed(2)}`
      : wm.effect === 'blink' ? `if(lt(mod(t,1.2),0.8),1,0.15)*${op.toFixed(2)}` : '';
    const xy = { tl: ['20', '20'], tr: ['w-text_w-20', '20'], bl: ['20', 'h-text_h-20'], br: ['w-text_w-20', 'h-text_h-20'] }[wm.pos] || ['w-text_w-20', 'h-text_h-20'];
    const out = next();
    lines.push(`${cur}drawtext=fontfile='${esc(wmFont)}':textfile='${esc(tf)}':fontsize=${clamp(num(wm.size, 28), 8, 200)}${eff ? `:alpha='${eff}'` : ''}:fontcolor=${hx(wm.color, 'FFFFFF')}${eff ? '' : '@' + op.toFixed(2)}:borderw=${clamp(num(wm.border, 2), 0, 10)}:bordercolor=${hx(wm.borderColor, '000000')}@${(op * 0.8).toFixed(2)}` +
      `${num(wm.shadow, 0) > 0 ? `:shadowx=${clamp(num(wm.shadow, 0), 0, 10)}:shadowy=${clamp(num(wm.shadow, 0), 0, 10)}:shadowcolor=black@0.6` : ''}` +
      `${wm.bg ? `:box=1:boxcolor=${hx(wm.bgColor, '000000')}@${(clamp(num(wm.bgOpacity, 60), 0, 100) / 100).toFixed(2)}:boxborderw=10` : ''}:x=${xy[0]}:y=${xy[1]}${out}`);
    cur = out;
  }
  if (p.srt && fs.existsSync(p.srt)) {
    const out = next();
    // .srt được ffmpeg đổi sang ASS với PlayResY=288 → mọi số trong force_style (cỡ chữ, viền, lề) bị phóng H/288 lần.
    // Đã thử original_size: KHÔNG có tác dụng (chữ vẫn khổng lồ). Tính ngược về thang 288 để ra đúng pixel mong muốn.
    const k = 288 / H;
    const fsz = Math.max(4, Math.round((H / 40) * k * 10) / 10);   // ≈ H/40 pixel
    const mv = Math.max(2, Math.round((H / 14) * k));              // lề dưới ≈ H/14 pixel
    lines.push(`${cur}subtitles='${esc(p.srt)}':force_style='FontName=Arial,FontSize=${fsz},Outline=${(1.6 * k * 3).toFixed(2)},Shadow=0,MarginV=${mv},Alignment=2'${out}`);
    cur = out;
  }
  // Bản xem trước: một nửa kích thước, làm tròn xuống số CHẴN (bộ mã hoá H.264 từ chối chiều lẻ → "Invalid argument").
  // Công thức cũ trunc(iw/4)*2 chỉ chẵn "tình cờ": chiều gốc không chia hết cho 4 thì ra số lẻ-hoá sai.
  if (opts.preview) lines.push(`${cur}scale=w=trunc(iw/4)*2:h=trunc(ih/4)*2,setsar=1[vout]`);
  else lines.push(`${cur}null[vout]`);

  /* ---- 4. âm thanh: gốc + các đoạn nhạc + giọng lồng ---- */
  const segs = [];
  if (p.music && p.music.path) segs.push({ ...p.music });
  (p.audioSegs || []).forEach(s => { if (s && s.path) segs.push(s); });
  const mix = [];
  segs.forEach((s, k) => {
    if (!fs.existsSync(s.path)) return;
    const st = clamp(num(s.start, 0), 0, Math.max(0, total - 0.05));
    const inn = Math.max(0, num(s.in, 0));
    const bounded = num(s.out, 0) > inn;
    let len = bounded ? num(s.out, 0) - inn : total - st;
    len = Math.max(0.05, Math.min(len, total - st));
    if (!bounded) inputs.push('-stream_loop', '-1');
    inputs.push('-i', s.path); const n = idx++;
    const chain = [`atrim=start=${inn.toFixed(3)}:duration=${len.toFixed(3)}`, 'asetpts=PTS-STARTPTS', 'aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo'];
    const fi = clamp(num(s.fadeIn, 0), 0, len / 2), fo = clamp(num(s.fadeOut, 0), 0, len / 2);
    if (fi > 0.01) chain.push(`afade=t=in:st=0:d=${fi.toFixed(3)}`);
    if (fo > 0.01) chain.push(`afade=t=out:st=${(len - fo).toFixed(3)}:d=${fo.toFixed(3)}`);
    chain.push(`volume=${(clamp(num(s.volume, 30), 0, 300) / 100).toFixed(3)}`);
    if (st > 0.01) { const ms = Math.round(st * 1000); chain.push(`adelay=${ms}|${ms}`); }
    lines.push(`[${n}:a]${chain.join(',')}[am${k}]`);
    mix.push(`[am${k}]`);
  });
  if (p.dub && p.dub.path && fs.existsSync(p.dub.path)) {
    inputs.push('-i', p.dub.path); const n = idx++;
    lines.push(`[${n}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${(clamp(num(p.dub.volume, 100), 0, 300) / 100).toFixed(3)}[ad]`);
    mix.push('[ad]');
  }
  if (mix.length) lines.push(`[ac]${mix.join('')}amix=inputs=${1 + mix.length}:duration=first:dropout_transition=0:normalize=0[aout]`);
  else lines.push('[ac]anull[aout]');
  return { inputs, script: lines.join(';\n'), total, W, H };
}

module.exports = { buildPlan, totalDuration, clipLen, transDur, TRANSITIONS, PRESETS };
