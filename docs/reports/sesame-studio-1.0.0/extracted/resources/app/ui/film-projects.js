/**
 * Film Project v1 — Shot Board inside the existing Kịch bản / Phim ngắn mode.
 * Only holds approved shots in the main TaskStore; never starts a paid AI call here.
 * All writes go through narrow IPC; no renderer-supplied filesystem path.
 */
(function () {
  'use strict';
  const A = window.App;
  if (!A || !document.getElementById('film-board')) return;
  const { api, $, escapeHtml: esc, fileUrl, toast } = A;
  const MODE = { film: 'Phim AI', story: 'Reel truyện', hiu: 'HIU', affiliate: 'Affiliate' };
  let current = null, tasks = [], dirty = new Set(), busy = false;
  const listEl = $('film-project-select'), messageEl = $('film-board-message'), scenesEl = $('film-scenes'), charsEl = $('film-characters');
  const msg = (text, tone = 'info') => { messageEl.textContent = text || ''; messageEl.dataset.tone = tone; };
  const safe = fn => async (...args) => {
    if (busy) return;
    busy = true;
    try { return await fn(...args); }
    catch (e) { const text = e?.message || String(e); msg(text, 'danger'); toast(text, 'danger'); }
    finally { busy = false; }
  };
  const taskOf = id => tasks.find(t => t.id === id);
  const assetOf = id => current?.assets?.find(a => a.id === id);
  const characterOf = id => current?.characters?.find(c => c.id === id);

  async function loadList(preferId) {
    if (!api?.filmList) { msg('Bản Sesame Studio này chưa nạp Project Store. Mở lại app sau khi cập nhật.', 'warn'); return; }
    const result = await api.filmList();
    const projects = Array.isArray(result) ? result : result?.projects || [];
    const previous = preferId || listEl.value || current?.id || '';
    listEl.innerHTML = '<option value="">Chọn dự án…</option>' + projects.map(p =>
      `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(MODE[p.mode] || p.mode)}</option>`).join('');
    if (previous && projects.some(p => p.id === previous)) listEl.value = previous;
    if (listEl.value) await loadProject(listEl.value);
    else { current = null; tasks = []; render(); }
  }

  async function loadProject(id) {
    if (!id) { current = null; tasks = []; dirty.clear(); render(); return; }
    current = await api.filmGet(id);
    const res = await api.listTasks().catch(() => ({ tasks: [] }));
    tasks = Array.isArray(res) ? res : res?.tasks || [];
    dirty.clear(); render();
  }

  function renderChars() {
    if (!current) { charsEl.innerHTML = ''; return; }
    const chars = current.characters || [];
    charsEl.innerHTML = chars.length ? chars.map(c => {
      const media = (c.assetIds || []).map(id => { const a = assetOf(id); if (!a) return '';
        const src = a.path || a.absPath || a.filePath || '';
        return src ? `<img src="${esc(fileUrl(src))}" alt="${esc(c.name)}" title="${esc(a.sourceName || c.name)}" class="film-asset-thumb">` : `<span class="film-asset-tag">${esc(a.sourceName || id)}</span>`;
      }).join('');
      return `<div class="film-character"><b>${esc(c.name)} · ${(c.assetIds || []).length} ảnh ref</b><span class="muted small">${esc(c.look || '')}</span>
        <div class="film-character-assets">${media || '<span class="muted small">Chưa có ảnh ref trong dự án</span>'}</div>
        <button type="button" class="btn-ghost btn-sm" data-film-action="pick-asset" data-char="${esc(c.id)}">Chọn ảnh nhân vật</button>
      </div>`;
    }).join('') : '<p class="muted small">Chưa có nhân vật. Dùng nút “Nạp spec Đạo diễn” ở dưới.</p>';
  }

  const shotHtml = (shot, scene) => {
    const t = taskOf(shot.taskId);
    const status = t ? (t.held ? 'Đã đưa vào chờ — chưa chạy' : `${t.status}${t.error ? ': ' + t.error : ''}`) :
      ({ draft: 'Nháp', approved: 'Đã duyệt', held: 'Đã đưa vào chờ', running: 'Đang chạy', done: 'Xong', failed: 'Lỗi' }[shot.status] || 'Nháp');
    const refs = [...new Set([...(shot.assetIds || []), ...(shot.castIds || []).flatMap(id => characterOf(id)?.assetIds || [])])];
    const refHtml = refs.length ? refs.map(id => { const a = assetOf(id); return `<span class="film-asset-tag">${esc(a?.sourceName || id)}</span>`; }).join('') : '<span class="muted small">Không có ảnh ref; Muse có thể lệch nhân vật</span>';
    const castHtml = (current.characters || []).map(c => `<label class="film-cast-check"><input type="checkbox" data-field="cast" value="${esc(c.id)}" ${shot.castIds?.includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('');
    const output = t?.files?.[0] || shot.outputPath;
    return `<article class="film-shot" data-scene="${esc(scene.id)}" data-shot="${esc(shot.id)}">
      <div class="film-shot-head"><b>${esc(scene.title || 'Cảnh')} · ${esc(shot.id)}</b><span class="film-status" title="${esc(t?.error || '')}">${esc(status)}</span></div>
      <div class="muted small">${Number(shot.seconds) || 0}s · ${esc(MODE[current.mode] || current.mode)}${shot.taskId ? ' · Task ' + esc(shot.taskId) : ''}</div>
      <label class="label">Nhân vật trong shot</label><div class="film-cast">${castHtml || '<span class="muted small">Cảnh không người</span>'}</div>
      <div class="film-shot-refs">${refHtml}</div>
      <label class="label">Prompt hình/video (sửa được)</label><textarea class="textarea film-prompt" data-field="prompt" rows="6">${esc(shot.prompt || '')}</textarea>
      <label class="label">Lời bình (tách khỏi prompt hình)</label><textarea class="textarea" data-field="narration" rows="2">${esc(shot.narration || '')}</textarea>
      <div class="film-shot-actions"><button type="button" class="btn-ghost btn-sm" data-film-action="save-shot">Lưu sửa đổi</button>
        <button type="button" class="btn-ghost btn-sm" data-film-action="approve-shot" ${shot.status === 'held' ? 'disabled' : ''}>Duyệt shot</button>
        <button type="button" class="btn btn-sm" data-film-action="hold-shot" ${shot.status !== 'approved' || shot.taskId ? 'disabled' : ''}>Đưa vào chờ · chưa chạy</button></div>
      ${output ? `<div class="film-output"><video src="${esc(fileUrl(output))}" controls preload="metadata"></video><span class="muted small">File kết quả: ${esc(output.split(/[\\/]/).pop())}</span></div>` : ''}
    </article>`;
  };

  function render() {
    const has = !!current;
    $('film-project-meta').textContent = has ? `${MODE[current.mode] || current.mode} · revision ${current.revision || 0} · ${current.scenes?.reduce((n,s) => n+(s.shots?.length||0),0) || 0} shot` : 'Chưa chọn dự án';
    $('film-project-import').disabled = !has || !['film','story'].includes(current.mode);
    $('film-project-refresh').disabled = !has;
    const directGen = document.querySelector('.film-advanced-send');
    if (directGen) directGen.hidden = has; // a selected project uses reviewed/held shots, not the legacy paid one-click path
    if (!has) { charsEl.innerHTML = ''; scenesEl.innerHTML = '<div class="ui-empty muted">Tạo một dự án để lưu nhân vật và phân cảnh. Chưa dùng lượt AI.</div>'; return; }
    renderChars();
    if (!['film','story'].includes(current.mode)) {
      scenesEl.innerHTML = '<p class="muted">Mode này hiện chỉ có project metadata. Luồng HIU/Affiliate sẽ được nối sau khi lát Phim/Reel qua test; chưa thể gửi task từ đây.</p>';
      return;
    }
    const list = (current.scenes || []).flatMap(scene => (scene.shots || []).map(shot => shotHtml(shot, scene)));
    scenesEl.innerHTML = list.length ? `<div class="film-shot-grid">${list.join('')}</div>` : '<div class="ui-empty muted">Nạp spec Đạo diễn đã kiểm tra ở phần trên. Shot sẽ hiện ở đây để sửa và duyệt trước khi đưa vào chờ.</div>';
  }

  function findShot(card) {
    const scene = current?.scenes?.find(s => s.id === card.dataset.scene);
    const shot = scene?.shots?.find(s => s.id === card.dataset.shot);
    if (!shot) throw new Error('Shot không còn tồn tại. Tải lại dự án.');
    return shot;
  }
  function dataFromCard(card) {
    return {
      prompt: card.querySelector('[data-field="prompt"]').value.trim(),
      narration: card.querySelector('[data-field="narration"]').value.trim(),
      castIds: [...card.querySelectorAll('[data-field="cast"]:checked')].map(x => x.value)
    };
  }

  $('film-project-create').addEventListener('click', safe(async () => {
    const name = $('film-project-new-name').value.trim();
    const mode = $('film-project-mode').value;
    if (!name) return msg('Nhập tên dự án trước.', 'warn');
    const p = await api.filmCreate({ name, mode });
    $('film-project-new-name').value = '';
    await loadList(p.id); msg(`Đã tạo dự án “${p.name}”. Chưa gen AI.`, 'ok');
  }));
  listEl.addEventListener('change', safe(async () => { await loadProject(listEl.value); msg(''); }));
  $('film-project-refresh').addEventListener('click', safe(async () => { await loadProject(listEl.value); msg('Đã làm mới trạng thái.'); }));
  $('film-project-import').addEventListener('click', safe(async () => {
    if (!current) return;
    const state = A.drama?.state?.();
    if (!state?.result?.ok || !state.spec) return msg('Bấm “Kiểm tra & xem lệnh” ở phần Đạo diễn trước, sửa mọi lỗi rồi nạp.', 'warn');
    if ((current.scenes || []).length && !window.confirm('Nạp spec mới sẽ thay các shot đang lưu trong dự án này (không xóa asset hay task cũ). Tiếp tục?')) return;
    const sourceText = $('drama-story')?.value.trim() || '';
    const p = await api.filmImportDirector(current.id, { ...state.spec, sourceText }, current.revision);
    current = p; dirty.clear(); render(); msg(`Đã lưu ${p.scenes?.reduce((n,s) => n+(s.shots?.length||0),0)} shot vào dự án. Chưa gửi Muse.`, 'ok');
  }));

  scenesEl.addEventListener('input', e => {
    const card = e.target.closest('.film-shot'); if (!card) return;
    dirty.add(card.dataset.shot); card.classList.add('film-dirty');
    card.querySelector('[data-film-action="approve-shot"]').disabled = true;
    card.querySelector('[data-film-action="hold-shot"]').disabled = true;
  });
  scenesEl.addEventListener('change', e => {
    if (e.target.matches('[data-field="cast"]')) e.target.dispatchEvent(new Event('input', { bubbles:true }));
  });
  scenesEl.addEventListener('click', safe(async e => {
    const btn = e.target.closest('[data-film-action]'); if (!btn) return;
    const card = btn.closest('.film-shot'); if (!card || !current) return;
    const shot = findShot(card);
    if (btn.dataset.filmAction === 'save-shot') {
      const data = dataFromCard(card);
      if (!data.prompt) return msg('Prompt shot không được trống.', 'warn');
      current = await api.filmMarkShot(current.id, shot.id, { ...data, status:'draft' }, current.revision);
      dirty.delete(shot.id); render(); msg('Đã lưu. Cần duyệt lại shot sau khi sửa.', 'ok');
    } else if (btn.dataset.filmAction === 'approve-shot') {
      if (dirty.has(shot.id)) return msg('Lưu sửa đổi trước khi duyệt.', 'warn');
      current = await api.filmMarkShot(current.id, shot.id, { status:'approved' }, current.revision);
      render(); msg('Đã duyệt shot. Chưa dùng lượt AI.', 'ok');
    } else if (btn.dataset.filmAction === 'hold-shot') {
      if (dirty.has(shot.id)) return msg('Lưu sửa đổi trước khi đưa vào chờ.', 'warn');
      const res = await api.filmHoldShot(current.id, shot.id, current.revision);
      current = res.project || res; tasks = [res.task, ...tasks].filter(Boolean);
      render(); msg('Task đã vào hàng đợi ở trạng thái CHƯA CHẠY. Không dùng lượt Muse.', 'ok');
    }
  }));
  charsEl.addEventListener('click', safe(async e => {
    const btn = e.target.closest('[data-film-action="pick-asset"]'); if (!btn || !current) return;
    if (dirty.size) return msg('Lưu thay đổi shot trước khi chọn ảnh, để không mất phần đang sửa.', 'warn');
    const p = await api.filmChooseAsset(current.id, btn.dataset.char);
    if (p) { current = p; render(); msg('Đã sao chép ảnh vào thư viện dự án. Không đụng ảnh gốc.', 'ok'); }
  }));

  A.filmProjects = { reload: () => loadList(current?.id), get activeProject() { return current; }, get dirty() { return dirty.size; } };
  loadList().catch(e => msg(e.message || String(e), 'danger'));
})();
