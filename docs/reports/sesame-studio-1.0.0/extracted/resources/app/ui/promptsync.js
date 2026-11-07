'use strict';
/* TAB PROMPT ĐỒNG BỘ — Hồ sơ nhân vật + Hồ sơ bối cảnh + các cảnh → prompt cùng một khuôn, phần Hồ sơ lặp nguyên văn ở mọi cảnh.
   Chỉ tạo văn bản (sao chép / lưu .txt). KHÔNG tự gửi vào hàng đợi, không dùng quota. */
(function () {
  const api = window.sesame;
  const root = document.getElementById('tab-promptsync');
  if (!root || !api || !api.psyncBuild) return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, k) => { try { window.App && window.App.toast && window.App.toast(m, k || 'ok'); } catch (_) {} };
  const KEY = 'sesame.promptsync.v1';
  const SHOTS = ['WS', 'MS', 'MCU', 'CU', 'ECU'];
  const ANGLES = ['eye-level', 'low angle', 'high angle', 'Dutch angle', 'over-the-shoulder'];
  const MOVES = ['static shot', 'slow push-in', 'rapid push-in', 'slow pan', 'tracking shot', 'snap zoom', 'handheld'];
  const blankScene = () => ({ characters: [], action: '', shot: 'MS', angle: 'eye-level', move: 'static shot', setting: '', mood: '', music: '', sfx: '', dialogue: [] });
  const blank = () => ({ styleName: '', styleDesc: '', location: { name: '', desc: '' }, defaultMusic: '', characters: [{ name: '', anatomy: '', voice: '' }], scenes: [blankScene()], options: { subtitlesOff: true, noSinging: true, exclusiveCast: true, lockAppearance: true, dialogueLang: 'vi' } });
  let S; try { S = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) {} if (!S || !S.scenes) S = blank();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (_) {} };
  let timer = 0, last = null;

  const css = document.createElement('style');
  css.textContent = `
  #tab-promptsync .ps-wrap{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:16px;padding:14px 20px 24px;height:100%;min-height:0}
  #tab-promptsync .ps-col{display:flex;flex-direction:column;gap:12px;min-height:0;overflow:auto;padding-right:4px}
  #tab-promptsync h1.ps-title{margin:0;font-size:21px}
  #tab-promptsync .ps-sub{font-size:12.5px;color:var(--ink-3)}
  #tab-promptsync .ps-card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
  #tab-promptsync .ps-card h3{margin:0;font-size:14px;display:flex;align-items:center;gap:8px}
  #tab-promptsync .ps-card h3 .grow{flex:1}
  #tab-promptsync .ps-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  #tab-promptsync label.ps-l{font-size:12px;color:var(--ink-2);min-width:64px}
  #tab-promptsync input[type=text],#tab-promptsync textarea,#tab-promptsync select{border:1px solid var(--line-2);background:var(--canvas);color:var(--ink);border-radius:8px;padding:6px 9px;font:inherit;font-size:12.5px;min-width:0}
  #tab-promptsync textarea{width:100%;min-height:58px;resize:vertical}
  #tab-promptsync .ps-grow{flex:1}
  #tab-promptsync .ps-btn{border:1px solid var(--line-2);background:var(--surface);color:var(--ink);border-radius:999px;padding:5px 13px;font-size:12.5px;font-weight:600;cursor:pointer}
  #tab-promptsync .ps-btn:hover{border-color:var(--blue-2);color:var(--blue)}
  #tab-promptsync .ps-btn.pri{background:var(--grad);color:#fff;border-color:transparent}
  #tab-promptsync .ps-btn.x:hover{border-color:#ef4444;color:#ef4444}
  #tab-promptsync .ps-item{border:1px dashed var(--line-2);border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:6px}
  #tab-promptsync .ps-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line-2);border-radius:999px;padding:2px 10px;font-size:12px;cursor:pointer;user-select:none}
  #tab-promptsync .ps-chip.on{background:var(--blue-tint);border-color:var(--blue-2);color:var(--blue);font-weight:700}
  #tab-promptsync .ps-out{white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,Consolas,monospace;font-size:11.5px;background:var(--soft);border-radius:10px;padding:8px 10px;max-height:240px;overflow:auto}
  #tab-promptsync .ps-warn{font-size:12px;color:#92400e;background:#fff7e6;border:1px solid #f0d79a;border-radius:8px;padding:5px 9px}
  #tab-promptsync .ps-ok{font-size:12px;color:#166534;background:#e8f7ee;border:1px solid #9fd8b4;border-radius:8px;padding:5px 9px}
  #tab-promptsync .ps-bad{font-size:12px;color:#991b1b;background:#fdecec;border:1px solid #f1b0b0;border-radius:8px;padding:5px 9px}
  #tab-promptsync .ps-chk{display:flex;align-items:center;gap:6px;font-size:12.5px}
  @media (max-width:1000px){#tab-promptsync .ps-wrap{grid-template-columns:1fr;height:auto}}
  `;
  document.head.appendChild(css);

  const opt = (arr, v) => arr.map(x => `<option${x === v ? ' selected' : ''}>${esc(x)}</option>`).join('');
  function render() {
    const O = S.options;
    root.innerHTML = `<div class="ps-wrap">
      <div class="ps-col" id="ps-left">
        <div><h1 class="ps-title">Prompt đồng bộ</h1><div class="ps-sub">Viết Hồ sơ một lần — app lặp nguyên văn ở mọi cảnh để giữ cùng bối cảnh và nhân vật. Chỉ tạo văn bản, không tự gửi đi.</div></div>
        <div class="ps-row"><button class="ps-btn" id="ps-import">📂 Nhập từ file prompt mẫu…</button><button class="ps-btn x" id="ps-reset">Làm mới</button></div>
        <div class="ps-card"><h3>Phong cách &amp; địa điểm</h3>
          <div class="ps-row"><label class="ps-l">Phong cách</label><input type="text" class="ps-grow" data-p="styleName" value="${esc(S.styleName)}" placeholder="VD: 3D Animation"></div>
          <textarea data-p="styleDesc" placeholder="Mô tả phong cách (ánh sáng, chất liệu, độ phân giải…)">${esc(S.styleDesc)}</textarea>
          <div class="ps-row"><label class="ps-l">Địa điểm</label><input type="text" class="ps-grow" data-p="location.name" value="${esc(S.location.name)}" placeholder="Tên địa điểm"></div>
          <textarea data-p="location.desc" placeholder="Mô tả địa điểm: sàn, tường, đồ vật, ánh sáng… (lặp nguyên văn ở mọi cảnh)">${esc(S.location.desc)}</textarea>
          <div class="ps-row"><label class="ps-l">Nhạc nền</label><input type="text" class="ps-grow" data-p="defaultMusic" value="${esc(S.defaultMusic)}" placeholder="Nhạc mặc định cho cảnh không ghi riêng"></div>
        </div>
        <div class="ps-card"><h3>Tùy chọn khoá <span class="grow"></span></h3>
          <label class="ps-chk"><input type="checkbox" data-o="lockAppearance"${O.lockAppearance !== false ? ' checked' : ''}> Khoá ngoại hình (“Appearance is FIXED”)</label>
          <label class="ps-chk"><input type="checkbox" data-o="exclusiveCast"${O.exclusiveCast !== false ? ' checked' : ''}> Chỉ các nhân vật liệt kê được xuất hiện</label>
          <label class="ps-chk"><input type="checkbox" data-o="subtitlesOff"${O.subtitlesOff !== false ? ' checked' : ''}> Tắt phụ đề trong video</label>
          <label class="ps-chk"><input type="checkbox" data-o="noSinging"${O.noSinging !== false ? ' checked' : ''}> Cấm hát</label>
          <div class="ps-row"><label class="ps-l">Ngôn ngữ thoại</label><select data-o="dialogueLang"><option value="vi"${O.dialogueLang === 'vi' ? ' selected' : ''}>Tiếng Việt (khoá)</option><option value="en"${O.dialogueLang === 'en' ? ' selected' : ''}>English (khoá)</option><option value=""${!O.dialogueLang ? ' selected' : ''}>Không khoá</option></select></div>
        </div>
        <div class="ps-card"><h3>Hồ sơ nhân vật <span class="grow"></span><button class="ps-btn" id="ps-addchar">＋ Thêm nhân vật</button></h3>
          ${S.characters.map((c, i) => `<div class="ps-item"><div class="ps-row"><input type="text" class="ps-grow" data-c="${i}.name" value="${esc(c.name)}" placeholder="Tên nhân vật (dùng đúng tên này trong cảnh)"><button class="ps-btn x" data-rmc="${i}">✕</button></div>
            <textarea data-c="${i}.anatomy" placeholder="Ngoại hình KHOÁ: giống loài/độ tuổi, khuôn mặt, tóc, trang phục, tỉ lệ cơ thể…">${esc(c.anatomy)}</textarea>
            <textarea data-c="${i}.voice" style="min-height:44px" placeholder="Giọng: giới tính, tuổi, giọng vùng, âm sắc, nhịp nói…">${esc(c.voice)}</textarea></div>`).join('')}
        </div>
        <div class="ps-card"><h3>Các cảnh <span class="grow"></span><button class="ps-btn" id="ps-addscene">＋ Thêm cảnh</button></h3>
          ${S.scenes.map((s, i) => `<div class="ps-item"><div class="ps-row"><b>Cảnh ${i + 1}</b><span class="ps-grow"></span><button class="ps-btn" data-dups="${i}" title="Nhân đôi cảnh">⧉</button><button class="ps-btn x" data-rms="${i}">✕</button></div>
            <div class="ps-row">${S.characters.filter(c => c.name.trim()).map(c => `<span class="ps-chip${(s.characters || []).includes(c.name) ? ' on' : ''}" data-cast="${i}|${esc(c.name)}">${esc(c.name)}</span>`).join('') || '<span class="ps-sub">Thêm nhân vật ở trên rồi chọn ai xuất hiện.</span>'}</div>
            <textarea data-s="${i}.action" placeholder="Hành động trong cảnh">${esc(s.action)}</textarea>
            <div class="ps-row"><label class="ps-l">Cỡ cảnh</label><select data-s="${i}.shot">${opt(SHOTS, s.shot)}</select><select data-s="${i}.angle">${opt(ANGLES, s.angle)}</select><select data-s="${i}.move">${opt(MOVES, s.move)}</select></div>
            <div class="ps-row"><label class="ps-l">Tâm trạng</label><input type="text" class="ps-grow" data-s="${i}.mood" value="${esc(s.mood)}"></div>
            <div class="ps-row"><label class="ps-l">Nhạc</label><input type="text" class="ps-grow" data-s="${i}.music" value="${esc(s.music)}" placeholder="(để trống = nhạc nền mặc định)"><label class="ps-l" style="min-width:38px">SFX</label><input type="text" class="ps-grow" data-s="${i}.sfx" value="${esc(s.sfx)}"></div>
            <div class="ps-row"><label class="ps-l">Bối cảnh</label><input type="text" class="ps-grow" data-s="${i}.setting" value="${esc(s.setting)}" placeholder="(để trống = câu đầu của mô tả địa điểm)"></div>
            ${(s.dialogue || []).map((d, j) => `<div class="ps-row"><select data-d="${i}.${j}.speaker">${['', ...S.characters.filter(c => c.name.trim()).map(c => c.name)].map(n => `<option${n === d.speaker ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select><input type="text" style="width:130px" data-d="${i}.${j}.delivery" value="${esc(d.delivery)}" placeholder="cách nói"><input type="text" class="ps-grow" data-d="${i}.${j}.text" value="${esc(d.text)}" placeholder="Lời thoại"><button class="ps-btn x" data-rmd="${i}.${j}">✕</button></div>`).join('')}
            <div class="ps-row"><button class="ps-btn" data-adddlg="${i}">＋ Thêm lời thoại</button></div></div>`).join('')}
        </div>
      </div>
      <div class="ps-col" id="ps-right"><div class="ps-card"><h3>Kết quả <span class="grow"></span><button class="ps-btn" id="ps-copyall">Sao chép tất cả</button><button class="ps-btn pri" id="ps-savetxt">Lưu .txt</button></h3><div id="ps-status"></div></div><div id="ps-outs"></div></div></div>`;
    bind(); rebuild(true);
  }
  const setPath = (obj, path, v) => { const k = path.split('.'); let o = obj; k.slice(0, -1).forEach(x => o = o[x]); o[k[k.length - 1]] = v; };
  function bind() {
    root.querySelectorAll('[data-p]').forEach(el => el.oninput = () => { setPath(S, el.dataset.p, el.value); changed(); });
    root.querySelectorAll('[data-o]').forEach(el => el.onchange = () => { S.options[el.dataset.o] = el.type === 'checkbox' ? el.checked : el.value; changed(); });
    root.querySelectorAll('[data-c]').forEach(el => el.oninput = () => {
      const [i, f] = el.dataset.c.split('.'); const old = S.characters[+i].name; S.characters[+i][f] = el.value;
      if (f === 'name') S.scenes.forEach(sc => { sc.characters = (sc.characters || []).map(n => n === old ? el.value : n); (sc.dialogue || []).forEach(d => { if (d.speaker === old) d.speaker = el.value; }); });
      changed(f === 'name');   // đổi tên → vẽ lại danh sách chip/người nói khi rời ô
    });
    root.querySelectorAll('[data-s]').forEach(el => el.oninput = el.onchange = () => { const [i, f] = el.dataset.s.split('.'); S.scenes[+i][f] = el.value; changed(); });
    root.querySelectorAll('[data-d]').forEach(el => el.oninput = el.onchange = () => { const [i, j, f] = el.dataset.d.split('.'); S.scenes[+i].dialogue[+j][f] = el.value; changed(); });
    root.querySelectorAll('[data-cast]').forEach(el => el.onclick = () => { const [i, n] = el.dataset.cast.split('|'); const sc = S.scenes[+i]; sc.characters = sc.characters || []; const k = sc.characters.indexOf(n); if (k >= 0) sc.characters.splice(k, 1); else sc.characters.push(n); el.classList.toggle('on'); changed(); });
    root.querySelectorAll('[data-rmc]').forEach(el => el.onclick = () => { S.characters.splice(+el.dataset.rmc, 1); save(); render(); });
    root.querySelectorAll('[data-rms]').forEach(el => el.onclick = () => { S.scenes.splice(+el.dataset.rms, 1); if (!S.scenes.length) S.scenes.push(blankScene()); save(); render(); });
    root.querySelectorAll('[data-dups]').forEach(el => el.onclick = () => { const i = +el.dataset.dups; S.scenes.splice(i + 1, 0, JSON.parse(JSON.stringify(S.scenes[i]))); save(); render(); });
    root.querySelectorAll('[data-adddlg]').forEach(el => el.onclick = () => { const sc = S.scenes[+el.dataset.adddlg]; sc.dialogue = sc.dialogue || []; sc.dialogue.push({ speaker: (sc.characters || [])[0] || '', delivery: '', text: '' }); save(); render(); });
    root.querySelectorAll('[data-rmd]').forEach(el => el.onclick = () => { const [i, j] = el.dataset.rmd.split('.'); S.scenes[+i].dialogue.splice(+j, 1); save(); render(); });
    root.querySelector('#ps-addchar').onclick = () => { S.characters.push({ name: '', anatomy: '', voice: '' }); save(); render(); };
    root.querySelector('#ps-addscene').onclick = () => { const prev = S.scenes[S.scenes.length - 1]; const ns = blankScene(); ns.characters = [...(prev && prev.characters || [])]; ns.music = prev ? prev.music : ''; S.scenes.push(ns); save(); render(); };
    root.querySelector('#ps-reset').onclick = () => { if (!confirm('Xoá toàn bộ nội dung đang soạn trong tab này?')) return; S = blank(); save(); render(); };
    root.querySelector('#ps-import').onclick = async () => {
      const f = await api.pickFile({ title: 'Chọn file prompt mẫu (.txt)', filters: [{ name: 'Text', extensions: ['txt'] }] }); if (!f) return;
      const r = await api.psyncParse({ filePath: f });
      if (!r || !r.ok || !r.project.scenes.length) { toast('Không nhận ra khối prompt nào trong file này', 'warn'); return; }
      if (!confirm(`Nhập ${r.project.scenes.length} cảnh và ${r.project.characters.length} nhân vật từ file? Nội dung đang soạn sẽ bị thay.`)) return;
      S = { ...blank(), ...r.project, defaultMusic: '', options: { ...blank().options, ...(r.project.options || {}) } }; save(); render(); toast('Đã nhập từ file mẫu', 'ok');
    };
    root.querySelector('#ps-copyall').onclick = async () => { if (!last) return; try { await navigator.clipboard.writeText(last.scenes.map(s => s.text).join('\n\n')); toast('Đã sao chép ' + last.scenes.length + ' prompt', 'ok'); } catch (_) { toast('Không sao chép được', 'err'); } };
    root.querySelector('#ps-savetxt').onclick = async () => { if (!last) return; const r = await api.saveText({ defaultName: 'prompt_dong_bo.txt', text: last.scenes.map(s => s.text).join('\n\n') }); if (r && r.ok) toast('Đã lưu: ' + r.path, 'ok'); };
  }
  function changed(rerender) { save(); clearTimeout(timer); timer = setTimeout(() => { rebuild(); if (rerender) { /* chip/người nói cập nhật khi vẽ lại lần sau */ } }, 250); }
  async function rebuild() {
    const r = await api.psyncBuild(S); last = r;
    const st = root.querySelector('#ps-status'), outs = root.querySelector('#ps-outs'); if (!st || !outs) return;
    const c = r.consistency || {};
    st.innerHTML = (c.ok ? '<div class="ps-ok">✔ Phần Hồ sơ (phong cách, địa điểm, ngoại hình, giọng) giống hệt nhau ở cả ' + r.scenes.length + ' cảnh.</div>' : '<div class="ps-bad">✖ Hồ sơ giữa các cảnh KHÔNG giống nhau' + ((c.driftingCharacters || []).length ? ' — lệch ở: ' + c.driftingCharacters.map(esc).join(', ') : '') + '.</div>') +
      (r.warnings || []).slice(0, 12).map(w => `<div class="ps-warn" style="margin-top:4px">⚠ ${esc(w)}</div>`).join('');
    outs.innerHTML = r.scenes.map(s => `<div class="ps-card"><h3>Cảnh ${s.index} <span class="ps-sub">${s.length} ký tự</span><span class="grow"></span><button class="ps-btn" data-copy="${s.index - 1}">Sao chép</button></h3><div class="ps-out">${esc(s.text)}</div></div>`).join('');
    outs.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(last.scenes[+b.dataset.copy].text); toast('Đã sao chép cảnh ' + (+b.dataset.copy + 1), 'ok'); } catch (_) { toast('Không sao chép được', 'err'); } });
  }
  document.addEventListener('app:tab', e => { if (e.detail === 'tab-promptsync') render(); });
  if (root.classList.contains('active')) render();
})();
