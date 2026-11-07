/**
 * DỰNG PROMPT ĐỒNG BỘ (bối cảnh + nhân vật) — học cấu trúc từ file mẫu "promt mẫu đồng bộ bối cảnh".
 * Ý tưởng: mọi cảnh dùng CÙNG một khuôn cố định, các phần "Hồ sơ" (phong cách, địa điểm, ngoại hình + giọng từng nhân vật)
 * được lặp NGUYÊN VĂN ở mọi cảnh; chỉ Hành động / Góc máy / Tâm trạng / Âm thanh / Thoại thay đổi theo cảnh.
 * Module thuần (không I/O), kiểm thử được. Không gọi mạng, không gửi vào hàng đợi.
 */
'use strict';

const SEP = ' | ';
const NO_EXTRA_CAST = 'NO OTHER CHARACTERS, NO ADDED OR BACKGROUND FIGURES, NO EXTRA CROWD, NO PLAIN HUMANS UNLESS LISTED, NO DUPLICATES, NO CLONES';
const LOCK_TAIL = 'locked proportions, no auto-rescale. (CRITICAL: Appearance is FIXED)';
const str = v => (v == null ? '' : String(v)).replace(/\s*\r?\n\s*/g, ' ').trim();
const key = n => str(n).toLowerCase();

function langLock(lang) {
  return lang === 'en' ? 'ALL DIALOGUE MUST BE SPOKEN IN ENGLISH'
    : lang === 'vi' ? 'PHẦN ĐÀM THOẠI BẮT BUỘC PHẢI BẰNG TIẾNG VIỆT' : '';
}

/** Các đoạn "Hồ sơ" dùng chung cho mọi cảnh (phần phải giống hệt nhau giữa các cảnh). */
function sharedSegments(project, castNames) {
  const o = project.options || {};
  const segs = [];
  segs.push(`Video Style : ${str(project.styleName) || 'Cinematic'}`);
  if (str(project.styleDesc)) segs.push(str(project.styleDesc));
  const loc = project.location || {};
  if (str(loc.desc) || str(loc.name)) segs.push(`Location (${str(loc.name) || 'Main location'}): ${str(loc.desc)}`);
  const chars = project.characters || [];
  castNames.forEach(n => {
    const c = chars.find(x => key(x.name) === key(n));
    if (!c) return;
    segs.push(`${str(c.name)}: ANATOMY: ${str(c.anatomy)}${o.lockAppearance === false ? '' : ' ' + LOCK_TAIL}`);
  });
  castNames.forEach(n => {
    const c = chars.find(x => key(x.name) === key(n));
    if (c && str(c.voice)) segs.push(`Voice ${str(c.name)} = ${str(c.voice)}`);
  });
  return segs;
}

function buildScene(project, scene, index) {
  const o = project.options || {};
  const warnings = [];
  const chars = project.characters || [];
  const cast = (scene.characters || []).map(str).filter(Boolean);
  const known = cast.filter(n => chars.some(c => key(c.name) === key(n)));
  cast.filter(n => !known.includes(n)).forEach(n => warnings.push(`Cảnh ${index + 1}: nhân vật “${n}” chưa có trong Hồ sơ nhân vật — bị bỏ qua.`));
  if (!known.length) warnings.push(`Cảnh ${index + 1}: chưa chọn nhân vật nào.`);
  known.forEach(n => { const c = chars.find(x => key(x.name) === key(n)); if (!str(c.anatomy)) warnings.push(`Cảnh ${index + 1}: “${n}” chưa mô tả ngoại hình (ANATOMY) — dễ bị lệch nhân vật.`); });
  if (!str(scene.action)) warnings.push(`Cảnh ${index + 1}: chưa có Hành động.`);

  const segs = sharedSegments(project, known);
  segs.push(`Action: ${str(scene.action)}`);
  const shot = str(scene.shot) || 'MS', angle = str(scene.angle) || 'eye-level', move = str(scene.move) || 'static shot';
  segs.push(`Camera: ${shot} -> ${angle} -> ${move}`);
  const setting = str(scene.setting) || str((project.location || {}).short) || str((project.location || {}).desc).split(/(?<=[.!?])\s/)[0];
  if (setting) segs.push(`Setting: ${setting}`);
  if (str(scene.mood)) segs.push(`Mood: ${str(scene.mood)}`);
  const music = str(scene.music) || str(project.defaultMusic), sfx = str(scene.sfx);
  if (music || sfx) segs.push(`Audio: Music: ${music || 'none'}; SFX: ${sfx || 'none'}`);

  const lines = (scene.dialogue || []).filter(d => str(d.text));
  if (lines.length) {
    lines.forEach(d => {
      const sp = str(d.speaker);
      if (sp && !known.some(n => key(n) === key(sp))) warnings.push(`Cảnh ${index + 1}: người nói “${sp}” không nằm trong danh sách nhân vật của cảnh.`);
      if (str(d.delivery)) segs.push(`vocal_delivery: ${str(d.delivery)}`);
      segs.push(`SPEAKER = ${sp || known[0] || 'Narrator'}: "${str(d.text)}"`);
    });
  }
  if (o.exclusiveCast !== false && known.length) {
    segs.push(`ONLY THESE CHARACTERS APPEAR: ${known.join(', ')}`);
    segs.push(NO_EXTRA_CAST);
  }
  if (o.subtitlesOff !== false) segs.push('SUBTITLES OFF');
  const ll = langLock(o.dialogueLang === undefined ? 'vi' : o.dialogueLang);
  if (ll) segs.push(ll);
  if (o.noSinging !== false) segs.push('DO NOT SING, NO SINGING');

  const text = segs.join(SEP);
  if (text.length > 4500) warnings.push(`Cảnh ${index + 1}: prompt dài ${text.length} ký tự — có thể vượt giới hạn của nền tảng; hãy rút gọn Hồ sơ.`);
  return { index: index + 1, text, length: text.length, warnings };
}

