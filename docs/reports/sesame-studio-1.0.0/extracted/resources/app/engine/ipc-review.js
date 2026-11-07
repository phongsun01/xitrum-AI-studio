// Review phim AI: từ phụ đề gốc -> lời bình tiếng Việt (Gemini / OpenAI của người dùng) -> SRT lời bình.
// Việc đọc giọng và ghép video dùng lại feat:dub-run.
const fs = require('fs');
const path = require('path');

const STYLES = {
  reviewer: 'Review kịch tính, tóm tắt cao trào, nhịp nhanh, dẫn dắt gây tò mò.',
  comedy: 'Review hài hước, châm biếm nhẹ, chơi chữ, giọng vui nhộn.',
  calm: 'Review điềm tĩnh, triết lý sâu sắc, chậm rãi, giàu cảm xúc.',
  cinema: 'Phân tích điện ảnh chuyên sâu: nhân vật, bố cục, thông điệp, cách kể chuyện.'
};

const toSec = (t) => { const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t || ''); return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000 : 0; };
const fromSec = (s) => { s = Math.max(0, s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = Math.floor(s % 60), ms = Math.round((s - Math.floor(s)) * 1000); const p = (n, w = 2) => String(n).padStart(w, '0'); return `${p(h)}:${p(m)}:${p(x)},${p(ms, 3)}`; };

// Gom các dòng phụ đề thành cụm ~25-45 giây, mỗi cụm sẽ có một đoạn lời bình.
function groupCues(cues, target = 30) {
  const groups = []; let cur = null;
  for (const c of cues) {
    const s = toSec(c.startTime), e = toSec(c.endTime);
    if (!cur) cur = { start: s, end: e, texts: [] };
    cur.end = Math.max(cur.end, e); cur.texts.push(c.text);
    if (cur.end - cur.start >= target) { groups.push(cur); cur = null; }
  }
  if (cur && cur.texts.length) { if (groups.length && cur.end - cur.start < 8) { const g = groups[groups.length - 1]; g.end = cur.end; g.texts.push(...cur.texts); } else groups.push(cur); }
  return groups;
}

async function geminiModel(key) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${key}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j && j.error && j.error.message || 'Khóa Gemini không hợp lệ');
  const names = (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace(/^models\//, '')).filter(n => /flash/.test(n) && !/(lite|image|tts|live|audio|thinking|exp|8b)/.test(n));
  names.sort((a, b) => (/preview/.test(a) ? 1 : 0) - (/preview/.test(b) ? 1 : 0) || b.localeCompare(a, 'en', { numeric: true }));
  if (!names.length) throw new Error('Không tìm thấy mô hình Gemini phù hợp cho khóa này');
  return names[0];
}

async function askLlm(provider, key, prompt) {
  if (provider === 'openai') {
    const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] }) });
    const j = await r.json(); if (!r.ok) throw new Error(j && j.error && j.error.message || 'OpenAI lỗi ' + r.status);
    return j.choices?.[0]?.message?.content || '';
  }
  if (!askLlm._model) askLlm._model = {};
  const model = askLlm._model[key] || (askLlm._model[key] = await geminiModel(key));
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
  const j = await r.json(); if (!r.ok) throw new Error(j && j.error && j.error.message || 'Gemini lỗi ' + r.status);
  return j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
}

// Số từ tối đa cho một đoạn lời bình dài `sec` giây (đọc tiếng Việt ~2.6 từ/giây ở tốc độ thường).
const maxWords = (sec) => Math.max(8, Math.floor(sec * 2.6));

function register({ ipcMain, readSettings, sendProgress }) {
  ipcMain.handle('feat:review-script', async (_e, p = {}) => {
    const cues = p.cues || [];
    if (!cues.length) return { ok: false, error: 'Chưa có phụ đề. Hãy nhập file SRT của phim trước.' };
    const s = readSettings();
    const provider = s.provider === 'openai' ? 'openai' : (s.provider === 'gemini' ? 'gemini' : '');
    if (!provider || !s.apiKey) return { ok: false, error: 'Cần khóa Gemini hoặc OpenAI. Bấm nút cấu hình để nhập khóa.', needKey: true };
    const groups = groupCues(cues, p.target || 30);
    const style = STYLES[p.style] || STYLES.reviewer;
    const out = []; const BATCH = 12;
    try {
      for (let i = 0; i < groups.length; i += BATCH) {
        const part = groups.slice(i, i + BATCH);
        const body = part.map((g, k) => `[${i + k + 1}] (${Math.round(g.end - g.start)} giây, tối đa ${maxWords(g.end - g.start)} từ)\n${g.texts.join(' ').slice(0, 900)}`).join('\n\n');
        const prompt = `Bạn là người viết lời bình review phim tiếng Việt. Phong cách: ${style}
Dưới đây là lời thoại (phụ đề) của từng đoạn phim. Với MỖI đoạn, viết một đoạn lời bình ngắn bằng tiếng Việt kể lại/nhận xét nội dung đoạn đó, tự nhiên như người dẫn chuyện, KHÔNG chép nguyên thoại, KHÔNG vượt số từ tối đa của đoạn.
Chỉ trả về đúng định dạng, mỗi đoạn một dòng: [số] lời bình
Không thêm tiêu đề hay giải thích.

${body}`;
        const text = await askLlm(provider, s.apiKey, prompt);
        for (const line of text.split('\n')) { const m = /^\s*\[(\d+)\]\s*(.+)$/.exec(line); if (m) out[+m[1] - 1] = m[2].trim(); }
        sendProgress('review', { percent: Math.round(Math.min(i + BATCH, groups.length) / groups.length * 100), text: 'Đang viết lời bình' });
      }
    } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 300) }; }
    const res = []; let miss = 0;
    groups.forEach((g, i) => {
      let t = out[i]; if (!t) { miss++; return; }
      const w = t.split(/\s+/); const cap = maxWords(g.end - g.start); if (w.length > cap + 6) t = w.slice(0, cap).join(' ') + '…';
      res.push({ id: String(res.length + 1), startTime: fromSec(g.start), endTime: fromSec(g.end), text: t });
    });
    if (!res.length) return { ok: false, error: 'Mô hình không trả về lời bình hợp lệ, hãy thử lại.' };
    return { ok: true, cues: res, groups: groups.length, missing: miss };
  });
}
module.exports = { register, groupCues, maxWords };
