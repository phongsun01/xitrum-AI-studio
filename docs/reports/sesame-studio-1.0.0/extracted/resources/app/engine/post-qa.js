/**
 * POST-GEN QA — chuẩn bị tài liệu kiểm lỗi cho một clip đã gen, rồi để model thị giác (ChatGPT/Claude của người dùng,
 * qua agent trong AICoworker) chấm theo thang cố định. Module này KHÔNG gọi mạng và KHÔNG gọi model.
 *
 * Việc của module: (1) trích khung hình theo mốc giây + ghép thành 1 tờ; (2) ghép ảnh khóa thành 1 tờ; (3) sinh phiếu chấm
 * có các câu hỏi cố định từ spec/shot (số người, mép khung, mặt khớp ảnh khóa, biểu cảm so với thang 0–4, khung cuối, đạo cụ);
 * (4) kiểm tra verdict model trả về có đủ trường, và quyết định gen lại hay không.
 * Các kiểm tra đo được (độ phân giải, có tiếng) làm bằng ffprobe. Phần mặt/biểu cảm là phán đoán của model, KHÔNG đo.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

// camera, gaze, entrances, speech thêm 22/10 từ bản QA do MUSE tự chấm clip của chính nó (user dán lại, clip 1 Linh Phù): máy push-in dù ghi
// "đứng yên", mắt nhìn sai hướng, nhân vật xuất hiện giữa clip thay vì có mặt từ giây 0. Mục speech: kiểm lời nói có đúng thoại không
// (lần này user nghe và xác nhận thoại ĐÚNG; phần "nghe nhầm chữ" trong bản chấm là do bộ nhận giọng của Muse, không phải lỗi phát âm).
const CHECKS = ['people_count', 'edge_cut', 'face_match', 'expression', 'wardrobe', 'props', 'setting', 'final_frame', 'extra_people', 'artifacts', 'camera', 'gaze', 'entrances', 'speech'];
const VERDICTS = ['pass', 'regen', 'review'];

function run(bin, args) {
  const r = spawnSync(bin, args, { encoding: 'utf8', windowsHide: true });
  if (r.error) throw r.error;
  return r;
}

/** ffprobe cạnh ffmpeg. Trả { width,height,duration,hasAudio }. */
function probe(ffmpeg, clip) {
  const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, m => 'ffprobe' + (m.endsWith('.exe') ? '.exe' : ''));
  const r = run(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,duration', '-of', 'json', clip]);
  const j = JSON.parse(r.stdout || '{}');
  const v = (j.streams || []).find(s => s.codec_type === 'video') || {};
  return { width: v.width || 0, height: v.height || 0, duration: Number(v.duration) || 0, hasAudio: (j.streams || []).some(s => s.codec_type === 'audio') };
}

/** Mốc lấy khung: đầu, giữa, cuối (mỗi ~1 giây, tối đa 8 khung). */
function sampleTimes(duration) {
  const n = Math.max(3, Math.min(8, Math.round(duration) + 1));
  return Array.from({ length: n }, (_, i) => +(Math.min(duration - 0.05, (duration * i) / (n - 1))).toFixed(2));
}

/** Tạo tờ khung hình của clip. Trả { sheet, frames, meta }. */
function contactSheet(ffmpeg, clip, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const meta = probe(ffmpeg, clip);
  const times = sampleTimes(meta.duration);
  const frames = times.map((t, i) => {
    const f = path.join(outDir, `f_${String(i).padStart(2, '0')}.png`);
    run(ffmpeg, ['-v', 'error', '-y', '-ss', String(t), '-i', clip, '-frames:v', '1', '-vf', 'scale=360:-2', f]);
    return { t, file: f };
  });
  const sheet = path.join(outDir, 'sheet.png');
  const inputs = frames.flatMap(f => ['-i', f.file]);
  run(ffmpeg, ['-v', 'error', '-y', ...inputs, '-filter_complex', `hstack=inputs=${frames.length}`, '-frames:v', '1', sheet]);
  return { sheet, frames, meta };
}