/** Dựng toàn bộ prompt + kiểm tra nhất quán. */
function buildSyncPrompts(project = {}) {
  const warnings = [];
  const chars = project.characters || [];
  const seen = new Set();
  chars.forEach(c => { const k = key(c.name); if (!k) warnings.push('Có nhân vật chưa đặt tên.'); else if (seen.has(k)) warnings.push(`Trùng tên nhân vật: “${c.name}”.`); seen.add(k); });
  if (!str((project.location || {}).desc)) warnings.push('Chưa mô tả địa điểm (Location) — các cảnh sẽ không đồng bộ bối cảnh.');
  const scenes = (project.scenes || []).map((s, i) => buildScene(project, s, i));
  scenes.forEach(s => warnings.push(...s.warnings));
  return { scenes, warnings, consistency: checkConsistency(scenes.map(s => s.text), project) };
}

/** Kiểm chứng: phần Hồ sơ của MỌI cảnh phải giống hệt nhau (cùng style, location, và mỗi nhân vật ở mọi cảnh có đúng một khối giống hệt). */
function checkConsistency(texts, project = {}) {
  const parts = texts.map(t => t.split(SEP));
  const pick = (p, pre) => p.filter(x => x.startsWith(pre));
  const same = arr => arr.length <= 1 || arr.every(x => x === arr[0]);
  const styleOK = same(parts.map(p => pick(p, 'Video Style').join('\n')));
  const locOK = same(parts.map(p => pick(p, 'Location').join('\n')));
  const byChar = {};
  parts.forEach(p => p.filter(x => /: ANATOMY:/.test(x) || /^Voice .+ = /.test(x)).forEach(x => {
    const name = /^Voice (.+?) = /.exec(x) ? /^Voice (.+?) = /.exec(x)[1] : x.split(': ANATOMY:')[0];
    (byChar[name] = byChar[name] || new Set()).add(x);
  }));
  const drift = Object.entries(byChar).filter(([, set]) => set.size > 2 /* 1 khối ANATOMY + 1 khối Voice */).map(([n]) => n);
  return { ok: styleOK && locOK && !drift.length, style: styleOK, location: locOK, driftingCharacters: drift };
}

/** Nhập ngược từ file prompt đã có (mỗi khối cách nhau dòng trống, đoạn cách nhau " | "). Best-effort, không đoán thêm. */
function parseSyncPrompts(text) {
  const blocks = String(text || '').split(/\r?\n\s*\r?\n/).map(s => s.trim()).filter(Boolean);
  const project = { styleName: '', styleDesc: '', location: { name: '', desc: '' }, characters: [], scenes: [], options: {} };
  const chars = new Map();
  blocks.forEach(b => {
    const segs = b.split(SEP).map(s => s.trim());
    const sc = { characters: [], action: '', shot: '', angle: '', move: '', setting: '', mood: '', music: '', sfx: '', dialogue: [] };
    let pendingDelivery = '';
    segs.forEach((s, i) => {
      let m;
      if ((m = /^Video Style\s*:\s*(.+)$/.exec(s))) { project.styleName = project.styleName || m[1]; if (segs[i + 1] && !/^(Location|.+: ANATOMY:)/.test(segs[i + 1])) project.styleDesc = project.styleDesc || segs[i + 1]; }
      else if ((m = /^Location \((.+?)\):\s*(.+)$/.exec(s))) { project.location.name = project.location.name || m[1]; project.location.desc = project.location.desc || m[2]; }
      else if ((m = /^(.+?):\s*ANATOMY:\s*(.+)$/.exec(s))) { const name = m[1].trim(); const an = m[2].replace(LOCK_TAIL, '').trim(); const c = chars.get(name) || { name, anatomy: '', voice: '' }; c.anatomy = c.anatomy || an; chars.set(name, c); }
      else if ((m = /^Voice (.+?) = (.+)$/.exec(s))) { const c = chars.get(m[1].trim()) || { name: m[1].trim(), anatomy: '', voice: '' }; c.voice = c.voice || m[2]; chars.set(c.name, c); }
      else if ((m = /^Action:\s*(.+)$/.exec(s))) sc.action = m[1];
      else if ((m = /^Camera:\s*(.+?)\s*->\s*(.+?)\s*->\s*(.+)$/.exec(s))) { sc.shot = m[1]; sc.angle = m[2]; sc.move = m[3]; }
      else if ((m = /^Setting:\s*(.+)$/.exec(s))) sc.setting = m[1];
      else if ((m = /^Mood:\s*(.+)$/.exec(s))) sc.mood = m[1];
      else if ((m = /^Audio:\s*Music:\s*(.*?);\s*SFX:\s*(.*)$/.exec(s))) { sc.music = m[1]; sc.sfx = m[2]; }
      else if ((m = /^vocal_delivery:\s*(.+)$/.exec(s))) pendingDelivery = m[1];
      else if ((m = /^SPEAKER = (.+?):\s*"(.*)"$/.exec(s))) { sc.dialogue.push({ speaker: m[1].trim(), text: m[2], delivery: pendingDelivery }); pendingDelivery = ''; }
      else if ((m = /^ONLY THESE CHARACTERS APPEAR:\s*(.+)$/.exec(s))) sc.characters = m[1].split(',').map(x => x.trim()).filter(Boolean);
    });
    project.scenes.push(sc);
  });
  project.characters = [...chars.values()];
  return project;
}

module.exports = { buildSyncPrompts, checkConsistency, parseSyncPrompts, sharedSegments, NO_EXTRA_CAST };
