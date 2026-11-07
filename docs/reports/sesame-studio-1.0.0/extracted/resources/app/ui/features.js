// Nối các tab Cắt video / Tách âm thanh / Dịch SRT với engine thật (xem engine/ipc-features.js).
(function () {
  const api = window.sesame;
  const $ = (id) => document.getElementById(id);
  const toast = (m, t) => (typeof showToast === 'function' ? showToast(m, t) : console.log(m));
  const fileUrl = (p) => 'file:///' + String(p).replace(/\\/g, '/').replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:');
  const fmt = (s) => { s = Math.max(0, s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = Math.floor(s % 60); return [h, m, x].map(n => String(n).padStart(2, '0')).join(':'); };
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const busy = (btn, on, label) => { if (!btn) return; if (on) { btn.dataset.l = btn.textContent; btn.textContent = label || 'Đang xử lý…'; btn.disabled = true; } else { btn.textContent = btn.dataset.l || btn.textContent; btn.disabled = false; } };

  // Electron không hỗ trợ window.prompt → hộp nhập tự vẽ
  function ask(title, def, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'sesame-modal-overlay'; ov.style.display = 'flex';
      ov.innerHTML = `<div class="sesame-modal-box" style="max-width:460px;padding:18px">
        <div class="sesame-modal-title" style="margin-bottom:10px">${esc(title)}</div>
        <input class="srt-edit-input" style="width:100%;padding:8px" type="${opts.password ? 'password' : 'text'}" value="${esc(def || '')}" />
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
          <button class="sesame-btn-outline btn-sm" data-r="0">Hủy</button>
          <button class="sesame-btn-start btn-sm" data-r="1">OK</button></div></div>`;
      document.body.appendChild(ov);
      const inp = ov.querySelector('input'); inp.focus(); inp.select();
      const done = (v) => { ov.remove(); resolve(v); };
      ov.querySelector('[data-r="0"]').onclick = () => done(null);
      ov.querySelector('[data-r="1"]').onclick = () => done(inp.value);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(inp.value); if (e.key === 'Escape') done(null); });
    });
  }
  if (!api || !api.feat) { console.warn('features.js: thiếu API preload (api.feat)'); return; }

  // =========================== CẮT VIDEO ===========================
  const cut = { path: '', duration: 0, start: 0, end: 0, video: null };

  function cutRender() {
    const vp = $('cut-viewport'); if (!vp) return;
    vp.innerHTML = `
      <video id="cut-video" src="${fileUrl(cut.path)}" controls style="max-width:100%;max-height:calc(100% - 56px);background:#000;border-radius:8px"></video>
      <div id="cut-marks" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;padding:8px 0;font-size:12px">
        <button class="sesame-btn-outline btn-sm" id="cut-set-start">⇥ Đặt điểm bắt đầu</button>
        <span id="cut-start-lbl">00:00:00</span>
        <button class="sesame-btn-outline btn-sm" id="cut-set-end">⇤ Đặt điểm kết thúc</button>
        <span id="cut-end-lbl">00:00:00</span>
        <button class="sesame-btn-outline btn-sm" id="cut-split">⫴ Chia đều mỗi N giây…</button>
      </div>`;
    cut.video = $('cut-video');
    cut.video.addEventListener('loadedmetadata', () => {
      cut.duration = cut.video.duration || cut.duration; cut.start = 0; cut.end = cut.duration; cutLabels();
      $('btn-cut-execute').disabled = false;
    });
    $('cut-set-start').onclick = () => { cut.start = cut.video.currentTime; if (cut.end <= cut.start) cut.end = cut.duration; cutLabels(); };
    $('cut-set-end').onclick = () => { cut.end = cut.video.currentTime; if (cut.end <= cut.start) { cut.start = 0; } cutLabels(); };
    $('cut-split').onclick = cutSplit;
    cut.video.addEventListener('timeupdate', cutLabels);
  }
  function cutLabels() {
    const a = $('cut-start-lbl'), b = $('cut-end-lbl'), tc = $('cut-timecode');
    if (a) a.textContent = fmt(cut.start); if (b) b.textContent = fmt(cut.end);
    if (tc) tc.textContent = `${fmt(cut.video ? cut.video.currentTime : 0)} - ${fmt(cut.duration)}  (cắt ${fmt(cut.start)} → ${fmt(cut.end)})`;
    const st = document.querySelector('#tab-cut .timeline-status-info'); if (st) st.textContent = `Đoạn cắt dài ${fmt(Math.max(0, cut.end - cut.start))}`;
  }
  async function cutPick() {
    const f = await api.feat('pick', { kind: 'video' }); if (!f) return;
    const pr = await api.toolkitProbeVideo(f);
    cut.path = f; cut.duration = pr && pr.ok ? pr.duration : 0; cutRender();
    if (pr && pr.ok) { toast(`Đã mở video ${pr.width}x${pr.height}, ${fmt(pr.duration)}`); }
  }
  async function cutSplit() {
    const n = parseInt(await ask('Chia video thành các phần dài bao nhiêu giây?', '60'), 10);
    if (!n || n < 3) return;
    toast('Đang chia video…', 4000);
    try { const r = await api.toolkitSplitVideo({ videoPath: cut.path, segmentSeconds: n });
      if (r && r.ok) { toast(`Đã chia ${r.count} phần`); api.openPath(r.parts[0] ? r.parts[0].replace(/[^\\/]+$/, '') : ''); } else toast('Lỗi: ' + (r && r.error || 'không rõ')); }
    catch (e) { toast('Lỗi chia video: ' + e.message); }
  }
  async function cutExport() {
    if (!cut.path) return toast('Hãy chọn video trước');
    const btn = $('btn-cut-execute'); busy(btn, true, 'Đang cắt…');
    const r = await api.feat('cut-export', { videoPath: cut.path, startSec: cut.start, endSec: cut.end || cut.duration, speed: (+$('slider-cut-speed').value || 100) / 100, res: $('sel-cut-res').value });
    busy(btn, false);
    if (r && r.ok) { toast('Đã xuất: ' + r.outputPath, 5000); api.openPath(r.outputPath.replace(/[^\\/]+$/, '')); } else toast('Lỗi: ' + (r && r.error || 'không rõ'), 6000);
  }
  function cutInit() {
    $('btn-cut-pick-file')?.addEventListener('click', cutPick);
    $('btn-cut-pick-store')?.addEventListener('click', async () => {
      const outs = await api.getDefaultOutputDir(); const f = await api.pickFile({}); if (f) { cut.path = f; const pr = await api.toolkitProbeVideo(f); cut.duration = pr && pr.ok ? pr.duration : 0; cutRender(); }
    });
    $('btn-cut-execute')?.addEventListener('click', cutExport);
    $('btn-cut-open-modes')?.addEventListener('click', () => cut.path ? cutSplit() : toast('Hãy chọn video trước'));
    const spd = $('slider-cut-speed'), lbl = $('val-cut-speed');
    const setSpd = (v) => { v = Math.min(200, Math.max(50, v)); spd.value = v; lbl.textContent = (v / 100).toFixed(2) + 'x'; if (cut.video) cut.video.playbackRate = v / 100; };
    spd?.addEventListener('input', () => setSpd(+spd.value));
    $('btn-cut-spd-minus')?.addEventListener('click', () => setSpd(+spd.value - 10));
    $('btn-cut-spd-plus')?.addEventListener('click', () => setSpd(+spd.value + 10));
    $('btn-cut-spd-reset')?.addEventListener('click', () => setSpd(100));
    $('btn-cut-play')?.addEventListener('click', () => { if (!cut.video) return; cut.video.paused ? cut.video.play() : cut.video.pause(); });
    $('btn-cut-prev')?.addEventListener('click', () => { if (cut.video) cut.video.currentTime = Math.max(0, cut.video.currentTime - 1 / 24); });
    $('btn-cut-next')?.addEventListener('click', () => { if (cut.video) cut.video.currentTime += 1 / 24; });
  }

  // =========================== TÁCH ÂM THANH ===========================
  const aud = { input: '', vocal: '', bgm: '' };
  function audPlayer(boxId, file, label) {
    const box = $(boxId); if (!box) return;
    box.innerHTML = `<audio controls src="${fileUrl(file)}" style="width:100%"></audio><div style="font-size:11px;opacity:.7;margin-top:4px">${esc(file)}</div>`;
  }
  function audInit() {
    $('btn-audio-pick-file')?.addEventListener('click', async () => {
      const f = await api.feat('pick', { kind: 'media' }); if (!f) return; aud.input = f;
      const b = $('btn-audio-pick-file'); b.textContent = '📁 ' + f.split(/[\\/]/).pop();
    });
    $('btn-audio-start')?.addEventListener('click', async () => {
      if (!aud.input) return toast('Hãy chọn file âm thanh / video trước');
      const btn = $('btn-audio-start'); busy(btn, true, 'Đang tách…');
      const r = await api.feat('audio-separate', { inputPath: aud.input, quality: $('sel-audio-quality').value });
      busy(btn, false);
      if (!r || !r.ok) return toast('Lỗi: ' + (r && r.error || 'không rõ'), 7000);
      aud.vocal = r.vocalPath; aud.bgm = r.bgmPath;
      audPlayer('wave-vocal-box', r.vocalPath); audPlayer('wave-bgm-box', r.bgmPath);
      toast('Tách xong (phương pháp triệt kênh giữa bằng ffmpeg — xấp xỉ, không phải model AI)', 7000);
    });
    const exp = (key, name) => async () => { if (!aud[key]) return toast('Chưa có dữ liệu để tải'); const r = await api.feat('copy-save', { src: aud[key], defaultName: name }); if (r && r.ok) toast('Đã lưu: ' + r.path); };
    $('btn-export-vocal')?.addEventListener('click', exp('vocal', 'vocal.wav'));
    $('btn-export-bgm')?.addEventListener('click', exp('bgm', 'bgm.wav'));
    const play = (boxId) => () => { const a = document.querySelector('#' + boxId + ' audio'); a ? (a.paused ? a.play() : a.pause()) : toast('Chưa có dữ liệu'); };
    $('btn-play-vocal')?.addEventListener('click', play('wave-vocal-box'));
    $('btn-play-bgm')?.addEventListener('click', play('wave-bgm-box'));
    const note = document.querySelector('#tab-audio .tool-subtitle');
    if (note) note.textContent = 'Tách giọng & nhạc nền bằng bộ lọc ffmpeg (xấp xỉ, cần file stereo). Model AI Demucs chưa được cài.';
  }

  // =========================== DỊCH SRT ===========================
  const srt = { cues: [], dst: [] };
  function srtRender() {
    const box = $('srt-rows-container'); if (!box) return;
    if (!srt.cues.length) { box.innerHTML = '<div class="wave-placeholder" style="padding:24px">Chưa có phụ đề. Bấm "Nhập file SRT".</div>'; return; }
    box.innerHTML = srt.cues.map((c, i) => `
      <div class="srt-row-item">
        <div class="col-num">${i + 1}</div>
        <div class="col-time">${esc(c.startTime)} ➔ ${esc(c.endTime)}</div>
        <div class="col-src">${esc(c.text)}</div>
        <div class="col-dst"><input type="text" class="srt-edit-input" data-i="${i}" value="${esc(srt.dst[i] || '')}" /></div>
      </div>`).join('');
    box.querySelectorAll('.srt-edit-input').forEach(inp => inp.addEventListener('input', () => { srt.dst[+inp.dataset.i] = inp.value; }));
  }
  async function srtSettings() {
    const s = await api.feat('get-settings');
    const prov = await ask('Nguồn dịch: local (từ điển nhỏ, không cần khóa) / gemini / openai', s.provider || 'local'); if (!prov) return null;
    const p = prov.trim().toLowerCase();
    if (!['local', 'gemini', 'openai'].includes(p)) { toast('Nguồn không hợp lệ'); return null; }
    let key = '';
    if (p !== 'local') { key = (await ask(`Dán khóa API ${p}${s.hasKey ? ' (để trống = giữ khóa đã lưu)' : ''}`, '', { password: true })) || ''; }
    await api.feat('save-settings', { provider: p, apiKey: key });
    return p;
  }
  function srtInit() {
    $('btn-srt-import-file')?.addEventListener('click', async () => {
      const f = await api.feat('pick', { kind: 'srt' }); if (!f) return;
      if (!/\.srt$/i.test(f)) return toast('Tab này nhận file .srt. Nhận dạng chữ trên video (OCR) và giọng nói (ASR) chưa được cài.', 7000);
      const t = await api.feat('read-text', f); if (!t.ok) return toast('Không đọc được file: ' + t.error);
      const r = await api.feat('parse-srt', t.text);
      srt.cues = r.cues || []; srt.dst = srt.cues.map(() => ''); srtRender();
      toast(`Đã nhập ${srt.cues.length} dòng phụ đề`);
    });
    $('btn-srt-translate-all')?.addEventListener('click', async () => {
      if (!srt.cues.length) return toast('Hãy nhập file SRT trước');
      const s = await api.feat('get-settings');
      if (s.provider === 'local' && !s.hasKey) {
        if (confirm('Đang dùng từ điển cục bộ (rất hạn chế). Bấm OK để chọn Gemini/OpenAI và nhập khóa API, hoặc Hủy để dịch bằng từ điển.')) { const p = await srtSettings(); if (!p) return; }
      }
      const btn = $('btn-srt-translate-all'); busy(btn, true, 'Đang dịch…');
      const genre = { auto: 'modern', may_tao: 'modern', anh_em: 'modern', ta_nguoi: 'ancient' }[$('sel-srt-pronouns').value] || 'modern';
      const r = await api.feat('translate', { cues: srt.cues, genre });
      busy(btn, false);
      if (!r || !r.ok) return toast('Lỗi dịch: ' + (r && r.error || 'không rõ'), 7000);
      srt.dst = r.cues.map(c => c.text); srtRender();
      toast(`Đã dịch ${srt.dst.length} dòng (${r.method})`);
    });
    $('btn-srt-export-file')?.addEventListener('click', async () => {
      if (!srt.cues.length) return toast('Chưa có phụ đề để xuất');
      const out = srt.cues.map((c, i) => ({ ...c, text: srt.dst[i] || c.text }));
      const t = await api.feat('cues-to-srt', out);
      const r = await api.feat('save-text', { defaultName: 'phude_vi.srt', text: t.text });
      if (r && r.ok) toast('Đã lưu: ' + r.path);
    });
    srtRender();
  }

  // =========================== TIỆN ÍCH CHUNG ===========================
  const stripListeners = (id) => { const el = $(id); if (!el) return null; const c = el.cloneNode(true); el.replaceWith(c); return c; };
  const baseName = (p) => String(p).split(/[\\/]/).pop();
  // =========================== LỒNG TIẾNG TTS ===========================
  const tts = { last: null, audio: null, busy: false };
  async function ttsRun(preview) {
    if (tts.busy) return toast('Đang xử lý, vui lòng chờ…');
    const text = $('txt-tts-script').value.trim(); if (!text) return toast('Hãy dán kịch bản trước');
    const btn = preview ? $('btn-tts-preview-line') : $('btn-tts-gen-all'); tts.busy = true; busy(btn, true, 'Đang đọc…');
    const off = api.onProgress((d) => { if (d.channel === 'tts' && btn && !preview) btn.textContent = `${d.text || 'Đang đọc…'} ${d.percent != null ? d.percent + '%' : ''}`; });
    try {
      const r = await api.feat('tts-synth', { text, voiceId: $('sel-tts-voice').value, rate: (+$('slider-tts-rate').value) / 100, pauseMs: +$('slider-tts-pause').value, mastering: $('chk-tts-mastering').checked, numNorm: $('chk-tts-num-norm').checked, preview });
      if (!r || !r.ok) return toast('Lỗi: ' + (r && r.error || 'không rõ'), 9000);
      if (!preview) tts.last = r.outputPath;
      if (tts.audio) tts.audio.pause();
      tts.audio = new Audio(fileUrl(r.outputPath)); tts.audio.play().catch(() => {});
      toast(preview ? 'Đang phát thử câu đầu' : `Xong ${r.lines} câu — đang phát. Bấm "Tải file Audio" để lưu.`, 5000);
    } finally { off && off(); tts.busy = false; busy(btn, false); }
  }
  async function ttsInit() {
    if (!$('tab-tts')) return;
    const voices = await api.feat('tts-voices').catch(() => []);
    const eng = $('sel-tts-engine'); if (eng) eng.innerHTML = '<option value="edge" selected>Edge-TTS (Microsoft, cần internet)</option>';
    const sel = $('sel-tts-voice'); if (sel && voices.length) sel.innerHTML = voices.map(v => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('');
    stripListeners('btn-tts-gen-all')?.addEventListener('click', () => ttsRun(false));
    stripListeners('btn-tts-preview-line')?.addEventListener('click', () => ttsRun(true));
    stripListeners('btn-tts-export-wav')?.addEventListener('click', async () => {
      if (!tts.last) return toast('Chưa có audio — bấm "Sinh giọng đọc toàn bộ" trước');
      const r = await api.feat('copy-save', { src: tts.last, defaultName: 'long_tieng.wav' }); if (r && r.ok) toast('Đã lưu: ' + r.path, 5000);
    });
  }
  // =========================== TRUNG TÂM TÀI NGUYÊN ===========================
  const RES_NAMES = {
    ffmpeg: ['FFmpeg', 'Cắt, ghép, render, tách âm'], hw: ['Bộ mã hoá phần cứng', 'NVENC / QSV / AMF giúp render nhanh hơn'],
    chrome: ['Google Chrome', 'Cần cho tab Tài khoản và tạo video AI'], python: ['Python', 'Chạy các công cụ giọng đọc'], edge: ['Edge-TTS (giọng Hoài My, Nam Minh)', 'Cần internet khi đọc'],
    vieneu: ['VieNeu-TTS', 'Giọng Việt chạy trên máy (tuỳ chọn)'], demucs: ['Demucs (tách giọng bằng AI)', 'Tab Tách âm đang dùng bộ lọc ffmpeg'], disk: ['Thư mục xuất', 'Nơi lưu video, âm thanh']
  };
  async function resRefresh() {
    const m = $('modal-resources'); if (!m) return; const body = m.querySelector('.sesame-modal-content'), title = m.querySelector('.sesame-modal-title');
    body.innerHTML = '<div style="padding:14px;opacity:.7">Đang kiểm tra…</div>';
    const list = await api.feat('resources-check');
    const okN = list.filter(x => x.ok).length; if (title) title.textContent = `Trung Tâm Tài Nguyên (${okN}/${list.length} sẵn sàng)`;
    body.innerHTML = list.map(x => { const n = RES_NAMES[x.id] || [x.id, '']; return `<div class="res-item-row"><div><div class="res-item-title">${esc(n[0])}</div><div class="res-item-desc">${esc(n[1])} — ${esc(x.detail || '')}</div></div>
      ${x.canInstall ? `<button class="sesame-btn-start btn-sm" data-inst="${x.id}">Cài đặt</button>` : `<span class="res-status-chip" style="${x.ok ? '' : 'opacity:.7'}">${x.ok ? '✓ Sẵn sàng' : '✗ Chưa có'}</span>`}</div>`; }).join('') +
      '<div style="padding:10px 4px"><button class="sesame-btn-outline btn-sm" id="btn-res-recheck">Kiểm tra lại</button></div>';
    $('btn-res-recheck').onclick = resRefresh;
    body.querySelectorAll('[data-inst]').forEach(b => b.onclick = async () => { b.disabled = true; b.textContent = 'Đang cài…'; const r = await api.feat('resources-install-edge'); toast(r.ok ? 'Đã cài edge-tts' : 'Lỗi cài đặt: ' + (r.error || ''), 6000); resRefresh(); });
  }
  function resInit() {
    const m = $('modal-resources'); if (!m) return;
    new MutationObserver(() => { if (m.style.display !== 'none') resRefresh(); }).observe(m, { attributes: true, attributeFilter: ['style', 'class'] });
  }

  // =========================== EDIT / GHÉP VIDEO ===========================
  const ed = { clips: [], busy: false };
  async function edAddFiles(files) {
    for (const f of files) { const p = await api.feat('probe-dur', f); ed.clips.push({ path: f, dur: p.ok ? p.duration : 0, w: p.width, h: p.height }); }
    edRender();
  }
  function edRender() {
    const cnt = document.querySelector('#tab-edit .proj-count-label'); if (cnt) cnt.textContent = `Clip (${ed.clips.length})`;
    const stage = document.querySelector('#tab-edit .edit-projects-empty-stage'); if (!stage) return;
    if (!ed.clips.length) { stage.innerHTML = '<div class="empty-icon-box">🎞</div><div class="empty-title">Chưa có clip nào</div><div class="empty-sub">Bấm "Tạo dự án" hoặc "Chọn video để chỉnh sửa" để thêm các video cần ghép.</div>'; return; }
    const total = ed.clips.reduce((a, c) => a + c.dur, 0);
    stage.style.cssText = 'display:block;width:100%;text-align:left';
    stage.innerHTML = `<div style="display:flex;flex-direction:column;gap:6px;width:100%">${ed.clips.map((c, i) => `<div style="display:flex;gap:8px;align-items:center;padding:7px 10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-surface)">
      <b style="width:26px;opacity:.7">${i + 1}</b><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(c.path)}">${esc(baseName(c.path))}</span>
      <span style="font-size:12px;opacity:.7">${c.w ? c.w + '×' + c.h + ' · ' : ''}${fmt(c.dur)}</span>
      <button class="sesame-btn-icon" data-up="${i}" title="Lên">▲</button><button class="sesame-btn-icon" data-dn="${i}" title="Xuống">▼</button><button class="sesame-btn-icon" data-rm="${i}" title="Xóa">✕</button></div>`).join('')}
      <div style="display:flex;gap:10px;align-items:center;margin-top:8px;flex-wrap:wrap">
        <label class="sesame-check-label"><input type="checkbox" id="chk-edit-norm" checked /> Chuẩn hoá khung hình/âm thanh (khuyên dùng khi clip khác độ phân giải)</label>
        <span style="margin-left:auto;font-size:12px;opacity:.75">Tổng ${fmt(total)}</span>
        <button class="sesame-btn-outline" id="btn-edit-save">💾 Lưu dự án</button>
        <button class="sesame-btn-start" id="btn-edit-merge">▶ Ghép & xuất video</button></div></div>`;
    stage.querySelectorAll('[data-up]').forEach(b => b.onclick = () => { const i = +b.dataset.up; if (i > 0) { [ed.clips[i - 1], ed.clips[i]] = [ed.clips[i], ed.clips[i - 1]]; edRender(); } });
    stage.querySelectorAll('[data-dn]').forEach(b => b.onclick = () => { const i = +b.dataset.dn; if (i < ed.clips.length - 1) { [ed.clips[i + 1], ed.clips[i]] = [ed.clips[i], ed.clips[i + 1]]; edRender(); } });
    stage.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { ed.clips.splice(+b.dataset.rm, 1); edRender(); });
    $('btn-edit-save').onclick = async () => { const r = await api.feat('save-json', { name: 'duan.sesproj', data: { v: 1, clips: ed.clips.map(c => c.path) } }); if (r.ok) toast('Đã lưu dự án'); };
    $('btn-edit-merge').onclick = edMerge;
  }
  async function edMerge() {
    if (ed.busy) return; if (ed.clips.length < 2) return toast('Cần ít nhất 2 clip để ghép');
    ed.busy = true; const b = $('btn-edit-merge'); busy(b, true, 'Đang ghép…');
    const off = api.onProgress((d) => { if (d.channel === 'edit' && b) b.textContent = `Đang ghép… ${d.percent != null ? d.percent + '%' : ''}`; });
    const r = await api.feat('merge-run', { files: ed.clips.map(c => c.path), normalize: $('chk-edit-norm') ? $('chk-edit-norm').checked : true });
    off && off(); ed.busy = false; busy(b, false);
    if (r && r.ok) { toast('Đã xuất: ' + r.outputPath, 6000); api.openPath(r.outputPath.replace(/[^\\/]+$/, '')); } else toast('Lỗi ghép: ' + (r && r.error || 'không rõ'), 8000);
  }
  function edInit() {
    if (!$('tab-edit')) return;
    const add = async () => { const fs_ = await api.feat('pick-multi', { kind: 'video' }); if (fs_ && fs_.length) edAddFiles(fs_); };
    const hero = stripListeners('btn-edit-create-proj'); hero && hero.addEventListener('click', add);
    stripListeners('btn-edit-pick-video')?.addEventListener('click', add);
    stripListeners('btn-edit-open-proj')?.addEventListener('click', async () => {
      const f = (await api.feat('pick-multi', { kind: 'json' }))[0]; if (!f) return;
      const r = await api.feat('read-json', f); if (!r.ok || !Array.isArray(r.data.clips)) return toast('File dự án không hợp lệ');
      ed.clips = []; await edAddFiles(r.data.clips); toast('Đã mở dự án');
    });
    stripListeners('btn-edit-clear-all')?.addEventListener('click', () => { ed.clips = []; edRender(); });
    edRender();
  }

  // =========================== REVIEW PHIM AI ===========================
  const rv = { queue: [], cur: -1, cues: [], busy: false };
  const rvStatus = (t) => { const e = $('rv-status'); if (e) e.textContent = t; };
  function rvQueueRender() {
    const box = document.querySelector('#tab-review .queue-list');
    const badge = document.querySelector('#tab-review .queue-count-badge');
    if (badge) badge.textContent = rv.queue.length + ' video';
    if (!box) return;
    if (!rv.queue.length) { box.innerHTML = '<div class="queue-empty-text">Chưa có video trong hàng đợi review.</div>'; return; }
    box.innerHTML = rv.queue.map((q, i) => `<div data-i="${i}" style="display:flex;gap:6px;align-items:center;padding:5px 8px;border-radius:6px;cursor:pointer;${i === rv.cur ? 'background:var(--emerald-light);' : ''}">
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${esc(baseName(q.path))}</span><span style="font-size:11px;opacity:.8">${esc(q.state || '')}</span>
      <button class="sesame-btn-icon" data-rm="${i}" title="Xóa">✕</button></div>`).join('');
    box.querySelectorAll('[data-i]').forEach(el => el.addEventListener('click', (e) => {
      if (e.target.dataset.rm != null) { rv.queue.splice(+e.target.dataset.rm, 1); if (rv.cur >= rv.queue.length) rv.cur = rv.queue.length - 1; rvQueueRender(); return; }
      rv.cur = +el.dataset.i; rvQueueRender();
    }));
  }
  async function rvAdd() {
    const f = await api.feat('pick', { kind: 'video' }); if (!f) return;
    rv.queue.push({ path: f, state: '' }); rv.cur = rv.queue.length - 1; rvQueueRender();
    const srt = f.replace(/\.[^.\\/]+$/, '.srt'); const t = await api.feat('read-text', srt);
    if (t.ok) { const r = await api.feat('parse-srt', t.text); if (r.cues && r.cues.length) { rv.cues = r.cues; rvStatus(`Đã nạp ${r.cues.length} dòng phụ đề gốc từ ${baseName(srt)}`); } }
  }
  async function rvImportSrt() {
    const f = await api.feat('pick', { kind: 'srt' }); if (!f) return;
    if (!/\.srt$/i.test(f)) return toast('Hãy chọn file .srt', 4000);
    const t = await api.feat('read-text', f); if (!t.ok) return toast('Không đọc được file');
    const r = await api.feat('parse-srt', t.text); rv.cues = r.cues || []; rvStatus(`Đã nạp ${rv.cues.length} dòng phụ đề gốc (${baseName(f)})`);
  }
  async function rvWrite(btn) {
    if (!rv.cues.length) { toast('Hãy nhập phụ đề gốc của phim (SRT) trước.', 5000); return false; }
    const s = await api.feat('get-settings');
    if (s.provider === 'local' || !s.hasKey) { const p = await srtSettings(); if (!p) return false; }
    const old = btn && btn.textContent; if (btn) busy(btn, true, 'Đang viết lời bình…');
    const off = api.onProgress((d) => { if (d.channel === 'review' && btn && d.percent != null) btn.textContent = `Đang viết lời bình… ${d.percent}%`; });
    const r = await api.feat('review-script', { cues: rv.cues, style: $('sel-review-style').value });
    off && off(); if (btn) busy(btn, false, old);
    if (!r || !r.ok) { toast('Lỗi viết lời bình: ' + (r && r.error || 'không rõ'), 9000); return false; }
    const txt = await api.feat('cues-to-srt', r.cues); $('rv-script').value = txt.text; rvStatus(`Đã viết ${r.cues.length} đoạn lời bình${r.missing ? ` (${r.missing} đoạn thiếu)` : ''}. Bạn có thể sửa trực tiếp trong ô bên dưới.`);
    return true;
  }
  async function rvStart() {
    if (rv.busy) return toast('Đang xử lý…'); if (!rv.queue.length) return toast('Hãy chọn video trước');
    const btn = $('btn-review-start');
    if (!$('rv-script').value.trim()) { rv.busy = true; const ok = await rvWrite(btn); rv.busy = false; if (!ok) return; }
    const parsed = await api.feat('parse-srt', $('rv-script').value); const narr = parsed.cues || [];
    if (!narr.length) return toast('Lời bình trống hoặc sai định dạng SRT');
    rv.busy = true; busy(btn, true, 'Đang dựng video…');
    const off = api.onProgress((d) => {
      if (d.channel !== 'dub') return; const q = rv.queue[rv.cur]; if (q) q.state = d.percent != null ? d.percent + '%' : '';
      if (btn) btn.textContent = (d.text || 'Đang dựng video…') + (d.percent != null ? ` ${d.percent}%` : ''); });
    const voice = $('sel-review-voice').value; const q = rv.queue[rv.cur >= 0 ? rv.cur : 0];
    const r = await api.feat('dub-run', { videoPath: q.path, cues: narr, voiceId: voice, dub: true, burnSub: false, timeSync: true, shield: false, origVol: +$('rv-origvol').value, dubVol: 100, speed: 1, res: $('sel-review-res').value });
    off && off(); rv.busy = false; busy(btn, false);
    if (r && r.ok) { q.state = '✓ Xong'; q.out = r.outputPath; rvQueueRender(); toast('Đã xuất: ' + r.outputPath, 6000); api.openPath(r.outputPath.replace(/[^\\/]+$/, '')); }
    else { q.state = '✗ Lỗi'; rvQueueRender(); toast('Lỗi dựng video: ' + (r && r.error || 'không rõ'), 9000); }
  }
  async function rvInit() {
    const tab = $('tab-review'); if (!tab) return;
    stripListeners('btn-review-pick-video')?.addEventListener('click', rvAdd);
    stripListeners('btn-review-add-queue')?.addEventListener('click', rvAdd);
    stripListeners('btn-review-pick-folder')?.addEventListener('click', () => toast('Chọn thư mục chưa hỗ trợ — thêm từng video.', 4500));
    stripListeners('btn-review-download-video')?.addEventListener('click', () => toast('Tải video từ link chưa hỗ trợ.', 4500));
    stripListeners('btn-review-clear-queue')?.addEventListener('click', () => { rv.queue = []; rv.cur = -1; rvQueueRender(); });
    stripListeners('btn-review-add-bgm')?.addEventListener('click', () => toast('Nhạc nền bổ sung chưa hỗ trợ.', 4000));
    stripListeners('btn-review-apply')?.addEventListener('click', () => toast('Thiết lập đã được áp dụng cho lần chạy sau.', 3000));
    stripListeners('btn-review-start')?.addEventListener('click', rvStart);
    // chỉ giữ hai giọng thật
    const sel = $('sel-review-voice');
    if (sel) { const voices = await api.feat('voices').catch(() => []); const real = voices.filter(v => /^vi-VN-/.test(v.id)); if (real.length) { sel.innerHTML = real.map(v => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join(''); } }
    const dur = $('sel-review-duration'); if (dur) { dur.disabled = true; dur.title = 'Chưa hỗ trợ: lời bình hiện bám theo toàn bộ phim, chưa tự cắt ngắn.'; }
    const anchor = sel && sel.closest('.review-sidebar-block');
    if (anchor && !$('rv-script')) {
      const blk = document.createElement('div'); blk.className = 'review-sidebar-block';
      blk.innerHTML = `<label class="block-label">Phụ đề gốc & lời bình</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="sesame-btn-outline btn-sm" id="rv-import">📄 Nhập SRT phim</button><button class="sesame-btn-outline btn-sm" id="rv-write">✍ Viết lời bình</button></div>
        <div id="rv-status" style="font-size:12px;opacity:.8;margin:6px 0">Chưa có phụ đề gốc (cần file .srt của phim)</div>
        <textarea id="rv-script" class="sesame-input-text" rows="7" placeholder="Lời bình (định dạng SRT) sẽ hiện ở đây sau khi bấm Viết lời bình. Có thể sửa tay." style="width:100%;resize:vertical;font-size:12px"></textarea>
        <div style="display:flex;gap:8px;align-items:center;margin-top:6px"><span style="font-size:12px">Âm gốc</span><input type="range" min="0" max="60" value="12" id="rv-origvol" class="sesame-slider" style="flex:1" /><span id="rv-origvol-v" style="font-size:12px;width:34px">12%</span></div>`;
      anchor.insertAdjacentElement('afterend', blk);
      $('rv-import').onclick = rvImportSrt; $('rv-write').onclick = (e) => rvWrite(e.currentTarget);
      $('rv-origvol').oninput = (e) => { $('rv-origvol-v').textContent = e.target.value + '%'; };
    }
    rvQueueRender();
  }

  document.addEventListener('DOMContentLoaded', () => { cutInit(); audInit(); srtInit(); ttsInit(); resInit(); edInit(); rvInit(); });
})();