/** Phiếu chấm cho một shot. Chỉ chứa câu hỏi cố định, dữ liệu lấy từ spec (không từ khóa của truyện cụ thể). */
function rubric(spec, shot, opts) {
  const o = opts || {};
  const chars = (shot.cast || []).map(id => (spec.characters || []).find(c => c.id === id)).filter(Boolean);
  const beats = Array.isArray(shot.beats) ? shot.beats : [];
  const levels = {};
  beats.forEach(b => Object.entries(b.emotion || {}).forEach(([cid, e]) => { levels[cid] = Math.max(levels[cid] || 0, Number(e.level) || 0); }));
  const lines = [
    `Chấm clip ${o.label || ''} ${shot.seconds || ''}s. Ảnh 1 là tờ khung hình theo thời gian (trái→phải, mốc giây: ${(o.times || []).join(', ')}). Ảnh 2 là ảnh khóa nhân vật/bối cảnh.`,
    `Người đúng trong khung: ${chars.map(c => c.name).join(', ') || '(không có ai)'} — tổng ${chars.length}. Bất kỳ người nào khác (kể cả hậu cảnh, nửa người, bóng) là lỗi extra_people.`,
    'Với MỖI mục trả: {"check": ..., "ok": true|false, "why": "một câu, nêu giây nếu có"}:',
    '- people_count: số người đúng bằng số ở trên suốt clip.',
    '- edge_cut: mọi người đúng nằm TRỌN trong khung, không bị cắt ở mép trái/phải/trên/dưới ở bất kỳ mốc nào.',
    '- face_match: mặt, kiểu tóc, độ tuổi từng người khớp ảnh khóa (nói rõ người nào lệch).',
    ...chars.map(c => `- expression (${c.name}): cường độ tối đa cho phép ${levels[c.id] == null ? 'theo spec' : levels[c.id]}/4 (0 vô cảm … 4 bùng nổ). Quá mức hoặc sai hướng là lỗi.`),
    '- wardrobe: trang phục và phụ kiện đúng spec/ảnh khóa, không đổi giữa chừng.',
    '- props: đạo cụ đúng, nhìn thấy rõ, không biến hình.',
    '- setting: bối cảnh đúng, không đổi giữa chừng.',
    `- final_frame: khung cuối đúng mô tả: "${shot.final_frame || '(spec không mô tả)'}".`,
    '- extra_people: có người thừa không (liệt kê vị trí và giây).',
    '- artifacts: chữ/logo/watermark, tay hay vật dị dạng, biến hình, cắt dở vật ở mép.',
    'Cuối cùng trả JSON {"verdict":"pass|regen|review","checks":[...],"fix":"một câu sửa prompt nếu regen"}.',
    'Quy tắc verdict: có extra_people, edge_cut, face_match hoặc expression sai → regen. Chỉ lỗi nhẹ không chắc chắn → review. Không được trả pass nếu không nhìn rõ.'
  ];
  return lines.join('\n');
}

/** Kiểm verdict của model có đúng khuôn không; trả { ok, problems, decision }. */
function checkVerdict(v) {
  const problems = [];
  if (!v || typeof v !== 'object') return { ok: false, problems: ['Verdict không phải đối tượng.'], decision: 'review' };
  if (!VERDICTS.includes(v.verdict)) problems.push(`verdict phải là ${VERDICTS.join('|')}.`);
  const got = new Set((Array.isArray(v.checks) ? v.checks : []).map(c => String(c.check || '').split(' ')[0]));
  CHECKS.forEach(c => { if (!got.has(c)) problems.push(`thiếu mục ${c}.`); });
  const failed = (v.checks || []).filter(c => c && c.ok === false);
  let decision = v.verdict;
  if (!problems.length && v.verdict === 'pass' && failed.length) { problems.push('verdict pass nhưng có mục ok=false.'); decision = 'review'; }
  if (problems.length) decision = 'review';
  return { ok: !problems.length, problems, decision, failed: failed.map(c => c.check) };
}

module.exports = { CHECKS, VERDICTS, probe, sampleTimes, contactSheet, rubric, checkVerdict };
