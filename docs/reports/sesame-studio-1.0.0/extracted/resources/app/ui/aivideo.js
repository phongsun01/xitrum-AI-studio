// Tab "Tạo video AI" — Giao diện 3 cột
(function () {
  'use strict';
  var root = document.getElementById('aivideo-root');
  if (!root) return;

  var ENGINES = [
    { id: 'dola', name: 'Dola AI (Seedance 2.0 Fast)', short: 'Dola AI', max: 3, note: 'Nhanh, hợp video ngắn có chuyển động mạnh. Tối đa 3 ảnh tham chiếu.' },
    { id: 'muse', name: 'Muse AI', short: 'Muse AI', max: 8, note: 'Nối cảnh liên tục, hội thoại tự nhiên. Tối đa 8 ảnh tham chiếu.' },
    { id: 'google_flow', name: 'Google Flow (Veo)', short: 'Google Flow', max: 8, note: 'Chất lượng điện ảnh 1080p, bối cảnh phức tạp. Tối đa 8 ảnh tham chiếu.' }
  ];
  var RATIOS = ['9:16', '16:9', '1:1'];
  var STATUS_TEXT = { queued: 'Đang chờ', running: 'Đang chạy', done: 'Hoàn tất', error: 'Lỗi', canceled: 'Đã huỷ' };

  var state = {
    engine: 'dola',
    images: [],
    ratio: '9:16',
    seconds: 5,
    merge: true,
    characters: [],
    fixedModel: { on: false, path: '' },
    providers: [],
    tasks: [],
    threads: [],
    busy: false,
    msg: null,
    timer: null,
    selectedThread: 'all',
    selectedStatus: 'all',
    searchQuery: '',
    checkedIds: new Set(),
    focusTaskId: null
  };
  var refs = {};

  var TEMPLATES = [
    { name: '🎬 Phim ngắn 3 cảnh', text: 'Cảnh 1: Nhân vật đứng trên sân thượng đêm mưa, mắt nhìn xa xăm trầm chiêu, máy quay tĩnh trung cảnh.\nCảnh 2: Nhân vật quay lại, ánh mắt kiên định dứt khoát, tiến về phía trước.\nCảnh 3: Ánh sáng bình minh le lói xua tan mây đen, nụ cười nhẹ xuất hiện.' },
    { name: '👥 Đối thoại 2 người', text: 'Cảnh 1: Hai người đứng đối diện nhau trên sân thượng, người bên trái nói câu dứt khoát.\nCảnh 2: Người bên phải sửng sốt lùi lại nửa bước, ánh mắt bàng hoàng kinh ngạc.' },
    { name: '🛍️ Giới thiệu sản phẩm', text: 'Cảnh 1: Cận cảnh mở hộp sản phẩm tinh xảo, ánh sáng mềm mại phản chiếu bề mặt.\nCảnh 2: Người mẫu cầm sản phẩm trên tay, mỉm cười tự nhiên nhìn vào ống kính.\nCảnh 3: Đặt sản phẩm lên bàn gỗ, máy quay lùi dần khoe toàn bộ thiết kế sang trọng.' }
  ];

  function engineById(id) {
    for (var i = 0; i < ENGINES.length; i++) if (ENGINES[i].id === id) return ENGINES[i];
    return ENGINES[0];
  }
  function api() {
    var s = window.sesame;
    return s && typeof s.feat === 'function' ? s : null;
  }
  function call(name, payload) {
    var s = api();
    if (!s) return Promise.resolve({ ok: false, error: 'Chức năng này chưa sẵn sàng. Hãy khởi động lại ứng dụng.' });
    try {
      return Promise.resolve(s.feat(name, payload)).then(function (r) {
        return r == null ? { ok: false, error: 'Không nhận được phản hồi.' } : r;
      }, function (e) { return { ok: false, error: String((e && e.message) || e || 'Lỗi không xác định') }; });
    } catch (e) {
      return Promise.resolve({ ok: false, error: String((e && e.message) || e) });
    }
  }
  function h(tag, cls, text, attrs) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function add(parent) {
    for (var i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]);
    return parent;
  }
  function clear(e) { while (e && e.firstChild) e.removeChild(e.firstChild); }
  function fileUrl(p) {
    var s = String(p || '').replace(/\\/g, '/');
    if (/^file:/i.test(s)) return s;
    if (s.charAt(0) !== '/') s = '/' + s;
    return 'file://' + encodeURI(s).replace(/#/g, '%23').replace(/\?/g, '%3F');
  }
  function baseName(p) { return String(p || '').split(/[\\/]/).pop(); }
  function visible() {
    return typeof root.offsetParent === 'undefined' ? true : root.offsetParent !== null;
  }
  function mmss(ms) {
    if (!ms || ms < 0) return '00:00';
    var totalSec = Math.floor(ms / 1000);
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function toast(msg) {
    if (typeof window.showToast === 'function') window.showToast(msg);
    else alert(msg);
  }

  // ---------- DỰNG BỘ KHUNG 3 CỘT (Studio 3 Columns) ----------
  var wrap = h('div', 'aiv-wrap');
  var chipRow = h('div', 'aiv-chips');
  var cols = h('div', 'aiv-cols');

  // Cột 1: Soạn prompt
  var colCompose = h('div', 'aiv-col aiv-col-compose');
  // Cột 2: Hàng đợi task & Giám sát luồng
  var colQueue = h('div', 'aiv-col aiv-col-queue');
  // Cột 3: Khung xem trước & Chi tiết
  var colDetail = h('div', 'aiv-col aiv-col-detail');

  add(cols, colCompose, colQueue, colDetail);
  add(wrap, chipRow, cols);
  clear(root);
  add(root, wrap);

  // ---------- 1. Thanh Chip Engine AI (Top Bar) ----------
  function renderChips() {
    clear(chipRow);
    ENGINES.forEach(function (en) {
      var p = null;
      for (var i = 0; i < state.providers.length; i++) if (state.providers[i].provider === en.id) p = state.providers[i];
      var chip = h('div', 'aiv-chip');
      var dotCls = 'aiv-dot';
      var label = 'Chưa rõ';
      if (p && p.loggedIn === true) { dotCls += ' aiv-ok'; label = 'Sẵn sàng'; }
      else if (p && p.loggedIn === false) { dotCls += ' aiv-bad'; label = 'Chưa đăng nhập'; }

      var info = h('div', 'aiv-chip-info');
      add(info, h('div', 'aiv-chip-name', en.short), h('div', 'aiv-chip-state', label));

      var btnLogin = h('button', 'aiv-btn aiv-btn-sm', 'Đăng nhập', { type: 'button' });
      var btnCheck = h('button', 'aiv-btn aiv-btn-sm aiv-btn-ghost', 'Kiểm tra', { type: 'button' });
      btnLogin.addEventListener('click', function () { doLogin(en.id, btnLogin); });
      btnCheck.addEventListener('click', function () { doCheck(en.id, btnCheck); });

      add(chip, h('span', dotCls), info, btnLogin, btnCheck);
      chipRow.appendChild(chip);
    });
  }

  function refreshStatus() {
    return call('aivideo-status').then(function (r) {
      if (r && r.ok && Array.isArray(r.providers)) { state.providers = r.providers; renderChips(); }
      else if (r && !r.ok && !api()) { renderChips(); }
    });
  }

  function doLogin(id, btn) {
    btn.disabled = true;
    call('aivideo-login', { provider: id }).then(function (r) {
      btn.disabled = false;
      if (r && r.ok) {
        setMsg('ok', 'Đã mở cửa sổ đăng nhập ' + engineById(id).name + '.');
        var tries = 0;
        var iv = setInterval(function () {
          tries++;
          var p = null;
          for (var i = 0; i < state.providers.length; i++) if (state.providers[i].provider === id) p = state.providers[i];
          if ((p && p.loggedIn === true) || tries > 30) { clearInterval(iv); return; }
          refreshStatus();
        }, 4000);
      } else setMsg('err', (r && r.error) || 'Không mở được trang đăng nhập.');
    });
  }

  function doCheck(id, btn) {
    btn.disabled = true;
    call('aivideo-check-login', { provider: id }).then(function (r) {
      btn.disabled = false;
      if (r && r.ok) {
        var found = false;
        state.providers.forEach(function (p) { if (p.provider === id) { p.loggedIn = !!r.loggedIn; found = true; } });
        if (!found) state.providers.push({ provider: id, label: engineById(id).name, loggedIn: !!r.loggedIn });
        renderChips();
        setMsg(r.loggedIn ? 'ok' : 'err', r.loggedIn ? 'Đã kết nối ' + engineById(id).short : 'Chưa đăng nhập ' + engineById(id).short);
      } else setMsg('err', (r && r.error) || 'Không kiểm tra được.');
    });
  }

  // ---------- CỘT 1: FORM SOẠN LỆNH ----------
  function setMsg(kind, text) {
    state.msg = text ? { kind: kind, text: text } : null;
    if (!refs.msg) return;
    refs.msg.textContent = text || '';
    refs.msg.className = 'aiv-msg' + (text ? ' aiv-msg-' + kind : '');
  }

  function buildComposeCol() {
    clear(colCompose);

    add(colCompose, h('h3', 'aiv-h', 'Soạn video AI'));

    // Engine Selector
    add(colCompose, h('label', 'aiv-label', 'Công cụ tạo video (Engine)'));
    var engRow = h('div', 'aiv-seg');
    refs.engBtns = {};
    ENGINES.forEach(function (en) {
      var b = h('button', 'aiv-seg-btn', en.short, { type: 'button' });
      b.addEventListener('click', function () { state.engine = en.id; syncForm(); });
      refs.engBtns[en.id] = b;
      engRow.appendChild(b);
    });
    refs.engNote = h('div', 'aiv-note');
    add(colCompose, engRow, refs.engNote);

    // Prompt + Quick Templates
    var tplHead = h('div', 'aiv-row aiv-between');
    add(tplHead, h('label', 'aiv-label', 'Prompt kịch bản'), h('span', 'aiv-hint', 'Mẫu nhanh:'));
    var tplRow = h('div', 'aiv-tpl-row');
    TEMPLATES.forEach(function (tpl) {
      var tb = h('button', 'aiv-btn aiv-btn-sm aiv-btn-ghost', tpl.name, { type: 'button' });
      tb.addEventListener('click', function () {
        refs.prompt.value = tpl.text;
        refs.prompt.dispatchEvent(new Event('input', { bubbles: true }));
      });
      tplRow.appendChild(tb);
    });
    add(colCompose, tplHead, tplRow);

    refs.prompt = h('textarea', 'aiv-textarea', null, {
      rows: '5',
      placeholder: 'Nhập nội dung kịch bản video...\nVí dụ:\nCảnh 1: Linh Phù bước đi dưới ánh hoàng hôn rực rỡ...\nCảnh 2: Máy quay lùi xa, toàn cảnh thành phố hiện ra...'
    });
    refs.prompt.addEventListener('input', updateCharDetection);
    add(colCompose, refs.prompt);

    // Thông báo nhận diện nhân vật tự động
    refs.charDetected = h('div', 'aiv-char-detected');
    add(colCompose, refs.charDetected);

    // Thư viện nhân vật
    var charBox = h('div', 'aiv-char-box');
    var charHead = h('div', 'aiv-row aiv-between');
    var btnAddChar = h('button', 'aiv-btn aiv-btn-sm', '+ Thêm nhân vật', { type: 'button' });
    btnAddChar.addEventListener('click', addCharacterPrompt);
    add(charHead, h('strong', null, 'Thư viện nhân vật'), btnAddChar);
    refs.charList = h('div', 'aiv-char-list');
    add(charBox, charHead, refs.charList);
    add(colCompose, charBox);

    // Ảnh tham chiếu
    var imgHead = h('div', 'aiv-row aiv-between', null, { style: 'margin-top: 6px;' });
    refs.pickBtn = h('button', 'aiv-btn aiv-btn-sm', '+ Chọn ảnh tham chiếu...', { type: 'button' });
    refs.imgCount = h('span', 'aiv-hint');
    refs.pickBtn.addEventListener('click', pickImages);
    add(imgHead, refs.pickBtn, refs.imgCount);
    refs.thumbs = h('div', 'aiv-thumbs');
    refs.imgWarn = h('div', 'aiv-warn');
    add(colCompose, imgHead, refs.thumbs, refs.imgWarn);

    // Tỉ lệ + Giây mỗi cảnh
    var opts = h('div', 'aiv-grid2');
    var g1 = h('div');
    add(g1, h('label', 'aiv-label', 'Tỉ lệ khung hình'));
    var ratioRow = h('div', 'aiv-seg');
    refs.ratioBtns = {};
    RATIOS.forEach(function (r) {
      var b = h('button', 'aiv-seg-btn', r, { type: 'button' });
      b.addEventListener('click', function () { state.ratio = r; syncForm(); });
      refs.ratioBtns[r] = b;
      ratioRow.appendChild(b);
    });
    add(g1, ratioRow);

    var g2 = h('div');
    add(g2, h('label', 'aiv-label', 'Giây / cảnh'));
    refs.seconds = h('input', 'aiv-input', null, { type: 'number', min: '3', max: '15', step: '1', value: String(state.seconds) });
    refs.seconds.addEventListener('change', function () { state.seconds = readSeconds(); });
    add(g2, refs.seconds);
    add(opts, g1, g2);
    add(colCompose, opts);

    // Người mẫu cố định
    var modelRow = h('div', 'aiv-row', null, { style: 'margin-top: 4px;' });
    refs.chkModel = h('input', null, null, { type: 'checkbox' });
    refs.chkModel.checked = state.fixedModel.on;
    refs.chkModel.addEventListener('change', function () { state.fixedModel.on = !!refs.chkModel.checked; });
    var modelLabel = h('label', 'aiv-switch', null, { style: 'margin: 0;' });
    add(modelLabel, refs.chkModel, h('span', null, 'Người mẫu cố định'));
    refs.btnPickModel = h('button', 'aiv-btn aiv-btn-sm aiv-btn-ghost', 'Chọn mặt mẫu', { type: 'button' });
    refs.btnPickModel.addEventListener('click', pickFixedModel);
    refs.lblModel = h('span', 'aiv-hint');
    add(modelRow, modelLabel, refs.btnPickModel, refs.lblModel);
    add(colCompose, modelRow);

    // Tự động ghép nối cảnh & Nhạc nền
    var mergeRow = h('label', 'aiv-switch');
    refs.merge = h('input', null, null, { type: 'checkbox' });
    refs.merge.checked = state.merge;
    refs.merge.addEventListener('change', function () { state.merge = !!refs.merge.checked; });
    add(mergeRow, refs.merge, h('span', null, 'Tự ghép các cảnh & lồng nhạc nền'));
    add(colCompose, mergeRow);

    // Submit actions
    var acts = h('div', 'aiv-row', null, { style: 'margin-top: 10px; display: flex; flex-direction: column; gap: 6px;' });
    refs.submit = h('button', 'aiv-btn aiv-btn-primary', '🎬 Tạo & chạy ngay', { type: 'button' });
    refs.submit.addEventListener('click', function () { submit(true); });

    refs.hold = h('button', 'aiv-btn aiv-btn-ghost', '⏳ Chỉ thêm vào hàng đợi', { type: 'button', style: 'width: 100%;' });
    refs.hold.addEventListener('click', function () { submit(false); });

    refs.msg = h('div', 'aiv-msg');
    add(acts, refs.submit, refs.hold, refs.msg);
    add(colCompose, acts);

    syncForm();
    loadCharacters();
  }

  function readSeconds() {
    var n = parseInt(refs.seconds && refs.seconds.value, 10);
    if (!isFinite(n) || n < 1) n = 5;
    return n;
  }

  function syncForm() {
    var en = engineById(state.engine);
    ENGINES.forEach(function (e) {
      if (refs.engBtns[e.id]) refs.engBtns[e.id].className = 'aiv-seg-btn' + (e.id === state.engine ? ' aiv-on' : '');
    });
    RATIOS.forEach(function (r) {
      if (refs.ratioBtns[r]) refs.ratioBtns[r].className = 'aiv-seg-btn' + (r === state.ratio ? ' aiv-on' : '');
    });
    if (refs.engNote) refs.engNote.textContent = en.note;
    renderThumbs();
  }

  function renderThumbs() {
    var en = engineById(state.engine);
    if (!refs.thumbs) return;
    clear(refs.thumbs);
    state.images.forEach(function (p, i) {
      var t = h('div', 'aiv-thumb');
      var img = h('img', null, null, { src: fileUrl(p), alt: baseName(p), title: baseName(p) });
      var x = h('button', 'aiv-thumb-x', '✕', { type: 'button', title: 'Xoá ảnh' });
      x.addEventListener('click', function () { state.images.splice(i, 1); renderThumbs(); });
      add(t, img, x);
      refs.thumbs.appendChild(t);
    });
    if (refs.imgCount) refs.imgCount.textContent = state.images.length + '/' + en.max + ' ảnh';
    if (refs.imgWarn) {
      refs.imgWarn.textContent = state.images.length > en.max
        ? 'Bạn đã chọn ' + state.images.length + ' ảnh, nhưng ' + en.short + ' chỉ nhận tối đa ' + en.max + '.'
        : '';
    }
  }

  function pickImages() {
    var s = window.sesame;
    if (!s || typeof s.pickFiles !== 'function') { setMsg('err', 'Chức năng chọn ảnh chưa sẵn sàng.'); return; }
    var en = engineById(state.engine);
    Promise.resolve().then(function () { return s.pickFiles({ type: 'image' }); }).then(function (r) {
      var list = Array.isArray(r) ? r : (r && (r.files || r.paths)) || [];
      var blocked = false;
      list.forEach(function (p) {
        if (!p || state.images.indexOf(p) >= 0) return;
        if (state.images.length >= en.max) { blocked = true; return; }
        state.images.push(p);
      });
      renderThumbs();
      if (blocked) setMsg('err', en.short + ' chỉ nhận tối đa ' + en.max + ' ảnh tham chiếu.');
    }).catch(function (e) { setMsg('err', 'Không chọn được ảnh: ' + String((e && e.message) || e)); });
  }

  function loadCharacters() {
    call('aivideo-get-characters').then(function (r) {
      if (r && r.ok && Array.isArray(r.characters)) {
        state.characters = r.characters;
        renderCharacters();
        updateCharDetection();
      }
    });
  }

  function renderCharacters() {
    if (!refs.charList) return;
    clear(refs.charList);
    if (!state.characters.length) {
      refs.charList.appendChild(h('span', 'aiv-hint', 'Chưa có nhân vật. Bấm "+ Thêm nhân vật" để lưu mặt mẫu.'));
      return;
    }
    state.characters.forEach(function (c) {
      var chip = h('div', 'aiv-char-chip');
      var img = h('img', null, null, { src: c.images && c.images[0] ? fileUrl(c.images[0]) : '', alt: c.name });
      var name = h('span', null, c.name + ' (' + (c.images ? c.images.length : 0) + ')');
      var del = h('button', 'aiv-char-chip-del', '✕', { type: 'button', title: 'Xoá nhân vật' });
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        call('aivideo-delete-character', { id: c.id }).then(function (r) {
          if (r && r.ok) { state.characters = r.characters; renderCharacters(); updateCharDetection(); }
        });
      });
      add(chip, img, name, del);
      refs.charList.appendChild(chip);
    });
  }

  function updateCharDetection() {
    if (!refs.charDetected) return;
    var text = String((refs.prompt && refs.prompt.value) || '').toLowerCase();
    var matched = state.characters.filter(function (c) {
      return c.name && text.includes(c.name.toLowerCase());
    });
    if (matched.length) {
      refs.charDetected.textContent = '👤 Nhận diện nhân vật: ' + matched.map(function (c) {
        return c.name + ' (' + (c.images ? c.images.length : 0) + ' ảnh)';
      }).join(', ') + ' -> Tự động gắn ảnh tham chiếu!';
    } else {
      refs.charDetected.textContent = '';
    }
  }

  function addCharacterPrompt() {
    var name = window.prompt('Nhập tên nhân vật (ví dụ: Linh Phù, Ông Hạ):');
    if (!name || !name.trim()) return;
    var s = window.sesame;
    if (!s || typeof s.pickFiles !== 'function') { setMsg('err', 'Chức năng chọn ảnh chưa sẵn sàng.'); return; }
    s.pickFiles({ type: 'image' }).then(function (r) {
      var files = Array.isArray(r) ? r : (r && (r.files || r.paths)) || [];
      if (!files.length) return;
      call('aivideo-save-character', { name: name.trim(), images: files.slice(0, 3) }).then(function (res) {
        if (res && res.ok) {
          state.characters = res.characters;
          renderCharacters();
          updateCharDetection();
          toast('Đã lưu nhân vật: ' + name);
        }
      });
    });
  }

  function pickFixedModel() {
    var s = window.sesame;
    if (!s || typeof s.pickFiles !== 'function') { setMsg('err', 'Chức năng chọn ảnh chưa sẵn sàng.'); return; }
    s.pickFiles({ type: 'image' }).then(function (r) {
      var files = Array.isArray(r) ? r : (r && (r.files || r.paths)) || [];
      if (files.length) {
        state.fixedModel.path = files[0];
        refs.lblModel.textContent = baseName(files[0]);
      }
    });
  }

  function submit(runImmediately) {
    if (state.busy) return;
    var en = engineById(state.engine);
    var prompt = String(refs.prompt.value || '').trim();
    if (!prompt) { setMsg('err', 'Hãy nhập prompt trước khi tạo.'); return; }

    var submitImages = state.images.slice();
    if (state.fixedModel.on && state.fixedModel.path && submitImages.indexOf(state.fixedModel.path) === -1) {
      submitImages.unshift(state.fixedModel.path);
    }
    // Auto attach detected character images
    var promptLower = prompt.toLowerCase();
    state.characters.forEach(function (c) {
      if (c.name && promptLower.includes(c.name.toLowerCase()) && Array.isArray(c.images)) {
        c.images.forEach(function (im) {
          if (im && submitImages.indexOf(im) === -1 && submitImages.length < en.max) {
            submitImages.push(im);
          }
        });
      }
    });

    if (submitImages.length > en.max) {
      setMsg('err', en.short + ' chỉ nhận tối đa ' + en.max + ' ảnh tham chiếu.');
      renderThumbs();
      return;
    }
    if (!api()) { setMsg('err', 'Chức năng tạo video chưa sẵn sàng.'); return; }

    state.seconds = readSeconds();
    var label = prompt.replace(/\s+/g, ' ').slice(0, 45);
    var payload = {
      engine: state.engine, prompt: prompt, images: submitImages,
      ratio: state.ratio, seconds: state.seconds, merge: !!state.merge, label: label,
      runImmediately: runImmediately !== false
    };

    state.busy = true; refs.submit.disabled = true;
    setMsg('info', 'Đang thêm vào hàng đợi...');

    call('aivideo-submit', payload).then(function (r) {
      state.busy = false; refs.submit.disabled = false;
      if (r && r.ok) {
        setMsg('ok', 'Đã thêm task vào hàng đợi!');
        if (r.task && r.task.id) state.focusTaskId = r.task.id;
        refreshList();
      } else {
        setMsg('err', (r && r.error) || 'Không thêm được vào hàng đợi.');
      }
    });
  }

  // ---------- CỘT 2: HÀNG ĐỢI TASK & GIÁM SÁT LUỒNG ----------
  function refreshList() {
    return call('aivideo-list').then(function (r) {
      if (r && r.ok && Array.isArray(r.tasks)) {
        state.tasks = r.tasks;
        state.threads = Array.isArray(r.threads) ? r.threads : [];
        // Auto focus first task if none focused
        if (!state.focusTaskId && state.tasks.length) {
          state.focusTaskId = state.tasks[0].id;
        }
        renderQueue();
        renderDetail();
      } else {
        renderQueue(r && !r.ok ? r.error : null);
        renderDetail();
      }
    });
  }

  function renderQueue(err) {
    clear(colQueue);

    // 1. Header with Task Count
    var head = h('div', 'aiv-row aiv-between');
    var hTitle = h('h3', 'aiv-h', 'Hàng đợi (' + state.tasks.length + ' task)');
    var clr = h('button', 'aiv-btn aiv-btn-sm aiv-btn-ghost', 'Xoá đã xong', { type: 'button' });
    clr.addEventListener('click', function () {
      call('aivideo-clear-done').then(function (r) {
        if (r && r.ok) refreshList();
      });
    });
    add(head, hTitle, clr);
    colQueue.appendChild(head);

    // 2. Thanh Chọn Luồng (Thread Selector Bar)
    var threadBar = h('div', 'aiv-threads-bar');
    var threadDefs = [
      { id: 'all', name: 'Tất cả luồng' },
      { id: 'dola', name: 'Luồng Dola AI' },
      { id: 'google_flow', name: 'Luồng Google Flow' },
      { id: 'muse', name: 'Luồng Muse AI' }
    ];

    threadDefs.forEach(function (td) {
      var pill = h('button', 'aiv-thread-pill' + (state.selectedThread === td.id ? ' active' : ''), null, { type: 'button' });
      var dot = h('span', 'aiv-thread-dot');
      var threadInfo = state.threads.find(function (th) { return th.provider === td.id; });
      var subText = '';

      if (td.id === 'all') {
        var runningCount = state.tasks.filter(function (t) { return t.status === 'running'; }).length;
        if (runningCount > 0) {
          dot.className += ' busy';
          subText = '(' + runningCount + ' đang gen)';
        } else {
          subText = '(' + state.tasks.length + ')';
        }
      } else {
        var isRunningThis = state.tasks.some(function (t) { return t.status === 'running' && t.engine === td.id; });
        if (isRunningThis || (threadInfo && threadInfo.busy)) {
          dot.className += ' busy';
          subText = 'Đang gen...';
        } else {
          subText = 'Sẵn sàng';
        }
      }

      var textSpan = h('span', null, td.name + ' ');
      var subSpan = h('span', 'aiv-thread-sub', subText);
      add(pill, dot, textSpan, subSpan);

      pill.addEventListener('click', function () {
        state.selectedThread = td.id;
        renderQueue();
      });
      threadBar.appendChild(pill);
    });
    colQueue.appendChild(threadBar);

    // 3. Search & Filter Bar
    var tools = h('div', 'aiv-queue-tools');
    var sInput = h('input', 'aiv-queue-search', null, { type: 'search', placeholder: '🔍 Tìm prompt...' });
    sInput.value = state.searchQuery || '';
    sInput.addEventListener('input', function () {
      state.searchQuery = sInput.value.toLowerCase().trim();
      renderQueue();
    });

    var stSelect = h('select', 'aiv-queue-select');
    var filterOpts = [
      { id: 'all', label: 'Tất cả trạng thái' },
      { id: 'running', label: '⚡ Đang chạy' },
      { id: 'queued', label: '⏳ Đang chờ' },
      { id: 'done', label: '✅ Hoàn tất' },
      { id: 'error', label: '⚠️ Lỗi' }
    ];
    filterOpts.forEach(function (fo) {
      var opt = h('option', null, fo.label, { value: fo.id });
      if (state.selectedStatus === fo.id) opt.selected = true;
      stSelect.appendChild(opt);
    });
    stSelect.addEventListener('change', function () {
      state.selectedStatus = stSelect.value;
      renderQueue();
    });

    add(tools, sInput, stSelect);
    colQueue.appendChild(tools);

    // 4. Quick Picks Row
    var picksRow = h('div', 'aiv-picks-row');
    var allCheckLabel = h('label', 'aiv-switch', null, { style: 'font-size:11.5px;margin:0;' });
    var chkAll = h('input', 'aiv-task-check', null, { type: 'checkbox' });
    chkAll.addEventListener('change', function () {
      var filtered = getFilteredTasks();
      if (chkAll.checked) filtered.forEach(function (t) { state.checkedIds.add(t.id); });
      else filtered.forEach(function (t) { state.checkedIds.delete(t.id); });
      renderQueue();
    });
    add(allCheckLabel, chkAll, h('span', null, 'Chọn tất cả'));

    var btnPickFailed = h('button', 'aiv-btn aiv-btn-sm aiv-btn-ghost', 'Chọn lỗi', { type: 'button' });
    btnPickFailed.addEventListener('click', function () {
      state.tasks.filter(function (t) { return t.status === 'error'; }).forEach(function (t) { state.checkedIds.add(t.id); });
      renderQueue();
    });

    var btnPickQueued = h('button', 'aiv-btn aiv-btn-sm aiv-btn-ghost', 'Chọn chưa chạy', { type: 'button' });
    btnPickQueued.addEventListener('click', function () {
      state.tasks.filter(function (t) { return t.status === 'queued'; }).forEach(function (t) { state.checkedIds.add(t.id); });
      renderQueue();
    });

    add(picksRow, allCheckLabel, h('div', 'aiv-row', null, { style: 'gap:4px;' }, btnPickFailed, btnPickQueued));
    colQueue.appendChild(picksRow);

    if (err) colQueue.appendChild(h('div', 'aiv-warn', err));

    // 5. Danh Sách Task (Scrollable List)
    var filteredTasks = getFilteredTasks();

    var list = h('div', 'aiv-list');
    if (!filteredTasks.length) {
      list.appendChild(h('div', 'aiv-empty', 'Không có task nào phù hợp bộ lọc.'));
    } else {
      filteredTasks.forEach(function (t) {
        list.appendChild(createTaskRow(t));
      });
    }
    colQueue.appendChild(list);

    // 6. Bulk Action Footer
    var foot = h('div', 'aiv-queue-foot');
    var btnRetryFailed = h('button', 'aiv-btn aiv-btn-sm', '🔄 Chạy lại lỗi', { type: 'button' });
    btnRetryFailed.addEventListener('click', function () { doBulkRetry(); });

    var btnBulkDelete = h('button', 'aiv-btn aiv-btn-sm aiv-btn-danger', '🗑️ Xoá đã chọn', { type: 'button' });
    btnBulkDelete.addEventListener('click', function () { doBulkDelete(); });

    var btnBulkMerge = h('button', 'aiv-btn aiv-btn-sm', '🎬 Ghép video', { type: 'button' });
    btnBulkMerge.addEventListener('click', function () { doBulkMerge(); });

    var btnStopAll = h('button', 'aiv-btn aiv-btn-sm aiv-btn-ghost', '⏹️ Dừng tất cả', { type: 'button' });
    btnStopAll.addEventListener('click', function () { doStopAll(); });

    add(foot, btnRetryFailed, btnBulkDelete, btnBulkMerge, btnStopAll);
    colQueue.appendChild(foot);
  }

  function getFilteredTasks() {
    return state.tasks.slice().filter(function (t) {
      if (state.selectedThread !== 'all' && t.engine !== state.selectedThread) return false;
      if (state.selectedStatus !== 'all' && t.status !== state.selectedStatus) return false;
      if (state.searchQuery) {
        var str = ((t.label || '') + ' ' + (t.prompt || '') + ' ' + (t.id || '')).toLowerCase();
        if (str.indexOf(state.searchQuery) === -1) return false;
      }
      return true;
    }).sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  }

  function createTaskRow(t) {
    var st = t.status || 'queued';
    var isSelected = state.focusTaskId === t.id;
    var row = h('div', 'aiv-task-row' + (isSelected ? ' selected' : ''), null, { 'data-id': String(t.id) });

    // 1. Checkbox
    var chk = h('input', 'aiv-task-check', null, { type: 'checkbox' });
    chk.checked = state.checkedIds.has(t.id);
    chk.addEventListener('click', function (e) {
      e.stopPropagation();
      chk.checked ? state.checkedIds.add(t.id) : state.checkedIds.delete(t.id);
    });

    // 2. Thumbnail
    var thumb = h('div', 'aiv-task-thumb');
    var files = Array.isArray(t.files) ? t.files : [];
    if (st === 'done' && files.length) {
      thumb.appendChild(h('video', null, null, { src: fileUrl(files[0]), preload: 'metadata', muted: 'muted' }));
    } else if (Array.isArray(t.images) && t.images.length) {
      var p = typeof t.images[0] === 'string' ? t.images[0] : (t.images[0].imageLocalPath || t.images[0].path || '');
      thumb.appendChild(h('img', null, null, { src: p ? fileUrl(p) : '', alt: '' }));
    } else {
      thumb.textContent = st === 'running' ? '⚡' : st === 'error' ? '⚠️' : '🎬';
    }

    // 3. Main Content
    var main = h('div', 'aiv-task-main');
    var title = h('div', 'aiv-task-title', t.label || (t.prompt ? String(t.prompt).slice(0, 45) : 'Video'));

    var meta = h('div', 'aiv-task-meta');
    var enName = t.engine ? engineById(t.engine).short : 'Luồng';
    meta.appendChild(h('span', 'aiv-thread-tag', enName));
    if (t.ratio) meta.appendChild(h('span', null, t.ratio));

    if (st === 'running') {
      var timer = h('span', 'aiv-timer', '⏱️ 00:00', { 'data-timer-id': t.id, 'data-start': String(t.startedAt || t.createdAt || Date.now()) });
      meta.appendChild(timer);
    }
    add(main, title, meta);

    if (st === 'running' || st === 'queued') {
      var bar = h('div', 'aiv-bar');
      var fill = h('span');
      fill.style.width = Math.max(8, Math.min(100, Number(t.pct) || (st === 'running' ? 25 : 5))) + '%';
      bar.appendChild(fill);
      main.appendChild(bar);
    }
    if (t.step && st === 'running') main.appendChild(h('div', 'aiv-step', t.step));
    if (t.error && st === 'error') main.appendChild(h('div', 'aiv-err', t.error));

    // 4. Right side: Badge
    var right = h('div', 'aiv-task-right');
    var badge = h('span', 'aiv-badge aiv-b-' + st, STATUS_TEXT[st] || st);
    right.appendChild(badge);

    add(row, chk, thumb, main, right);

    // Click row -> Select task and update Column 3 Detail Inspector!
    row.addEventListener('click', function () {
      state.focusTaskId = t.id;
      renderQueue();
      renderDetail();
    });

    return row;
  }

  // Bulk Actions
  function doBulkRetry() {
    var failed = state.tasks.filter(function (t) {
      if (t.status !== 'error') return false;
      return state.checkedIds.size ? state.checkedIds.has(t.id) : true;
    });
    if (!failed.length) return toast('Không có task lỗi nào để chạy lại.');
    failed.forEach(function (t) { call('aivideo-retry', { id: t.id }); });
    toast('Đang chạy lại ' + failed.length + ' task lỗi.');
    setTimeout(refreshList, 800);
  }

  function doBulkDelete() {
    if (!state.checkedIds.size) return toast('Hãy chọn ít nhất 1 task để xoá.');
    var ids = Array.from(state.checkedIds);
    ids.forEach(function (id) { call('aivideo-delete', { id: id }); });
    state.checkedIds.clear();
    toast('Đã xoá ' + ids.length + ' task.');
    setTimeout(refreshList, 800);
  }

  function doBulkMerge() {
    var doneTasks = state.tasks.filter(function (t) {
      if (t.status !== 'done' || !t.files || !t.files.length) return false;
      return state.checkedIds.size ? state.checkedIds.has(t.id) : true;
    });
    if (doneTasks.length < 2) return toast('Cần ít nhất 2 video hoàn tất để ghép.');
    var videoPaths = doneTasks.map(function (t) { return t.files[0]; });
    toast('Đang gửi lệnh ghép ' + videoPaths.length + ' video...');
    call('aivideo-merge-done', { videos: videoPaths }).then(function (r) {
      if (r && r.ok) {
        toast('Ghép video thành công! File đã lưu vào thư viện.');
        refreshList();
      } else toast('Lỗi ghép: ' + ((r && r.error) || 'Thất bại'));
    });
  }

  function doStopAll() {
    var running = state.tasks.filter(function (t) { return t.status === 'running' || t.status === 'queued'; });
    if (!running.length) return toast('Không có task nào đang chạy.');
    running.forEach(function (t) { call('aivideo-cancel', { id: t.id }); });
    toast('Đã gửi lệnh dừng ' + running.length + ' task.');
    setTimeout(refreshList, 800);
  }

  // ---------- CỘT 3: KHUNG XEM TRƯỚC VIDEO & CHI TIẾT (Detail Inspector) ----------
  function renderDetail() {
    clear(colDetail);

    var t = state.tasks.find(function (x) { return x.id === state.focusTaskId; });
    if (!t && state.tasks.length) {
      t = state.tasks[0];
      state.focusTaskId = t.id;
    }

    if (!t) {
      var emptyBox = h('div', 'aiv-detail-placeholder');
      add(emptyBox, h('div', null, '🎬', { style: 'font-size:32px;' }), h('strong', null, 'Xem trước video & chi tiết'), h('p', 'aiv-hint', 'Chọn một task trong hàng đợi để xem video đã hoàn tất, theo dõi luồng đang chạy và prompt kịch bản.'));
      colDetail.appendChild(emptyBox);
      return;
    }

    var st = t.status || 'queued';
    var files = Array.isArray(t.files) ? t.files : [];

    // 1. Header
    var dHead = h('div', 'aiv-row aiv-between', null, { style: 'border-bottom:1px solid var(--border);padding-bottom:6px;' });
    add(dHead, h('strong', 'aiv-h', 'Chi tiết task'), h('span', 'aiv-badge aiv-b-' + st, STATUS_TEXT[st] || st));
    colDetail.appendChild(dHead);

    // 2. Video Player / Status Placeholder (Top)
    if (st === 'done' && files.length) {
      var player = h('video', 'aiv-detail-player', null, {
        src: fileUrl(files[0]), controls: 'controls', autoplay: 'autoplay', loop: 'loop', preload: 'metadata'
      });
      colDetail.appendChild(player);
    } else if (st === 'running') {
      var runBox = h('div', 'aiv-detail-placeholder');
      var spin = h('div', 'aiv-spin', '⚡');
      var runTitle = h('strong', null, 'Đang tạo video...');
      var runStep = h('div', 'aiv-step', t.step || 'Đang xử lý trên luồng...');
      var runBar = h('div', 'aiv-bar', null, { style: 'width:80%;margin:4px 0;' });
      var runFill = h('span');
      runFill.style.width = Math.max(10, Number(t.pct) || 30) + '%';
      runBar.appendChild(runFill);
      var runTimer = h('div', 'aiv-timer', '⏱️ 00:00', { 'data-timer-id': t.id, 'data-start': String(t.startedAt || t.createdAt || Date.now()) });
      add(runBox, spin, runTitle, runStep, runBar, runTimer);
      colDetail.appendChild(runBox);
    } else if (st === 'error') {
      var errBox = h('div', 'aiv-detail-placeholder');
      add(errBox, h('div', null, '⚠️', { style: 'font-size:28px;' }), h('strong', null, 'Quá trình tạo gặp lỗi', { style: 'color:#ef4444;' }), h('div', 'aiv-err', t.error || 'Lỗi không xác định'));
      colDetail.appendChild(errBox);
    } else {
      var waitBox = h('div', 'aiv-detail-placeholder');
      add(waitBox, h('div', null, '⏳', { style: 'font-size:28px;' }), h('strong', null, 'Đang chờ tới lượt luồng...'), h('p', 'aiv-hint', 'Hệ thống sẽ tự động gửi lệnh tới Engine khi luồng sẵn sàng.'));
      colDetail.appendChild(waitBox);
    }

    // 3. Meta info row
    var metaRow = h('div', 'aiv-row', null, { style: 'font-size:11.5px;color:var(--text-muted);margin-top:4px;' });
    var enName = t.engine ? engineById(t.engine).name : 'Luồng tự động';
    metaRow.appendChild(h('span', 'aiv-thread-tag', enName));
    if (t.ratio) metaRow.appendChild(h('span', 'aiv-badge', 'Tỉ lệ: ' + t.ratio));
    if (t.seconds) metaRow.appendChild(h('span', 'aiv-badge', t.seconds + ' giây'));
    if (t.createdAt) {
      var d = new Date(t.createdAt);
      metaRow.appendChild(h('span', null, d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })));
    }
    colDetail.appendChild(metaRow);

    // 4. Prompt Section
    var pHead = h('div', 'aiv-row aiv-between', null, { style: 'margin-top:6px;' });
    var btnCopy = h('button', 'aiv-btn aiv-btn-sm aiv-btn-ghost', '📋 Sao chép', { type: 'button' });
    btnCopy.addEventListener('click', function () {
      navigator.clipboard.writeText(t.prompt || '').then(function () { toast('Đã sao chép prompt!'); });
    });
    add(pHead, h('label', 'aiv-label', 'Prompt kịch bản:'), btnCopy);
    colDetail.appendChild(pHead);

    var promptBox = h('div', 'aiv-detail-prompt-box aiv-prompt-scroll', t.prompt || '');
    colDetail.appendChild(promptBox);

    // 5. Reference images (if any)
    var imgs = Array.isArray(t.images) ? t.images : [];
    if (imgs.length) {
      colDetail.appendChild(h('label', 'aiv-label', 'Ảnh tham chiếu (' + imgs.length + '):'));
      var dThumbs = h('div', 'aiv-thumbs');
      imgs.forEach(function (im) {
        var p = typeof im === 'string' ? im : (im && (im.imageLocalPath || im.path)) || '';
        if (p) {
          var dThumb = h('div', 'aiv-thumb');
          dThumb.appendChild(h('img', null, null, { src: fileUrl(p), alt: baseName(p) }));
          dThumbs.appendChild(dThumb);
        }
      });
      colDetail.appendChild(dThumbs);
    }

    // 6. Action buttons footer
    var acts = h('div', 'aiv-detail-actions');

    if (st === 'done' && files.length) {
      var btnOpen = h('button', 'aiv-btn aiv-btn-sm', '📁 Mở file video', { type: 'button' });
      btnOpen.addEventListener('click', function () { call('aivideo-open', { path: files[0] }); });

      var btnReels = h('button', 'aiv-btn aiv-btn-sm aiv-btn-primary', '📢 Đăng Facebook Reels', { type: 'button' });
      btnReels.addEventListener('click', function () {
        if (typeof window.selectVideoForFb === 'function') {
          window.selectVideoForFb(files[0], t.prompt);
        } else if (typeof window.openFbModalWithVideo === 'function') {
          window.openFbModalWithVideo(files[0], t.prompt);
        } else {
          toast('Tính năng Đăng Reels đã có trong menu bên trái!');
        }
      });
      add(acts, h('div', 'aiv-row', null, { style: 'display:grid;grid-template-columns:1fr 1fr;gap:6px;' }, btnOpen, btnReels));
    }

    var bottomRow = h('div', 'aiv-row', null, { style: 'display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:4px;' });

    var btnRetry = h('button', 'aiv-btn aiv-btn-sm', '🔄 Tạo lại', { type: 'button' });
    btnRetry.addEventListener('click', function () {
      call('aivideo-retry', { id: t.id }).then(function (r) {
        if (r && r.ok) { toast('Đã thêm lại task vào hàng đợi!'); refreshList(); }
      });
    });

    var btnEdit = h('button', 'aiv-btn aiv-btn-sm aiv-btn-ghost', '✏️ Chỉnh sửa', { type: 'button' });
    btnEdit.addEventListener('click', function () {
      refs.prompt.value = t.prompt || '';
      if (t.engine) state.engine = t.engine;
      if (t.ratio) state.ratio = t.ratio;
      syncForm();
      refs.prompt.focus();
      toast('Đã nạp prompt sang khung soạn thảo!');
    });

    var btnDel = h('button', 'aiv-btn aiv-btn-sm aiv-btn-danger', '🗑️ Xoá', { type: 'button' });
    btnDel.addEventListener('click', function () {
      call('aivideo-delete', { id: t.id }).then(function () {
        toast('Đã xoá task.');
        state.focusTaskId = null;
        refreshList();
      });
    });

    add(bottomRow, btnRetry, btnEdit, btnDel);
    acts.appendChild(bottomRow);
    colDetail.appendChild(acts);
  }

  // ---------- Live Real-time Elapsed Timer Ticker ----------
  setInterval(function () {
    var timers = document.querySelectorAll('[data-timer-id]');
    timers.forEach(function (el) {
      var start = parseInt(el.getAttribute('data-start'), 10);
      if (start > 0) {
        var elapsed = Date.now() - start;
        el.textContent = '⏱️ ' + mmss(elapsed);
      }
    });
  }, 1000);

  function onProg(d) {
    if (!d || d.channel !== 'aivideo') return;
    var hit = false;
    state.tasks.forEach(function (t) {
      if (d.id != null && t.id === d.id) {
        ['status', 'step', 'pct', 'files', 'error'].forEach(function (k) { if (d[k] !== undefined) t[k] = d[k]; });
        hit = true;
      }
    });
    if (hit) {
      renderQueue();
      if (state.focusTaskId === d.id) renderDetail();
    }
    refreshList();
  }

  // ---------- Khởi Động ----------
  buildComposeCol();
  renderChips();
  renderQueue(api() ? null : 'Chức năng tạo video chưa sẵn sàng.');
  renderDetail();

  if (api()) { refreshStatus(); refreshList(); }
  else setMsg('err', 'Chức năng tạo video chưa sẵn sàng.');

  try {
    if (window.sesame && typeof window.sesame.onProgress === 'function') window.sesame.onProgress(onProg);
  } catch (_) { /* bỏ qua */ }

  state.timer = setInterval(function () { if (visible() && api()) refreshStatus(); }, 12000);
  document.addEventListener('click', function (ev) {
    var t = ev && ev.target;
    if (t && t.getAttribute && (t.getAttribute('data-tab') === 'tab-aivideo' || t.closest('.sesame-nav-btn[data-tab="tab-aivideo"]')) && api()) {
      refreshStatus();
      refreshList();
    }
  });

  window.__aivideoUI = { state: state, refreshList: refreshList, refreshStatus: refreshStatus };
})();
