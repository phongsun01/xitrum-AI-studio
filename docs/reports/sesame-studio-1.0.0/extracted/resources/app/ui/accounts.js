/**
 * TÀI KHOẢN — danh sách tài khoản Muse (mỗi cái 1 Chrome), cài đặt chia việc, chip trạng thái trên thanh trên.
 * Main gửi lại toàn bộ danh sách qua accounts-update mỗi khi có gì đổi.
 */
(function () {
  'use strict';
  const { api, $, escapeHtml, fmtDate, fmtTime, chip, toast, setBlocked } = window.App;
  if (!api) return;

  const list = $('acc-list');
  const accMax = $('acc-max');
  const accTotal = $('acc-total');
  const accMode = $('acc-mode');
  const accTopup = $('acc-topup');
  const accKeep = $('acc-keep');
  const accProxies = $('acc-proxies');
  let view = { accounts: [], settings: {}, running: {}, proxies: [] };

  // [tone, chữ] của 1 tài khoản — dùng cho chip thanh trên và dòng trong tab
  function state(a) {
    const n = view.running[a.id] || 0;
    if (!a.enabled) return ['muted', 'Tắt'];
    if (a.loggedIn === false) return ['warn', 'Chưa đăng nhập'];
    if (n) return ['live', `Đang chạy ${n}`];
    if (a.pausedUntil) return ['danger', `Nghỉ – hết hạn mức${a.pausedUntil < 9e15 ? ` (tới ${fmtDate(a.pausedUntil)})` : ''}`];
    return ['ok', 'Rảnh'];
  }

  // Thanh trên: 1 nút tóm tắt, bấm mở danh sách từng tài khoản
  function renderChips() {
    const st = view.accounts.map(state);
    const run = st.filter(([t]) => t === 'live').length, ready = st.filter(([t]) => t === 'ok').length;
    const [tone, text] = run ? ['live', `${run} đang chạy`] : ready ? ['ok', `${ready}/${st.length} rảnh`] : ['warn', 'không có TK rảnh'];
    $('acc-sum').innerHTML = `${chip(tone, `Tài khoản: ${text}`)}<svg class="acc-menu-caret" viewBox="0 0 12 12" width="12" height="12"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
    $('acc-chips').innerHTML = view.accounts.map((a, i) => chip(st[i][0], `${a.name}: ${st[i][1]}`, `${a.name}: ${st[i][1]}`)).join('');
  }
  const accMenu = $('acc-menu');
  document.addEventListener('click', e => { if (accMenu.open && !accMenu.contains(e.target)) accMenu.open = false; });
  $('acc-menu-manage').addEventListener('click', () => { accMenu.open = false; window.App.goTab('tab-accounts'); });

  // Số API (topupBalance) khác đơn vị số Muse hiện: 40.000.000 ↔ "còn 1 tỷ token" trên trang Muse → nhân 25.
  // ponytail: tỷ lệ suy từ 1 ảnh chụp, Muse đổi đơn vị thì sửa hằng số này.
  const TOKEN_PER_UNIT = 25;
  const fmtTokens = n => new Intl.NumberFormat('vi', { notation: 'compact', compactDisplay: 'long', maximumFractionDigits: 2 }).format(n * TOKEN_PER_UNIT);

  // Hạn mức gọn 1 dòng: thanh mảnh + % · đặt lại · token; chi tiết ở tooltip
  function quotaHtml(q) {
    if (!q) return '<div class="muted small">Chưa có số liệu hạn mức</div>';
    const tone = q.pct >= 100 ? 'danger' : q.pct >= 80 ? 'warn' : '';
    const token = q.topupLeft != null ? `token ${fmtTokens(q.topupBalance)} (${Math.round(q.topupLeft * 100)}%)` : '';
    const tip = [q.tier, q.resetsAt && `Đặt lại ${fmtDate(q.resetsAt)}`, token && `Token bổ sung còn ${fmtTokens(q.topupBalance)}`, `kiểm tra ${fmtTime(q.checkedAt)}`].filter(Boolean).join(' · ');
    return `<div class="acc-q" title="${escapeHtml(tip)}">
      <div class="quota-bar"><i style="width:${Math.min(100, Math.max(0, q.pct))}%"${tone ? ` data-tone="${tone}"` : ''}></i></div>
      <div class="small"><strong>${Math.round(q.pct)}%</strong><span class="muted">${q.resetsAt ? ` · đặt lại ${fmtDate(q.resetsAt)}` : ''}${token ? ` · ${token}` : ''}</span></div></div>`;
  }

  // Dòng proxy tài khoản đang được gán (cố định hoặc tự chọn)
  const proxyOf = a => (a.proxy === 'none' ? '' : a.proxy || a.proxyAuto || '');
  const labelOf = line => view.proxies.find(p => p.line === line)?.label || line.replace(/^.*@/, '').split(':').slice(0, 2).join(':');
  // Ô proxy riêng của tài khoản: gõ/dán proxy hoặc chọn từ kho; trống = tự lấy từ kho (kho trống = không proxy)
  function proxyRow(a) {
    const pool = view.proxies.filter(p => !p.error);
    const f = a.proxyFixed, h = f?.health;
    const [tone, text] = a.proxy === 'none' ? ['muted', 'không dùng proxy']
      : f ? (f.error ? ['danger', f.error] : !h ? ['muted', 'chưa kiểm tra'] : h.ok ? ['ok', `sống · ${h.ms}ms`] : ['danger', `chết · ${h.error}`])
      : pool.length ? ['muted', `tự lấy từ kho${a.proxyAuto ? `: ${labelOf(a.proxyAuto)}` : ''}`] : ['muted', 'không dùng proxy'];
    const val = a.proxy === 'none' ? '' : a.proxy || '';
    const ph = pool.length ? 'Trống = tự lấy từ kho proxy · bấm để chọn' : 'ip:port hoặc ip:port:user:pass — trống = không dùng proxy';
    return `
        <div class="acc-proxy-row">
          <span class="muted small">Proxy</span>
          <input class="input mono" data-f="proxy" list="acc-proxy-pool" value="${escapeHtml(val)}" placeholder="${escapeHtml(ph)}" spellcheck="false" autocomplete="off"
            title="Proxy riêng của tài khoản này — đổi thì Chrome (nếu đang rảnh) mở lại với proxy mới">
          <button class="btn-ghost btn-sm" data-act="proxy-check">Kiểm tra</button>
          <span class="small">${chip(tone, text)}${a.proxyNow ? ` <span class="muted">· Chrome đang qua ${escapeHtml(a.proxyNow)}</span>` : ''}</span>
        </div>`;
  }

  function renderProxies() {
    $('acc-proxy-status').innerHTML = view.proxies.map(p => {
      const h = p.health, users = view.accounts.filter(a => proxyOf(a) === p.line).map(a => escapeHtml(a.name)).join(', ');
      const [tone, text] = p.error ? ['danger', p.error] : !h ? ['muted', 'chưa kiểm tra'] : h.ok ? ['ok', `sống · ${h.ms}ms`] : ['danger', `chết · ${h.error}`];
      return `<span>${chip(tone, `${p.label}: ${text}`)}${users ? ` <span class="muted">→ ${users}</span>` : ''}</span>`;
    }).join('');
    $('acc-proxy-pool').innerHTML = view.proxies.filter(p => !p.error).map(p => `<option value="${escapeHtml(p.line)}">${escapeHtml(p.label)}</option>`).join('');
  }

  function renderList() {
    list.innerHTML = view.accounts.map(a => {
      const [tone, text] = state(a);
      const busy = Boolean(view.running[a.id]);
      const provider = a.provider || 'muse';
      const providerBadge = provider === 'google_flow'
        ? '<span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:#ecfdf5;color:#059669;border:1px solid #a7f3d0;text-transform:uppercase;">Google Flow</span>'
        : provider === 'seedance'
        ? '<span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:#ecfeff;color:#0891b2;border:1px solid #a5f3fc;text-transform:uppercase;">Seedance 2.5</span>'
        : provider === 'dola'
        ? '<span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:#fef3c7;color:#d97706;border:1px solid #fde68a;text-transform:uppercase;">Dola (Seedance 2.0)</span>'
        : '<span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;background:#eef2ff;color:#4f46e5;border:1px solid #c7d2fe;text-transform:uppercase;">Muse AI</span>';
      const seedanceRow = provider === 'seedance' ? `
        <div class="acc-proxy-row" style="margin-top:6px;">
          <span class="muted small" style="min-width:70px;">API Key</span>
          <input class="input mono" data-f="apiKey" value="${escapeHtml(a.apiKey || '')}" placeholder="API Key BytePlus ModelArk (tuỳ chọn) — để trống để chạy trực tiếp trên Chrome BytePlus Playground" spellcheck="false" autocomplete="off" title="API Key cho Seedance 2.5">
        </div>` : '';
      return `
      <div class="card acc-row" data-id="${escapeHtml(a.id)}">
        <label class="switch" title="Bật / tắt tài khoản"><input type="checkbox" data-f="enabled"${a.enabled ? ' checked' : ''}><span></span></label>
        ${providerBadge}
        <input class="input acc-nm" data-f="name" value="${escapeHtml(a.name)}" title="Sửa tên">
        <span class="small">${chip(tone, text)}</span>
        ${quotaHtml(a.quota)}
        <select class="select" data-f="threads" title="Số luồng của tài khoản này">${[1, 2, 3, 4, 5].map(n => `<option value="${n}"${n === a.threads ? ' selected' : ''}>${n} luồng</option>`).join('')}</select>
        <div class="acc-acts">
          ${a.loggedIn ? '<button class="btn-ghost btn-sm" data-act="show">Hiện Chrome</button>' : '<button class="btn btn-sm" data-act="login">Đăng nhập</button>'}
          <button class="btn-ghost btn-sm" data-act="quota"${a.loggedIn ? '' : ' disabled'}>Hạn mức</button>
          <button class="btn-ghost btn-sm" data-act="logout"${a.loggedIn && !busy ? '' : ' disabled'}>Đăng xuất</button>
          <button class="btn-danger btn-sm" data-act="remove"${busy || view.accounts.length < 2 ? ' disabled' : ''}>Xoá</button>
        </div>${seedanceRow}${proxyRow(a)}
      </div>`;
    }).join('');
  }

  // Ô đang gõ không bị ghi đè khi main gửi cập nhật
  const typing = el => document.activeElement === el;
  function renderSettings() {
    const s = view.settings;
    if (!typing(accMax)) accMax.value = s.maxAccounts ?? '';
    if (!typing(accTotal)) accTotal.value = s.totalThreads ?? '';
    accMode.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === s.mode));
    accTopup.checked = Boolean(s.useTopup);
    accKeep.checked = Boolean(s.keepGoing);
    if (!typing(accProxies)) accProxies.value = s.proxies ?? '';
    $('acc-pool').checked = Boolean(s.usePool);
    $('acc-proxy-box').hidden = !s.usePool;
  }

  let pending = false;
  function render(v) {
    if (v) view = v;
    renderChips();
    renderSettings();
    renderProxies();
    setBlocked(view.blocked);
    // Đang sửa tên / proxy / apiKey thì để sau khi rời ô mới vẽ lại
    if (list.contains(document.activeElement) && ['name', 'proxy', 'apiKey'].includes(document.activeElement.dataset.f)) { pending = true; return; }
    renderList();
  }
  list.addEventListener('focusout', () => { if (pending) { pending = false; setTimeout(renderList); } });

  list.addEventListener('change', async e => {
    const f = e.target.dataset.f;
    const id = e.target.closest('[data-id]')?.dataset.id;
    if (!f || !id) return;
    const value = f === 'enabled' ? e.target.checked : f === 'threads' ? Number(e.target.value) : e.target.value.trim();
    if (f === 'name' && !value) return render();
    await api.updateAccount(id, { [f]: value });
  });

  list.addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('[data-id]').dataset.id;
    const acc = view.accounts.find(a => a.id === id);
    const act = btn.dataset.act;
    if (act === 'proxy-check') {
      btn.disabled = true;
      await api.updateAccount(id, { proxy: btn.parentElement.querySelector('[data-f="proxy"]').value.trim() }); // vừa gõ chưa rời ô thì lưu trước
      return render(await api.checkProxies());
    }
    if (act === 'login') {
      btn.disabled = true;
      btn.textContent = 'Đang mở Chrome…';
      toast(`Đang mở trình duyệt Chrome của ${acc.name} để kiểm tra / đăng nhập…`, 'info');
      const r = await api.loginAccount(id);
      if (r?.ok) toast(`✅ Tài khoản ${acc.name} đã đăng nhập sẵn sàng!`, 'ok');
      else toast(`Đã mở Chrome của ${acc.name}. Hãy hoàn tất đăng nhập rồi bấm "Kiểm tra phiên".`, 'info');
      return;
    }
    if (act === 'show' && !await api.showAccount(id)) toast('Không mở được Chrome của tài khoản này.', 'danger');
    if (act === 'quota') { btn.disabled = true; render(await api.checkQuota(id)); }
    if (act === 'logout') {
      if (!confirm(`Đăng xuất ${acc.name}? Muốn dùng lại phải đăng nhập lại.`)) return;
      const r = await api.logoutAccount(id);
      toast(r?.ok ? `Đã đăng xuất ${acc.name}.` : r?.error || 'Không đăng xuất được.', r?.ok ? 'ok' : 'danger');
    }
    if (act === 'remove') {
      if (!confirm(`Xoá ${acc.name}? Phiên đăng nhập Chrome của tài khoản này sẽ được đưa vào Thùng rác.`)) return;
      const r = await api.removeAccount(id);
      toast(r?.ok ? `Đã xoá ${acc.name}.` : r?.error || 'Không xoá được.', r?.ok ? 'ok' : 'danger');
    }
  });

  const saveSettings = patch => api.saveAccountSettings(patch).then(settings => render({ ...view, settings }));
  accMax.addEventListener('change', () => saveSettings({ maxAccounts: Number(accMax.value) }));
  accTotal.addEventListener('change', () => saveSettings({ totalThreads: Number(accTotal.value) }));
  accMode.addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) saveSettings({ mode: b.dataset.mode }); });
  accTopup.addEventListener('change', () => saveSettings({ useTopup: accTopup.checked }));
  accKeep.addEventListener('change', () => saveSettings({ keepGoing: accKeep.checked }));
  $('acc-pool').addEventListener('change', e => saveSettings({ usePool: e.target.checked }).then(() => api.listAccounts()).then(render));
  accProxies.addEventListener('change', () => saveSettings({ proxies: accProxies.value }).then(() => api.listAccounts()).then(render));

  // Thêm tài khoản theo từng provider (Muse AI / Google Flow / Seedance)
  const addAccountForProvider = async (provider, btn) => {
    if (btn) btn.disabled = true;
    try {
      const p = provider || 'muse';
      const count = view.accounts.filter(a => (a.provider || 'muse') === p).length + 1;
      const defName = p === 'google_flow' ? `Google Flow ${count}` : p === 'seedance' ? `Seedance ${count}` : p === 'dola' ? `Dola ${count}` : `Muse AI ${count}`;
      const acc = await api.addAccount(defName, p);
      toast(`Đã thêm ${acc?.name || 'tài khoản'}. Chrome mới đã mở, hãy đăng nhập trong đó.`, 'ok');
    } catch (e) {
      toast('Không thêm được tài khoản: ' + e.message, 'danger');
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  $('acc-add-muse')?.addEventListener('click', e => addAccountForProvider('muse', e.currentTarget));
  $('acc-add-gflow')?.addEventListener('click', e => addAccountForProvider('google_flow', e.currentTarget));
  $('acc-add-seedance')?.addEventListener('click', e => addAccountForProvider('seedance', e.currentTarget));
  $('acc-add-dola')?.addEventListener('click', e => addAccountForProvider('dola', e.currentTarget));
  $('acc-add')?.addEventListener('click', e => addAccountForProvider('muse', e.currentTarget));
  const busyBtn = async (btn, fn) => { btn.disabled = true; try { render(await fn()); } finally { btn.disabled = false; } };
  $('acc-check-quota').addEventListener('click', e => busyBtn(e.currentTarget, () => api.checkQuota()));
  $('acc-proxy-check').addEventListener('click', e => busyBtn(e.currentTarget, async () => {
    await saveSettings({ proxies: accProxies.value }); // vừa gõ chưa rời ô thì lưu trước
    return api.checkProxies();
  }));
  $('acc-check-login').addEventListener('click', e => busyBtn(e.currentTarget, () => api.checkLogins()));

  api.onAccountsUpdate(render);
  document.addEventListener('app:tab', e => { if (e.detail === 'tab-accounts') api.listAccounts().then(render); });
  api.listAccounts().then(render);
})();
