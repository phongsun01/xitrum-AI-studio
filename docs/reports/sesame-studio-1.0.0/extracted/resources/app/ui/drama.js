(function () {
  const DC = window.DramaCompiler;
  if (!DC) return;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let lastCompiled = null;
  let lastSpec = null;

  function sampleSpec() {
    if (window.SAMPLE_SPEC) return JSON.parse(JSON.stringify(window.SAMPLE_SPEC));
    return {
      title: 'Khế Ước Linh Phù — Tập 1',
      genre: 'hidden_identity',
      audio: 'narration',
      style: 'màu phim điện ảnh ấm pha xanh lục cổ trang, sương đêm mỏng, ánh sáng đèn lồng vàng dịu từ bên trái',
      characters: [
        { id: 'lp', name: 'Linh Phù', look: 'thiếu nữ 20 tuổi, gương mặt thanh tú, tóc đen dài búi nửa cài trâm gỗ mộc, mặc áo giao lĩnh màu xanh ngọc nhạt khoác ngoài váy trắng ngà, đeo túi gấm nhỏ bên hông', height_cm: 162 },
        { id: 'oh', name: 'Ông Hạ', look: 'lão nhân 65 tuổi, râu tóc bạc dài búi gọn, gương mặt góc cạnh nhiều nếp nhăn, mặc áo bào vải thô màu nâu sẫm, tay trái đeo chuỗi hạt gỗ mun', height_cm: 172 }
      ],
      shots: [
        {
          id: 1, seconds: 6,
          purpose: 'Người xem thấy ngay Ông Hạ đang giữ thứ Linh Phù cần và ra điều kiện',
          hook: 'Ông Hạ đặt tấm linh phù phát sáng nhẹ xuống mặt bàn gỗ ngay trước mặt Linh Phù',
          state_change: 'power',
          setting: 'hiên gỗ cổ trang ban đêm, đèn lồng treo dưới mái hiên, bàn trà gỗ thấp ở giữa, sương mỏng phía sân sau',
          cast: ['lp', 'oh'],
          layout: {
            lp: { side: 'left', facing: 'right', gaze: 'oh', why: 'chờ câu trả lời của Ông Hạ về điều kiện trao linh phù' },
            oh: { side: 'right', facing: 'left', gaze: 'lp', why: 'dò xét quyết tâm của Linh Phù' }
          },
          director: {
            wants: { lp: 'lấy lại tấm linh phù của sư phụ', oh: 'buộc Linh Phù nhận lời thề giữ bí mật' },
            winner: 'oh', frame_favors: 'oh',
            frame_note: 'Ông Hạ ngồi cao hơn nửa đầu bên phải bàn trà, tay đặt lên linh phù ở trung tâm khung hình'
          },
          camera: { size: 'medium', move: 'static' },
          beats: [
            { from: 0, to: 3, action: 'Ông Hạ đặt tấm linh phù giấy vàng xuống mặt bàn gỗ, hai ngón tay vẫn giữ trên mép giấy; Linh Phù dừng bước cách bàn một bước', emotion: { lp: { label: 'môi khép chặt, ánh mắt nhìn thẳng vào tấm linh phù trên bàn', level: 2, because: 'nhận ra vật của sư phụ' }, oh: { label: 'khóe mắt nheo nhẹ, cằm hơi nâng lên nhìn Linh Phù', level: 2, because: 'nắm thế chủ động' } } },
            { from: 3, to: 6, action: 'Linh Phù bước nửa bước tới gần bàn, tay phải đưa nhẹ ra phía trước rồi dừng lại khi Ông Hạ giữ chặt linh phù', emotion: { lp: { label: 'đôi mày nhíu nhẹ, bàn tay khựng lại trên không', level: 3, because: 'bị chặn lại trước mặt' }, oh: { label: 'môi mím thành đường thẳng, ánh mắt nhìn thẳng không chớp', level: 2, because: 'ra hiệu chưa đến lúc trao' } } }
          ],
          final_frame: 'Ông Hạ giữ tay trên tấm linh phù giữa bàn, Linh Phù đứng đối diện bên trái, hai người nhìn nhau qua ánh đèn lồng',
          narration: 'Tấm linh phù nằm ngay trước mắt, nhưng cái giá để chạm vào nó là cả lời thề mười năm.'
        },
        {
          id: 2, seconds: 6,
          purpose: 'Linh Phù chấp nhận đánh đổi để xoay chuyển thế cờ',
          state_change: 'relation',
          setting: 'hiên gỗ cổ trang ban đêm, đèn lồng treo dưới mái hiên, bàn trà gỗ thấp ở giữa, sương mỏng phía sân sau',
          cast: ['lp', 'oh'],
          layout: {
            lp: { side: 'left', facing: 'right', gaze: 'oh', why: 'đưa tín vật để chứng minh quyết tâm' },
            oh: { side: 'right', facing: 'left', gaze: 'lp', why: 'bất ngờ trước tín vật Linh Phù lấy ra' }
          },
          director: {
            wants: { lp: 'buộc Ông Hạ buông tay khỏi linh phù', oh: 'xác nhận thân phận thật của Linh Phù' },
            winner: 'lp', frame_favors: 'lp',
            frame_note: 'máy đẩy gần về phía Linh Phù bên trái khi cô đặt ngọc bội lên bàn cạnh linh phù'
          },
          camera: { size: 'close', move: 'push-in' },
          beats: [
            { from: 0, to: 3, action: 'Linh Phù mở túi gấm bên hông, lấy miếng ngọc bội trắng đặt xuống mặt bàn ngay sát tấm linh phù', emotion: { lp: { label: 'ánh mắt sáng và kiên định nhìn thẳng Ông Hạ, cằm nâng nhẹ', level: 2, because: 'đưa ra bằng chứng thân phận' }, oh: { label: 'đôi mắt mở rộng nhẹ nhìn xuống miếng ngọc bội, ngón tay hơi nới khỏi linh phù', level: 2, because: 'nhận ra ngọc bội của cố nhân' } } },
            { from: 3, to: 6, action: 'Ông Hạ chậm rãi rút tay về phía mình; Linh Phù đặt bàn tay lên tấm linh phù trên mặt bàn', emotion: { lp: { label: 'hơi thở lắng xuống, ánh mắt dịu lại nhưng vẫn trang nghiêm', level: 1, because: 'đã chạm được vật cần tìm' }, oh: { label: 'đầu khẽ gật nhẹ, ánh mắt trầm tĩnh nhìn Linh Phù', level: 1, because: 'chấp thuận giao ước' } } }
          ],
          final_frame: 'Bàn tay Linh Phù đặt trên tấm linh phù cạnh miếng ngọc bội dưới ánh đèn lồng ấm, Ông Hạ ngồi trầm mặc phía đối diện',
          narration: 'Khoảnh khắc miếng ngọc bội chạm mặt bàn, người giữ cửa năm xưa đã biết mình không thể cản bước nàng.'
        }
      ]
    };
  }

  function currentCompileOpts(library) {
    const ivsEl = $('drama-ivs');
    const pipeEl = $('drama-v51-pipe');
    const audioEl = $('drama-audio');
    return {
      library: library || [],
      ivs: ivsEl ? ivsEl.checked : false,
      v51Format: (pipeEl && pipeEl.checked) ? 'pipe' : 'multiline',
      audioMode: (audioEl && audioEl.value === 'mode_b') ? 'B' : 'A',
      speakerFirewall: true
    };
  }

  async function render() {
    const raw = ($('drama-json')?.value || '').trim();
    const report = $('drama-report');
    const cards = $('drama-cards');
    const status = $('drama-status');
    const qBtn = $('btn-drama-queue');
    if (!raw) {
      if (report) report.innerHTML = '';
      if (cards) cards.innerHTML = '';
      if (status) status.textContent = 'Chưa có spec JSON.';
      if (qBtn) qBtn.disabled = true;
      lastCompiled = null;
      lastSpec = null;
      return;
    }
    let spec;
    try { spec = JSON.parse(raw); }
    catch (e) {
      if (report) report.innerHTML = `<div class="card" style="border-color:var(--danger);padding:10px;"><b>❌ JSON không hợp lệ:</b> ${esc(e.message)}</div>`;
      if (cards) cards.innerHTML = '';
      if (status) status.textContent = 'JSON lỗi cú pháp.';
      if (qBtn) qBtn.disabled = true;
      lastCompiled = null;
      lastSpec = null;
      return;
    }

    // Đồng bộ tuỳ chọn V5.1 từ giao diện vào spec nếu người dùng bật/chọn
    const ivsEl = $('drama-ivs');
    const audioEl = $('drama-audio');
    const genreEl = $('drama-genre');
    if (ivsEl && spec.ivs === undefined) spec.ivs = ivsEl.checked;
    else if (ivsEl && ivsEl.checked) spec.ivs = true;
    if (audioEl && audioEl.value && (!spec.audio || spec.audio === 'mode_b' || audioEl.value === 'mode_b')) {
      spec.audio = audioEl.value;
    }
    if (genreEl && genreEl.value && !spec.genre) spec.genre = genreEl.value;

    const library = await (window.sesame?.listCharacters ? window.sesame.listCharacters() : Promise.resolve([]));
    const opts = currentCompileOpts(library);
    const res = DC.compile(spec, opts);
    lastCompiled = res;
    lastSpec = spec;

    const pills = [];
    res.errors.forEach(x => pills.push(`<div style="color:var(--danger);font-size:12px;">⛔ <b>${esc(x.where)}:</b> ${esc(x.msg)}</div>`));
    res.warnings.forEach(x => pills.push(`<div style="color:var(--warning, #d97706);font-size:12px;">⚠️ <b>${esc(x.where)}:</b> ${esc(x.msg)}</div>`));
    if (report) {
      const genreInfo = res.genre ? ` · Thể loại: <b>${esc(res.genre.label || res.genre.name)}</b>` : '';
      const v51Badges = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
        <span class="badge" style="background:rgba(16,185,129,0.14);color:#10b981;border:1px solid rgba(16,185,129,0.3);padding:2px 8px;border-radius:999px;font-size:11px;">✓ Chuẩn Muse V5.1</span>
        ${opts.ivs || spec.ivs ? '<span class="badge" style="background:rgba(6,182,212,0.14);color:#06b6d4;border:1px solid rgba(6,182,212,0.3);padding:2px 8px;border-radius:999px;font-size:11px;">🛡️ IVS Chống trôi mặt 100%</span>' : ''}
        <span class="badge" style="background:rgba(139,92,246,0.14);color:#8b5cf6;border:1px solid rgba(139,92,246,0.3);padding:2px 8px;border-radius:999px;font-size:11px;">🔥 Speaker Firewall (NARRATOR_001 / VOICE_001)</span>
        <span class="badge" style="background:rgba(245,158,11,0.14);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);padding:2px 8px;border-radius:999px;font-size:11px;">${spec.audio === 'mode_b' ? '🔇 Audio Mode B (Hình sạch + TTS Hậu kỳ)' : '🎙️ Audio Mode: ' + esc(spec.audio)}</span>
      </div>`;
      report.innerHTML = pills.length
        ? `<div class="card" style="padding:10px;display:flex;flex-direction:column;gap:4px;">${v51Badges}${pills.join('')}</div>`
        : `<div class="card" style="padding:10px;color:var(--success, #16a34a);font-size:12px;">✅ Hợp lệ toàn bộ — tất cả quy tắc CẤU TRÚC đều đạt${genreInfo}.${v51Badges}</div>`;
    }

    if (!res.ok) {
      if (status) status.textContent = `${res.errors.length} lỗi chặn gen · ${res.warnings.length} lưu ý — sửa lỗi màu đỏ trước khi gửi Muse.`;
      if (cards) cards.innerHTML = '';
      if (qBtn) qBtn.disabled = true;
      return;
    }

    if (status) status.textContent = `Đạt · ${res.shots.length} shot · tổng ${res.stats.seconds}s · ${res.warnings.length} lưu ý`;
    if (qBtn) qBtn.disabled = false;
    if (cards) {
      cards.innerHTML = res.shots.map((c, i) => {
        const sh = spec.shots[i];
        const refTag = c.ivs
          ? `<span style="color:#06b6d4;">🛡️ IVS Cảnh độc lập (Không ép khóa mặt liên cảnh)</span>`
          : (c.refs.length
            ? `Ảnh nhân vật gắn kèm: ${c.refs.map(r => `<b>${esc(r.name)}</b> (${r.images.length})`).join(', ')}`
            : '<i>Chưa có ảnh tham chiếu trong Tư liệu</i>');
        const fwLines = (c.postproduction_audio || []).map(seg =>
          `<div style="font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--text-secondary,#64748b);">${esc(seg.lineFormatted)}</div>`
        ).join('');
        return `<div class="card" style="padding:10px;display:flex;flex-direction:column;gap:6px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
            <b>Shot ${i + 1} · ${c.seconds}s · ${esc(sh.camera?.size || 'medium')} / ${esc(sh.camera?.move || 'static')} · Δ ${esc(sh.state_change || '')}</b>
            <span class="muted small">${refTag}</span>
          </div>
          ${sh.purpose ? `<div class="small">🎯 <i>${esc(sh.purpose)}</i></div>` : ''}
          ${c.narration ? `<div class="small">🎙️ Lời bình (NARRATOR_001 off-screen): "${esc(c.narration)}"</div>` : ''}
          ${fwLines ? `<div style="background:rgba(15,23,42,0.04);border-left:3px solid #06b6d4;padding:6px 8px;border-radius:4px;"><b style="font-size:11px;">🧱 Bức tường lửa giọng nói &amp; Hậu kỳ (Speaker Firewall Timeline):</b>${fwLines}</div>` : ''}
          <details open><summary class="small muted" style="cursor:pointer;">Xem prompt gửi sang Muse (${opts.v51Format === 'pipe' ? 'Chuẩn Pipe đơn dòng' : 'Chuẩn Điện ảnh V5.1'})</summary>
            <pre style="white-space:pre-wrap;font-size:11.5px;margin:6px 0 0;padding:8px;background:var(--surface-2,rgba(0,0,0,.04));border-radius:6px;">${esc(c.prompt)}</pre>
          </details>
          ${opts.v51Format !== 'pipe' && c.v51Prompt ? `<details><summary class="small muted" style="cursor:pointer;">⚡ Xem bản Prompt Pipe đơn dòng (PROMPT ${String(i + 1).padStart(3, '0')} | SCENE | VISUAL | FIREWALL | NEGATIVE)</summary>
            <pre style="white-space:pre-wrap;font-size:11px;margin:6px 0 0;padding:8px;background:var(--surface-2,rgba(0,0,0,.04));border-radius:6px;">${esc(c.v51Prompt)}</pre>
          </details>` : ''}
        </div>`;
      }).join('');
    }
  }

  function bind() {
    $('btn-drama-check')?.addEventListener('click', render);
    $('drama-ivs')?.addEventListener('change', render);
    $('drama-v51-pipe')?.addEventListener('change', render);
    $('drama-audio')?.addEventListener('change', render);
    $('drama-genre')?.addEventListener('change', () => {
      if ($('drama-json')?.value.trim()) render();
    });

    $('btn-drama-genre-tpl')?.addEventListener('click', () => {
      const gid = $('drama-genre')?.value || 'ceo';
      const audio = $('drama-audio')?.value || 'mode_b';
      const ivs = $('drama-ivs') ? $('drama-ivs').checked : true;
      const g = DC.genreFor(gid);
      const tpl = DC.generateGenreTemplate(gid, { audio, ivs });
      if ($('drama-story') && g && g.sampleStory) {
        $('drama-story').value = g.sampleStory;
      }
      if ($('drama-json')) {
        $('drama-json').value = JSON.stringify(tpl, null, 2);
      }
      render();
    });

    $('btn-drama-sample')?.addEventListener('click', () => {
      const s = sampleSpec();
      if ($('drama-audio')) $('drama-audio').value = s.audio;
      if ($('drama-genre') && s.genre) $('drama-genre').value = s.genre;
      if ($('drama-json')) $('drama-json').value = JSON.stringify(s, null, 2);
      render();
    });

    $('btn-drama-copy-prompt')?.addEventListener('click', async () => {
      const story = ($('drama-story')?.value || '').trim() || '(Dán đoạn truyện của bạn vào đây)';
      const audio = $('drama-audio')?.value || 'mode_b';
      const genre = $('drama-genre')?.value || 'ceo';
      const ivs = $('drama-ivs') ? $('drama-ivs').checked : true;
      const text = DC.directorPrompt(story, { audio, genre, ivs, shots: 4 });
      try {
        await navigator.clipboard.writeText(text);
        if ($('drama-status')) $('drama-status').textContent = '📋 Đã copy lệnh Đạo diễn vào clipboard — dán sang ChatGPT / Claude để lấy JSON.';
      } catch (e) {
        if ($('drama-json')) $('drama-json').value = text;
        if ($('drama-status')) $('drama-status').textContent = 'Đã đổ lệnh Đạo diễn vào ô bên dưới — hãy copy.';
      }
    });

    $('btn-drama-queue')?.addEventListener('click', () => {
      if (!lastCompiled || !lastCompiled.ok) return;
      if (typeof window.enqueueDramaShots === 'function') {
        window.enqueueDramaShots(lastSpec, lastCompiled.shots);
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
