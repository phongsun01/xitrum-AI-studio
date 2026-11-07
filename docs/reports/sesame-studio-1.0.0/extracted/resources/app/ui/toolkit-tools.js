'use strict';

(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function baseName(p) {
    return String(p || '').split(/[\\/]/).pop() || p;
  }

  function toFileUrl(p) {
    if (!p) return '';
    let norm = String(p).replace(/\\/g, '/');
    if (norm.startsWith('file://')) return norm;
    // Đảm bảo đường dẫn Windows (ví dụ D:/path) hoặc POSIX (/path) thành URI chuẩn file:///D:/...
    norm = norm.replace(/^\/+/, '');
    return `file:///${norm}`;
  }

  function fmtSec(sec) {
    const v = Math.max(0, Number(sec) || 0);
    const h = Math.floor(v / 3600);
    const m = Math.floor((v % 3600) / 60);
    const s = Math.floor(v % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function fmtMmSs(sec) {
    const v = Math.max(0, Number(sec) || 0);
    const m = Math.floor(v / 60);
    const s = Math.floor(v % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  /* =========================================================================
   * 1. TAB CẮT VIDEO — BÀN DỰNG FILMSTRIP + SÓNG ÂM
   * ========================================================================= */
  let cutState = {
    videoPath: '',       // chưa nạp video nào: không còn video mẫu nạp sẵn
    duration: 0,
    width: 0,
    height: 0,
    fps: 0,
    sizeMB: '0.00',
    frames: [],
    peaks: [],
    mode: 'parts',       // 'parts' | 'duration' | 'scene' | 'markers'
    parts: 4,
    segmentSeconds: 3,
    sceneThreshold: 0.35,
    sceneCuts: [],   // mốc do "Dò chuyển cảnh" tìm ra từ video thật
    markers: [],     // bắt đầu 0 mốc, người dùng tự cắm
    undoStack: [],
    redoStack: [],
    flipH: false,
    flipV: false,
    rotate: 0,
    subPreview: false,
    speed: 1.0,
    zoom: 1.0,
    origVolume: 100,
    dubVolume: 0,
    stageCollapsed: false,
    outputDir: '',
    plannedSegments: [],
    exportedFiles: []
  };

  const MODE_NAMES = {
    parts: 'Chia đều số phần',
    duration: 'Cắt theo thời lượng',
    scene: 'Tự dò chuyển cảnh',
    markers: 'Theo mốc đánh dấu'
  };

  function pushMarkerUndo() {
    cutState.undoStack.push([...cutState.markers]);
    if (cutState.undoStack.length > 25) cutState.undoStack.shift();
    cutState.redoStack = [];
  }

  function applyVideoTransformPreview() {
    const videoEl = document.getElementById('cut-preview-video');
    if (!videoEl) return;
    const sx = cutState.flipH ? -1 : 1;
    const sy = cutState.flipV ? -1 : 1;
    const rot = cutState.rotate || 0;
    videoEl.style.transform = `scale(${sx}, ${sy}) rotate(${rot}deg)`;
    document.getElementById('btn-cut-flip-h')?.classList.toggle('active', cutState.flipH);
    document.getElementById('btn-cut-flip-v')?.classList.toggle('active', cutState.flipV);
    document.getElementById('btn-cut-rotate')?.classList.toggle('active', rot !== 0);
    document.getElementById('btn-cut-sub-toggle')?.classList.toggle('active', cutState.subPreview);
    const subOverlay = document.getElementById('cut-sub-overlay');
    if (subOverlay) subOverlay.hidden = !cutState.subPreview;
  }

  function renderTimelineTracks() {
    const dur = Math.max(1, cutState.duration || 22);
    // 1. Vẽ thước thời gian (Time Ruler 00:00, 00:02...)
    const rulerEl = document.getElementById('cut-ruler-ticks');
    if (rulerEl) {
      const step = dur <= 25 ? 2 : dur <= 60 ? 5 : 10;
      const ticks = [];
      for (let t = 0; t <= dur; t += step) {
        const leftPct = Math.min(99.2, (t / dur) * 100);
        ticks.push(`
          <div style="position:absolute;left:${leftPct}%;top:0;bottom:0;display:flex;flex-direction:column;justify-content:space-between;pointer-events:none;">
            <span style="padding-left:3px;font-size:10px;color:#94a3b8;">${fmtMmSs(t)}</span>
            <span style="width:1px;height:6px;background:#475569;"></span>
          </div>
        `);
      }
      rulerEl.innerHTML = ticks.join('');
    }

    // 2. Vẽ dải Filmstrip ảnh trích xuất thật từ video
    const stripEl = document.getElementById('cut-filmstrip-thumbs');
    if (stripEl) {
      const frames = Array.isArray(cutState.frames) && cutState.frames.length ? cutState.frames : [];
      if (frames.length) {
        stripEl.innerHTML = frames.map(src => `
          <div style="flex:1;height:100%;background-image:url('${src}');background-size:cover;background-position:center;border-right:1px solid rgba(15,23,42,0.45);"></div>
        `).join('');
      } else {
        stripEl.innerHTML = Array.from({ length: 12 }, (_, i) => `
          <div style="flex:1;height:100%;background:linear-gradient(135deg,#0f172a,#1e293b);border-right:1px solid #334155;display:flex;align-items:center;justify-content:center;font-size:10px;color:#475569;">#${i + 1}</div>
        `).join('');
      }
    }

    // 3. Vẽ dải sóng âm (Audio Waveform) màu xanh ngọc
    const waveEl = document.getElementById('cut-waveform-bars');
    if (waveEl) {
      const peaks = Array.isArray(cutState.peaks) && cutState.peaks.length
        ? cutState.peaks
        : Array.from({ length: 96 }, () => 0.05);
      waveEl.innerHTML = peaks.map((p, idx) => {
        const hPct = Math.round(Math.max(14, Math.min(96, p * 100)));
        const col = idx % 2 === 0 ? '#10b981' : '#0891b2';
        return `<div style="flex:1;height:${hPct}%;background:${col};opacity:0.85;border-radius:1px 1px 0 0;"></div>`;
      }).join('');
    }
  }

  async function loadVideoIntoCut(videoPath) {
    if (!videoPath) return;
    const probe = await window.sesame?.toolkitProbeVideo?.(videoPath);
    if (!probe || !probe.ok) {
      if (window.App?.toast) window.App.toast(probe?.error || 'Không đọc được thông số video', 'err');
      return;
    }
    cutState.videoPath = videoPath;
    cutState.sceneCuts = [];   // video mới → mốc chuyển cảnh cũ không còn đúng, phải dò lại
    { const h = document.getElementById('cut-scene-hint'); if (h) h.textContent = 'Chưa dò. Bấm “Dò chuyển cảnh ngay” — app tự tìm các điểm đổi cảnh để tách.'; }
    cutState.duration = probe.duration || 10;
    cutState.width = probe.width || 1080;
    cutState.height = probe.height || 1920;
    cutState.fps = probe.fps || 30;
    cutState.sizeMB = probe.sizeMB || '0.00';
    cutState.frames = Array.isArray(probe.frames) ? probe.frames : [];
    cutState.peaks = Array.isArray(probe.peaks) ? probe.peaks : [];

    // Video mới → bắt đầu 0 mốc (không tự cắm mốc giả); người dùng cắm mốc hoặc dùng chế độ khác
    cutState.markers = [];
    cutState.undoStack = []; cutState.redoStack = [];
    { const mInput = document.getElementById('cut-input-markers'); if (mInput) mInput.value = ''; }
    cutState.fromLibrary = false;

    const titleEl = document.getElementById('cut-video-title');
    const metaEl = document.getElementById('cut-video-meta');
    const totalTimeEl = document.getElementById('cut-total-time');
    const videoEl = document.getElementById('cut-preview-video');

    const fname = probe.fileName || baseName(videoPath);
    if (titleEl) titleEl.textContent = `${fname}  ${fmtMmSs(cutState.duration)}`;
    if (metaEl) metaEl.textContent = `${cutState.width}×${cutState.height} · ${cutState.fps} FPS · ${cutState.duration}s (${cutState.sizeMB} MB)`;
    if (totalTimeEl) totalTimeEl.textContent = fmtSec(cutState.duration);
    if (videoEl) {
      videoEl.src = toFileUrl(videoPath);
      videoEl.currentTime = 0;
      videoEl.playbackRate = cutState.speed || 1.0;
      videoEl.volume = Math.min(1, Math.max(0, (cutState.origVolume || 100) / 100));
    }

    renderTimelineTracks();
    applyVideoTransformPreview();
    await refreshCutPlan();
  }

  async function refreshCutPlan() {
    const res = await window.sesame?.toolkitPlanSegments?.({
      duration: cutState.duration,
      mode: cutState.mode,
      parts: cutState.parts,
      segmentSeconds: cutState.segmentSeconds,
      markers: cutState.markers,
      sceneCuts: cutState.sceneCuts
    });
    const segments = res?.segments || [];
    cutState.plannedSegments = segments;

    const summaryEl = document.getElementById('cut-timeline-summary');
    const badgeEl = document.getElementById('cut-source-badge');
    const countEl = document.getElementById('cut-planned-count');
    const statusEl = document.getElementById('cut-status-text');
    const markerBadge = document.getElementById('cut-marker-badge');

    const modeTitle = MODE_NAMES[cutState.mode] || cutState.mode;
    if (summaryEl) summaryEl.textContent = `${segments.length} phần cắt`;
    if (badgeEl) badgeEl.innerHTML = `<span class="st-dot"></span>${esc(modeTitle)} · ${segments.length} phần`;
    if (countEl) countEl.textContent = String(segments.length);
    if (markerBadge) markerBadge.textContent = `Đã đặt ${cutState.markers.length} mốc · xuất ${cutState.markers.length + 1} phần`;
    if (statusEl) {
      const verb = { parts: 'chia đều', duration: 'cắt theo thời lượng', scene: 'cắt theo chuyển cảnh', markers: 'cắt theo mốc' }[cutState.mode] || modeTitle.toLowerCase();
      statusEl.textContent = cutState.videoPath ? `Sẽ ${verb} thành ${segments.length} video.` : 'Chọn một video để bắt đầu.';
    }

    // Vẽ các vạch chia đoạn lên dải Filmstrip
    const segBar = document.getElementById('cut-timeline-segments');
    if (segBar && cutState.duration > 0) {
      segBar.innerHTML = segments.map((s, idx) => {
        const wPct = Math.max(1, ((s.endSec - s.startSec) / cutState.duration) * 100);
        const isLast = idx === segments.length - 1;
        return `
          <div title="Phần ${s.index}: ${s.startSec}s → ${s.endSec}s (${s.duration}s)" style="width:${wPct}%;height:100%;border-right:${isLast ? 'none' : '2px dashed #38bdf8'};background:${idx % 2 === 0 ? 'rgba(8,145,178,0.10)' : 'rgba(16,185,129,0.10)'};display:flex;align-items:flex-end;justify-content:flex-end;padding:3px 6px;">
            <span style="background:rgba(2,6,23,0.75);color:#38bdf8;font-size:10px;font-weight:800;padding:1px 6px;border-radius:4px;border:1px solid rgba(56,189,248,0.35);">P${s.index} (${s.duration}s)</span>
          </div>
        `;
      }).join('');
    }

    // Vẽ các cờ mốc cắt ⚑ lên Timeline
    const flagsLayer = document.getElementById('cut-flags-layer');
    if (flagsLayer && cutState.duration > 0) {
      const activePoints = cutState.mode === 'scene' ? cutState.sceneCuts : cutState.markers;
      flagsLayer.innerHTML = (activePoints || []).map(pt => {
        const pct = Math.min(99, Math.max(1, (pt / cutState.duration) * 100));
        return `
          <div style="position:absolute;left:${pct}%;top:0;bottom:0;width:1px;background:#fbbf24;pointer-events:none;">
            <span style="position:absolute;top:2px;left:-7px;background:#f59e0b;color:#0f172a;font-size:9.5px;font-weight:900;padding:0 4px;border-radius:3px;box-shadow:0 1px 4px rgba(0,0,0,0.5);">⚑ ${pt}s</span>
          </div>
        `;
      }).join('');
    }

    // Vẽ bảng danh sách các đoạn dự kiến tách trong hộp thoại Chế độ cắt
    const tbody = document.getElementById('cut-planned-tbody');
    if (tbody) {
      tbody.innerHTML = segments.map(s => `
        <tr style="border-bottom:1px solid var(--line);" class="cut-plan-row" data-start="${s.startSec}">
          <td style="padding:6px 10px;font-weight:700;color:#0891b2;">Phần ${String(s.index).padStart(2, '0')}</td>
          <td style="padding:6px 10px;font-family:monospace;">${fmtMmSs(s.startSec)} (${s.startSec}s)</td>
          <td style="padding:6px 10px;font-family:monospace;">${fmtMmSs(s.endSec)} (${s.endSec}s)</td>
          <td style="padding:6px 10px;font-weight:600;">${s.duration}s</td>
          <td style="padding:6px 10px;text-align:right;">
            <button type="button" class="srt-pill-btn cut-seek-btn" data-start="${s.startSec}" style="height:24px;padding:0 8px;font-size:11px;">▶ Xem</button>
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll('.cut-seek-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const st = parseFloat(btn.getAttribute('data-start')) || 0;
          const v = document.getElementById('cut-preview-video');
          if (v) {
            v.currentTime = st;
            v.play().catch(() => {});
          }
        });
      });
    }
  }

  function setCutMode(mode) {
    cutState.mode = mode;
    document.querySelectorAll('.cut-mode-btn').forEach(btn => {
      btn.classList.toggle('teal', btn.getAttribute('data-cut-mode') === mode);
    });
    ['parts', 'duration', 'scene', 'markers'].forEach(m => {
      const box = document.getElementById(`cut-param-${m}`);
      if (box) box.hidden = (m !== mode);
    });
    refreshCutPlan();
    // Chuyển sang "Chuyển cảnh" khi đã có video mà chưa dò → tự dò luôn
    if (mode === 'scene' && cutState.videoPath && !(cutState.sceneCuts || []).length) {
      document.getElementById('btn-cut-detect-scenes')?.click();
    }
  }

  function renderCutOutputList() {
    const listEl = document.getElementById('cut-output-list');
    const countEl = document.getElementById('cut-output-count');
    if (countEl) countEl.textContent = String(cutState.exportedFiles.length);
    if (!listEl) return;

    if (cutState.exportedFiles.length === 0) {
      listEl.innerHTML = `<div class="muted small" style="grid-column:1/-1;padding:8px;text-align:center;border:1px dashed var(--line);border-radius:8px;">Chưa có video nào được cắt trong phiên này. Bấm <b>✂️ Cắt &amp; Xuất</b> ở góc dưới bên phải để tách video.</div>`;
      return;
    }

    listEl.innerHTML = cutState.exportedFiles.map((item, idx) => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;border-radius:8px;background:var(--surface-2);border:1px solid var(--line);">
        <div style="min-width:0;flex:1;">
          <div style="font-weight:700;font-size:12px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ✅ ${esc(item.label || ('Phần ' + (idx + 1)))}: ${esc(item.fileName)}
          </div>
          <div class="muted small" style="font-size:11px;">${item.width}×${item.height} · <b>${item.duration}s</b> (${item.startSec}s→${item.endSec}s) · ${item.sizeMB} MB</div>
        </div>
        <div class="row" style="gap:5px;flex-shrink:0;">
          <button type="button" class="srt-pill-btn teal cut-play-out-btn" data-path="${esc(item.path)}" style="height:26px;padding:0 8px;font-size:11px;">▶ Phát</button>
          <button type="button" class="srt-pill-btn cut-open-out-btn" data-path="${esc(item.path)}" style="height:26px;padding:0 8px;font-size:11px;">📂 Mở</button>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('.cut-play-out-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = btn.getAttribute('data-path');
        const v = document.getElementById('cut-preview-video');
        const titleEl = document.getElementById('cut-video-title');
        if (v && p) {
          v.src = toFileUrl(p);
          v.currentTime = 0;
          v.play().catch(() => {});
          if (titleEl) titleEl.textContent = `[Đang phát bản cắt] ${baseName(p)}`;
        }
      });
    });

    listEl.querySelectorAll('.cut-open-out-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = btn.getAttribute('data-path');
        if (p) window.sesame?.openPath?.(p);
      });
    });
  }

  function bindCutVideoTab() {
    const videoEl = document.getElementById('cut-preview-video');
    const playBtn = document.getElementById('btn-cut-play-toggle');
    const playheadEl = document.getElementById('cut-timeline-playhead');
    const playheadTimeEl = document.getElementById('cut-playhead-time');
    const modalCutMode = document.getElementById('modal-cut-mode');

    // Mở / đóng hộp thoại Chế độ cắt
    document.getElementById('btn-cut-open-mode-modal')?.addEventListener('click', () => {
      if (modalCutMode && typeof modalCutMode.showModal === 'function') modalCutMode.showModal();
    });
    document.getElementById('btn-cut-close-mode-modal')?.addEventListener('click', () => {
      modalCutMode?.close();
    });
    document.getElementById('btn-cut-close-mode-modal-x')?.addEventListener('click', () => {
      modalCutMode?.close();
    });
    document.getElementById('btn-cut-modal-apply')?.addEventListener('click', () => {
      modalCutMode?.close();
      if (window.App?.toast) window.App.toast(`Đã áp dụng: ${MODE_NAMES[cutState.mode]} (${cutState.plannedSegments.length} phần)`, 'ok');
    });
    document.getElementById('btn-cut-modal-export')?.addEventListener('click', () => {
      modalCutMode?.close();
      document.getElementById('btn-cut-start-export')?.click();
    });

    // Transport Controls (Phát / Tạm dừng, Lùi 1s, Tiến 1s, Fullscreen, Thu gọn khung)
    playBtn?.addEventListener('click', () => {
      if (!videoEl) return;
      if (videoEl.paused) videoEl.play().catch(() => {});
      else videoEl.pause();
    });
    videoEl?.addEventListener('play', () => { if (playBtn) playBtn.textContent = '⏸'; });
    videoEl?.addEventListener('pause', () => { if (playBtn) playBtn.textContent = '▶'; });
    videoEl?.addEventListener('ended', () => { if (playBtn) playBtn.textContent = '▶'; });

    document.getElementById('btn-cut-step-back')?.addEventListener('click', () => {
      if (videoEl) videoEl.currentTime = Math.max(0, (videoEl.currentTime || 0) - 1);
    });
    document.getElementById('btn-cut-step-fwd')?.addEventListener('click', () => {
      if (videoEl) videoEl.currentTime = Math.min(cutState.duration || 10, (videoEl.currentTime || 0) + 1);
    });
    document.getElementById('btn-cut-fullscreen')?.addEventListener('click', () => {
      if (videoEl?.requestFullscreen) videoEl.requestFullscreen().catch(() => {});
    });
    document.getElementById('btn-cut-collapse-stage')?.addEventListener('click', () => {
      const vp = document.getElementById('cut-stage-viewport');
      const btn = document.getElementById('btn-cut-collapse-stage');
      if (!vp) return;
      cutState.stageCollapsed = !cutState.stageCollapsed;
      vp.style.height = cutState.stageCollapsed ? '120px' : '250px';
      if (videoEl) videoEl.style.maxHeight = cutState.stageCollapsed ? '112px' : '242px';
      if (btn) btn.textContent = cutState.stageCollapsed ? '⌄' : '⌃';
    });

    // Thanh công cụ chỉnh sửa CapCut (Undo, Redo, Sub, Snapshot, Aspect, FlipH, FlipV, Rotate, Split)
    document.getElementById('btn-cut-undo')?.addEventListener('click', () => {
      if (!cutState.undoStack.length) return;
      cutState.redoStack.push([...cutState.markers]);
      cutState.markers = cutState.undoStack.pop();
      const mInput = document.getElementById('cut-input-markers');
      if (mInput) mInput.value = cutState.markers.join(', ');
      refreshCutPlan();
    });
    document.getElementById('btn-cut-redo')?.addEventListener('click', () => {
      if (!cutState.redoStack.length) return;
      cutState.undoStack.push([...cutState.markers]);
      cutState.markers = cutState.redoStack.pop();
      const mInput = document.getElementById('cut-input-markers');
      if (mInput) mInput.value = cutState.markers.join(', ');
      refreshCutPlan();
    });
    document.getElementById('btn-cut-sub-toggle')?.addEventListener('click', () => {
      cutState.subPreview = !cutState.subPreview;
      applyVideoTransformPreview();
    });
    document.getElementById('btn-cut-snapshot')?.addEventListener('click', () => {
      if (window.App?.toast) window.App.toast(`📸 Đã chụp khung hình tại ${fmtSec(videoEl?.currentTime || 0)}`, 'ok');
    });
    document.querySelectorAll('[data-cut-asp]').forEach(b => b.addEventListener('click', () => {
      const sel = document.getElementById('cut-opt-aspect'); if (!sel) return;
      sel.value = b.dataset.cutAsp; sel.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelectorAll('[data-cut-asp]').forEach(x => x.classList.toggle('on', x === b));
      if (window.App?.toast) window.App.toast('Tỷ lệ khung hình xuất: ' + (sel.options[sel.selectedIndex]?.text || b.dataset.cutAsp), 'ok');
    }));
    document.getElementById('btn-cut-aspect-cycle')?.addEventListener('click', () => {
      const sel = document.getElementById('cut-opt-aspect');
      if (!sel) return;
      const opts = ['source', '9:16', '16:9', '1:1'];
      const next = opts[(opts.indexOf(sel.value) + 1) % opts.length];
      sel.value = next;
      if (window.App?.toast) window.App.toast(`Tỷ lệ khung hình xuất: ${sel.options[sel.selectedIndex]?.text || next}`, 'ok');
    });
    document.getElementById('btn-cut-flip-h')?.addEventListener('click', () => {
      cutState.flipH = !cutState.flipH;
      const chk = document.getElementById('cut-opt-flip');
      if (chk) chk.checked = cutState.flipH;
      applyVideoTransformPreview();
    });
    document.getElementById('btn-cut-flip-v')?.addEventListener('click', () => {
      cutState.flipV = !cutState.flipV;
      applyVideoTransformPreview();
    });
    document.getElementById('btn-cut-rotate')?.addEventListener('click', () => {
      cutState.rotate = ((cutState.rotate || 0) + 90) % 360;
      applyVideoTransformPreview();
    });

    // Tốc độ phát (Speed Slider + +/- + Reset)
    const speedSlider = document.getElementById('cut-speed-slider');
    const speedValEl = document.getElementById('cut-speed-val');
    const updateSpeed = (val) => {
      const sp = Math.max(0.5, Math.min(2.0, Math.round(Number(val) * 20) / 20));
      cutState.speed = sp;
      if (speedSlider) speedSlider.value = String(sp);
      if (speedValEl) speedValEl.textContent = `${sp.toFixed(2)}x`;
      if (videoEl) videoEl.playbackRate = sp;
      const hiddenSpd = document.getElementById('cut-opt-speed');
      if (hiddenSpd) hiddenSpd.innerHTML = `<option value="${sp}" selected>${sp}</option>`;
    };
    speedSlider?.addEventListener('input', () => updateSpeed(speedSlider.value));
    document.getElementById('btn-cut-spd-minus')?.addEventListener('click', () => updateSpeed((cutState.speed || 1) - 0.05));
    document.getElementById('btn-cut-spd-plus')?.addEventListener('click', () => updateSpeed((cutState.speed || 1) + 0.05));
    document.getElementById('btn-cut-spd-reset')?.addEventListener('click', () => updateSpeed(1.0));

    // Thu phóng Timeline (Zoom Slider)
    const zoomSlider = document.getElementById('cut-zoom-slider');
    const timelineBar = document.getElementById('cut-timeline-bar');
    const updateZoom = (val) => {
      const z = Math.max(1, Math.min(3, Number(val) || 1));
      cutState.zoom = z;
      if (zoomSlider) zoomSlider.value = String(z);
      if (timelineBar) timelineBar.style.width = `${Math.round(z * 100)}%`;
    };
    zoomSlider?.addEventListener('input', () => updateZoom(zoomSlider.value));
    document.getElementById('btn-cut-zoom-out')?.addEventListener('click', () => updateZoom((cutState.zoom || 1) - 0.25));
    document.getElementById('btn-cut-zoom-in')?.addEventListener('click', () => updateZoom((cutState.zoom || 1) + 0.25));

    // Âm lượng Giọng gốc & Giọng lồng
    const origVolSlider = document.getElementById('cut-vol-orig');
    const origVolVal = document.getElementById('cut-vol-orig-val');
    const updateOrigVol = (v) => {
      const vol = Math.max(0, Math.min(200, Math.round(Number(v) || 0)));
      cutState.origVolume = vol;
      if (origVolSlider) origVolSlider.value = String(vol);
      if (origVolVal) origVolVal.textContent = `${vol}%`;
      if (videoEl) videoEl.volume = Math.min(1, vol / 100);
    };
    origVolSlider?.addEventListener('input', () => updateOrigVol(origVolSlider.value));
    document.getElementById('btn-cut-vol-orig-minus')?.addEventListener('click', () => updateOrigVol(cutState.origVolume - 10));
    document.getElementById('btn-cut-vol-orig-plus')?.addEventListener('click', () => updateOrigVol(cutState.origVolume + 10));

    const dubVolSlider = document.getElementById('cut-vol-dub');
    const dubVolVal = document.getElementById('cut-vol-dub-val');
    const updateDubVol = (v) => {
      const vol = Math.max(0, Math.min(200, Math.round(Number(v) || 0)));
      cutState.dubVolume = vol;
      if (dubVolSlider) dubVolSlider.value = String(vol);
      if (dubVolVal) dubVolVal.textContent = `${vol}%`;
    };
    dubVolSlider?.addEventListener('input', () => updateDubVol(dubVolSlider.value));
    document.getElementById('btn-cut-vol-dub-minus')?.addEventListener('click', () => updateDubVol(cutState.dubVolume - 10));
    document.getElementById('btn-cut-vol-dub-plus')?.addEventListener('click', () => updateDubVol(cutState.dubVolume + 10));

    // Chuyển chế độ cắt trong modal
    document.querySelectorAll('.cut-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        setCutMode(btn.getAttribute('data-cut-mode') || 'parts');
      });
    });

    // Số phần (parts)
    const partsInp = document.getElementById('cut-input-parts');
    partsInp?.addEventListener('input', () => {
      cutState.parts = Math.max(2, Math.min(50, parseInt(partsInp.value, 10) || 3));
      refreshCutPlan();
    });
    document.querySelectorAll('.cut-quick-parts').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = parseInt(btn.getAttribute('data-val'), 10) || 3;
        cutState.parts = v;
        if (partsInp) partsInp.value = String(v);
        document.querySelectorAll('.cut-quick-parts').forEach(b => b.classList.toggle('active', b === btn));
        refreshCutPlan();
      });
    });

    // Thời lượng mỗi phần (duration)
    const durInp = document.getElementById('cut-input-duration');
    durInp?.addEventListener('input', () => {
      cutState.segmentSeconds = Math.max(2, parseFloat(durInp.value) || 8);
      refreshCutPlan();
    });
    document.querySelectorAll('.cut-quick-dur').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = parseFloat(btn.getAttribute('data-val')) || 8;
        cutState.segmentSeconds = v;
        if (durInp) durInp.value = String(v);
        document.querySelectorAll('.cut-quick-dur').forEach(b => b.classList.toggle('active', b === btn));
        refreshCutPlan();
      });
    });

    // Tự dò chuyển cảnh (scene)
    document.getElementById('btn-cut-detect-scenes')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-cut-detect-scenes');
      const hint = document.getElementById('cut-scene-hint');
      const thInp = document.getElementById('cut-input-threshold');
      cutState.sceneThreshold = Math.max(0.1, Math.min(0.8, parseFloat(thInp?.value) || 0.35));

      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Đang dò chuyển cảnh...';
      }
      try {
        const res = await window.sesame?.toolkitDetectScenes?.({
          videoPath: cutState.videoPath,
          threshold: cutState.sceneThreshold
        });
        if (res && res.ok) {
          cutState.sceneCuts = res.sceneCuts || [];
          if (hint) {
            hint.innerHTML = `<b style="color:#0891b2;">✅ Đã phát hiện ${cutState.sceneCuts.length} điểm chuyển cảnh</b> (tại giây: ${cutState.sceneCuts.join('s, ') || 'không có'}) → Sẽ tách thành <b>${cutState.sceneCuts.length + 1} cảnh độc lập</b>.`;
          }
          await refreshCutPlan();
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '🔍 Dò chuyển cảnh ngay';
        }
      }
    });

    // Đặt mốc tại Playhead & Kéo/Nhấp trên thước Timeline
    videoEl?.addEventListener('timeupdate', () => {
      const cur = videoEl.currentTime || 0;
      if (playheadTimeEl) playheadTimeEl.textContent = fmtSec(cur);
      if (playheadEl && cutState.duration > 0) {
        const pct = Math.min(100, Math.max(0, (cur / cutState.duration) * 100));
        playheadEl.style.left = `${pct}%`;
      }
    });

    let isDraggingPlayhead = false;
    const seekFromMouseEvent = (e) => {
      if (!videoEl || !cutState.duration || !timelineBar) return;
      const rect = timelineBar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const sec = Math.round(ratio * cutState.duration * 100) / 100;
      videoEl.currentTime = sec;
      if (playheadTimeEl) playheadTimeEl.textContent = fmtSec(sec);
      if (playheadEl) playheadEl.style.left = `${ratio * 100}%`;
    };

    timelineBar?.addEventListener('mousedown', (e) => {
      isDraggingPlayhead = true;
      seekFromMouseEvent(e);
    });
    window.addEventListener('mousemove', (e) => {
      if (isDraggingPlayhead) seekFromMouseEvent(e);
    });
    window.addEventListener('mouseup', () => {
      isDraggingPlayhead = false;
    });

    timelineBar?.addEventListener('dblclick', (e) => {
      if (!cutState.duration || !timelineBar) return;
      const rect = timelineBar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const sec = Math.round(ratio * cutState.duration * 10) / 10;
      addCutMarkerAt(sec);
    });

    function addCutMarkerAt(sec) {
      if (sec < 0.8 || sec > cutState.duration - 0.8) {
        if (window.App?.toast) window.App.toast('Mốc cắt phải cách đầu và cuối video ít nhất 0.8 giây.', 'warn');
        return;
      }
      pushMarkerUndo();
      const existingIdx = cutState.markers.findIndex(m => Math.abs(m - sec) < 0.6);
      if (existingIdx >= 0) {
        cutState.markers.splice(existingIdx, 1);
      } else {
        cutState.markers.push(Math.round(sec * 10) / 10);
        cutState.markers.sort((a, b) => a - b);
      }
      const mInput = document.getElementById('cut-input-markers');
      if (mInput) mInput.value = cutState.markers.join(', ');
      setCutMode('markers');
    }

    document.getElementById('btn-cut-add-marker')?.addEventListener('click', () => {
      const cur = videoEl ? videoEl.currentTime : 0;
      addCutMarkerAt(cur > 0.8 ? cur : Math.round((cutState.duration / 2) * 10) / 10);
    });
    document.getElementById('btn-cut-split-playhead')?.addEventListener('click', () => {
      const cur = videoEl ? videoEl.currentTime : 0;
      addCutMarkerAt(cur > 0.8 ? cur : Math.round((cutState.duration / 2) * 10) / 10);
      if (window.App?.toast) window.App.toast('✂ Đã đặt điểm tách đoạn tại vị trí Playhead!', 'ok');
    });

    document.getElementById('btn-cut-clear-markers')?.addEventListener('click', () => {
      pushMarkerUndo();
      cutState.markers = [];
      const mInput = document.getElementById('cut-input-markers');
      if (mInput) mInput.value = '';
      refreshCutPlan();
    });

    document.getElementById('btn-cut-apply-markers')?.addEventListener('click', () => {
      pushMarkerUndo();
      const mInput = document.getElementById('cut-input-markers');
      const raw = String(mInput?.value || '');
      cutState.markers = raw
        .split(/[,;\s]+/)
        .map(s => parseFloat(s.trim()))
        .filter(n => Number.isFinite(n) && n >= 0.8 && n <= cutState.duration - 0.8)
        .sort((a, b) => a - b);
      refreshCutPlan();
    });

    // Chọn video từ file máy tính
    document.getElementById('btn-cut-pick-file')?.addEventListener('click', async () => {
      const f = await window.sesame?.pickFile?.({
        title: 'Chọn video để cắt',
        filters: [{ name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm'] }]
      });
      if (f) await loadVideoIntoCut(f);
    });

    // Chọn video từ Kho video
    document.getElementById('btn-cut-pick-lib')?.addEventListener('click', async () => {
      const list = await window.sesame?.getLibraryVideos?.();
      if (!Array.isArray(list) || list.length === 0) {
        if (window.App?.toast) window.App.toast('Kho video đang trống. Hãy tạo video trước hoặc chọn file từ máy.', 'warn');
        return;
      }
      // Hộp chọn video thật trong Kho (trước đây chỉ xoay vòng video kế tiếp)
      let dlg = document.getElementById('cut-lib-dlg');
      if (!dlg) {
        dlg = document.createElement('dialog');
        dlg.id = 'cut-lib-dlg';
        dlg.style.cssText = 'border:1px solid var(--line);border-radius:16px;padding:0;max-width:560px;width:92vw;background:var(--surface);color:var(--ink);';
        document.body.appendChild(dlg);
      }
      const mb = s => (s / 1048576).toFixed(1) + ' MB';
      dlg.innerHTML = `<div style="padding:16px 18px;border-bottom:1px solid var(--line);font-weight:800;font-size:15px;">Chọn video trong Kho (${list.length})</div>
        <div id="cut-lib-list" style="max-height:52vh;overflow:auto;padding:8px;">${list.map((x, i) => `
          <button type="button" data-i="${i}" style="display:flex;justify-content:space-between;gap:12px;width:100%;text-align:left;padding:9px 12px;border:1px solid transparent;border-radius:10px;background:transparent;color:inherit;cursor:pointer;">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(x.filename || baseName(x.localPath || x.path))}</span>
            <span class="muted small" style="white-space:nowrap;">${mb(x.size || 0)}</span></button>`).join('')}</div>
        <div style="padding:10px 18px;border-top:1px solid var(--line);display:flex;justify-content:flex-end;"><button type="button" class="btn-ghost btn-sm" id="cut-lib-close">Đóng</button></div>`;
      dlg.querySelector('#cut-lib-close').onclick = () => dlg.close();
      dlg.querySelector('#cut-lib-list').onclick = async e => {
        const b = e.target.closest('button[data-i]'); if (!b) return;
        const it = list[+b.dataset.i]; const chosen = it?.localPath || it?.path;
        dlg.close();
        if (chosen) {
          await loadVideoIntoCut(chosen);
          cutState.fromLibrary = true;
          if (window.App?.toast) window.App.toast(`Đã nạp từ Kho video: ${baseName(chosen)}`, 'ok');
        }
      };
      dlg.showModal();
    });

    // Chọn thư mục xuất
    document.getElementById('btn-cut-choose-outdir')?.addEventListener('click', async () => {
      const dir = await window.sesame?.pickFolder?.();
      if (dir) {
        cutState.outputDir = dir;
        const inp = document.getElementById('cut-output-dir');
        if (inp) inp.value = dir;
      }
    });

    document.getElementById('btn-cut-open-dir')?.addEventListener('click', async () => {
      const target = cutState.outputDir || await window.sesame?.getDefaultOutputDir?.();
      if (target) window.sesame?.openPath?.(target);
    });

    // Hộp giải thích 4 chế độ cắt + ý nghĩa từng icon
    const cutHelp = document.getElementById('modal-cut-help');
    document.getElementById('btn-cut-help')?.addEventListener('click', () => cutHelp?.showModal?.());
    document.getElementById('btn-cut-help-close')?.addEventListener('click', () => cutHelp?.close?.());
    cutHelp?.addEventListener('click', e => { if (e.target === cutHelp) cutHelp.close(); });

    // Nút Cắt & Xuất Video
    document.getElementById('btn-cut-start-export')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-cut-start-export');
      const statusEl = document.getElementById('cut-status-text');
      const progEl = document.getElementById('cut-progress-fill');

      const aspect = document.getElementById('cut-opt-aspect')?.value || 'source';
      const speed = cutState.speed || 1.0;
      const flipH = Boolean(cutState.flipH);
      const flipV = Boolean(cutState.flipV);
      const rotate = Number(cutState.rotate) || 0;
      const origVolume = Number(cutState.origVolume ?? 100);

      if (!cutState.videoPath) {
        if (statusEl) statusEl.textContent = '⚠️ Chưa có video. Bấm “Chọn video” hoặc “Kho video” trước.';
        if (window.App?.toast) window.App.toast('Chưa nạp video để cắt.', 'warn');
        return;
      }
      // Video lấy từ Kho → các phần mới thay video gốc trong Kho, nguồn vào Thùng rác (khôi phục được) — hỏi trước
      let replaceSource = false;
      if (cutState.fromLibrary) {
        replaceSource = confirm('Video này nằm trong Kho. Sau khi cắt xong, các phần mới sẽ thay video gốc trong Kho và video gốc được chuyển vào Thùng rác (khôi phục được).\n\nBấm OK để thay video gốc, Hủy để giữ cả video gốc.');
      }

      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Đang cắt & xuất...';
      }
      if (progEl) progEl.style.width = '20%';
      if (statusEl) statusEl.textContent = '⏳ Đang cắt và đóng gói các phần video MP4 độc lập...';

      try {
        const res = await window.sesame?.toolkitCutExport?.({
          videoPath: cutState.videoPath,
          mode: cutState.mode,
          parts: cutState.parts,
          segmentSeconds: cutState.segmentSeconds,
          sceneThreshold: cutState.sceneThreshold,
          sceneCuts: cutState.sceneCuts,
          markers: cutState.markers,
          aspect,
          speed,
          flipH,
          flipV,
          rotate,
          origVolume,
          outputDir: cutState.outputDir,
          flat: replaceSource,          // thay video trong Kho: các phần nằm thẳng trong Kho
          replaceSource
        });

        if (res && res.ok) {
          cutState.exportedFiles = res.outputs || [];
          if (progEl) progEl.style.width = '100%';
          if (statusEl) {
            const how = res.method === 'copy' ? 'giữ nguyên chất lượng (không mã hoá lại, mốc căn theo khung hình khoá)' : 'mã hoá lại H.264 để cắt đúng mốc và áp dụng chỉnh sửa';
            const warn = (res.warnings || []).length ? `<br><span style="color:#b45309;">⚠ ${res.warnings.map(esc).join('<br>⚠ ')}</span>` : '';
            const trash = res.sourceTrashed ? '<br>🗑 Video gốc đã chuyển vào Thùng rác.' : (replaceSource && res.sourceTrashed === false ? `<br>⚠ Không chuyển được video gốc vào Thùng rác: ${esc(res.trashError || '')}` : '');
            statusEl.innerHTML = `<b style="color:#10b981;">✅ Cắt video hoàn tất!</b> Đã xuất <b>${res.count} video MP4 riêng biệt</b> tại <code>${esc(res.outDir)}</code><br><span class="muted small">Cách cắt: ${how}.</span>${warn}${trash}`;
          }
          if (res.sourceTrashed) cutState.fromLibrary = false;
          renderCutOutputList();
          { const box = document.getElementById('cut-output-box'); if (box) box.open = true; }
          if (window.App?.toast) window.App.toast(`Đã cắt và xuất thành công ${res.count} video MP4!`, 'ok');
        } else {
          if (statusEl) statusEl.textContent = '⚠️ Lỗi cắt video: ' + (res?.error || 'Không xác định');
          if (window.App?.toast) window.App.toast(res?.error || 'Lỗi cắt video', 'err');
        }
      } catch (err) {
        if (statusEl) statusEl.textContent = '⚠️ Lỗi: ' + (err.message || err);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '✂️ Cắt & Xuất';
        }
      }
    });

    // Nút + Ghép nối các phần đã cắt ở cuối Timeline
    document.getElementById('btn-cut-merge-exported')?.addEventListener('click', async () => {
      if (cutState.exportedFiles.length < 2) {
        if (window.App?.toast) window.App.toast('Hãy bấm "✂️ Cắt & Xuất" để tạo ít nhất 2 phần trước khi ghép nối.', 'warn');
        return;
      }
      const btn = document.getElementById('btn-cut-merge-exported');
      const statusEl = document.getElementById('cut-status-text');
      if (btn) btn.disabled = true;
      try {
        const paths = cutState.exportedFiles.map(f => f.path);
        const res = await window.sesame?.toolkitMergeCuts?.({ videoPaths: paths });
        if (res && res.ok) {
          if (statusEl) {
            statusEl.innerHTML = `<b style="color:#10b981;">✅ Đã ghép ${paths.length} phần thành 1 video hoàn chỉnh:</b> <code>${esc(res.fileName)}</code> (${res.duration}s · ${res.sizeMB} MB)`;
          }
          if (videoEl) {
            videoEl.src = toFileUrl(res.outputPath);
            videoEl.play().catch(() => {});
          }
          if (window.App?.toast) window.App.toast(`Đã ghép thành công: ${res.fileName}`, 'ok');
        }
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    // Không nạp video mẫu: chờ người dùng chọn video thật. Đồng bộ ô nhập mặc định với trạng thái.
    { const p = document.getElementById('cut-input-parts'); if (p) p.value = String(cutState.parts);
      const d = document.getElementById('cut-input-duration'); if (d) d.value = Number(cutState.segmentSeconds).toFixed(1); }
    const titleEl0 = document.getElementById('cut-video-title'); if (titleEl0 && !cutState.videoPath) titleEl0.textContent = 'Chưa chọn video';
    const metaEl0 = document.getElementById('cut-video-meta'); if (metaEl0 && !cutState.videoPath) metaEl0.textContent = 'Bấm “Chọn video” hoặc “Kho video” để bắt đầu';
    refreshCutPlan();
  }

  /* =========================================================================
   * 2. TAB TEXT TO SPEECH (VOICE STUDIO CHUẨN TOOLKIT)
   * ========================================================================= */
  let ttsState = {
    mode: 'file',        // 'file' (mặc định) | 'text' | 'txt'
    readingMode: 'file', // 'file' | 'fit' | 'pro'
    timedFilePath: '',
    batch: [],
    timedCues: [],
    plainTxtPath: '',
    outputDir: '',
    history: []
  };

  // ===================== GIỌNG ĐỌC: nguồn thật + cài đặt riêng  =====================
  // Nguồn chạy thật: Edge (online) · Google (online) · VieNeu (trên máy). Danh mục lấy từ engine, không hard-code giọng giả.
  const TTS_STORE_KEY = 'sesame.tts.voice.v2';
  const ttsVoice = { source: 'edge', locale: 'vi-VN', voiceId: 'vi-VN-HoaiMyNeural', ratePct: 0, pitchHz: 0, pauseSec: 0.25, parallel: 1 };
  try { Object.assign(ttsVoice, JSON.parse(localStorage.getItem(TTS_STORE_KEY) || '{}')); } catch (_) {}
  let ttsCatalog = null; // { sources:[], voices:[] }
  let ttsRevalidateBatch = null; // gán trong bindTtsTab

  const TTS_SAMPLES = {
    vi: 'Xin chào, đây là giọng đọc thử của Sesame Studio.',
    en: 'Hello, this is a voice sample from Sesame Studio.',
    zh: '你好，这是 Sesame Studio 的语音试听。',
    ja: 'こんにちは、Sesame Studio の音声サンプルです。',
    ko: '안녕하세요, Sesame Studio 음성 샘플입니다.',
    fr: 'Bonjour, ceci est un échantillon de voix de Sesame Studio.',
    de: 'Hallo, das ist eine Sprachprobe von Sesame Studio.',
    es: 'Hola, esta es una muestra de voz de Sesame Studio.',
    th: 'สวัสดี นี่คือตัวอย่างเสียงจาก Sesame Studio'
  };
  const ttsSampleFor = locale => TTS_SAMPLES[String(locale || 'vi').split('-')[0].toLowerCase()] || TTS_SAMPLES.en;
  const fmtPct = n => (n >= 0 ? '+' : '') + n + '%';
  // Cảnh báo câu vượt ô / chồng tiếng do engine báo (không cắt chữ, không giấu): "#5 +0.05s"
  const ttsWarnText = res => {
    const w = res && Array.isArray(res.warnings) ? res.warnings : [];
    if (!w.length) return '';
    return `⚠ ${w.length} câu ${w.some(x => /vượt/.test(x.reason)) ? 'vượt ô SRT' : 'chồng sang câu kế'}: ` + w.slice(0, 6).map(x => `#${x.cue} (+${x.overSec}s, cần ~${x.needSpeed}x)`).join(', ') + (w.length > 6 ? '…' : '') + ' — hãy sửa SRT hoặc nới ô thời gian.';
  };
  const TTS_LOCALE_FIRST = ['vi-VN', 'vi', 'en-US', 'en', 'zh-CN', 'zh-TW', 'ja-JP', 'ja', 'ko-KR', 'ko'];

  async function loadTtsCatalog(force) {
    if (ttsCatalog && !force) return ttsCatalog;
    try {
      const r = await window.sesame?.toolkitTtsCatalog?.();
      if (r && Array.isArray(r.voices) && r.voices.length) ttsCatalog = r;
    } catch (_) {}
    if (!ttsCatalog) ttsCatalog = { sources: [{ id: 'edge', name: 'Edge', kind: 'online', available: true, count: 0, note: '' }], voices: [] };
    // nguồn đã lưu mà nay không còn dùng được → quay về Edge
    const s = ttsCatalog.sources.find(x => x.id === ttsVoice.source);
    if (!s || !s.available) { ttsVoice.source = 'edge'; ttsVoice.locale = 'vi-VN'; ttsVoice.voiceId = 'vi-VN-HoaiMyNeural'; }
    return ttsCatalog;
  }
  const ttsSources = () => (ttsCatalog?.sources || []);
  function ttsLocalesFor(source) {
    const seen = new Map();
    (ttsCatalog?.voices || []).filter(v => v.source === source).forEach(v => { if (!seen.has(v.locale)) seen.set(v.locale, v.localeName || v.locale); });
    const arr = [...seen.entries()].map(([code, name]) => ({ code, name }));
    arr.sort((a, b) => {
      const ia = TTS_LOCALE_FIRST.indexOf(a.code), ib = TTS_LOCALE_FIRST.indexOf(b.code);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      return a.code.localeCompare(b.code);
    });
    return arr;
  }
  const ttsVoicesFor = (source, locale) => (ttsCatalog?.voices || []).filter(v => v.source === source && v.locale === locale);
  function ttsFirstLocale(source, hintLang) {
    const locs = ttsLocalesFor(source);
    if (hintLang) {
      const hit = locs.find(l => l.code === hintLang) || locs.find(l => l.code.toLowerCase().startsWith(hintLang + '-')) || locs.find(l => l.code.toLowerCase() === hintLang);
      if (hit) return hit.code;
    }
    return (locs[0] || {}).code || '';
  }
  function ttsDefaultVoiceFor(source, locale) {
    if (source === ttsVoice.source && locale === ttsVoice.locale && ttsVoicesFor(source, locale).some(v => v.id === ttsVoice.voiceId)) return ttsVoice.voiceId;
    return (ttsVoicesFor(source, locale)[0] || {}).id || '';
  }
  const ttsVoiceLabel = v => `${v.gender === 'm' ? '♂' : v.gender === 'f' ? '♀' : '•'} ${v.name}`;
  const ttsLocaleLabel = l => `${l.code} · ${l.name}`;
  function ttsPrettyId(id) {
    const raw = String(id || '').split('-').slice(2).join(' ').replace(/Neural$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
    return raw === 'Hoai My' ? 'Hoài My' : raw === 'Nam Minh' ? 'Nam Minh' : (raw || String(id || ''));
  }

  function updateTtsVoiceSummary() {
    const badgeEl = document.getElementById('tts-voice-summary-badge');
    if (!badgeEl) return;
    const v = (ttsCatalog?.voices || []).find(x => x.source === ttsVoice.source && x.id === ttsVoice.voiceId);
    const srcName = ttsSources().find(s => s.id === ttsVoice.source)?.name || ttsVoice.source;
    const g = v ? (v.gender === 'm' ? '♂' : v.gender === 'f' ? '♀' : '•') : '♀';
    badgeEl.innerHTML = `<span class="tts2-dot"></span>${esc(v ? v.name : ttsPrettyId(ttsVoice.voiceId))} · ${g} · ${esc(srcName)} · ${fmtPct(ttsVoice.ratePct)}`;
  }

  // ---- Hộp thoại "Giọng riêng" ----
  let ttsDraft = null;
  let ttsPreviewBusy = false;
  function renderVoiceDialog() {
    const d = ttsDraft; if (!d) return;
    const $id = id => document.getElementById(id);
    const sources = ttsSources();
    const locked = sources.filter(s => !s.available).map(s => s.name);
    const ok = sources.filter(s => s.available).map(s => s.name);
    $id('tts-vd-banner').innerHTML = `<b>Dùng được ngay:</b> ${esc(ok.join(', ') || '—')}. <b>Chưa dùng được</b> (chưa cài, chưa tích hợp hoặc cần API): ${esc(locked.join(', ') || '—')} — các ô này bị khoá để tránh lỗi khi xử lý.`;
    const kindLabel = { online: 'Online', local: 'Local', api: 'Cần API' };
    $id('tts-vd-sources').innerHTML = sources.map(s => {
      const cls = ['tts-src', d.source === s.id ? 'active' : '', s.available ? '' : 'locked'].join(' ');
      const badge = s.available ? (kindLabel[s.kind] || '') : (s.kind === 'local' ? 'Chưa cài' : 'Chưa hỗ trợ');
      return `<button type="button" class="${cls}" data-src="${esc(s.id)}" ${s.available ? '' : 'disabled'} title="${esc(s.note || '')}"><span class="tts-src-badge" data-kind="${s.available ? esc(s.kind) : 'off'}">${esc(badge)}</span><span class="tts-src-name">${esc(s.name)}</span><span class="tts-src-count">${s.available ? s.count : ''}</span></button>`;
    }).join('');
    $id('tts-vd-srcnote').textContent = sources.find(s => s.id === d.source)?.note || '';
    const locs = ttsLocalesFor(d.source);
    if (!locs.some(l => l.code === d.locale)) d.locale = ttsFirstLocale(d.source, String(d.locale || 'vi').split('-')[0]);
    $id('tts-vd-locale').innerHTML = locs.map(l => `<option value="${esc(l.code)}" ${l.code === d.locale ? 'selected' : ''}>${esc(ttsLocaleLabel(l))}</option>`).join('');
    const voices = ttsVoicesFor(d.source, d.locale);
    if (!voices.some(v => v.id === d.voiceId)) d.voiceId = (voices[0] || {}).id || '';
    $id('tts-vd-voice').innerHTML = voices.map(v => `<option value="${esc(v.id)}" ${v.id === d.voiceId ? 'selected' : ''}>${esc(ttsVoiceLabel(v))}</option>`).join('');
    $id('tts-vd-rate').value = d.ratePct; $id('tts-vd-rate-val').textContent = fmtPct(d.ratePct);
    const pitchOk = d.source === 'edge';
    $id('tts-vd-pitch').value = pitchOk ? d.pitchHz : 0; $id('tts-vd-pitch').disabled = !pitchOk;
    $id('tts-vd-pitch-val').textContent = pitchOk ? `${d.pitchHz > 0 ? '+' : ''}${d.pitchHz} Hz` : 'Không hỗ trợ ở nguồn này';
    $id('tts-vd-pause').value = String(d.pauseSec);
    const par = $id('tts-vd-parallel');
    par.value = String(d.source === 'vieneu' ? 1 : d.parallel); par.disabled = d.source === 'vieneu';
  }
  function openVoiceDialog() {
    loadTtsCatalog().then(() => {
      ttsDraft = { ...ttsVoice };
      renderVoiceDialog();
      const st = document.getElementById('tts-vd-prevstatus'); if (st) st.textContent = '';
      document.getElementById('tts-voice-dlg')?.showModal?.();
    });
  }
  function initVoiceDialog() {
    const dlg = document.getElementById('tts-voice-dlg');
    if (!dlg || dlg.dataset.bound) return; dlg.dataset.bound = '1';
    const $id = id => document.getElementById(id);
    document.getElementById('btn-tts-voice-settings')?.addEventListener('click', openVoiceDialog);
    $id('tts-vd-sources').addEventListener('click', e => {
      const b = e.target.closest('[data-src]'); if (!b || b.disabled || !ttsDraft) return;
      const lang = String(ttsDraft.locale || 'vi').split('-')[0];
      ttsDraft.source = b.dataset.src; ttsDraft.locale = ttsFirstLocale(ttsDraft.source, lang); ttsDraft.voiceId = '';
      renderVoiceDialog();
    });
    $id('tts-vd-locale').addEventListener('change', e => { ttsDraft.locale = e.target.value; ttsDraft.voiceId = ''; renderVoiceDialog(); });
    $id('tts-vd-voice').addEventListener('change', e => { ttsDraft.voiceId = e.target.value; });
    $id('tts-vd-rate').addEventListener('input', e => { ttsDraft.ratePct = Number(e.target.value); $id('tts-vd-rate-val').textContent = fmtPct(ttsDraft.ratePct); });
    $id('tts-vd-rate-reset').addEventListener('click', () => { ttsDraft.ratePct = 0; renderVoiceDialog(); });
    $id('tts-vd-pitch').addEventListener('input', e => { ttsDraft.pitchHz = Number(e.target.value); $id('tts-vd-pitch-val').textContent = `${ttsDraft.pitchHz > 0 ? '+' : ''}${ttsDraft.pitchHz} Hz`; });
    $id('tts-vd-pause').addEventListener('change', e => { ttsDraft.pauseSec = Number(e.target.value); });
    $id('tts-vd-parallel').addEventListener('change', e => { ttsDraft.parallel = Number(e.target.value); });
    $id('tts-vd-preview').addEventListener('click', async () => {
      if (ttsPreviewBusy || !ttsDraft || !ttsDraft.voiceId) return;
      ttsPreviewBusy = true;
      const btn = $id('tts-vd-preview'); const st = $id('tts-vd-prevstatus');
      btn.disabled = true; btn.textContent = '⏳ Đang tạo mẫu…'; st.textContent = '';
      try {
        const res = await window.sesame?.toolkitTtsPreview?.({
          source: ttsDraft.source, voiceId: ttsDraft.voiceId, rate: 1 + ttsDraft.ratePct / 100,
          pitchHz: ttsDraft.source === 'edge' ? ttsDraft.pitchHz : 0, text: ttsSampleFor(ttsDraft.locale)
        });
        if (res && res.ok) {
          const a = $id('tts-vd-audio'); a.src = toFileUrl(res.outputPath) + `?t=${Date.now()}`; a.load();
          await a.play().catch(() => {});
          st.textContent = `✅ Đã phát mẫu ${res.duration}s — nguồn ${ttsDraft.source}, ${fmtPct(ttsDraft.ratePct)} tốc độ.`;
        } else st.textContent = '⚠ Không tạo được mẫu: ' + (res?.error || 'lỗi không xác định');
      } catch (err) { st.textContent = '⚠ Lỗi: ' + (err.message || err); }
      btn.disabled = false; btn.textContent = '▶ Nghe thử'; ttsPreviewBusy = false;
    });
    const closeDlg = () => { try { $id('tts-vd-audio').pause(); } catch (_) {} dlg.close(); };
    $id('tts-vd-cancel').addEventListener('click', closeDlg);
    $id('tts-vd-x').addEventListener('click', closeDlg);
    $id('tts-vd-save').addEventListener('click', () => {
      if (!ttsDraft || !ttsDraft.voiceId) return;
      Object.assign(ttsVoice, ttsDraft);
      if (ttsVoice.source === 'vieneu') ttsVoice.parallel = 1;
      try { localStorage.setItem(TTS_STORE_KEY, JSON.stringify(ttsVoice)); } catch (_) {}
      updateTtsVoiceSummary();
      if (typeof ttsRevalidateBatch === 'function') ttsRevalidateBatch();
      closeDlg();
      if (window.App?.toast) window.App.toast('Đã lưu giọng riêng.', 'ok');
    });
  }

  function updateTtsCharCount() {
    const inp = document.getElementById('tts-text-input');
    const badge = document.getElementById('tts-char-count');
    if (inp && badge) {
      badge.textContent = `${inp.value.length} ký tự`;
    }
  }

  function renderTimedCuesTable() {
    const tbody = document.getElementById('tts-timed-tbody');
    const sumEl = document.getElementById('tts-timed-summary');
    if (sumEl && ttsState.timedCues.length > 0) {
      sumEl.innerHTML = `✅ Đã nhận <b>${ttsState.timedCues.length} câu có timecode</b> từ <code>${esc(baseName(ttsState.timedFilePath))}</code> · Sẵn sàng tạo giọng đọc.`;
    }
    if (!tbody) return;
    tbody.innerHTML = ttsState.timedCues.map((c, idx) => `
      <tr style="border-bottom:1px solid var(--line);">
        <td style="padding:7px 10px;font-weight:700;color:var(--muted);">#${c.index || idx + 1}</td>
        <td style="padding:7px 10px;font-family:monospace;font-size:11.5px;color:#0891b2;">${esc(c.startTime)} → ${esc(c.endTime)}</td>
        <td style="padding:7px 10px;">
          <input type="text" class="input tts-cue-edit" data-idx="${idx}" value="${esc(c.text)}" style="width:100%;font-size:13px;">
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.tts-cue-edit').forEach(inp => {
      inp.addEventListener('input', () => {
        const i = Number(inp.getAttribute('data-idx'));
        if (ttsState.timedCues[i]) ttsState.timedCues[i].text = inp.value;
      });
    });
  }

  async function loadTimedFile(filePath) {
    if (!filePath) return;
    const res = await window.sesame?.toolkitTtsParseTimed?.({ filePath });
    if (res && res.ok && res.cues.length > 0) {
      ttsState.timedFilePath = filePath;
      ttsState.timedCues = res.cues;
      const inp = document.getElementById('tts-timed-file-path');
      if (inp) inp.value = filePath;
      renderTimedCuesTable();
    } else if (window.App?.toast) {
      window.App.toast('File chưa có timecode hợp lệ. Hãy chọn file .srt hoặc chuyển sang tab Nhập văn bản.', 'warn');
    }
  }

  async function loadPlainTxtFile(filePath) {
    if (!filePath) return;
    const res = await window.sesame?.toolkitTtsReadTxt?.(filePath);
    if (res && res.ok) {
      ttsState.plainTxtPath = filePath;
      const pathInp = document.getElementById('tts-plain-txt-path');
      const prevInp = document.getElementById('tts-plain-txt-preview');
      const sumEl = document.getElementById('tts-plain-txt-summary');
      if (pathInp) pathInp.value = filePath;
      if (prevInp) prevInp.value = res.text;
      if (sumEl) {
        sumEl.innerHTML = `✅ Đã nạp <b>${res.charCount} ký tự</b> (${res.lineCount} đoạn) từ <code>${esc(res.fileName)}</code>. Bạn có thể kiểm tra hoặc sửa trước khi tạo giọng.`;
      }
    }
  }

  function renderTtsHistory() {
    const listEl = document.getElementById('tts-history-list');
    const countEl = document.getElementById('tts-history-count');
    if (countEl) countEl.textContent = String(ttsState.history.length);
    if (!listEl) return;

    if (ttsState.history.length === 0) {
      listEl.innerHTML = `<div class="muted small" style="padding:8px 12px;border:1px dashed var(--line);border-radius:8px;text-align:center;">Chưa có file âm thanh nào trong phiên này.</div>`;
      return;
    }

    listEl.innerHTML = ttsState.history.map(item => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 12px;border-radius:8px;background:var(--surface-2);border:1px solid var(--line);">
        <div style="min-width:0;flex:1;">
          <div style="font-weight:700;font-size:12.5px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            🎵 ${esc(item.fileName)} <span class="st-chip" data-tone="ok" style="margin-left:6px;">${esc(item.format)}</span>
          </div>
          <div class="muted small">Thời lượng: <b>${item.duration}s</b> · Dung lượng: ${item.sizeKB} KB · Chế độ: ${esc(item.modeLabel)}</div>
        </div>
        <div class="row" style="gap:6px;">
          <button type="button" class="srt-pill-btn teal tts-play-hist-btn" data-path="${esc(item.outputPath)}" style="height:26px;padding:0 10px;font-size:11.5px;">▶ Nghe</button>
          <button type="button" class="srt-pill-btn tts-open-hist-btn" data-path="${esc(item.outputPath)}" style="height:26px;padding:0 10px;font-size:11.5px;">📂 Mở file</button>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('.tts-play-hist-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = btn.getAttribute('data-path');
        const player = document.getElementById('tts-audio-player');
        if (player && p) {
          player.src = toFileUrl(p);
          player.play().catch(() => {});
        }
      });
    });

    listEl.querySelectorAll('.tts-open-hist-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = btn.getAttribute('data-path');
        if (p) window.sesame?.openPath?.(p);
      });
    });
  }

  function bindTtsTab() {
    updateTtsVoiceSummary();
    updateTtsCharCount();
    renderTtsHistory();

    // Chuyển tab chế độ nguồn (text | file | txt)
    document.querySelectorAll('.tts-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-tts-mode') || 'text';
        ttsState.mode = mode;
        document.querySelectorAll('.tts-mode-btn').forEach(b => b.classList.toggle('active', b === btn));
        ['text', 'file', 'txt'].forEach(m => {
          const pane = document.getElementById(`tts-pane-${m}`);
          if (pane) pane.hidden = (m !== mode);
        });
        const readRow = document.getElementById('tts-reading-mode-row');
        if (readRow) readRow.style.display = (mode === 'file') ? 'flex' : 'none';
      });
    });

    // Chuyển Cách đọc (Giữ timeline | Khớp thời gian tuyệt đối | Mode Pro)
    document.querySelectorAll('.tts-read-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        ttsState.readingMode = btn.getAttribute('data-read-mode') || 'file';
        document.querySelectorAll('.tts-read-btn').forEach(b => b.classList.toggle('active', b === btn));
      });
    });


    const textInp = document.getElementById('tts-text-input');
    textInp?.addEventListener('input', updateTtsCharCount);

    // Chèn thẻ điều khiển giọng [nghỉ 0.5s], [nhấn mạnh], ...
    document.querySelectorAll('.tts-tag-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tag = btn.getAttribute('data-tts-tag') || '[nghỉ 0.5s]';
        if (!textInp) return;
        const start = textInp.selectionStart ?? textInp.value.length;
        const end = textInp.selectionEnd ?? textInp.value.length;
        const before = textInp.value.slice(0, start);
        const after = textInp.value.slice(end);
        textInp.value = `${before} ${tag} ${after}`.replace(/ +/g, ' ');
        textInp.focus();
        updateTtsCharCount();
      });
    });

    // Chuẩn hóa AI
    document.getElementById('btn-tts-normalize-ai')?.addEventListener('click', async () => {
      if (!textInp || !textInp.value.trim()) {
        if (window.App?.toast) window.App.toast('Hãy nhập văn bản trước khi Chuẩn hóa AI.', 'warn');
        return;
      }
      const btn = document.getElementById('btn-tts-normalize-ai');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Đang chuẩn hóa...';
      }
      try {
        const res = await window.sesame?.toolkitTtsNormalize?.({ text: textInp.value });
        if (res && res.ok && res.normalized) {
          textInp.value = res.normalized;
          updateTtsCharCount();
          const statusEl = document.getElementById('tts-status-text');
          if (statusEl) statusEl.textContent = '✨ Đã chuẩn hóa AI (đổi số đếm sang chữ, chỉnh dấu câu và nhịp nghỉ tự nhiên). Hãy kiểm tra lại rồi bấm Tạo giọng đọc.';
          if (window.App?.toast) window.App.toast('Đã chuẩn hóa văn bản cho giọng đọc tự nhiên!', 'ok');
        }
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '✨ Chuẩn hóa AI';
        }
      }
    });

    // Đọc file TXT vào thẳng ô văn bản
    document.getElementById('btn-tts-import-txt-inline')?.addEventListener('click', async () => {
      const f = await window.sesame?.pickFile?.({
        title: 'Chọn file TXT để đưa vào ô văn bản',
        filters: [{ name: 'Văn bản TXT', extensions: ['txt'] }]
      });
      if (f) {
        const r = await window.sesame?.toolkitTtsReadTxt?.(f);
        if (r && r.ok && textInp) {
          textInp.value = r.text;
          updateTtsCharCount();
        }
      }
    });

    // Chế độ 2: Chọn file SRT/TXT có timecode
    document.getElementById('btn-tts-pick-timed')?.addEventListener('click', async () => {
      const f = await window.sesame?.pickFile?.({
        title: 'Chọn file SRT/TXT có timecode',
        filters: [{ name: 'Phụ đề có timecode', extensions: ['srt', 'txt'] }]
      });
      if (f) await loadTimedFile(f);
    });

    // Chế độ 3: Chọn file TXT thuần
    document.getElementById('btn-tts-pick-txt')?.addEventListener('click', async () => {
      const f = await window.sesame?.pickFile?.({
        title: 'Chọn file TXT chứa văn bản',
        filters: [{ name: 'Văn bản TXT', extensions: ['txt'] }]
      });
      if (f) await loadPlainTxtFile(f);
    });

    // Chọn thư mục xuất
    document.getElementById('btn-tts-choose-outdir')?.addEventListener('click', async () => {
      const dir = await window.sesame?.pickFolder?.();
      if (dir) {
        ttsState.outputDir = dir;
        const inp = document.getElementById('tts-output-dir');
        if (inp) inp.value = dir;
      }
    });
    document.getElementById('btn-tts-open-dir')?.addEventListener('click', async () => {
      const target = ttsState.outputDir || await window.sesame?.getDefaultOutputDir?.();
      if (target) window.sesame?.openPath?.(target);
    });

    // ---------- Bảng xử lý hàng loạt (mỗi SRT có ngôn ngữ + giọng riêng, lấy từ nguồn đang chọn) ----------
    function ensureRowValid(b) {
      const src = ttsVoice.source;
      const locs = ttsLocalesFor(src);
      if (!locs.some(l => l.code === b.locale)) b.locale = ttsFirstLocale(src, String(b.locale || ttsVoice.locale || 'vi').split('-')[0]);
      if (!ttsVoicesFor(src, b.locale).some(v => v.id === b.voiceId)) b.voiceId = ttsDefaultVoiceFor(src, b.locale);
    }
    ttsRevalidateBatch = () => { ttsState.batch.forEach(ensureRowValid); renderBatch(); };
    function renderBatch() {
      const tb = document.getElementById('tts-batch-tbody');
      if (!tb) return;
      if (!ttsState.batch.length) {
        tb.innerHTML = '<tr class="tts2-empty"><td colspan="4">Chưa có file nào trong danh sách hàng loạt. Bấm “Thêm nhiều SRT”.</td></tr>';
        return;
      }
      const locs = ttsLocalesFor(ttsVoice.source);
      tb.innerHTML = ttsState.batch.map((b, i) => {
        const langOpts = locs.map(l => `<option value="${esc(l.code)}" ${b.locale === l.code ? 'selected' : ''}>${esc(ttsLocaleLabel(l))}</option>`).join('');
        const voiceOpts = ttsVoicesFor(ttsVoice.source, b.locale).map(v => `<option value="${esc(v.id)}" ${b.voiceId === v.id ? 'selected' : ''}>${esc(ttsVoiceLabel(v))}</option>`).join('');
        const cls = b.status === 'done' ? 'tts2-st-ok' : b.status === 'error' ? 'tts2-st-err' : b.status === 'running' ? 'tts2-st-run' : '';
        const label = b.status === 'done' ? (b.warn ? `<span title="${esc(b.warn)}">⚠ Xong (có câu vượt ô)</span>` : '✅ Xong') : b.status === 'error' ? '⚠ ' + esc(b.error || 'Lỗi') : b.status === 'running' ? '⏳ Đang đọc…' : 'Chờ';
        return `<tr data-i="${i}"><td title="${esc(b.path)}">${esc(baseName(b.path))}</td>
          <td><select class="select tts-b-lang">${langOpts}</select></td>
          <td><select class="select tts-b-voice">${voiceOpts}</select></td>
          <td class="${cls}">${label} <button type="button" class="tts2-ghost tts-b-del" style="height:26px;padding:0 8px;" title="Bỏ file này">✕</button></td></tr>`;
      }).join('');
    }
    document.getElementById('tts-batch-tbody')?.addEventListener('change', e => {
      const tr = e.target.closest('tr[data-i]'); if (!tr) return;
      const b = ttsState.batch[Number(tr.dataset.i)]; if (!b) return;
      if (e.target.classList.contains('tts-b-lang')) {
        b.locale = e.target.value;
        b.voiceId = ttsDefaultVoiceFor(ttsVoice.source, b.locale);
        renderBatch();
      } else if (e.target.classList.contains('tts-b-voice')) b.voiceId = e.target.value;
    });
    document.getElementById('tts-batch-tbody')?.addEventListener('click', e => {
      if (!e.target.classList.contains('tts-b-del')) return;
      const tr = e.target.closest('tr[data-i]');
      ttsState.batch.splice(Number(tr.dataset.i), 1);
      renderBatch();
    });
    document.getElementById('btn-tts-add-batch')?.addEventListener('click', async () => {
      await loadTtsCatalog();
      const files = await window.sesame?.pickFiles?.({ title: 'Chọn nhiều file SRT/TXT có timecode', filters: [{ name: 'Phụ đề có timecode', extensions: ['srt', 'txt'] }] });
      (files || []).forEach(p => {
        if (ttsState.batch.some(b => b.path === p)) return;
        const base = baseName(p).toLowerCase();
        const hint = /(\.|_|-)(en|eng)(\.|_|-)|english/.test(base) ? 'en'
          : /(\.|_|-)(zh|cn|chi)(\.|_|-)|chinese|trung/.test(base) ? 'zh'
          : /(\.|_|-)(ja|jp)(\.|_|-)|japanese|nhat/.test(base) ? 'ja'
          : /(\.|_|-)(ko|kr)(\.|_|-)|korean|han quoc/.test(base) ? 'ko'
          : /(\.|_|-)(vi|vn)(\.|_|-)|viet/.test(base) ? 'vi' : '';
        const row = { path: p, locale: ttsFirstLocale(ttsVoice.source, hint || String(ttsVoice.locale || 'vi').split('-')[0]), voiceId: '', status: '', error: '' };
        row.voiceId = ttsDefaultVoiceFor(ttsVoice.source, row.locale);
        ttsState.batch.push(row);
      });
      renderBatch();
    });
    document.getElementById('btn-tts-clear-batch')?.addEventListener('click', () => { ttsState.batch = []; renderBatch(); });

    async function runTtsBatch({ rate, pitchHz, pauseSec, format }) {
      const btn = document.getElementById('btn-tts-generate');
      const statusEl = document.getElementById('tts-status-text');
      const progEl = document.getElementById('tts-progress-fill');
      const player = document.getElementById('tts-audio-player');
      const metaEl = document.getElementById('tts-output-meta');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang xử lý hàng loạt...'; }
      await loadTtsCatalog();
      const total = ttsState.batch.length;
      ttsState.batch.forEach(b => { ensureRowValid(b); b.status = ''; b.error = ''; });
      renderBatch();
      const limit = Math.max(1, Math.min(3, ttsVoice.source === 'vieneu' ? 1 : (ttsVoice.parallel || 1)));
      let ok = 0, finished = 0, next = 0, shown = false;
      async function worker() {
        while (next < total) {
          const i = next++;
          const b = ttsState.batch[i];
          b.status = 'running'; renderBatch();
          if (statusEl) statusEl.textContent = `⏳ Đang đọc ${finished + 1}/${total}: ${baseName(b.path)}` + (limit > 1 ? ` (chạy song song ${limit} file)` : '');
          try {
            const res = await window.sesame?.toolkitTtsGenerate?.({ mode: 'file', readingMode: ttsState.readingMode, text: '', filePath: b.path, voiceId: b.voiceId, source: ttsVoice.source, rate, pitchHz, pauseSec, format, outputDir: ttsState.outputDir });
            if (res && res.ok) {
              b.status = 'done'; b.warn = ttsWarnText(res); ok++;
              ttsState.history.unshift({ ...res, modeLabel: `Hàng loạt · ${baseName(b.path)}` });
              if (player && !shown) { shown = true; player.src = toFileUrl(res.outputPath) + `?t=${Date.now()}`; player.load(); }
              if (metaEl && shown && ok === 1) metaEl.innerHTML = `<b>${esc(res.fileName)}</b> (${res.duration}s · ${res.sizeKB} KB)` + (total > 1 ? ' · file đầu của lô' : '');
            } else { b.status = 'error'; b.error = res?.error || 'Không xác định'; }
          } catch (err) { b.status = 'error'; b.error = err.message || String(err); }
          finished++;
          if (progEl) progEl.style.width = Math.round((finished / total) * 100) + '%';
          renderBatch(); renderTtsHistory();
        }
      }
      await Promise.all(Array.from({ length: Math.min(limit, total) }, worker));
      if (progEl) progEl.style.width = '100%';
      if (statusEl) statusEl.innerHTML = `<b>Hàng loạt xong:</b> ${ok}/${total} file thành công${ok < total ? ' — file lỗi xem ở cột Trạng thái' : ''}.`;
      if (btn) { btn.disabled = false; btn.textContent = '🎙 Tạo giọng đọc'; }
    }

    // ---------- Gợi ý ⓘ, hộp thoại "Cài đặt giọng riêng…", trạng thái ban đầu ----------
    function initTtsExtras() {
      document.querySelectorAll('#tab-tts .tts2-i').forEach(b => b.addEventListener('click', () => {
        const line = document.getElementById('tts-hint-line');
        const txt = b.getAttribute('data-tts-hint') || '';
        if (!line) return;
        const same = !line.hidden && line.textContent === txt;
        line.textContent = txt; line.hidden = same;
      }));
      initVoiceDialog();
      loadTtsCatalog().then(() => { updateTtsVoiceSummary(); ttsRevalidateBatch && ttsRevalidateBatch(); });
      // kích hoạt chế độ mặc định: file timecode + giữ timeline
      document.querySelector('.tts-mode-btn[data-tts-mode="' + ttsState.mode + '"]')?.click();
      document.querySelector('.tts-read-btn[data-read-mode="' + ttsState.readingMode + '"]')?.click();
      updateTtsVoiceSummary();
      renderBatch();
    }

    // Hàm thực thi Tạo giọng đọc
    async function runTtsSynthesis(previewOnly = false) {
      const btn = document.getElementById(previewOnly ? 'btn-tts-preview-short' : 'btn-tts-generate');
      const statusEl = document.getElementById('tts-status-text');
      const progEl = document.getElementById('tts-progress-fill');
      const player = document.getElementById('tts-audio-player');
      const metaEl = document.getElementById('tts-output-meta');

      await loadTtsCatalog();
      const voiceId = ttsVoice.voiceId || 'vi-VN-HoaiMyNeural';
      const rate = 1 + (Number(ttsVoice.ratePct) || 0) / 100;
      const pitchHz = ttsVoice.source === 'edge' ? (Number(ttsVoice.pitchHz) || 0) : 0;
      const pauseSec = Number(ttsVoice.pauseSec) || 0.25;
      const format = document.getElementById('tts-output-format')?.value || 'mp3';

      if (!previewOnly && ttsState.mode === 'file' && ttsState.batch.length) {
        return runTtsBatch({ rate, pitchHz, pauseSec, format });
      }
      if (ttsState.mode === 'file' && !ttsState.timedCues.length) {
        if (statusEl) statusEl.textContent = '⚠ Chưa chọn file SRT/TXT có timecode. Bấm “Chọn file” hoặc “Thêm nhiều SRT”.';
        return;
      }
      if (ttsState.mode === 'text' && !(textInp?.value || '').trim()) {
        if (statusEl) statusEl.textContent = '⚠ Chưa có văn bản để đọc.';
        return;
      }

      let payloadText = '';
      let payloadFile = '';
      if (ttsState.mode === 'text') {
        payloadText = textInp?.value || '';
        if (previewOnly) {
          payloadText = payloadText.split(/[.!?…\n]+/).filter(Boolean)[0] || payloadText;
        }
      } else if (ttsState.mode === 'file') {
        // Kết hợp lại nội dung từ bảng đã chỉnh sửa
        payloadText = ttsState.timedCues.map((c, idx) => `${idx + 1}\n${c.startTime} --> ${c.endTime}\n${c.text}`).join('\n\n');
        payloadFile = ttsState.timedFilePath;
        if (previewOnly) { payloadText = ttsState.timedCues[0]?.text || ''; payloadFile = ''; }
      } else if (ttsState.mode === 'txt') {
        payloadText = document.getElementById('tts-plain-txt-preview')?.value || '';
        payloadFile = ttsState.plainTxtPath;
      }

      if (btn) {
        btn.disabled = true;
        btn.textContent = previewOnly ? '⏳ Đang tạo mẫu...' : '⏳ Đang tạo giọng đọc...';
      }
      if (progEl) progEl.style.width = '25%';
      if (statusEl) statusEl.textContent = '⏳ Đang tổng hợp giọng đọc AI và chuẩn hóa âm lượng...';

      try {
        const res = await window.sesame?.toolkitTtsGenerate?.({
          mode: previewOnly ? 'text' : ttsState.mode,
          readingMode: ttsState.readingMode,
          text: payloadText,
          filePath: payloadFile,
          voiceId,
          source: ttsVoice.source,
          rate,
          pitchHz,
          pauseSec,
          format,
          outputDir: ttsState.outputDir
        });

        if (res && res.ok) {
          if (progEl) progEl.style.width = '100%';
          if (statusEl) {
            statusEl.innerHTML = `<b style="color:#0891b2;">✅ Tạo giọng đọc hoàn tất:</b> <code>${esc(res.fileName)}</code> (${res.format} · Thời lượng: <b>${res.duration}s</b> · ${res.sizeKB} KB)` + (ttsWarnText(res) ? `<br><b style="color:#d97706;">${esc(ttsWarnText(res))}</b>` : '');
          }
          if (metaEl) {
            metaEl.innerHTML = `<b>${esc(res.fileName)}</b> (${res.duration}s · ${res.sizeKB} KB)`;
          }
          if (player) {
            player.src = toFileUrl(res.outputPath) + `?t=${Date.now()}`;
            player.load();
            player.play().catch(e => console.warn('Autoplay:', e));
          }
          const modeLabel = ttsState.mode === 'file'
            ? `Timecode (${ttsState.readingMode})`
            : (ttsState.mode === 'txt' ? 'Từ file TXT' : 'Nhập văn bản');
          ttsState.history.unshift({ ...res, modeLabel });
          renderTtsHistory();
          if (window.App?.toast) window.App.toast(`Đã xuất giọng đọc: ${res.fileName} (${res.duration}s)`, 'ok');
        } else {
          if (statusEl) statusEl.textContent = '⚠️ Lỗi tạo giọng đọc: ' + (res?.error || 'Không xác định');
          if (window.App?.toast) window.App.toast(res?.error || 'Lỗi tạo giọng đọc', 'err');
        }
      } catch (err) {
        if (statusEl) statusEl.textContent = '⚠️ Lỗi: ' + (err.message || err);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = previewOnly ? '🔊 Nghe thử 1 câu' : '🎙️ Tạo giọng đọc';
        }
      }
    }

    document.getElementById('btn-tts-preview-short')?.addEventListener('click', () => runTtsSynthesis(true));
    document.getElementById('btn-tts-generate')?.addEventListener('click', () => runTtsSynthesis(false));

    // Nạp sẵn dữ liệu mẫu cho tab SRT timecode và TXT thuần để người mới bấm qua là dùng được ngay
    initTtsExtras();
  }

  /* =========================================================================
   * 3. MODAL QUẢN LÝ MODEL & TÀI NGUYÊN + ĐIỀU KHIỂN THU PHÓNG (ZOOM)
   * ========================================================================= */
  async function checkResources(opts = {}) {
    const { autoShowIfMissing = false } = opts;
    try {
      const r = await window.sesame?.feat?.('resources-check');
      const items = Array.isArray(r) ? r : (r?.items || []);
      if (!items.length) return r;

      const readyCount = items.filter(x => x.ok || x.ready).length;
      const totalCount = items.length;
      const missingCount = totalCount - readyCount;
      const allReady = missingCount === 0;

      const readyPill = document.getElementById('res-ready-pill');
      const missingPill = document.getElementById('res-missing-pill');
      const listEl = document.getElementById('res-items-list');
      const storageEl = document.getElementById('res-storage-path');

      if (readyPill) readyPill.textContent = `Sẵn sàng ${readyCount}/${totalCount}`;
      if (missingPill) missingPill.textContent = `Chưa tải ${missingCount}`;
      if (storageEl && r?.storageDir) storageEl.textContent = r.storageDir;

      if (listEl) {
        listEl.innerHTML = items.map(item => `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;border-bottom:1px solid var(--line);">
            <div style="min-width:0;flex:1;">
              <div style="font-weight:750;font-size:13px;color:var(--ink);">${esc(item.title || item.name)} <span class="st-chip" data-tone="info" style="margin-left:6px;">${esc(item.tag || 'Hệ thống')}</span></div>
              <div class="muted small" style="margin-top:2px;">${esc(item.desc || '')}</div>
              <div class="small" style="color:#0891b2;margin-top:2px;">${esc(item.detail || '')}</div>
            </div>
            <span class="st-chip" data-tone="${item.ok ? 'ok' : 'warn'}"><span class="st-dot"></span>${item.ok ? '✓ Sẵn sàng' : '⚠ Chưa cài'}</span>
          </div>
        `).join('');
      }

      if (autoShowIfMissing && !allReady) {
        const modal = document.getElementById('modal-resources');
        if (modal) modal.style.display = 'flex';
      }
      return r;
    } catch (_) {}
  }

  function bindResourcesModal() {
    const modal = document.getElementById('modal-resources');
    const openModal = async () => {
      if (modal) modal.style.display = 'flex';
      await checkResources({ silent: true });
    };
    const closeModal = () => {
      if (modal) modal.style.display = 'none';
    };

    document.getElementById('btn-open-resources')?.addEventListener('click', openModal);
    document.getElementById('btn-close-resources')?.addEventListener('click', closeModal);
    document.getElementById('btn-close-resources-btm')?.addEventListener('click', closeModal);

    document.getElementById('btn-res-recheck')?.addEventListener('click', async () => {
      await checkResources({ silent: true });
      if (window.App?.toast) window.App.toast('Đã kiểm tra lại toàn bộ Model & Runtime!', 'ok');
    });

    document.getElementById('btn-res-open-dir')?.addEventListener('click', () => {
      window.sesame?.openOutputFolder?.();
    });

    document.getElementById('btn-res-install-all')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-res-install-all');
      const note = document.getElementById('res-footer-note');
      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Đang cài đặt tự động...';
      }
      if (note) note.textContent = '⏳ Đang tải và cấu hình FFmpeg, Edge-TTS & VieNeu-TTS v3 48kHz...';
      try {
        const r = await window.sesame?.feat?.('resources-install', {});
        await checkResources({ silent: true });
        if (note) {
          note.textContent = (r && r.logs && r.logs.length)
            ? '✅ ' + r.logs.join(' · ')
            : '✅ Đã kiểm tra và cài đặt đầy đủ các gói tài nguyên!';
        }
        if (window.App?.toast) window.App.toast('Đã cài đặt hoàn tất các gói Model & Runtime cần thiết!', 'ok');
      } catch (err) {
        if (note) note.textContent = '⚠️ Lỗi cài đặt: ' + (err.message || err);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = '⬇️ Tải tài nguyên cần thiết';
        }
      }
    });

    setTimeout(() => {
      checkResources({ autoShowIfMissing: false });
    }, 800);
  }

  function bindZoomControls() {
    const lbl = document.getElementById('btn-zoom-reset');
    const setLbl = (pct) => {
      if (lbl && pct) lbl.textContent = `${pct}%`;
    };
    if (window.sesame?.onZoomChanged) {
      window.sesame.onZoomChanged(setLbl);
    }
    document.getElementById('btn-zoom-in')?.addEventListener('click', async () => {
      const r = await window.sesame?.zoom?.('in');
      if (r?.pct) setLbl(r.pct);
    });
    document.getElementById('btn-zoom-out')?.addEventListener('click', async () => {
      const r = await window.sesame?.zoom?.('out');
      if (r?.pct) setLbl(r.pct);
    });
    document.getElementById('btn-zoom-reset')?.addEventListener('click', async () => {
      const r = await window.sesame?.zoom?.('reset');
      if (r?.pct) setLbl(r.pct);
    });
    window.addEventListener('wheel', async (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const r = await window.sesame?.zoom?.(e.deltaY < 0 ? 'in' : 'out');
        if (r?.pct) setLbl(r.pct);
      }
    }, { passive: false });
  }

  window.SesameToolkit = {
    loadVideoIntoCut,
    openResourcesModal: async () => {
      const modal = document.getElementById('modal-resources');
      if (modal) modal.style.display = 'flex';
      return await checkResources({ silent: true });
    },
    checkResources
  };

  function initToolkitTools() {
    bindCutVideoTab();
    bindTtsTab();
    bindResourcesModal();
    bindZoomControls();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initToolkitTools);
  } else {
    initToolkitTools();
  }
})();
