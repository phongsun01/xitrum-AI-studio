/**
 * HỘP GHÉP VIDEO — dùng chung cho Studio và Thư viện:
 * - Đổi thứ tự ↑↓, bỏ bớt
 * - Nút ⚡ Sắp xếp timeline (tự nhận diện 0s-10s, Cảnh 1, 2, 3... dù tạo lại sau do lỗi)
 * - Nút A → Z và Đảo ngược
 * - Chuẩn hóa timeline 30fps CFR (chống tua nhanh, lệch tiếng)
 * - Đặt tên file, thanh % tiến độ.
 * App.openMerge(paths, onDone)
 */
(function () {
  'use strict';
  const { api, $, escapeHtml, toast } = window.App;
  const dlg = $('merge-dlg');
  let list = [];
  let done = () => {};
  let busy = false;

  function extractSortKey(filePath) {
    const name = filePath.split(/[\\/]/).pop() || '';
    // 1. Phân cảnh theo khoảng thời gian: 0s-10s, 000s-010s, 400s-500s...
    const mTimeRange = name.match(/(\d+)s[-_](\d+)s/i);
    if (mTimeRange) {
      return {
        type: 1,
        start: parseInt(mTimeRange[1], 10),
        end: parseInt(mTimeRange[2], 10),
        name
      };
    }
    // 2. Phân cảnh theo số cảnh: Canh-01, Canh_02, Scene 3, Phan-4, Tap-5...
    const mScene = name.match(/(?:canh|scene|phan|tap|c)[-_ ]*(\d+)/i);
    if (mScene) {
      return {
        type: 2,
        scene: parseInt(mScene[1], 10),
        name
      };
    }
    // 3. Số thứ tự đầu tên file: 01_xxx, 2.xxx...
    const mLeading = name.match(/^(\d+)/);
    if (mLeading) {
      return {
        type: 3,
        num: parseInt(mLeading[1], 10),
        name
      };
    }
    return { type: 4, name };
  }

  function compareTimeline(a, b) {
    const ka = extractSortKey(a);
    const kb = extractSortKey(b);
    if (ka.type === 1 && kb.type === 1) {
      if (ka.start !== kb.start) return ka.start - kb.start;
      return ka.end - kb.end;
    }
    if (ka.type === 2 && kb.type === 2) {
      return ka.scene - kb.scene;
    }
    if (ka.type === 3 && kb.type === 3) {
      return ka.num - kb.num;
    }
    if (ka.type <= 3 && kb.type <= 3) {
      const valA = ka.start ?? ka.scene ?? ka.num ?? 0;
      const valB = kb.start ?? kb.scene ?? kb.num ?? 0;
      if (valA !== valB) return valA - valB;
    }
    return ka.name.localeCompare(kb.name, undefined, { numeric: true, sensitivity: 'base' });
  }

  function compareAZ(a, b) {
    const na = a.split(/[\\/]/).pop() || '';
    const nb = b.split(/[\\/]/).pop() || '';
    return na.localeCompare(nb, undefined, { numeric: true, sensitivity: 'base' });
  }

  function render() {
    $('merge-list').innerHTML = list.map((p, i) => `<div class="merge-row" data-i="${i}">
        <strong>${i + 1}</strong><span title="${escapeHtml(p)}">${escapeHtml(p.split(/[\\/]/).pop())}</span>
        <div class="row"><button type="button" class="btn-ghost btn-sm" data-m="-1"${i ? '' : ' disabled'} aria-label="Lên">↑</button><button type="button" class="btn-ghost btn-sm" data-m="1"${i < list.length - 1 ? '' : ' disabled'} aria-label="Xuống">↓</button><button type="button" class="btn-ghost btn-sm" data-m="x" aria-label="Bỏ">✕</button></div>
      </div>`).join('');
    $('merge-go').disabled = busy || list.length < 2;
  }
  const bar = pct => { dlg.querySelector('.merge-bar').hidden = pct === null; $('merge-pct').style.width = (pct || 0) + '%'; };

  $('merge-sort-timeline')?.addEventListener('click', () => {
    if (busy || list.length < 2) return;
    list.sort(compareTimeline);
    render();
    toast('Đã sắp xếp theo timeline / phân cảnh', 'ok');
  });

  $('merge-sort-az')?.addEventListener('click', () => {
    if (busy || list.length < 2) return;
    list.sort(compareAZ);
    render();
    toast('Đã sắp xếp theo tên file A → Z', 'ok');
  });

  $('merge-sort-rev')?.addEventListener('click', () => {
    if (busy || list.length < 2) return;
    list.reverse();
    render();
    toast('Đã đảo ngược thứ tự danh sách', 'ok');
  });

  $('merge-list').addEventListener('click', e => {
    const m = e.target.dataset.m;
    const i = +e.target.closest('[data-i]')?.dataset.i;
    if (!m || busy) return;
    if (m === 'x') list.splice(i, 1);
    else { const j = i + +m; [list[i], list[j]] = [list[j], list[i]]; }
    render();
  });
  let mergePreviewAudio = null;
  $('btn-merge-preview-voice')?.addEventListener('click', async () => {
    const v = $('merge-voice')?.value || 'vieneu:Quỳnh Anh';
    const sample = ($('merge-voice-text')?.value || '').trim().split('\n')[0] || '';
    const btn = $('btn-merge-preview-voice');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang tạo...'; }
    try {
      const r = await api.vieneuPreview({ voice: v, text: sample });
      if (!r?.success || !r.path) throw new Error(r?.error || 'Không tạo được mẫu thử');
      if (mergePreviewAudio) { try { mergePreviewAudio.pause(); } catch (_) {} }
      mergePreviewAudio = new Audio(window.App.fileUrl(r.path) + '?t=' + Date.now());
      await mergePreviewAudio.play();
      toast(`Đang phát giọng mẫu VieNeu-TTS 48kHz: ${r.voice}`, 'ok');
    } catch (e) {
      toast('Lỗi nghe thử giọng: ' + (e.message || e), 'danger');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔊 Nghe thử'; }
    }
  });

  $('merge-cancel').addEventListener('click', () => { if (!busy) dlg.close(); });
  dlg.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  $('merge-go').addEventListener('click', async () => {
    busy = true; render(); bar(0);
    const voice = $('merge-voice')?.value || '';
    const voiceText = ($('merge-voice-text')?.value || '').trim();
    $('merge-go').textContent = (voice && voiceText) ? 'Đang ghép & lồng tiếng 48kHz...' : 'Đang ghép...';
    const normalize = Boolean($('merge-normalize')?.checked);
    const r = await api.mergeVideos(list, $('merge-name').value.trim(), { normalize, voice, voiceText }).catch(e => ({ success: false, error: e.message }));
    busy = false;
    $('merge-go').textContent = 'Ghép';
    if (!r?.success) { bar(null); render(); return toast('Ghép lỗi: ' + (r?.error || 'không rõ'), 'danger'); }
    toast('Đã ghép: ' + r.path.split(/[\\/]/).pop(), 'ok');
    dlg.close();
    done(r);
  });
  api?.onMergeProgress?.(pct => { if (busy) bar(pct); });

  window.App.openMerge = (paths, onDone = () => {}) => {
    if (paths.length < 2) return toast('Chọn ít nhất 2 video để ghép.', 'warn');
    list = paths.slice();
    done = onDone;
    $('merge-name').value = '';
    if ($('merge-normalize')) $('merge-normalize').checked = true;
    bar(null);
    render();
    dlg.showModal();
  };
})();
