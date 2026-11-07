/**
 * GOOGLE FLOW AI VIDEO APP BUILDER (8 BƯỚC TỰ ĐỘNG HÓA TRONG Sesame Studio)
 * Quy trình: Ý tưởng → Kịch bản → Danh sách Scene → Prompt → Video Preview
 * Tích hợp sâu với engine/flow-builder-ai.js, gflow-runner.js, scene-helper.js và merge.js.
 */
(function () {
  'use strict';

  const { api, $, escapeHtml, fileUrl, toast } = window.App;

  const DEFAULT_IDEA = 'Tạo video quảng cáo một cô gái Việt Nam giới thiệu sản phẩm thời trang trong một quán cà phê hiện đại.';

  let state = {
    idea: DEFAULT_IDEA,
    options: {
      genre: 'fashion',
      style: 'modern_lifestyle',
      durationSec: 40,
      aspectRatio: '9:16',
      sceneCount: 5,
      language: 'vi',
      engine: 'google_flow',
      voice: 'vieneu:Quỳnh Anh',
      characterName: '',
      continuity: true
    },
    refImages: [],
    locks: {
      productLock: '',
      characterLock: '',
      settingLock: ''
    },
    scriptOverview: '',
    scenes: [],
    mergedVideoPath: '',
    rawMergedVideoPath: '',
    autoMergeWhenAllDone: false,
    isSequentialRunning: false,
    stopRequested: false
  };

  // Map taskId -> sceneIndex để cập nhật tiến độ thời gian thực từ hàng đợi Sesame Studio
  const taskToSceneMap = new Map();
  let saveTimer = null;

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!api?.flowStateSave) return;
      api.flowStateSave({
        idea: state.idea,
        options: state.options,
        refImages: state.refImages,
        locks: state.locks,
        scriptOverview: state.scriptOverview,
        scenes: state.scenes,
        mergedVideoPath: state.mergedVideoPath,
        rawMergedVideoPath: state.rawMergedVideoPath
      }).catch(() => {});
    }, 350);
  }

  // ---------- 1. Kiểm tra kết nối tài khoản Google Flow (Bước #1) ----------
  function applyAccountBadgeFromList(accounts = []) {
    const badge = $('flow-acc-badge');
    if (!badge) return;
    const gflowAccs = (accounts || []).filter(a => a.provider === 'google_flow');
    const loggedInAcc = gflowAccs.find(a => a.loggedIn);
    const dot = badge.querySelector('.st-dot');
    const txt = badge.querySelector('span:last-child');
    if (loggedInAcc) {
      badge.dataset.tone = 'ok';
      if (dot) dot.style.background = 'var(--green)';
      if (txt) txt.textContent = `Google Flow: Đã kết nối (${loggedInAcc.name || 'Sẵn sàng'})`;
    } else if (gflowAccs.length > 0) {
      badge.dataset.tone = 'warn';
      if (dot) dot.style.background = 'var(--amber)';
      if (txt) txt.textContent = `Google Flow: Chưa đăng nhập (${gflowAccs[0].name})`;
    } else {
      badge.dataset.tone = 'warn';
      if (dot) dot.style.background = 'var(--amber)';
      if (txt) txt.textContent = 'Google Flow: Bấm "Kết nối Google Flow" để đăng nhập';
    }
  }

  async function refreshGoogleFlowAccountBadge() {
    if (!api?.listAccounts) return;
    try {
      const res = await api.listAccounts();
      applyAccountBadgeFromList(res?.accounts || []);
    } catch (_) {}
  }

  // ---------- 2. Đồng bộ danh sách Nhân vật cố định từ Tư liệu ----------
  function populateCharactersDropdown(studioData) {
    const sel = $('flow-opt-char');
    if (!sel) return;
    const chars = studioData?.characters || [];
    const cur = state.options.characterName || sel.value || '';
    sel.innerHTML = `<option value="">Tự động theo mô tả kịch bản</option>` +
      chars.map(c => `<option value="${escapeHtml(c.name)}">👤 ${escapeHtml(c.name)} (${(c.images || []).length} ảnh)</option>`).join('');
    if ([...sel.options].some(o => o.value === cur)) {
      sel.value = cur;
    }
  }

  function getSelectedCharacterRecord() {
    const name = ($('flow-opt-char')?.value || state.options.characterName || '').trim();
    if (!name) return null;
    const studio = window.App.studioData ? window.App.studioData() : null;
    const found = (studio?.characters || []).find(c => c.name === name);
    return found || null;
  }

  // ---------- 3. Đọc / Ghi các trường cấu hình trên UI ----------
  function syncInputsFromState() {
    if ($('flow-idea-input')) $('flow-idea-input').value = state.idea || '';
    const o = state.options || {};
    if ($('flow-opt-genre') && o.genre) $('flow-opt-genre').value = o.genre;
    if ($('flow-opt-style') && o.style) $('flow-opt-style').value = o.style;
    if ($('flow-opt-duration') && o.durationSec) $('flow-opt-duration').value = String(o.durationSec);
    if ($('flow-opt-ratio') && o.aspectRatio) $('flow-opt-ratio').value = o.aspectRatio;
    if ($('flow-opt-scenes') && o.sceneCount) $('flow-opt-scenes').value = String(o.sceneCount);
    if ($('flow-opt-lang') && o.language) $('flow-opt-lang').value = o.language;
    if ($('flow-opt-engine') && o.engine) $('flow-opt-engine').value = o.engine;
    if ($('flow-opt-voice') && o.voice !== undefined) $('flow-opt-voice').value = o.voice;
    if ($('flow-opt-char')) $('flow-opt-char').value = o.characterName || '';
    if ($('flow-opt-continuity')) $('flow-opt-continuity').checked = o.continuity !== false;

    if ($('flow-lock-product')) $('flow-lock-product').value = state.locks?.productLock || '';
    if ($('flow-lock-char')) $('flow-lock-char').value = state.locks?.characterLock || '';
    if ($('flow-lock-setting')) $('flow-lock-setting').value = state.locks?.settingLock || '';
    if ($('flow-script-overview')) $('flow-script-overview').value = state.scriptOverview || '';

    renderRefImages();
    updateIdeaSummaryText();
  }

  function readOptionsFromUI() {
    const charRec = getSelectedCharacterRecord();
    state.idea = ($('flow-idea-input')?.value || '').trim();
    state.options = {
      genre: $('flow-opt-genre')?.value || 'commercial',
      style: $('flow-opt-style')?.value || 'luxury_cinematic',
      durationSec: Number($('flow-opt-duration')?.value) || 40,
      aspectRatio: $('flow-opt-ratio')?.value || '9:16',
      sceneCount: Number($('flow-opt-scenes')?.value) || 5,
      language: $('flow-opt-lang')?.value || 'vi',
      engine: $('flow-opt-engine')?.value || 'google_flow',
      voice: $('flow-opt-voice') ? $('flow-opt-voice').value : 'vieneu:Quỳnh Anh',
      characterName: $('flow-opt-char')?.value || '',
      characterDesc: charRec ? `Nhân vật cố định ${charRec.name}` : '',
      continuity: $('flow-opt-continuity') ? $('flow-opt-continuity').checked : true
    };
    return state.options;
  }

  function updateIdeaSummaryText() {
    const o = readOptionsFromUI();
    const perScene = Math.max(5, Math.round(o.durationSec / Math.max(1, o.sceneCount)));
    const el = $('flow-idea-summary');
    const vLabel = o.voice ? ` · Giọng VieNeu 48kHz: ${o.voice.replace(/^vieneu:/i, '')}` : '';
    if (el) {
      el.textContent = `Cấu hình: ${o.sceneCount} Scene × ~${perScene}s (Tổng ${o.durationSec} giây) · Khung hình ${o.aspectRatio}${vLabel}${o.continuity ? ' · Bật Khóa nối cảnh' : ''}`;
    }
  }

  // ---------- 4. Quản lý ảnh tham chiếu (Ingredients / First-Frame) ----------
  function renderRefImages() {
    const strip = $('flow-ref-strip');
    const clearBtn = $('btn-flow-clear-refs');
    const title = $('flow-ref-title');
    if (!strip) return;
    const list = state.refImages || [];
    clearBtn.hidden = list.length === 0;
    strip.hidden = list.length === 0;
    if (title) {
      title.textContent = list.length
        ? `Đã đính kèm ${list.length}/4 ảnh tham chiếu Sản phẩm / Nhân vật (Ingredients Google Flow)`
        : 'Ảnh tham chiếu Sản phẩm / Nhân vật (Tuỳ chọn — Ingredients Google Flow)';
    }
    strip.innerHTML = list.map((p, idx) => `
      <div class="thumb-wrap" title="${escapeHtml(p)}">
        <img src="${escapeHtml(fileUrl(p))}" alt="Ref ${idx + 1}">
        <button type="button" class="thumb-x" data-rm-ref="${idx}" aria-label="Bỏ ảnh">✕</button>
      </div>
    `).join('');
  }

  async function pickRefImages() {
    if (!api?.selectImageFile) return;
    const files = await api.selectImageFile(true);
    if (!files || !files.length) return;
    const merged = [...(state.refImages || []), ...files.map(f => f.filePath)].filter(Boolean);
    state.refImages = [...new Set(merged)].slice(0, 4);
    renderRefImages();
    scheduleSave();
  }

  // ---------- 5. Xây dựng Kịch bản, Chia Scene & Tạo Prompt (Bước #4 & #5) ----------
  async function buildProjectFromIdea(showNotification = true) {
    const opts = readOptionsFromUI();
    if (!state.idea) {
      toast('Vui lòng nhập ý tưởng vào ô "Bạn muốn tạo video gì?" trước.', 'warn');
      $('flow-idea-input')?.focus();
      return;
    }
    const btn = $('btn-flow-build-script');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Đang viết kịch bản & tạo bộ Prompt...';
    }
    try {
      const project = await api.flowGenerateProject({
        idea: state.idea,
        options: opts
      });
      state.locks = {
        productLock: project.entities?.productLock || '',
        characterLock: project.entities?.characterLock || '',
        settingLock: project.entities?.settingLock || ''
      };
      state.scriptOverview = project.scriptOverview || '';
      state.scenes = (project.scenes || []).map((sc, i) => ({
        ...sc,
        index: i + 1,
        status: 'idle',
        stepText: '',
        videoPath: '',
        error: '',
        activePanel: 'prompt'
      }));
      state.mergedVideoPath = '';

      syncInputsFromState();
      renderAllScenes();
      renderPreviewSection();
      updatePipelineStepper();
      scheduleSave();

      if (showNotification) {
        toast(`Đã tự động viết kịch bản và tạo ${state.scenes.length} Scene kèm bộ Prompt chi tiết!`, 'ok');
      }
    } catch (err) {
      toast('Lỗi tạo kịch bản: ' + (err.message || err), 'danger');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '✨ Viết Kịch Bản, Chia Scene & Tạo Bộ Prompt';
      }
    }
  }

  // Đồng bộ khóa đồng nhất (Product / Character / Setting Lock) vào tất cả các Scene Prompt
  async function syncLocksToAllScenePrompts() {
    if (!state.scenes.length) {
      toast('Chưa có danh sách Scene để đồng bộ.', 'warn');
      return;
    }
    state.locks = {
      productLock: ($('flow-lock-product')?.value || '').trim(),
      characterLock: ($('flow-lock-char')?.value || '').trim(),
      settingLock: ($('flow-lock-setting')?.value || '').trim()
    };
    const opts = readOptionsFromUI();
    const entities = {
      idea: state.idea,
      productLock: state.locks.productLock,
      characterLock: state.locks.characterLock,
      settingLock: state.locks.settingLock,
      lighting: state.locks.settingLock
    };

    for (let i = 0; i < state.scenes.length; i++) {
      const sc = state.scenes[i];
      const newPrompt = await api.flowBuildScenePrompt({
        scene: sc,
        entities,
        options: opts
      });
      if (newPrompt) sc.prompt = newPrompt;
    }
    renderAllScenes();
    scheduleSave();
    toast('Đã đồng bộ Khóa Nhân vật / Sản phẩm / Bối cảnh vào toàn bộ Prompt các Scene!', 'ok');
  }

  // ---------- 6. Render Dãy nút Generate Scene 1..N & Danh sách Scene (Bước #6 & #7) ----------
  function isSceneBusy(sc) {
    return sc.status === 'processing' || sc.status === 'queued';
  }

  function isSceneDone(sc) {
    return sc.status === 'succeeded' && Boolean(sc.videoPath);
  }

  function renderQuickButtonsBar() {
    const bar = $('flow-scene-quick-btns');
    if (!bar) return;
    if (!state.scenes.length) {
      bar.innerHTML = `<span class="muted small">Chưa có Scene nào. Hãy bấm "Viết Kịch Bản, Chia Scene & Tạo Bộ Prompt" ở trên.</span>`;
      return;
    }

    const sceneBtns = state.scenes.map((sc, idx) => {
      const busy = isSceneBusy(sc);
      const done = isSceneDone(sc);
      const badgeIcon = busy ? '⏳' : (done ? '✅' : '🎬');
      return `<button type="button" class="btn-ghost btn-sm flow-quick-scene-btn ${done ? 'is-done' : ''} ${busy ? 'is-running' : ''}" data-quick-gen="${idx}" ${busy ? 'disabled' : ''}>
        ${badgeIcon} Generate Scene ${idx + 1}
      </button>`;
    }).join('');

    bar.innerHTML = `
      <span class="label" style="margin:0; align-self:center; margin-right:4px;">Tạo nhanh (Bước #6):</span>
      ${sceneBtns}
      <button type="button" class="btn btn-sm" data-quick-gen-all="1">⚡ Generate All Scenes (${state.scenes.length})</button>
    `;
  }

  function getSceneStatusChip(sc) {
    if (sc.status === 'processing') {
      return `<span class="st-chip" data-tone="live"><span class="st-dot"></span>${escapeHtml(sc.stepText || 'Đang tạo trên Google Flow...')}</span>`;
    }
    if (sc.status === 'queued') {
      return `<span class="st-chip" data-tone="info"><span class="st-dot"></span>Đang chờ hàng đợi</span>`;
    }
    if (isSceneDone(sc)) {
      return `<span class="st-chip" data-tone="ok"><span class="st-dot"></span>Đã tạo Video</span>`;
    }
    if (sc.status === 'failed') {
      return `<span class="st-chip" data-tone="danger" title="${escapeHtml(sc.error || '')}"><span class="st-dot"></span>Lỗi (${escapeHtml((sc.error || 'Thất bại').slice(0, 38))})</span>`;
    }
    return `<span class="st-chip"><span class="st-dot"></span>Sẵn sàng</span>`;
  }

  function renderAllScenes() {
    renderQuickButtonsBar();
    const wrap = $('flow-scenes-list');
    if (!wrap) return;

    if (!state.scenes.length) {
      wrap.innerHTML = `
        <div class="preview-empty">
          <strong>Chưa có danh sách Scene</strong>
          Nhập ý tưởng ở Bước 1 và nhấn <b>✨ Viết Kịch Bản, Chia Scene &amp; Tạo Bộ Prompt</b>.
        </div>`;
      return;
    }

    wrap.innerHTML = state.scenes.map((sc, idx) => {
      const busy = isSceneBusy(sc);
      const hasVideo = isSceneDone(sc);
      const showPromptBox = sc.activePanel !== 'preview_only';

      return `
        <article class="flow-scene-card ${hasVideo ? 'is-completed' : ''} ${busy ? 'is-busy' : ''}" data-scene-idx="${idx}" id="flow-scene-card-${idx}">
          <div class="flow-scene-head">
            <div class="row" style="gap: 10px; flex-wrap: wrap;">
              <span class="flow-scene-num">SCENE ${idx + 1}</span>
              <input type="text" class="input flow-scene-title-input" data-sc-field="title" value="${escapeHtml(sc.title || `Scene ${idx + 1}`)}" placeholder="Tiêu đề cảnh...">
              <span class="pill" title="Khoảng thời gian trong video">${escapeHtml(sc.timeRange || `${idx * 8}s-${(idx + 1) * 8}s`)}</span>
              <label class="row" style="gap:4px; font-size:12px; color:var(--ink-2);">
                <span>Thời lượng:</span>
                <input type="number" min="4" max="15" class="input flow-scene-dur-input" data-sc-field="durationSec" value="${Number(sc.durationSec) || 8}">
                <span>giây</span>
              </label>
              ${getSceneStatusChip(sc)}
            </div>

            <!-- Thanh điều khiển chuẩn Bước #7: Prompt | Generate | Preview | Regenerate -->
            <div class="flow-scene-actions" role="toolbar" aria-label="Điều khiển Scene ${idx + 1}">
              <button type="button" class="flow-act-btn ${showPromptBox ? 'active' : ''}" data-sc-act="prompt" title="Mở / chỉnh sửa chi tiết kịch bản & Prompt của Scene ${idx + 1}">
                📝 Prompt
              </button>
              <button type="button" class="flow-act-btn primary" data-sc-act="generate" ${busy ? 'disabled' : ''} title="Tạo video cho Scene ${idx + 1} bằng Google Flow">
                ▶️ Generate
              </button>
              <button type="button" class="flow-act-btn ${hasVideo ? 'has-video' : ''}" data-sc-act="preview" title="Xem trước video của Scene ${idx + 1}">
                👁️ Preview
              </button>
              <button type="button" class="flow-act-btn" data-sc-act="regenerate" ${busy ? 'disabled' : ''} title="Tạo lại (Regenerate) video mới cho Scene ${idx + 1}">
                🔄 Regenerate
              </button>
              <button type="button" class="flow-act-btn danger" data-sc-act="delete" ${busy ? 'disabled' : ''} title="Xóa Scene này">
                ✕
              </button>
            </div>
          </div>

          <div class="flow-scene-body">
            <!-- Cột trái: Nội dung cảnh + Prompt chi tiết (Bước #4 & #5) -->
            <div class="flow-scene-editor" ${showPromptBox ? '' : 'hidden'}>
              <div class="flow-scene-meta-grid">
                <div>
                  <label class="label">Nội dung cảnh (Content)</label>
                  <input type="text" class="input" data-sc-field="content" value="${escapeHtml(sc.content || '')}" placeholder="Nội dung chính của cảnh...">
                </div>
                <div>
                  <label class="label">Hành động (Action)</label>
                  <input type="text" class="input" data-sc-field="action" value="${escapeHtml(sc.action || '')}" placeholder="Chuyển động của nhân vật / sản phẩm...">
                </div>
                <div>
                  <label class="label">Góc máy &amp; Chuyển động Camera (Visual / Camera)</label>
                  <input type="text" class="input" data-sc-field="camera" value="${escapeHtml(sc.camera || sc.visual || '')}" placeholder="Cận cảnh, Dolly-in, pan, ánh sáng...">
                </div>
                <div>
                  <label class="label">Âm thanh &amp; Nhạc nền (Audio)</label>
                  <input type="text" class="input" data-sc-field="audio" value="${escapeHtml(sc.audio || '')}" placeholder="Nhạc nền cinematic, âm thanh môi trường...">
                </div>
                <div style="grid-column: 1 / -1;">
                  <label class="label">🎙️ Lời thoại / Thuyết minh VieNeu-TTS 48kHz (Voiceover — để trống sẽ tự đọc theo Nội dung cảnh)</label>
                  <input type="text" class="input" data-sc-field="voiceover" value="${escapeHtml(sc.voiceover ?? sc.content ?? '')}" placeholder="Nhập câu thuyết minh tiếng Việt cho Scene ${idx + 1}...">
                </div>
              </div>

              <div class="flow-prompt-box">
                <div class="row-between" style="margin-bottom: 4px;">
                  <label class="label" style="margin:0;">Prompt tạo Video chi tiết — Scene ${idx + 1} (Nhân vật, hành động, bối cảnh, camera, ánh sáng, 4K, âm thanh)</label>
                  <div class="row" style="gap: 6px;">
                    <button type="button" class="btn-ghost btn-sm" data-sc-act="rebuild-prompt" title="Cập nhật lại Prompt từ các ô Nội dung/Hành động/Camera ở trên">✨ Cập nhật lại Prompt</button>
                    <button type="button" class="btn-ghost btn-sm" data-sc-act="copy-prompt" title="Copy Prompt của Scene ${idx + 1}">📋 Copy Prompt</button>
                  </div>
                </div>
                <textarea class="textarea flow-scene-prompt-textarea" rows="4" data-sc-field="prompt" placeholder="Prompt đầy đủ để gửi sang Google Flow...">${escapeHtml(sc.prompt || '')}</textarea>
              </div>
            </div>

            <!-- Cột phải: Video Preview trực tiếp của Scene -->
            <div class="flow-scene-preview-pane" id="flow-scene-preview-${idx}">
              ${hasVideo ? `
                <video class="flow-scene-video" src="${escapeHtml(fileUrl(sc.videoPath))}" controls preload="metadata"></video>
                <div class="row-between" style="margin-top: 6px; font-size: 11.5px;">
                  <span class="muted" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(sc.videoPath)}">✅ ${escapeHtml(sc.videoPath.split(/[\\/]/).pop())}</span>
                  <div class="row" style="gap:4px;">
                    <button type="button" class="btn-ghost btn-sm" data-sc-act="locate-video">📂 Mở file</button>
                    <button type="button" class="btn-ghost btn-sm" data-sc-act="regenerate">🔄 Tạo lại</button>
                  </div>
                </div>
              ` : busy ? `
                <div class="flow-scene-placeholder busy">
                  <div class="flow-spinner"></div>
                  <strong>Đang sản xuất Scene ${idx + 1}...</strong>
                  <span class="muted small">${escapeHtml(sc.stepText || 'Đang gửi lệnh vào Google Flow...')}</span>
                </div>
              ` : `
                <div class="flow-scene-placeholder">
                  <strong>Preview Scene ${idx + 1}</strong>
                  <span class="muted small">Chưa có video. Nhấn <b>▶️ Generate</b> hoặc <b>Generate Scene ${idx + 1}</b> để tạo.</span>
                  <button type="button" class="btn btn-sm" data-sc-act="generate" style="margin-top: 6px;">▶️ Generate Scene ${idx + 1}</button>
                </div>
              `}
            </div>
          </div>
        </article>
      `;
    }).join('');

    const stopBtn = $('btn-flow-stop-all');
    const anyBusy = state.scenes.some(isSceneBusy) || state.isSequentialRunning;
    if (stopBtn) stopBtn.hidden = !anyBusy;
  }

  // ---------- 7. Render Khu vực Video Preview Tổng hợp (Bước #7 & #8) ----------
  function renderPreviewSection() {
    const strip = $('flow-preview-strip');
    const countEl = $('flow-done-count');
    const finalBox = $('flow-final-player-box');
    if (!strip || !finalBox) return;

    const doneScenes = state.scenes.filter(isSceneDone);
    if (countEl) countEl.textContent = `${doneScenes.length}/${state.scenes.length}`;

    strip.innerHTML = state.scenes.map((sc, idx) => {
      const hasVideo = isSceneDone(sc);
      const busy = isSceneBusy(sc);
      return `
        <div class="flow-mini-scene-card ${hasVideo ? 'done' : ''} ${busy ? 'busy' : ''}" data-goto-scene="${idx}">
          <div class="flow-mini-thumb">
            ${hasVideo
              ? `<video src="${escapeHtml(fileUrl(sc.videoPath))}" muted preload="metadata"></video>`
              : `<div class="flow-mini-empty">${busy ? `⏳ Đang tạo...` : `Scene ${idx + 1}`}</div>`
            }
          </div>
          <div class="flow-mini-meta">
            <strong>Scene ${idx + 1} (${sc.durationSec || 8}s)</strong>
            <span class="muted small">${escapeHtml((sc.title || '').replace(/^Scene\s*\d+\s*:\s*/i, ''))}</span>
          </div>
        </div>
      `;
    }).join('');

    if (state.mergedVideoPath) {
      finalBox.innerHTML = `
        <div class="flow-final-video-wrap">
          <div class="row-between" style="margin-bottom: 8px;">
            <strong style="color: var(--green);">🎉 Video Hoàn Chỉnh Đã Ghép (${doneScenes.length} Scene)</strong>
            <div class="row" style="gap: 6px;">
              <button type="button" class="btn-ghost btn-sm" id="btn-flow-locate-merged">📂 Mở file</button>
              <button type="button" class="btn-ghost btn-sm" id="btn-flow-open-merge-dlg">🎛️ Hộp ghép nâng cao</button>
            </div>
          </div>
          <video class="flow-final-video" src="${escapeHtml(fileUrl(state.mergedVideoPath))}" controls autoplay muted></video>
          <div class="muted small" style="margin-top: 6px; word-break: break-all;">Đường dẫn: ${escapeHtml(state.mergedVideoPath)}</div>
        </div>
      `;
      $('btn-flow-locate-merged')?.addEventListener('click', () => api?.revealFile(state.mergedVideoPath));
      $('btn-flow-open-merge-dlg')?.addEventListener('click', () => {
        const paths = doneScenes.map(s => s.videoPath).filter(Boolean);
        if (window.App.openMerge && paths.length >= 2) {
          window.App.openMerge(paths, outPath => {
            if (outPath) {
              state.mergedVideoPath = outPath;
              renderPreviewSection();
              scheduleSave();
            }
          });
        }
      });
    } else if (doneScenes.length === 1) {
      finalBox.innerHTML = `
        <div class="flow-final-video-wrap">
          <div class="row-between" style="margin-bottom: 8px;">
            <strong>Xem trước Scene vừa tạo (${escapeHtml(doneScenes[0].title || 'Scene 1')})</strong>
            <button type="button" class="btn-ghost btn-sm" id="btn-flow-locate-single">📂 Mở file</button>
          </div>
          <video class="flow-final-video" src="${escapeHtml(fileUrl(doneScenes[0].videoPath))}" controls muted></video>
          <div class="muted small" style="margin-top: 6px;">Tạo thêm ít nhất 1 Scene nữa để ghép thành video dài hoàn chỉnh.</div>
        </div>
      `;
      $('btn-flow-locate-single')?.addEventListener('click', () => api?.revealFile(doneScenes[0].videoPath));
    } else {
      finalBox.innerHTML = `
        <div class="preview-empty">
          <strong>Chưa có Video tổng hợp (${doneScenes.length}/${state.scenes.length} Scene hoàn tất)</strong>
          Hãy nhấn <b>🎬 Generate Video (Tạo &amp; Tự ghép)</b> hoặc tạo từng Scene rồi bấm <b>🎞️ Ghép các Scene đã xong thành 1 Video</b>.
        </div>
      `;
    }
  }

  function updatePipelineStepper() {
    const steps = document.querySelectorAll('#flow-pipeline-bar .flow-step-item, #flow-steps-bar .step');
    if (!steps.length) return;
    const hasIdea = Boolean((state.idea || '').trim());
    const hasScript = Boolean(state.scenes && state.scenes.length > 0);
    const hasPrompts = hasScript && state.scenes.every(s => (s.prompt || '').trim().length > 10);
    const hasAnyVideo = hasScript && state.scenes.some(isSceneDone);

    const doneFlags = [hasIdea, hasScript, hasScript, hasPrompts, hasAnyVideo];
    steps.forEach((el, idx) => {
      el.classList.toggle('done', Boolean(doneFlags[idx]));
    });
  }

  // ---------- 8. Gửi lệnh Generate Video cho 1 Scene hoặc All Scenes (Bước #6) ----------
  function collectReferenceImagesForScene(scenePrompt) {
    const studio = window.App.studioData ? window.App.studioData() : null;
    const charRec = getSelectedCharacterRecord();
    const extraRefs = [...(state.refImages || [])];
    if (charRec && Array.isArray(charRec.images)) {
      extraRefs.unshift(...charRec.images);
    }
    if (window.Compose && studio) {
      const composed = window.Compose.imagesFor({
        prompt: scenePrompt,
        index: 0,
        characters: studio.characters || [],
        model: studio.model,
        rotate: studio.rotate,
        refs: extraRefs,
        mode: 'shared'
      });
      return composed.images || extraRefs.slice(0, 4);
    }
    return [...new Set(extraRefs)].slice(0, 4);
  }

  async function dispatchSingleScene(sceneIdx, isRegenerate = false) {
    const sc = state.scenes[sceneIdx];
    if (!sc) return null;

    const opts = readOptionsFromUI();
    const promptText = (sc.prompt || '').trim();
    if (!promptText) {
      toast(`Scene ${sceneIdx + 1} chưa có Prompt. Hãy tạo hoặc nhập Prompt trước.`, 'warn');
      return null;
    }

    // Nếu bật Khóa nối cảnh liên tục (Continuity Lock) và Scene trước đó đã có video hoàn chỉnh,
    // trích xuất frame cuối của Scene trước làm frame mở đầu cho Scene hiện tại.
    let continuityStartFrame = null;
    if (opts.continuity && sceneIdx > 0) {
      const prevScene = state.scenes[sceneIdx - 1];
      if (prevScene?.videoPath && api?.flowExtractEndFrame) {
        try {
          continuityStartFrame = await api.flowExtractEndFrame({ videoPath: prevScene.videoPath });
        } catch (_) {}
      }
    }

    const refPaths = collectReferenceImagesForScene(promptText);
    const imagesPayload = refPaths.map(src =>
      String(src).startsWith('data:') ? { imageBase64: src } : { imageLocalPath: src }
    );
    const dur = Number(sc.durationSec) || 8;
    const startSec = sceneIdx * dur;
    const endSec = startSec + dur;
    const timeRange = sc.timeRange || `${startSec}s-${endSec}s`;

    sc.status = 'queued';
    sc.stepText = 'Đang xếp hàng đợi...';
    sc.error = '';
    renderAllScenes();
    renderPreviewSection();

    try {
      const studio = window.App.studioData ? window.App.studioData() : null;
      const cleanPrompt = window.Compose && studio
        ? window.Compose.untag(promptText, studio.characters || [])
        : promptText;

      const created = await api.submitTask({
        prompt: cleanPrompt,
        kind: 'video',
        ratio: opts.aspectRatio || '9:16',
        secs: dur,
        engine: opts.engine || 'google_flow',
        held: false,
        label: `[Flow Scene ${sceneIdx + 1}] ${sc.title || cleanPrompt.slice(0, 48)}`,
        images: imagesPayload,
        timeRange,
        continuityStartFrame: continuityStartFrame || null,
        continuity: Boolean(opts.continuity)
      });

      if (created && created.id) {
        sc.taskId = created.id;
        taskToSceneMap.set(created.id, sceneIdx);
      }
      scheduleSave();
      toast(`${isRegenerate ? 'Đang tạo lại (Regenerate)' : 'Đã gửi lệnh tạo'} Scene ${sceneIdx + 1} trên Google Flow!`, 'info');
      return created;
    } catch (err) {
      sc.status = 'failed';
      sc.error = err.message || String(err);
      renderAllScenes();
      toast(`Lỗi gửi Scene ${sceneIdx + 1}: ${sc.error}`, 'danger');
      return null;
    }
  }

  function waitForSceneTaskCompletion(sceneIdx, timeoutMs = 15 * 60 * 1000) {
    return new Promise(resolve => {
      const start = Date.now();
      const timer = setInterval(() => {
        if (state.stopRequested) {
          clearInterval(timer);
          resolve({ ok: false, stopped: true });
          return;
        }
        const sc = state.scenes[sceneIdx];
        if (!sc) {
          clearInterval(timer);
          resolve({ ok: false });
          return;
        }
        if (isSceneDone(sc)) {
          clearInterval(timer);
          resolve({ ok: true, videoPath: sc.videoPath });
          return;
        }
        if (sc.status === 'failed' || sc.status === 'cancelled') {
          clearInterval(timer);
          resolve({ ok: false, error: sc.error || 'Đã hủy' });
          return;
        }
        if (Date.now() - start > timeoutMs) {
          clearInterval(timer);
          resolve({ ok: false, error: 'Quá thời gian chờ Scene hoàn tất' });
        }
      }, 800);
    });
  }

  async function generateAllScenes({ autoMerge = false, forceRegenerateAll = false } = {}) {
    if (!state.scenes.length) {
      await buildProjectFromIdea(false);
    }
    if (!state.scenes.length) return;

    const opts = readOptionsFromUI();
    state.autoMergeWhenAllDone = autoMerge;
    state.stopRequested = false;

    // Nếu bật Continuity Lock: chạy tuần tự Scene 1 -> Scene 2 -> ... để lấy frame cuối của Scene trước nối vào Scene sau
    if (opts.continuity) {
      state.isSequentialRunning = true;
      renderAllScenes();
      toast(`Bắt đầu sản xuất tuần tự ${state.scenes.length} Scene với Khóa nối cảnh liên tục (Continuity Lock)...`, 'info');

      for (let i = 0; i < state.scenes.length; i++) {
        if (state.stopRequested) break;
        const sc = state.scenes[i];
        if (!forceRegenerateAll && isSceneDone(sc)) {
          continue;
        }
        const task = await dispatchSingleScene(i, forceRegenerateAll);
        if (!task) break;
        const res = await waitForSceneTaskCompletion(i);
        if (!res.ok) {
          if (!res.stopped) {
            toast(`Scene ${i + 1} gặp lỗi (${res.error || 'Thất bại'}). Bạn có thể bấm Regenerate trên Scene ${i + 1}.`, 'warn');
          }
          break;
        }
      }

      state.isSequentialRunning = false;
      renderAllScenes();
      renderPreviewSection();

      if (!state.stopRequested && autoMerge) {
        const readyClips = state.scenes.filter(isSceneDone);
        if (readyClips.length >= 2) {
          await mergeCompletedScenesToFinalVideo();
        }
      }
      return;
    }

    // Nếu tắt Continuity Lock: đẩy toàn bộ các Scene vào hàng đợi cùng lúc
    let dispatched = 0;
    for (let i = 0; i < state.scenes.length; i++) {
      const sc = state.scenes[i];
      if (!forceRegenerateAll && isSceneDone(sc)) continue;
      await dispatchSingleScene(i, forceRegenerateAll);
      dispatched++;
    }
    if (dispatched === 0) {
      toast('Tất cả các Scene đều đã có video. Nếu muốn tạo mới, hãy bấm Regenerate.', 'info');
      if (autoMerge) await mergeCompletedScenesToFinalVideo();
    } else {
      toast(`Đã đưa ${dispatched} Scene vào hàng đợi sản xuất Google Flow!`, 'ok');
    }
  }

  // ---------- 9. Ghép các Scene đã hoàn thành thành 1 Video MP4 & Lồng tiếng VieNeu-TTS 48kHz ----------
  async function mergeCompletedScenesToFinalVideo() {
    const doneScenes = state.scenes.filter(isSceneDone);
    if (doneScenes.length < 2) {
      toast('Cần ít nhất 2 Scene đã tạo xong video để ghép nối.', 'warn');
      return;
    }
    const btn = $('btn-flow-merge-final');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Đang ghép các Scene...';
    }
    try {
      const opts = readOptionsFromUI();
      const clipPaths = doneScenes.map(s => s.videoPath);
      const safeName = (state.idea || 'GoogleFlow_Video')
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
        .trim()
        .slice(0, 45)
        .replace(/\s+/g, '_');
      const outputName = `FlowApp_${safeName}_${Date.now()}`;

      const res = await api.mergeVideos(clipPaths, outputName, { normalize: true });
      const mergedPath = res?.path || res?.outputPath;
      if (!res?.success || !mergedPath) {
        throw new Error(res?.error || 'Không thể ghép video');
      }

      state.rawMergedVideoPath = mergedPath;
      let finalPath = mergedPath;

      // Tự động lồng giọng đọc AI VieNeu-TTS v3 Turbo (48kHz) nếu được chọn
      if ($('flow-merge-voice')?.checked && opts.voice && api?.dubVideoVieneu) {
        if (btn) btn.textContent = '🎙️ Đang lồng tiếng VieNeu-TTS 48kHz...';
        const dubRes = await api.dubVideoVieneu({
          videoPath: finalPath,
          scenes: doneScenes,
          voice: opts.voice,
          keepAmbient: false
        });
        if (dubRes?.success && dubRes?.path) {
          finalPath = dubRes.path;
        }
      }

      if ($('flow-merge-music')?.checked && api?.addMusic) {
        if (btn) btn.textContent = '🎵 Đang ghép nhạc nền...';
        const musicRes = await api.addMusic(finalPath);
        if (musicRes?.success && musicRes?.path) {
          finalPath = musicRes.path;
        }
      }

      state.mergedVideoPath = finalPath;
      renderPreviewSection();
      updatePipelineStepper();
      scheduleSave();
      toast('🎉 Đã ghép & lồng tiếng VieNeu-TTS 48kHz thành công cho Video MP4 hoàn chỉnh!', 'ok');
    } catch (err) {
      toast('Lỗi ghép video: ' + (err.message || err), 'danger');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '🎞️ Ghép các Scene đã xong thành 1 Video';
      }
    }
  }

  async function dubCurrentFlowVideoWithVieneu() {
    const doneScenes = state.scenes.filter(isSceneDone);
    const sourceVideo = state.rawMergedVideoPath || state.mergedVideoPath || (doneScenes.length === 1 ? doneScenes[0].videoPath : '');
    if (!sourceVideo) {
      toast('Chưa có video đã ghép (hoặc Scene đã xong) để lồng tiếng. Hãy tạo hoặc ghép Scene trước.', 'warn');
      return;
    }
    const opts = readOptionsFromUI();
    const voice = opts.voice || 'vieneu:Quỳnh Anh';
    const btn = $('btn-flow-dub-vieneu');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Đang lồng 48kHz...';
    }
    try {
      toast(`Đang lồng giọng đọc AI VieNeu-TTS v3 Turbo (48kHz) — Giọng ${voice.replace(/^vieneu:/i, '')}...`, 'info');
      const dubRes = await api.dubVideoVieneu({
        videoPath: sourceVideo,
        scenes: doneScenes.length ? doneScenes : state.scenes,
        voice,
        keepAmbient: false
      });
      if (!dubRes?.success || !dubRes?.path) {
        throw new Error(dubRes?.error || 'Không thể lồng tiếng VieNeu-TTS 48kHz');
      }
      let finalPath = dubRes.path;
      if ($('flow-merge-music')?.checked && api?.addMusic) {
        const musicRes = await api.addMusic(finalPath);
        if (musicRes?.success && musicRes?.path) finalPath = musicRes.path;
      }
      state.mergedVideoPath = finalPath;
      renderPreviewSection();
      scheduleSave();
      toast(`🎉 Đã lồng tiếng VieNeu-TTS v3 Turbo 48kHz (${dubRes.voice}) thành công!`, 'ok');
    } catch (err) {
      toast('Lỗi lồng tiếng 48kHz: ' + (err.message || err), 'danger');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '🎙️ Lồng tiếng lại (48kHz)';
      }
    }
  }

  // ---------- 10. Lắng nghe cập nhật Task thời gian thực từ Main Process ----------
  function syncSingleTaskToScene(t) {
    if (!t || !state.scenes.length) return false;
    let sceneIdx = taskToSceneMap.get(t.id);
    if (sceneIdx === undefined) {
      sceneIdx = state.scenes.findIndex(s => s.taskId === t.id);
      if (sceneIdx >= 0) taskToSceneMap.set(t.id, sceneIdx);
    }
    if (sceneIdx === undefined || sceneIdx < 0 || !state.scenes[sceneIdx]) return false;

    const sc = state.scenes[sceneIdx];
    const mp4File = Array.isArray(t.files) ? t.files.find(f => /\.mp4$/i.test(f)) : (t.outputPath || '');
    const nextVideoPath = mp4File || sc.videoPath || '';
    const nextStep = t.step || '';
    const nextErr = t.error || '';

    if (
      sc.status !== t.status ||
      sc.stepText !== nextStep ||
      sc.videoPath !== nextVideoPath ||
      sc.error !== nextErr
    ) {
      sc.status = t.status;
      sc.stepText = nextStep;
      if (mp4File) sc.videoPath = mp4File;
      sc.error = nextErr;
      return true;
    }
    return false;
  }

  if (api?.onTaskUpdate) {
    api.onTaskUpdate(({ task }) => {
      if (!task) return;
      const changed = syncSingleTaskToScene(task);
      if (changed) {
        const activeEl = document.activeElement;
        const isTypingInScene = activeEl && activeEl.closest('#flow-scenes-list') && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT');
        if (!isTypingInScene) {
          renderAllScenes();
        } else {
          renderQuickButtonsBar();
        }
        renderPreviewSection();
        updatePipelineStepper();
        scheduleSave();

        if (
          state.autoMergeWhenAllDone &&
          !state.isSequentialRunning &&
          state.scenes.length >= 2 &&
          state.scenes.every(isSceneDone)
        ) {
          state.autoMergeWhenAllDone = false;
          mergeCompletedScenesToFinalVideo();
        }
      }
    });
  }

  if (api?.onAccountsUpdate) {
    api.onAccountsUpdate(v => applyAccountBadgeFromList(v?.accounts || []));
  }

  // ---------- 11. Gắn sự kiện tương tác UI ----------
  function bindEvents() {
    // Bước #1: Kết nối Google Flow + Mở thư mục xuất
    const onConnectFlow = async () => {
      try {
        const res = await api.listAccounts();
        const accounts = res?.accounts || [];
        const gf = accounts.find(a => a.provider === 'google_flow');
        if (gf) {
          toast(`Đang mở trình duyệt Google Flow (${gf.name})...`, 'info');
          if (gf.loggedIn) {
            await api.showAccount(gf.id);
          } else {
            await api.loginAccount(gf.id);
          }
        } else {
          toast('Đang khởi tạo tài khoản Google Flow mới và mở cửa sổ đăng nhập...', 'info');
          await api.addAccount('Google Flow', 'google_flow');
        }
        await refreshGoogleFlowAccountBadge();
      } catch (err) {
        toast('Lỗi mở Google Flow: ' + (err.message || err), 'danger');
      }
    };
    ['btn-flow-login', 'btn-flow-connect-acc'].forEach(id => $(id)?.addEventListener('click', onConnectFlow));
    $('btn-flow-open-folder')?.addEventListener('click', () => api?.openOutputFolder?.());

    // Bước #2: Tiện ích ChatGPT 0-credit
    const onCopyChatGpt = async () => {
      const opts = readOptionsFromUI();
      if (!state.idea) {
        toast('Hãy nhập ý tưởng video ở Bước 1 trước khi copy lệnh cho ChatGPT.', 'warn');
        $('flow-idea-input')?.focus();
        return;
      }
      const prompt = await api.flowChatGptHelper({ idea: state.idea, options: opts });
      await navigator.clipboard.writeText(prompt);
      toast('Đã copy lệnh chuẩn cho ChatGPT! Hãy dán vào ChatGPT rồi bấm "Dán từ ChatGPT".', 'ok');
    };
    ['btn-flow-chatgpt-copy', 'btn-flow-copy-chatgpt'].forEach(id => $(id)?.addEventListener('click', onCopyChatGpt));

    const chatDlg = $('flow-chatgpt-dlg');
    const onPasteChatGpt = () => {
      if (!chatDlg) return;
      $('flow-chatgpt-raw').value = '';
      chatDlg.showModal();
    };
    ['btn-flow-chatgpt-paste', 'btn-flow-paste-chatgpt'].forEach(id => $(id)?.addEventListener('click', onPasteChatGpt));
    $('flow-chatgpt-close')?.addEventListener('click', () => chatDlg?.close());
    $('flow-chatgpt-cancel')?.addEventListener('click', () => chatDlg?.close());
    $('flow-chatgpt-apply')?.addEventListener('click', async () => {
      const raw = ($('flow-chatgpt-raw')?.value || '').trim();
      if (!raw) {
        toast('Vui lòng dán nội dung từ ChatGPT vào ô trống.', 'warn');
        return;
      }
      try {
        const opts = readOptionsFromUI();
        const parsed = await api.flowParseExternal({
          rawText: raw,
          idea: state.idea,
          options: opts
        });
        const scenesList = Array.isArray(parsed) ? parsed : (parsed?.scenes || []);
        if (!scenesList.length) {
          toast('Không nhận diện được danh sách Scene. Hãy thử lại.', 'warn');
          return;
        }
        if (parsed?.entities) {
          state.locks = {
            productLock: parsed.entities.productLock || state.locks.productLock,
            characterLock: parsed.entities.characterLock || state.locks.characterLock,
            settingLock: parsed.entities.settingLock || state.locks.settingLock
          };
        }
        state.scriptOverview = parsed?.scriptOverview || '';
        state.scenes = scenesList.map((sc, i) => ({
          ...sc,
          index: i + 1,
          status: 'idle',
          stepText: '',
          videoPath: '',
          error: '',
          activePanel: 'prompt'
        }));
        chatDlg?.close();
        syncInputsFromState();
        renderAllScenes();
        renderPreviewSection();
        updatePipelineStepper();
        scheduleSave();
        toast(`Đã nhập thành công ${state.scenes.length} Scene từ ChatGPT!`, 'ok');
      } catch (err) {
        toast('Lỗi phân tích nội dung: ' + (err.message || err), 'danger');
      }
    });

    // Bước #7: Thanh quy trình 5 bước (scroll nhanh tới từng khu vực)
    const stepTargetMap = {
      idea: 'flow-sec-idea',
      script: 'flow-sec-script',
      scenes: 'flow-sec-scenes',
      prompts: 'flow-sec-scenes',
      preview: 'flow-sec-preview'
    };
    ['flow-pipeline-bar', 'flow-steps-bar'].forEach(barId => {
      $(barId)?.addEventListener('click', e => {
        const btn = e.target.closest('[data-jump], [data-step-nav]');
        if (!btn) return;
        document.querySelectorAll('#flow-pipeline-bar .flow-step-item, #flow-steps-bar .step').forEach(el => el.classList.toggle('active', el === btn));
        const jumpId = btn.dataset.jump || stepTargetMap[btn.dataset.stepNav];
        const target = jumpId ? $(jumpId) : null;
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    // Bước #3: Chọn mẫu Ý tưởng (Preset Chips)
    $('flow-idea-presets')?.addEventListener('click', async e => {
      const chipBtn = e.target.closest('.preset-chip');
      if (!chipBtn) return;
      if (chipBtn.dataset.idea) $('flow-idea-input').value = chipBtn.dataset.idea;
      if (chipBtn.dataset.genre && $('flow-opt-genre')) $('flow-opt-genre').value = chipBtn.dataset.genre;
      if (chipBtn.dataset.style && $('flow-opt-style')) $('flow-opt-style').value = chipBtn.dataset.style;
      if (chipBtn.dataset.scenes && $('flow-opt-scenes')) $('flow-opt-scenes').value = chipBtn.dataset.scenes;
      if (chipBtn.dataset.ratio && $('flow-opt-ratio')) $('flow-opt-ratio').value = chipBtn.dataset.ratio;
      updateIdeaSummaryText();
      await buildProjectFromIdea(true);
    });

    // Thay đổi cấu hình Ý tưởng
    ['flow-idea-input', 'flow-opt-genre', 'flow-opt-style', 'flow-opt-duration', 'flow-opt-ratio', 'flow-opt-scenes', 'flow-opt-lang', 'flow-opt-engine', 'flow-opt-voice', 'flow-opt-char', 'flow-opt-continuity'].forEach(id => {
      $(id)?.addEventListener('change', () => {
        updateIdeaSummaryText();
        scheduleSave();
      });
      if (id === 'flow-idea-input') {
        $(id)?.addEventListener('input', () => {
          state.idea = $('flow-idea-input').value;
          scheduleSave();
        });
      }
    });

    let flowVoicePreviewAudio = null;
    $('btn-flow-preview-voice')?.addEventListener('click', async () => {
      const v = $('flow-opt-voice')?.value || '';
      if (!v) return toast('Hãy chọn 1 giọng đọc VieNeu-TTS 48kHz trong danh sách để nghe thử.', 'warn');
      const btn = $('btn-flow-preview-voice');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang tạo...'; }
      try {
        const r = await api.vieneuPreview({ voice: v });
        if (!r?.success || !r.path) throw new Error(r?.error || 'Không tạo được mẫu thử');
        if (flowVoicePreviewAudio) { try { flowVoicePreviewAudio.pause(); } catch (_) {} }
        flowVoicePreviewAudio = new Audio(fileUrl(r.path) + '?t=' + Date.now());
        await flowVoicePreviewAudio.play();
        toast(`Đang phát giọng mẫu VieNeu-TTS v3 Turbo (48kHz): ${r.voice}`, 'ok');
      } catch (e) {
        toast('Lỗi nghe thử giọng: ' + (e.message || e), 'danger');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '🔊 Nghe thử'; }
      }
    });

    // Đính kèm ảnh tham chiếu
    $('btn-flow-pick-refs')?.addEventListener('click', pickRefImages);
    $('btn-flow-clear-refs')?.addEventListener('click', () => {
      state.refImages = [];
      renderRefImages();
      scheduleSave();
    });
    $('flow-ref-strip')?.addEventListener('click', e => {
      const rm = e.target.closest('[data-rm-ref]');
      if (!rm) return;
      const idx = Number(rm.dataset.rmRef);
      state.refImages.splice(idx, 1);
      renderRefImages();
      scheduleSave();
    });

    const dropzone = $('flow-ref-dropzone');
    if (dropzone) {
      dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag'); });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
      dropzone.addEventListener('drop', e => {
        e.preventDefault();
        dropzone.classList.remove('drag');
        const files = [...(e.dataTransfer?.files || [])]
          .map(f => f.path)
          .filter(p => p && /\.(png|jpe?g|webp)$/i.test(p));
        if (files.length) {
          state.refImages = [...new Set([...(state.refImages || []), ...files])].slice(0, 4);
          renderRefImages();
          scheduleSave();
        }
      });
    }

    // Nút tạo kịch bản & bộ Prompt
    $('btn-flow-build-script')?.addEventListener('click', () => buildProjectFromIdea(true));

    // Khóa đồng nhất (Consistency Lock)
    ['flow-lock-product', 'flow-lock-char', 'flow-lock-setting', 'flow-script-overview'].forEach(id => {
      $(id)?.addEventListener('input', () => {
        state.locks = {
          productLock: $('flow-lock-product')?.value || '',
          characterLock: $('flow-lock-char')?.value || '',
          settingLock: $('flow-lock-setting')?.value || ''
        };
        state.scriptOverview = $('flow-script-overview')?.value || '';
        scheduleSave();
      });
    });
    $('btn-flow-sync-locks')?.addEventListener('click', syncLocksToAllScenePrompts);

    // Dãy nút nhanh Bước #6: Generate Scene 1 | Generate Scene 2 | ... | Generate All Scenes
    $('flow-scene-quick-btns')?.addEventListener('click', e => {
      const quickScene = e.target.closest('[data-quick-gen]');
      if (quickScene) {
        const idx = Number(quickScene.dataset.quickGen);
        dispatchSingleScene(idx, false);
        return;
      }
      if (e.target.closest('[data-quick-gen-all]')) {
        generateAllScenes({ autoMerge: false, forceRegenerateAll: false });
      }
    });

    // Các nút trên thanh công cụ Scene
    $('btn-flow-add-scene')?.addEventListener('click', async () => {
      const nextIdx = state.scenes.length + 1;
      const opts = readOptionsFromUI();
      const dur = 8;
      const startSec = (nextIdx - 1) * dur;
      const newScene = {
        index: nextIdx,
        sceneNum: nextIdx,
        title: `Scene ${nextIdx}: Cảnh bổ sung`,
        durationSec: dur,
        timeRange: `${startSec}s-${startSec + dur}s`,
        content: 'Cận cảnh sản phẩm và nhân vật tương tác tự nhiên.',
        action: 'Nhân vật mỉm cười nhẹ, nâng sản phẩm lên dưới ánh sáng đẹp.',
        visual: 'Quay cận cảnh trung (Medium Close-up), ánh sáng điện ảnh mềm mại.',
        camera: 'Slow Dolly-in, lấy nét sâu vào chủ thể, xóa phông bokeh.',
        audio: 'Nhạc nền hiện đại, sang trọng.',
        prompt: '',
        status: 'idle',
        stepText: '',
        videoPath: '',
        error: '',
        activePanel: 'prompt'
      };
      newScene.prompt = await api.flowBuildScenePrompt({
        scene: newScene,
        entities: {
          idea: state.idea,
          productLock: state.locks.productLock,
          characterLock: state.locks.characterLock,
          settingLock: state.locks.settingLock,
          lighting: state.locks.settingLock
        },
        options: opts
      });
      state.scenes.push(newScene);
      renderAllScenes();
      renderPreviewSection();
      scheduleSave();
      toast(`Đã thêm Scene ${nextIdx}.`, 'ok');
    });

    $('btn-flow-gen-all')?.addEventListener('click', () => {
      generateAllScenes({ autoMerge: false, forceRegenerateAll: false });
    });

    $('btn-flow-gen-video')?.addEventListener('click', () => {
      generateAllScenes({ autoMerge: true, forceRegenerateAll: false });
    });

    $('btn-flow-stop-all')?.addEventListener('click', async () => {
      state.stopRequested = true;
      state.isSequentialRunning = false;
      state.autoMergeWhenAllDone = false;
      await api?.stopAllTasks();
      state.scenes.forEach(s => {
        if (isSceneBusy(s)) {
          s.status = 'idle';
          s.stepText = '';
        }
      });
      renderAllScenes();
      renderPreviewSection();
      toast('Đã dừng tiến trình tạo video.', 'warn');
    });

    // Tương tác trên từng thẻ Scene (Prompt | Generate | Preview | Regenerate + chỉnh sửa trực tiếp)
    $('flow-scenes-list')?.addEventListener('input', e => {
      const card = e.target.closest('[data-scene-idx]');
      const field = e.target.dataset.scField;
      if (!card || !field) return;
      const idx = Number(card.dataset.sceneIdx);
      const sc = state.scenes[idx];
      if (!sc) return;
      if (field === 'durationSec') {
        sc.durationSec = Math.max(4, Math.min(15, Number(e.target.value) || 8));
      } else {
        sc[field] = e.target.value;
        if (field === 'camera') sc.visual = e.target.value;
      }
      scheduleSave();
    });

    $('flow-scenes-list')?.addEventListener('click', async e => {
      const actBtn = e.target.closest('[data-sc-act]');
      const card = e.target.closest('[data-scene-idx]');
      if (!actBtn || !card) return;

      const idx = Number(card.dataset.sceneIdx);
      const sc = state.scenes[idx];
      if (!sc) return;
      const act = actBtn.dataset.scAct;

      if (act === 'prompt') {
        sc.activePanel = 'prompt';
        renderAllScenes();
        const ta = document.querySelector(`#flow-scene-card-${idx} .flow-scene-prompt-textarea`);
        ta?.focus();
      } else if (act === 'generate') {
        await dispatchSingleScene(idx, false);
      } else if (act === 'regenerate') {
        await dispatchSingleScene(idx, true);
      } else if (act === 'preview') {
        const previewEl = $(`flow-scene-preview-${idx}`);
        const vid = previewEl?.querySelector('video');
        if (vid) {
          vid.scrollIntoView({ behavior: 'smooth', block: 'center' });
          vid.play().catch(() => {});
        } else {
          toast(`Scene ${idx + 1} chưa có video. Hãy bấm "Generate" để tạo video trước.`, 'info');
        }
      } else if (act === 'rebuild-prompt') {
        const opts = readOptionsFromUI();
        sc.prompt = await api.flowBuildScenePrompt({
          scene: sc,
          entities: {
            idea: state.idea,
            productLock: state.locks.productLock,
            characterLock: state.locks.characterLock,
            settingLock: state.locks.settingLock,
            lighting: state.locks.settingLock
          },
          options: opts
        });
        renderAllScenes();
        scheduleSave();
        toast(`Đã cập nhật lại Prompt cho Scene ${idx + 1}.`, 'ok');
      } else if (act === 'copy-prompt') {
        await navigator.clipboard.writeText(sc.prompt || '');
        toast(`Đã copy Prompt của Scene ${idx + 1}!`, 'ok');
      } else if (act === 'locate-video' && sc.videoPath) {
        api?.revealFile(sc.videoPath);
      } else if (act === 'delete') {
        if (state.scenes.length <= 1) {
          toast('Dự án cần ít nhất 1 Scene.', 'warn');
          return;
        }
        state.scenes.splice(idx, 1);
        state.scenes.forEach((s, i) => { s.index = i + 1; s.sceneNum = i + 1; });
        renderAllScenes();
        renderPreviewSection();
        scheduleSave();
      }
    });

    // Bấm vào ô thu nhỏ ở Bước 5 để cuộn lên Scene tương ứng
    $('flow-preview-strip')?.addEventListener('click', e => {
      const mini = e.target.closest('[data-goto-scene]');
      if (!mini) return;
      const idx = Number(mini.dataset.gotoScene);
      const card = $(`flow-scene-card-${idx}`);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    // Nút ghép & lồng tiếng ở Bước 5
    $('btn-flow-merge-final')?.addEventListener('click', mergeCompletedScenesToFinalVideo);
    $('btn-flow-dub-vieneu')?.addEventListener('click', dubCurrentFlowVideoWithVieneu);
  }

  // ---------- 12. Khởi tạo khi mở ứng dụng ----------
  async function initFlowBuilder() {
    bindEvents();
    if (window.App.onStudio) {
      window.App.onStudio(populateCharactersDropdown);
    }
    await refreshGoogleFlowAccountBadge();

    let saved = null;
    try {
      saved = await api?.flowStateLoad();
    } catch (_) {}

    if (saved && Array.isArray(saved.scenes) && saved.scenes.length > 0) {
      state = {
        ...state,
        ...saved,
        options: { ...state.options, ...(saved.options || {}) },
        locks: { ...state.locks, ...(saved.locks || {}) },
        isSequentialRunning: false,
        stopRequested: false
      };
      syncInputsFromState();
      renderAllScenes();
      renderPreviewSection();
      updatePipelineStepper();
    } else {
      // Khởi tạo sẵn ví dụ kiểm tra ở Bước #8 để người dùng mở lên thấy ngay quy trình hoàn chỉnh
      syncInputsFromState();
      await buildProjectFromIdea(false);
    }

    // Đồng bộ lại các task đang chạy hoặc đã hoàn thành trong hàng đợi
    if (api?.listTasks) {
      try {
        const res = await api.listTasks();
        (res?.tasks || []).forEach(syncSingleTaskToScene);
        renderAllScenes();
        renderPreviewSection();
      } catch (_) {}
    }
  }

  document.addEventListener('app:tab', e => {
    if (e.detail === 'tab-flow-app') {
      refreshGoogleFlowAccountBadge();
    }
  });

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initFlowBuilder);
  } else {
    initFlowBuilder();
  }
})();
