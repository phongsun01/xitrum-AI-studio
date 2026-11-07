'use strict';
/* TAB EDIT / GHÉP VIDEO — làm việc theo dự án (danh sách dự án + trình soạn timeline).
   Mọi thao tác gọi engine thật qua window.sesame.edit* ; không có nút giả. */
(function () {
  const api = window.sesame;
  const root = document.getElementById('tab-edit');
  if (!root || !api || !api.editList) return;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const baseName = p => String(p || '').split(/[\\/]/).pop();
  const fileUrl = p => p ? 'file:///' + String(p).replace(/\\/g, '/').replace(/^\/+/, '') : '';
  const fmt = s => { s = Math.max(0, Number(s) || 0); const m = Math.floor(s / 60); return String(m).padStart(2, '0') + ':' + (s % 60).toFixed(1).padStart(4, '0'); };
  const toast = (m, k) => { try { window.App && window.App.toast && window.App.toast(m, k || 'ok'); } catch (_) {} };
  const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const clipLen = c => Math.max(0, (c.out - c.in) / Math.min(4, Math.max(0.25, Number(c.speed) || 1)));
  // Tổng thời lượng = tổng clip trừ phần chồng của chuyển cảnh (cùng công thức với engine: bị chặn ≤ 90% clip ngắn hơn trong cặp).
  const transOf = i => {
    if (!P || i <= 0) return 0;
    const t = P.clips[i].transition; if (!t || !t.type || t.type === 'none') return 0;
    const d = Number(t.dur) || 0; if (d <= 0) return 0;
    return Math.max(0, Math.min(d, 0.9 * Math.min(clipLen(P.clips[i - 1]), clipLen(P.clips[i]))));
  };
  const total = () => P ? Math.max(0, P.clips.reduce((s, c, i) => s + clipLen(c) - transOf(i), 0)) : 0;

  let P = null;            // dự án đang mở
  let dirty = false;
  let sel = -1;            // chỉ số clip đang chọn
  let pxPerSec = 22;
  let busy = false;
  let mediaPool = [];      // thumbnail trong cột Tệp phương tiện (probe info)

  /* ---------- CSS riêng ---------- */
  const css = document.createElement('style');
  css.textContent = `
  #tab-edit .ed-wrap{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--canvas);color:var(--ink)}
  #tab-edit .ed-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 16px;background:var(--surface);border-bottom:1px solid var(--line);flex-shrink:0}
  #tab-edit .ed-title{font-size:16px;font-weight:800}
  #tab-edit .ed-sub{font-size:12px;color:var(--ink-3)}
  #tab-edit .ed-btn{border:1px solid var(--line-2);background:var(--surface);color:var(--ink);border-radius:999px;padding:6px 14px;font-size:12.5px;font-weight:600;cursor:pointer}
  #tab-edit .ed-btn:hover{border-color:var(--blue-2);color:var(--blue)}
  #tab-edit .ed-btn.pri{background:var(--grad);color:#fff;border-color:transparent}
  #tab-edit .ed-btn.danger:hover{border-color:#ef4444;color:#ef4444}
  #tab-edit .ed-btn:disabled{opacity:.5;cursor:default}
  #tab-edit .ed-grow{flex:1}
  #tab-edit .ed-listpage{flex:1;min-height:0;overflow:auto;padding:14px 20px 24px;display:flex;flex-direction:column;gap:14px}
  #tab-edit .ed-banner{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;min-height:82px;border:1.5px solid var(--blue-2);border-radius:20px;background:linear-gradient(180deg,var(--surface),var(--soft));color:var(--ink);font-size:17px;cursor:pointer;flex-shrink:0}
  #tab-edit .ed-banner:hover{box-shadow:0 4px 18px rgba(0,0,0,.08)}
  #tab-edit .ed-plus{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:1.5px solid var(--blue-2);border-radius:8px;color:var(--blue-2);font-size:20px;line-height:1}
  #tab-edit .ed-quick{display:flex;justify-content:center;gap:12px;flex-wrap:wrap}
  #tab-edit .ed-btn.o-blue{border-color:#7fa6e0;background:#eaf2fd;color:#1f4f9e}
  #tab-edit .ed-btn.o-teal{border-color:#6bb7b0;background:#e6f6f4;color:#0f6b66}
  #tab-edit .ed-btn.o-red{border-color:#e7a4a4;color:#c0392b;background:var(--surface)}
  #tab-edit .ed-listhead{display:flex;align-items:center;gap:10px;margin-top:6px}
  #tab-edit .ed-listhead h3{margin:0;font-size:18px;font-weight:800}
  #tab-edit .ed-list{display:flex;flex-wrap:wrap;gap:18px;align-content:flex-start}
  #tab-edit .ed-card{width:176px;cursor:pointer;display:flex;flex-direction:column;gap:4px}
  #tab-edit .ed-cover{position:relative;width:176px;height:92px;border-radius:10px;overflow:hidden;background:#0b1220 center/cover no-repeat}
  #tab-edit .ed-cover.empty{background:transparent;display:flex;align-items:center;justify-content:center}
  #tab-edit .ed-cover.empty i{font-style:normal;color:#e48a8a;border:1.5px solid #e48a8a;border-radius:6px;padding:2px 8px;font-size:12px}
  #tab-edit .ed-x{position:absolute;right:4px;top:3px;border:0;background:none;color:#e5484d;font-size:16px;font-weight:900;cursor:pointer;text-shadow:0 0 3px #fff}
  #tab-edit .ed-card:hover .ed-cname{color:var(--blue)}
  #tab-edit .ed-cname{font-weight:800;font-size:13px;margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #tab-edit .ed-cmeta{display:flex;justify-content:space-between;font-size:12px;color:var(--ink-3)}
  #tab-edit .ed-main{flex:1;min-height:0;display:grid;grid-template-columns:300px 1fr;gap:0}
  #tab-edit .ed-left{border-right:1px solid var(--line);overflow:auto;padding:10px;display:flex;flex-direction:column;gap:10px;background:var(--surface)}
  #tab-edit .ed-box{border:1px solid var(--line);border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:8px}
  #tab-edit .ed-box h4{margin:0;font-size:13px}
  #tab-edit .ed-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  #tab-edit .ed-row label{font-size:12px;color:var(--ink-2)}
  #tab-edit input[type=text],#tab-edit input[type=number],#tab-edit select{border:1px solid var(--line-2);background:var(--canvas);color:var(--ink);border-radius:8px;padding:4px 8px;font-size:12.5px;min-width:0}
  #tab-edit input[type=range]{accent-color:var(--blue-2);flex:1;min-width:60px}
  #tab-edit .ed-thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(86px,1fr));gap:8px;max-height:230px;overflow:auto}
  #tab-edit .ed-th{position:relative;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:#0b1220;cursor:grab}
  #tab-edit .ed-th video{width:100%;height:96px;object-fit:cover;display:block;pointer-events:none}
  #tab-edit .ed-th .nm{font-size:10px;padding:2px 4px;background:var(--surface);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #tab-edit .ed-th button{position:absolute;right:3px;top:3px;width:22px;height:22px;border-radius:50%;border:0;background:var(--blue-2);color:#fff;font-weight:800;cursor:pointer}
  #tab-edit .ed-right{display:flex;flex-direction:column;min-width:0;min-height:0}
  #tab-edit .ed-stage{flex:1;min-height:160px;background:#000;display:flex;align-items:center;justify-content:center;position:relative}
  #tab-edit .ed-stage video{max-width:100%;max-height:100%}
  #tab-edit .ed-ctrl{display:flex;align-items:center;gap:10px;padding:6px 12px;background:var(--surface);border-top:1px solid var(--line);flex-wrap:wrap}
  #tab-edit .ed-tl{background:var(--surface);border-top:1px solid var(--line);padding:6px 12px 10px;overflow-x:auto;overflow-y:hidden;flex-shrink:0}
  #tab-edit .ed-ruler{position:relative;height:18px;font-size:10px;color:var(--ink-3)}
  #tab-edit .ed-ruler i{position:absolute;top:0;border-left:1px solid var(--line-2);padding-left:3px;height:18px}
  #tab-edit .ed-track{position:relative;display:flex;height:64px;gap:2px;align-items:stretch;min-width:100%}
  #tab-edit .ed-clip{position:relative;border:2px solid var(--line-2);border-radius:8px;background:linear-gradient(135deg,#0e7490,#0b4f63);color:#fff;font-size:11px;padding:4px 6px;overflow:hidden;cursor:pointer;flex:0 0 auto;user-select:none}
  #tab-edit .ed-clip.sel{border-color:#fbbf24;box-shadow:0 0 0 2px rgba(251,191,36,.35)}
  #tab-edit .ed-clip.over{outline:2px dashed #fbbf24}
  #tab-edit .ed-clip b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #tab-edit .ed-clip small{opacity:.85}
  #tab-edit .ed-hint{font-size:11px;color:var(--ink-3)}
  #tab-edit .ed-prop{display:flex;gap:10px;flex-wrap:wrap;align-items:center;padding:6px 12px;background:var(--soft);border-top:1px solid var(--line);font-size:12px}
  #tab-edit .ed-prop label{display:flex;align-items:center;gap:4px}
  #tab-edit .ed-prop input[type=number]{width:70px}
  #tab-edit .ed-foot{display:flex;align-items:center;gap:10px;padding:8px 16px;background:var(--surface);border-top:1px solid var(--line);flex-shrink:0;font-size:12.5px}
  #tab-edit .ed-bar{height:6px;background:var(--line);border-radius:4px;overflow:hidden;flex:1;max-width:320px}
  #tab-edit .ed-bar i{display:block;height:100%;width:0;background:var(--grad)}
  #tab-edit .ed-txt{display:grid;grid-template-columns:1fr auto;gap:4px;border:1px solid var(--line);border-radius:8px;padding:6px}
  #tab-edit .ed-txt .ed-row{grid-column:1/3}
  #tab-edit dialog{border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--ink);padding:14px;max-width:520px;width:90%}
  #tab-edit .ed-lib{max-height:50vh;overflow:auto;display:flex;flex-direction:column;gap:4px;margin:8px 0}
  #tab-edit .ed-lib label{display:flex;gap:8px;align-items:center;font-size:12.5px;padding:3px 4px;border-radius:6px}
  #tab-edit .ed-tools{display:flex;gap:2px;align-items:center;padding:4px 10px;background:var(--surface);border-bottom:1px solid var(--line);overflow-x:auto;flex-shrink:0}
  #tab-edit .ed-tool{display:flex;flex-direction:column;align-items:center;gap:1px;border:0;background:none;color:var(--ink-2);font-size:11px;font-weight:600;padding:3px 10px;border-radius:8px;cursor:pointer;white-space:nowrap}
  #tab-edit .ed-tool span{font-size:16px;line-height:18px}
  #tab-edit .ed-tool:hover{background:var(--blue-tint);color:var(--blue)}
  #tab-edit .ed-mix{display:flex;align-items:center;gap:10px;padding:5px 12px;background:var(--surface);border-top:1px solid var(--line);flex-wrap:wrap;font-size:12px;flex-shrink:0}
  #tab-edit .ed-mix input[type=range]{max-width:140px}
  #tab-edit .ed-dfoot{display:flex;justify-content:flex-end;margin-top:12px}
  #tab-edit dialog h3{margin:0 0 10px;font-size:15px}
  #tab-edit dialog::backdrop{background:rgba(0,0,0,.45)}

  /* ===== bố cục màn soạn ===== */
  #tab-edit .ed-top{background:transparent;border:0;padding:12px 22px 6px;gap:12px}
  #tab-edit .ed-title{font-size:21px}
  #tab-edit .ed-nameinp{border:0!important;border-bottom:1px dashed var(--line-2)!important;background:transparent!important;border-radius:0!important;font:inherit;color:var(--ink);width:150px;padding:0 2px!important}
  #tab-edit .ed-main{grid-template-columns:320px 1fr;gap:12px;padding:6px 14px 8px}
  #tab-edit .ed-left{background:transparent;border-right:0;padding:0 2px 0 0;gap:12px}
  #tab-edit .ed-box{background:var(--surface);border-radius:18px;padding:14px 16px;gap:10px}
  #tab-edit .ed-box h4{font-size:14px;display:flex;align-items:center;gap:8px}
  #tab-edit .ed-bi{font-style:normal;color:var(--blue-2)}
  #tab-edit .ed-btn.o-blue{border-color:#7fa6e0;background:#eaf2fd;color:#1f4f9e}
  #tab-edit .ed-btn.o-teal{border-color:#6bb7b0;background:#e6f6f4;color:#0f6b66}
  #tab-edit .ed-btn.o-gold{border-color:#d3b27a;background:#fbf3e4;color:#8a5a12}
  #tab-edit .ed-btn.o-dark{border:1.5px solid #1e3a5f;color:#1e3a5f;background:var(--surface);padding:8px 26px}
  #tab-edit .ed-btn.pri{padding:8px 24px}
  #tab-edit .ed-thumbs{grid-template-columns:repeat(auto-fill,minmax(64px,64px));max-height:260px}
  #tab-edit .ed-th{border-radius:10px;border:0;width:64px}
  #tab-edit .ed-th video{height:104px}
  #tab-edit .ed-th .nm{display:none}
  #tab-edit .ed-th button{right:auto;left:auto;top:auto;bottom:4px;right:4px;background:#0f766e}
  #tab-edit .ed-right{gap:8px}
  #tab-edit .ed-tools{background:transparent;border:0;padding:0;gap:8px;overflow:visible;flex-wrap:wrap}
  #tab-edit .ed-round{display:flex;gap:6px;padding:4px 8px;border:1px solid var(--line-2);border-radius:999px;background:var(--surface)}
  #tab-edit .ed-rb{width:32px;height:32px;border-radius:50%;border:1.5px solid var(--line-2);background:var(--surface);color:var(--ink-2);font-size:15px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
  #tab-edit .ed-rb:hover:not(:disabled),#tab-edit .ed-rb.on{border-color:var(--blue-2);color:var(--blue);background:var(--blue-tint)}
  #tab-edit .ed-rb:disabled{opacity:.42;cursor:not-allowed}
  #tab-edit .ed-pill{border:1.5px solid #e29bb6;color:#b83b6c;background:#fdeef4;border-radius:999px;padding:6px 16px;font-weight:700;font-size:12.5px}
  #tab-edit .ed-pill:disabled{opacity:.5;cursor:not-allowed}
  #tab-edit .ed-tool.on{background:var(--blue-tint);color:var(--blue);box-shadow:0 0 0 1.5px var(--blue-2) inset}
  #tab-edit .ed-stagewrap{position:relative;flex:1;min-height:200px;display:flex}
  #tab-edit .ed-stagewrap .ed-stage{flex:1;border-radius:16px;overflow:hidden;min-height:0}
  #tab-edit .ed-empty{position:absolute;inset:0;background:var(--surface);border:1px solid var(--line);border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;z-index:1}
  #tab-edit .ed-empty[hidden]{display:none}
  #tab-edit .ed-empty h3{margin:0;font-size:22px}
  #tab-edit .ed-camera{font-size:44px;color:var(--blue-2);line-height:1}
  #tab-edit dialog.ed-panel{position:absolute;top:6px;right:6px;bottom:auto;left:auto;margin:0;width:min(400px,52%);max-width:none;height:auto;max-height:min(560px,calc(100vh - 230px));overflow:auto;z-index:5;box-shadow:0 8px 28px rgba(0,0,0,.28);border-radius:16px;padding:16px 18px}
  #tab-edit dialog.ed-panel:not([open]){display:none}
  #tab-edit .ed-lock{background:#fff7e6;border:1px solid #f0d79a;color:#7a5a12;border-radius:10px;padding:8px 10px;font-size:12.5px;margin-bottom:8px}
  #tab-edit .ed-lock[hidden]{display:none}
  #tab-edit .ed-ctrl{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;border:0;background:transparent;padding:0 6px}
  #tab-edit .ed-ctrl #ed-time{font-weight:700;color:var(--ink)}
  #tab-edit .ed-ctrl #ed-full{justify-self:end}
  #tab-edit .ed-playcluster{display:flex;align-items:center;gap:16px}
  #tab-edit .ed-play{width:34px;height:34px;border:0;background:none;color:#c2410c;font-size:22px;cursor:pointer}
  #tab-edit .ed-ib{min-width:30px;height:30px;border:0;background:transparent;color:var(--ink-2);font-size:16px;border-radius:8px;cursor:pointer;padding:0 6px}
  #tab-edit .ed-ib:hover{background:var(--blue-tint);color:var(--blue)}
  #tab-edit .ed-tlbar{display:flex;align-items:center;gap:2px;padding:0 4px;flex-wrap:nowrap;overflow-x:auto}
  #tab-edit .ed-tl{background:var(--soft);border:0;border-radius:12px;padding:4px 8px}
  #tab-edit .ed-trackrow{display:flex;align-items:stretch;gap:8px}
  #tab-edit .ed-tlabel{width:62px;flex:0 0 62px;display:flex;align-items:center;font-size:12px;font-weight:700;color:var(--ink-2)}
  #tab-edit .ed-track{height:60px;flex:1;gap:0}
  #tab-edit .ed-clip{border-radius:6px;border:2px solid transparent;padding:0;background:#16323a}
  #tab-edit .ed-clip.sel{border-color:#0f766e;box-shadow:none}
  #tab-edit .ed-film{position:absolute;inset:0;display:flex}
  #tab-edit .ed-film video.fs{height:100%;object-fit:cover;pointer-events:none;flex:0 0 auto}
  #tab-edit .ed-clip b,#tab-edit .ed-clip small{position:relative;z-index:1;padding:0 6px;text-shadow:0 1px 2px #000}
  #tab-edit .ed-clip b{padding-top:3px;font-size:10.5px}
  #tab-edit .ed-mix{background:transparent;border:0;padding:2px 6px}
  #tab-edit .ed-apply{border:1.5px solid var(--line-2);border-radius:999px;background:var(--surface);color:var(--blue);font-weight:800;font-size:13px;padding:9px 24px;cursor:pointer}
  #tab-edit .ed-apply:not(:disabled){border-color:var(--blue-2);box-shadow:0 1px 6px rgba(0,0,0,.08)}
  #tab-edit .ed-apply:disabled{color:var(--ink-3);cursor:not-allowed;opacity:.65}
  #tab-edit .ed-foot{background:var(--surface);border-top:1px solid var(--line);padding:10px 22px}
  #tab-edit .ed-statusg{color:#1a7f37;font-weight:600;flex:1}
  #tab-edit .ed-prop{background:transparent;border:0;padding:2px 6px}

  /* ===== sóng âm trên clip ===== */
  #tab-edit .ed-wave{position:absolute;left:0;right:0;bottom:0;height:34%;display:flex;align-items:flex-end;gap:1px;padding:0 2px;background:rgba(0,0,0,.35);pointer-events:none}
  #tab-edit .ed-wave i{flex:1;background:#34d399;opacity:.9;border-radius:1px 1px 0 0;min-width:1px}
  #tab-edit .ed-wave.flat{background:rgba(0,0,0,.45);border-top:1px dashed rgba(255,255,255,.35)}
  /* ===== co giãn chiều cao: video nhận phần còn lại, các hàng còn lại không bị co ===== */
  #tab-edit .ed-wrap{overflow:hidden}
  #tab-edit .ed-main{min-height:0;overflow:hidden}
  #tab-edit .ed-right{min-height:0;overflow:hidden}
  #tab-edit .ed-stagewrap{flex:1 1 0;min-height:110px}
  #tab-edit .ed-tools,#tab-edit .ed-ctrl,#tab-edit .ed-prop,#tab-edit .ed-tlbar,#tab-edit .ed-tl,#tab-edit .ed-mix{flex:0 0 auto}
  #tab-edit .ed-main{grid-template-columns:290px minmax(0,1fr)}
  #tab-edit .ed-tools{gap:6px;row-gap:2px}
  #tab-edit .ed-round{gap:3px;padding:3px 6px}
  #tab-edit .ed-rb{width:28px;height:28px;font-size:13px}
  #tab-edit .ed-pill{padding:4px 12px;font-size:12px}
  #tab-edit .ed-tool{padding:2px 7px;font-size:10.5px}
  #tab-edit .ed-tool span{font-size:14px;line-height:15px}
  #tab-edit .ed-prop{flex-wrap:nowrap;overflow-x:auto;font-size:11.5px;gap:6px;white-space:nowrap}
  #tab-edit .ed-prop input[type=number]{width:54px}
  #tab-edit .ed-prop .ed-btn{padding:3px 10px;font-size:11.5px}
  #tab-edit .ed-ctrl{padding-top:0;padding-bottom:0}
  #tab-edit .ed-tlbar{padding-top:0;padding-bottom:0}
  #tab-edit .ed-tl{padding-top:2px;padding-bottom:4px}
  #tab-edit .ed-ruler{height:14px}
  #tab-edit .ed-track{height:52px}
  #tab-edit .ed-foot{padding:6px 22px}
  #tab-edit .ed-thumbs>.ed-hint{grid-column:1/-1}
  #tab-edit .ed-chk{display:flex;align-items:center;gap:6px;font-size:12.5px}
  #tab-edit input[type=color]{width:34px;height:26px;padding:0;border:1px solid var(--line-2);border-radius:6px;background:none}
  #tab-edit .ed-sl{display:flex;align-items:center;gap:6px;margin:3px 0;font-size:12.5px}
  #tab-edit .ed-sl label{width:84px;flex:0 0 auto;color:var(--ink-2)}
  #tab-edit .ed-sl .v{width:30px;text-align:right;color:var(--ink-3);font-variant-numeric:tabular-nums}
  #tab-edit .ed-sl input[type=range]{flex:1;min-width:60px}
  #tab-edit .ed-gh{display:flex;align-items:center;justify-content:space-between;margin:12px 0 2px;font-size:11.5px;color:#9a3412;letter-spacing:.04em}
  #tab-edit dialog.ed-panel h3{font-size:14px}
  @media (max-width:900px){#tab-edit .ed-main{grid-template-columns:1fr}#tab-edit .ed-left{max-height:260px;border-right:0;border-bottom:1px solid var(--line)}}
  `;
  document.head.appendChild(css);

  /* ---------- DANH SÁCH DỰ ÁN ---------- */
  async function showList() {
    P = null; dirty = false; sel = -1;
    root.innerHTML = `<div class="ed-wrap">
      <div class="ed-top"><span class="ed-title">Edit/Ghép video</span><span class="ed-sub">Mở dự án · chỉnh sửa · xuất trực tiếp</span></div>
      <div class="ed-listpage">
        <button class="ed-banner" id="ed-new"><span class="ed-plus">＋</span><b>Tạo dự án</b></button>
        <div class="ed-quick">
          <button class="ed-btn o-blue" id="ed-open-prj">📂 Mở dự án…</button>
          <button class="ed-btn o-teal" id="ed-pick-new">▶ Chọn video để chỉnh sửa</button>
        </div>
        <div class="ed-listhead"><h3 id="ed-count">Dự án</h3><span class="ed-grow"></span><button class="ed-btn o-red" id="ed-delall">🗑 Xóa tất cả</button></div>
        <div class="ed-list" id="ed-list"><div class="ed-hint">Đang tải…</div></div>
      </div>
      <dialog id="ed-opendlg"><h3>Mở dự án</h3><div class="ed-lib" id="ed-openlist"></div><div class="ed-dfoot"><button class="ed-btn" data-close>Đóng</button></div></dialog></div>`;
    root.querySelector('#ed-new').onclick = () => createProject();
    root.querySelector('#ed-pick-new').onclick = async () => {
      const files = await api.pickFiles({ title: 'Chọn video để chỉnh sửa', filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi'] }] });
      if (files && files.length) await createProject(files);
    };
    const list = await api.editList();
    const box = root.querySelector('#ed-list');
    root.querySelector('#ed-count').textContent = 'Dự án (' + list.length + ')';
    const mmss = s => { s = Math.max(0, Math.round(Number(s) || 0)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
    const mb = b => ((Number(b) || 0) / 1048576).toFixed(1) + ' MB';
    if (!list.length) box.innerHTML = '<div class="ed-hint">Chưa có dự án nào. Bấm “＋ Tạo dự án” để bắt đầu.</div>';
    else box.innerHTML = list.map(p => `<div class="ed-card" data-id="${esc(p.id)}">
      <div class="ed-cover${p.cover ? '' : ' empty'}" style="${p.cover ? `background-image:url('${fileUrl(p.cover)}')` : ''}">${p.cover ? '' : '<i>▶</i>'}<button class="ed-x" data-del="${esc(p.id)}" title="Xoá dự án">✕</button></div>
      <div class="ed-cname" title="${esc(p.name)}">${esc(p.name)}</div>
      <div class="ed-cmeta"><span>${mb(p.size)}</span><span>${mmss(p.duration)}</span></div></div>`).join('');
    box.querySelectorAll('.ed-card').forEach(c => c.onclick = e => { if (e.target.closest('[data-del]')) return; openProject(c.dataset.id); });
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('Xoá dự án này? (File video gốc không bị xoá)')) return;
      await api.editDelete(b.dataset.del); toast('Đã xoá dự án', 'warn'); showList();
    });
    root.querySelector('#ed-delall').onclick = async () => {
      if (!list.length) return;
      if (!confirm('Xoá TẤT CẢ ' + list.length + ' dự án? (File video gốc không bị xoá)')) return;
      for (const p of list) await api.editDelete(p.id);
      toast('Đã xoá tất cả dự án', 'warn'); showList();
    };
    const dlg = root.querySelector('#ed-opendlg');
    root.querySelector('#ed-open-prj').onclick = () => {
      root.querySelector('#ed-openlist').innerHTML = list.map(p => `<button class="ed-btn" style="text-align:left;border-radius:10px" data-open="${esc(p.id)}">${esc(p.name)} · ${mmss(p.duration)} · ${p.clips} clip</button>`).join('') || '<div class="ed-hint">Chưa có dự án nào.</div>';
      root.querySelectorAll('#ed-openlist [data-open]').forEach(b => b.onclick = () => { dlg.close(); openProject(b.dataset.open); });
      dlg.showModal();
    };
    root.querySelectorAll('#ed-opendlg [data-close]').forEach(x => x.onclick = () => dlg.close());
  }

  async function createProject(files) {
    const now = new Date(); const p2 = n => String(n).padStart(2, '0');
    const name = 'Dự án ' + p2(now.getMonth() + 1) + p2(now.getDate()) + '-' + p2(now.getHours()) + p2(now.getMinutes());
    const r = await api.editNew(name);
    if (r && r.ok) {
      P = r.project; mediaPool = []; dirty = false; sel = -1; showEditor();
      if (Array.isArray(files) && files.length) await addMedia(files, true);
    }
  }

  async function openProject(id) {
    const r = await api.editLoad(id);
    if (!r || !r.ok) { toast((r && r.error) || 'Không mở được dự án', 'err'); return; }
    P = r.project; dirty = false; sel = P.clips.length ? 0 : -1;
    mediaPool = [];
    showEditor();
    if (r.missing && r.missing.length) toast('Thiếu file nguồn: ' + r.missing.join(', '), 'warn');
  }

  /* ---------- TRÌNH SOẠN ---------- */
  function showEditor() {
    root.innerHTML = `<div class="ed-wrap">
      <div class="ed-top">
        <span class="ed-title">Edit/Ghép video</span>
        <span class="ed-sub">Đang chỉnh: <input type="text" id="ed-name" class="ed-nameinp" title="Tên dự án"> · <span id="ed-lockmsg"></span></span>
      </div>
      <div class="ed-main">
        <div class="ed-left">
          <div class="ed-box"><h4><i class="ed-bi">▭</i>Tệp phương tiện</h4>
            <div class="ed-row"><button class="ed-btn o-blue" id="ed-add">＋ Thêm tệp</button><button class="ed-btn o-blue" id="ed-lib">▣ Kho video</button></div>
            <div class="ed-thumbs" id="ed-thumbs"></div>
            <div class="ed-hint">Kéo thumbnail hoặc dấu + vào hàng Video để chèn đúng vị trí.</div></div>
          <div class="ed-box"><h4><i class="ed-bi">♪</i>Thêm nhạc nền</h4>
            <div class="ed-row"><button class="ed-btn o-blue" id="ed-mus">Thêm âm thanh</button><button class="ed-btn" id="ed-mus-x">✕ Bỏ</button></div>
            <div class="ed-hint" id="ed-mus-n"></div>
            <div class="ed-row"><label>Âm lượng</label><input type="range" id="ed-mv" min="0" max="200"><span id="ed-mv-v" class="ed-hint"></span></div>
            <div class="ed-row"><button class="ed-btn" data-panel="ed-d-aud">♫ Đoạn nhạc theo thời điểm…</button></div></div>
          <div class="ed-box"><h4><i class="ed-bi">🎙</i>Âm thanh lồng tiếng</h4>
            <div class="ed-row"><button class="ed-btn o-blue" id="ed-dub">Thêm giọng lồng</button><button class="ed-btn" id="ed-dub-x">✕ Bỏ</button></div>
            <div class="ed-hint" id="ed-dub-n"></div></div>
        </div>
        <div class="ed-right">
          <div class="ed-tools">
            <div class="ed-round">
              <button class="ed-rb" data-panel="ed-d-wm" title="Logo chèn — chữ / logo chìm">▨</button>
              <button class="ed-rb" id="ed-frame" title="Khung video — tỉ lệ khung khi xuất">▢</button>
              <button class="ed-rb" data-panel="ed-d-ov" title="Lớp phủ — ảnh / video đè lên">❏</button>
              <button class="ed-rb" data-panel="ed-d-mask" title="Che Sub — làm mờ hoặc che vùng phụ đề cũ">☰</button>
            </div>
            <span class="ed-grow"></span>
            <button class="ed-tool" data-panel="ed-d-filter" title="Bộ lọc màu và chuyển cảnh cho clip đang chọn"><span>▣</span>Bộ lọc</button>
            <button class="ed-tool" data-panel="ed-d-sub" title="Phụ đề .srt"><span>✎</span>Phụ đề</button>
            <button class="ed-tool" data-panel="ed-d-text" title="Chữ chèn lên video"><span>TA</span>Text</button>
            <button class="ed-tool" data-panel="ed-d-wm" title="Chữ / logo chìm"><span>⛉</span>Watermark</button>
            <button class="ed-tool" data-panel="ed-d-ov" title="Ảnh / video đè lên"><span>▤</span>Lớp phủ</button>
            <button class="ed-tool" data-panel="ed-d-mask" title="Làm mờ hoặc che vùng phụ đề cũ"><span>▦</span>Che Sub</button>
          </div>
          <div class="ed-stagewrap">
            <div class="ed-stage"><video id="ed-vid"></video>
              <div class="ed-empty" id="ed-empty"><div class="ed-camera">▣</div><h3>Chọn video để bắt đầu</h3>
                <div class="ed-row" style="justify-content:center"><button class="ed-btn o-blue" id="ed-e-pick">▭ Chọn video</button><button class="ed-btn o-gold" id="ed-e-dir">▤ Chọn thư mục</button></div>
                <div class="ed-row" style="justify-content:center"><button class="ed-btn o-teal" id="ed-e-lib">⤓ Kho video</button></div>
                <div class="ed-hint">Chọn nhiều tệp một lượt: tự xếp theo số trong tên (Canh-01, Canh-02…)</div></div>
            </div>
            <dialog id="ed-d-filter" class="ed-panel"><div id="ed-fbody"></div></dialog>
            <dialog id="ed-d-sub" class="ed-panel"><h3>Phụ đề</h3>
              <div class="ed-lock" id="ed-sublock">🔒 Video chưa xử lý nên Phụ đề bị khóa. Bấm “Áp dụng” để xử lý timeline trước.</div>
              <div id="ed-subbody"><div class="ed-row"><button class="ed-btn" id="ed-srt">Chọn file .srt</button><button class="ed-btn" id="ed-srt-x">✕ Bỏ</button></div>
              <div class="ed-hint" id="ed-srt-n"></div></div></dialog>
            <dialog id="ed-d-text" class="ed-panel"><h3>Chữ (Text)</h3><div id="ed-texts" style="display:flex;flex-direction:column;gap:6px"></div>
              <button class="ed-btn" id="ed-addtext">＋ Thêm chữ</button></dialog>
            <dialog id="ed-d-wm" class="ed-panel"><h3>Watermark</h3>
              <label class="ed-chk"><input type="checkbox" id="ed-wmshow"> Hiển thị watermark</label>
              <div class="ed-row"><label>Chữ</label><input type="text" id="ed-wm" style="flex:1" placeholder="Để trống = không có"></div>
              <div class="ed-row"><button class="ed-btn" id="ed-wmimg">Chọn logo (ảnh)</button><button class="ed-btn" id="ed-wmimg-x">✕ Bỏ</button></div>
              <div class="ed-hint" id="ed-wmimg-n"></div>
              <div class="ed-row"><label>Vị trí</label><select id="ed-wmpos"><option value="tl">Trên trái</option><option value="tr">Trên phải</option><option value="bl">Dưới trái</option><option value="br">Dưới phải</option></select></div>
              <div class="ed-row"><label>Font</label><select id="ed-wmfont"><option>Arial</option><option>Segoe UI</option><option>Times New Roman</option><option>Tahoma</option><option>Verdana</option><option>Calibri</option><option>Consolas</option><option>Impact</option></select>
                <label class="ed-chk"><input type="checkbox" id="ed-wmbold"> <b>B</b></label><label class="ed-chk"><input type="checkbox" id="ed-wmital"> <i>I</i></label></div>
              <div class="ed-row"><label>Hiệu ứng chữ</label><select id="ed-wmeff"><option value="none">Không hiệu ứng</option><option value="fade">Mờ dần vào / ra</option><option value="pulse">Nhịp sáng</option><option value="blink">Nhấp nháy</option></select></div>
              <div class="ed-sl"><label>Cỡ chữ</label><input type="range" id="ed-wmsize" min="12" max="120"><span class="v" id="ed-wmsize-v"></span></div>
              <div class="ed-sl"><label>Độ mờ</label><input type="range" id="ed-wmop" min="10" max="100"><span class="v" id="ed-wmop-v"></span></div>
              <div class="ed-row"><label>Màu chữ</label><input type="color" id="ed-wmcol"><label>Màu viền</label><input type="color" id="ed-wmbcol"></div>
              <div class="ed-sl"><label>Viền</label><input type="range" id="ed-wmbw" min="0" max="10"><span class="v" id="ed-wmbw-v"></span></div>
              <div class="ed-sl"><label>Bóng</label><input type="range" id="ed-wmsh" min="0" max="10"><span class="v" id="ed-wmsh-v"></span></div>
              <div class="ed-row"><label class="ed-chk"><input type="checkbox" id="ed-wmbg"> Nền sau chữ</label><input type="color" id="ed-wmbgcol"></div></dialog>
            <dialog id="ed-d-ov" class="ed-panel"><h3>Lớp phủ (ảnh / video đè lên)</h3><div id="ed-ovs" style="display:flex;flex-direction:column;gap:6px"></div>
              <div class="ed-row"><button class="ed-btn" id="ed-ov-img">＋ Ảnh</button><button class="ed-btn" id="ed-ov-vid">＋ Video</button></div></dialog>
            <dialog id="ed-d-mask" class="ed-panel"><h3>Che Sub (làm mờ / hộp màu)</h3><div id="ed-mks" style="display:flex;flex-direction:column;gap:6px"></div>
              <div class="ed-row"><button class="ed-btn" id="ed-mk-add">＋ Thêm vùng che</button><button class="ed-btn" id="ed-mk-cue" title="Tạo một vùng che cho mỗi câu trong file .srt (dùng kiểu/vị trí của vùng đầu tiên)">☷ Che theo từng câu .srt</button></div>
              <div class="ed-hint">“Xoá gần đúng” chỉ vá bằng dải nền bên cạnh, không phải tái tạo nền bằng AI. Chưa có “Bo vùng vẽ”.</div></dialog>
            <dialog id="ed-d-aud" class="ed-panel"><h3>Đoạn nhạc theo thời điểm</h3><div id="ed-segs" style="display:flex;flex-direction:column;gap:6px"></div>
              <button class="ed-btn" id="ed-seg-add">＋ Thêm đoạn nhạc</button></dialog>
          </div>
          <div class="ed-ctrl"><span id="ed-time" class="ed-sub"></span>
            <span class="ed-playcluster"><button class="ed-ib" id="ed-pv" title="Clip trước">‹</button><button class="ed-play" id="ed-play" title="Phát / tạm dừng">▶</button><button class="ed-ib" id="ed-nx" title="Clip sau">›</button></span>
            <button class="ed-ib" id="ed-full" title="Toàn màn hình">⤢</button></div>
          <div class="ed-prop" id="ed-prop"></div>
          <div class="ed-tlbar">
            <button class="ed-ib" id="ed-undo" title="Hoàn tác chỉnh sửa / tách đoạn (Ctrl+Z)">↶</button>
            <button class="ed-ib" id="ed-redo" title="Làm lại chỉnh sửa (Ctrl+Y)">↷</button>
            <button class="ed-ib" data-asp="source" title="Giữ gốc">▭</button>
            <button class="ed-ib" data-asp="16:9" title="Ngang 16:9">▬</button>
            <button class="ed-ib" data-asp="9:16" title="Dọc 9:16">▮</button>
            <button class="ed-ib" data-geo="flipH" title="Lật ngang (clip đang chọn)">⇋</button>
            <button class="ed-ib" data-geo="flipV" title="Lật dọc (clip đang chọn)">⇅</button>
            <button class="ed-ib" data-geo="rot" title="Xoay video 90° (clip đang chọn)">⟳</button>
            <button class="ed-ib" id="ed-split" title="Tách đoạn đang chọn tại vị trí đang xem">✂</button>
            <span class="ed-grow"></span>
            <button class="ed-ib" id="ed-zo" title="Thu nhỏ timeline">−</button><span class="ed-hint" id="ed-zv">1.00×</span><button class="ed-ib" id="ed-zi" title="Phóng to timeline">＋</button>
          </div>
          <div class="ed-tl"><div class="ed-ruler" id="ed-ruler"></div><div class="ed-trackrow"><div class="ed-tlabel">▤ Video</div><div class="ed-track" id="ed-track"></div></div></div>
          <div class="ed-mix">
            <label>Giọng gốc</label><input type="range" id="ed-ov" min="0" max="200"><span id="ed-ov-v" class="ed-hint"></span>
            <label>Giọng lồng</label><input type="range" id="ed-dv" min="0" max="200"><span id="ed-dv-v" class="ed-hint"></span>
            <span class="ed-grow"></span>
            <select id="ed-asp" title="Tỉ lệ khung hình khi xuất"><option value="source">Bản gốc</option><option value="9:16">9:16 dọc</option><option value="16:9">16:9 ngang</option><option value="1:1">1:1 vuông</option></select>
            <button class="ed-apply" id="ed-apply" title="Xử lý toàn bộ timeline (chuyển cảnh, màu, chữ, lớp phủ, nhạc) và xem kết quả">✓ Áp dụng</button>
          </div>
        </div>
      </div>
      <div class="ed-foot"><span id="ed-status" class="ed-statusg"></span><div class="ed-bar" id="ed-bar" hidden><i></i></div>
        <button class="ed-ib" id="ed-save" title="Lưu dự án (không đóng)">⟳</button><button class="ed-btn pri" id="ed-saveclose">Lưu &amp; đóng</button><button class="ed-btn o-dark" id="ed-export">Xuất</button></div>
    </div>`;
    bind();
    processed = !!P.srt; lastSig = null; hist = []; hi = -1;
    syncAll();
    pushHist();
  }

  const $ = id => root.querySelector('#' + id);
  let hist = [], hi = -1, histT = 0, processed = false, lastSig = null;
  const pushHist = () => { if (!P) return; const s = JSON.stringify(P); if (hist[hi] === s) return; hist = hist.slice(0, hi + 1); hist.push(s); if (hist.length > 60) hist.shift(); hi = hist.length - 1; };
  const mark = () => { dirty = true; clearTimeout(histT); histT = setTimeout(pushHist, 350); };
  const sigOf = () => P.clips.map(c => [c.path, c.in, c.out, c.speed].join('|')).join(';');
  function applyLock() {
    const locked = !processed;
    const sl = $('ed-sublock'); if (sl) sl.hidden = !locked;
    const sb = $('ed-subbody'); if (sb) { sb.style.opacity = locked ? '.45' : '1'; sb.querySelectorAll('button').forEach(b => b.disabled = locked); }
    const lm = $('ed-lockmsg'); if (lm) lm.textContent = locked ? 'video chưa xử lý nên Phụ đề bị khóa' : 'video đã xử lý · Phụ đề đã mở';
    const st = $('ed-status'); if (st && !busy && !/^(✅|⚠|Đã )/.test(st.textContent)) st.textContent = locked ? 'Video chưa xử lý · dùng Video, Text, Watermark, Che Sub, ghép video và nhạc nền bình thường' : 'Video đã xử lý · có thể thêm Phụ đề';
  }
  function refreshLock() {
    const sg = sigOf(); if (lastSig !== null && sg !== lastSig) processed = false; lastSig = sg; applyLock();
    const em = $('ed-empty'); if (em) em.hidden = !!P.clips.length;
    const ap = $('ed-apply'); if (ap && !busy) ap.disabled = !P.clips.length;
    const zv = $('ed-zv'); if (zv) zv.textContent = (pxPerSec / 22).toFixed(2) + '×';
  }

  function bind() {
    $('ed-name').oninput = e => { P.name = e.target.value; mark(); };
    $('ed-add').onclick = async () => {
      const files = await api.pickFiles({ title: 'Chọn video', filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi'] }] });
      if (files && files.length) await addMedia(files, true);
    };
    $('ed-lib').onclick = openLibrary;
    const pickAudio = async (key, label) => {
      const f = await api.pickFile({ title: label, filters: [{ name: 'Âm thanh', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] }] });
      if (f) { P[key].path = f; mark(); syncAudio(); }
    };
    $('ed-mus').onclick = () => pickAudio('music', 'Chọn nhạc nền');
    $('ed-mus-x').onclick = () => { P.music.path = ''; mark(); syncAudio(); };
    $('ed-dub').onclick = () => pickAudio('dub', 'Chọn giọng lồng');
    $('ed-dub-x').onclick = () => { P.dub.path = ''; mark(); syncAudio(); };
    $('ed-ov').oninput = e => { P.origVolume = +e.target.value; $('ed-ov-v').textContent = e.target.value + '%'; mark(); };
    $('ed-mv').oninput = e => { P.music.volume = +e.target.value; $('ed-mv-v').textContent = e.target.value + '%'; mark(); };
    $('ed-dv').oninput = e => { P.dub.volume = +e.target.value; $('ed-dv-v').textContent = e.target.value + '%'; mark(); };
    $('ed-asp').onchange = e => { P.aspect = e.target.value; mark(); };
    $('ed-addtext').onclick = () => { P.texts.push({ id: uid(), text: 'Chữ mới', start: 0, end: Math.max(2, total()), size: 48, color: '#FFFFFF', x: 0.5, y: 0.85 }); mark(); renderTexts(); };
    $('ed-wm').oninput = e => { P.watermark.text = e.target.value; mark(); };
    $('ed-wmimg').onclick = async () => { const f = await api.pickFile({ title: 'Chọn logo', type: 'image' }); if (f) { P.watermark.image = f; mark(); syncWm(); } };
    $('ed-wmimg-x').onclick = () => { P.watermark.image = ''; mark(); syncWm(); };
    $('ed-wmpos').onchange = e => { P.watermark.pos = e.target.value; mark(); };
    const WM = () => P.watermark;
    const wmv = (id, v) => { const el = $(id + '-v'); if (el) el.textContent = v; };
    $('ed-wmop').oninput = e => { WM().opacity = +e.target.value; wmv('ed-wmop', e.target.value + '%'); mark(); };
    $('ed-wmshow').onchange = e => { WM().show = e.target.checked; mark(); };
    $('ed-wmfont').onchange = e => { WM().font = e.target.value; mark(); };
    $('ed-wmbold').onchange = e => { WM().bold = e.target.checked; mark(); };
    $('ed-wmital').onchange = e => { WM().italic = e.target.checked; mark(); };
    $('ed-wmeff').onchange = e => { WM().effect = e.target.value; mark(); };
    $('ed-wmsize').oninput = e => { WM().size = +e.target.value; wmv('ed-wmsize', e.target.value + 'px'); mark(); };
    $('ed-wmcol').oninput = e => { WM().color = e.target.value; mark(); };
    $('ed-wmbcol').oninput = e => { WM().borderColor = e.target.value; mark(); };
    $('ed-wmbw').oninput = e => { WM().border = +e.target.value; wmv('ed-wmbw', e.target.value); mark(); };
    $('ed-wmsh').oninput = e => { WM().shadow = +e.target.value; wmv('ed-wmsh', e.target.value); mark(); };
    $('ed-wmbg').onchange = e => { WM().bg = e.target.checked; mark(); };
    $('ed-wmbgcol').oninput = e => { WM().bgColor = e.target.value; mark(); };
    $('ed-srt').onclick = async () => { const f = await api.pickFile({ title: 'Chọn phụ đề', filters: [{ name: 'SRT', extensions: ['srt'] }] }); if (f) { P.srt = f; mark(); syncSrt(); } };
    $('ed-srt-x').onclick = () => { P.srt = ''; mark(); syncSrt(); };
    $('ed-ov-img').onclick = () => addOverlay('image');
    $('ed-ov-vid').onclick = () => addOverlay('video');
    $('ed-mk-cue').onclick = maskPerCue;
    $('ed-mk-add').onclick = () => { P.masks = P.masks || []; P.masks.push({ id: uid(), mode: 'blur', x: 0.1, y: 0.8, w: 0.8, h: 0.12, start: 0, end: Math.max(2, total()), strength: 25, detail: 60, color: '#000000' }); mark(); renderMasks(); };
    $('ed-seg-add').onclick = addSeg;
    $('ed-apply').onclick = previewAll;
    $('ed-e-pick').onclick = () => $('ed-add').onclick();
    $('ed-e-dir').onclick = async () => {
      const files = await api.pickFiles({ title: 'Chọn nhiều video trong thư mục', filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi'] }] });
      if (files && files.length) await addMedia(files, true);
    };
    $('ed-e-lib').onclick = openLibrary;
    $('ed-frame').onclick = () => { const a = $('ed-asp'); a.focus(); if (a.showPicker) { try { a.showPicker(); } catch (_) {} } };
    root.querySelectorAll('[data-asp]').forEach(b => b.onclick = () => { P.aspect = b.dataset.asp; $('ed-asp').value = P.aspect; mark(); });
    root.querySelectorAll('[data-geo]').forEach(b => b.onclick = () => {
      const c = P.clips[sel]; if (!c) { toast('Chọn một clip trước', 'warn'); return; }
      const k = b.dataset.geo; if (k === 'rot') c.rot = ((c.rot || 0) + 90) % 360; else c[k] = !c[k];
      mark(); renderTimeline(); toast('Đã đặt cho clip ' + (sel + 1) + ' (hiện khi Áp dụng / Xuất)', 'ok');
    });
    $('ed-undo').onclick = () => { clearTimeout(histT); pushHist(); if (hi > 0) { hi--; P = JSON.parse(hist[hi]); sel = Math.min(sel, P.clips.length - 1); dirty = true; syncAll(); } };
    $('ed-redo').onclick = () => { clearTimeout(histT); if (hi < hist.length - 1) { hi++; P = JSON.parse(hist[hi]); sel = Math.min(sel, P.clips.length - 1); dirty = true; syncAll(); } };
    $('ed-play').onclick = () => { const v = $('ed-vid'); if (!P.clips.length) return; if (v.paused) v.play().catch(() => {}); else v.pause(); };
    $('ed-vid').addEventListener('play', () => { $('ed-play').textContent = '❚❚'; });
    $('ed-vid').addEventListener('pause', () => { $('ed-play').textContent = '▶'; });
    $('ed-pv').onclick = () => { if (sel > 0) { sel--; renderTimeline(); loadPreview(); } };
    $('ed-nx').onclick = () => { if (sel < P.clips.length - 1) { sel++; renderTimeline(); loadPreview(); } };
    $('ed-full').onclick = () => { const st = root.querySelector('.ed-stage'); if (st.requestFullscreen) st.requestFullscreen().catch(() => {}); };
    $('ed-vid').onclick = () => $('ed-play').onclick();
    root.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName || '')) {
        if (e.key === 'z') { e.preventDefault(); $('ed-undo').onclick(); } else if (e.key === 'y') { e.preventDefault(); $('ed-redo').onclick(); }
      }
    });
    const syncPanelBtns = () => root.querySelectorAll('[data-panel]').forEach(b => { const d = $(b.dataset.panel); b.classList.toggle('on', !!(d && d.open)); });
    root.querySelectorAll('[data-panel]').forEach(t => t.onclick = () => {
      const d = $(t.dataset.panel); if (!d) return;
      if (d.open) { d.close(); return; }
      root.querySelectorAll('dialog.ed-panel[open]').forEach(o => o.close());
      if (t.dataset.panel === 'ed-d-filter') renderFilter();
      d.show(); syncPanelBtns();
    });
    root.querySelectorAll('dialog.ed-panel').forEach(d => d.addEventListener('close', syncPanelBtns));
    root.querySelectorAll('dialog [data-close]').forEach(x => x.onclick = () => x.closest('dialog').close());
    root.querySelectorAll('dialog:not(.ed-panel)').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));
    $('ed-zi').onclick = () => { pxPerSec = Math.min(120, pxPerSec * 1.4); renderTimeline(); };
    $('ed-zo').onclick = () => { pxPerSec = Math.max(4, pxPerSec / 1.4); renderTimeline(); };
    $('ed-split').onclick = splitAtPlayhead;
    $('ed-save').onclick = () => save(false);
    $('ed-saveclose').onclick = async () => { if (await save(true)) showList(); };
    $('ed-export').onclick = doExport;
    const v = $('ed-vid');
    v.addEventListener('timeupdate', () => {
      const c = P && P.clips[sel];
      if (c && v.currentTime >= c.out - 0.03 && !v.paused) { v.pause(); v.currentTime = c.out; }
      showTime();
    });
    v.addEventListener('play', () => {
      const c = P && P.clips[sel];
      if (c && (v.currentTime >= c.out - 0.05 || v.currentTime < c.in)) v.currentTime = c.in;
    });
  }

  function syncAll() {
    $('ed-name').value = P.name;
    $('ed-ov').value = P.origVolume == null ? 100 : P.origVolume; $('ed-ov-v').textContent = $('ed-ov').value + '%';
    $('ed-mv').value = P.music.volume; $('ed-mv-v').textContent = P.music.volume + '%';
    $('ed-dv').value = P.dub.volume; $('ed-dv-v').textContent = P.dub.volume + '%';
    $('ed-asp').value = P.aspect || 'source';
    $('ed-wm').value = P.watermark.text || ''; $('ed-wmpos').value = P.watermark.pos || 'br'; $('ed-wmop').value = P.watermark.opacity == null ? 70 : P.watermark.opacity;
    { const W = P.watermark;
      $('ed-wmfont').value = W.font || 'Arial'; $('ed-wmbold').checked = W.bold !== false; $('ed-wmital').checked = !!W.italic; $('ed-wmeff').value = W.effect || 'none';
      $('ed-wmshow').checked = W.show !== false; $('ed-wmsize').value = W.size == null ? 28 : W.size; $('ed-wmsize-v').textContent = $('ed-wmsize').value + 'px';
      $('ed-wmop-v').textContent = $('ed-wmop').value + '%';
      $('ed-wmcol').value = W.color || '#ffffff'; $('ed-wmbcol').value = W.borderColor || '#000000';
      $('ed-wmbw').value = W.border == null ? 2 : W.border; $('ed-wmbw-v').textContent = $('ed-wmbw').value;
      $('ed-wmsh').value = W.shadow || 0; $('ed-wmsh-v').textContent = $('ed-wmsh').value;
      $('ed-wmbg').checked = !!W.bg; $('ed-wmbgcol').value = W.bgColor || '#000000'; }
    syncAudio(); syncWm(); syncSrt(); renderTexts(); renderOverlays(); renderMasks(); renderSegs(); renderThumbs(); renderTimeline(); loadPreview();
    $('ed-status').textContent = ''; applyLock();
  }
  function syncAudio() { $('ed-mus-n').textContent = P.music.path ? '♪ ' + baseName(P.music.path) : 'Chưa thêm nhạc'; $('ed-dub-n').textContent = P.dub.path ? '🎙 ' + baseName(P.dub.path) : 'Chưa thêm giọng lồng'; }
  function syncWm() { $('ed-wmimg-n').textContent = P.watermark.image ? '🖼 ' + baseName(P.watermark.image) : ''; }
  function syncSrt() { $('ed-srt-n').textContent = P.srt ? '📄 ' + baseName(P.srt) : 'Chưa chọn phụ đề'; }

  /* ---------- tệp phương tiện ---------- */
  async function addMedia(files, alsoAppend) {
    const infos = await api.editProbe(files);
    const bad = infos.filter(i => !i.ok || !i.hasVideo);
    if (bad.length) toast('Bỏ qua ' + bad.length + ' tệp không đọc được/không có hình', 'warn');
    // Nhiều tệp một lượt: xếp theo số trong tên (Canh-01, Canh-02…, 0s-10s…) để đúng thứ tự cảnh, không theo thứ tự chọn/ngày tạo.
    const natural = (a, b) => String(a.name).localeCompare(String(b.name), 'vi', { numeric: true, sensitivity: 'base' });
    const good = infos.filter(i => i.ok && i.hasVideo);
    if (good.length > 1) good.sort(natural);
    const wasEmpty = P.clips.length === 0;
    for (const i of good) {
      if (!mediaPool.find(m => m.path === i.path)) mediaPool.push(i);
      if (alsoAppend) insertClip(i, P.clips.length);
    }
    if (wasEmpty && P.clips.length) sel = 0;   // thêm video đầu tiên → vị trí xem về 00:00:00
    mark(); renderThumbs(); renderTimeline(); loadPreview();
  }
  function insertClip(i, at) {
    P.clips.splice(at, 0, { id: uid(), path: i.path, name: i.name, duration: i.duration, srcDuration: i.duration, in: 0, out: i.duration, speed: 1, volume: 100, hasAudio: i.hasAudio, width: i.width, height: i.height });
    sel = at; mark();
  }
  function renderThumbs() {
    // gom cả clip đang có trong dự án vào danh sách phương tiện
    for (const c of P.clips) if (!mediaPool.find(m => m.path === c.path)) mediaPool.push({ path: c.path, name: c.name, duration: c.srcDuration || c.duration, hasAudio: c.hasAudio, width: c.width, height: c.height, hasVideo: true, ok: true });
    const box = $('ed-thumbs');
    box.innerHTML = mediaPool.map((m, k) => `<div class="ed-th" draggable="true" data-k="${k}"><video src="${fileUrl(m.path)}#t=0.5" preload="metadata" muted></video><div class="nm" title="${esc(m.name)}">${esc(m.name)}</div><button data-add="${k}" title="Thêm vào cuối hàng Video">+</button></div>`).join('') || '<div class="ed-hint">Chưa có tệp. Dùng “＋ Thêm tệp” hoặc “Kho video”.</div>';
    box.querySelectorAll('[data-add]').forEach(b => b.onclick = e => { e.stopPropagation(); insertClip(mediaPool[+b.dataset.add], P.clips.length); renderTimeline(); loadPreview(); });
    box.querySelectorAll('.ed-th').forEach(el => el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', 'media:' + el.dataset.k); e.dataTransfer.effectAllowed = 'copy'; }));
  }

  async function openLibrary() {
    const list = await api.getLibraryVideos();
    const items = (Array.isArray(list) ? list : []).map(x => x.localPath || x.path).filter(Boolean);
    if (!items.length) { toast('Kho video đang trống', 'warn'); return; }
    let dlg = root.querySelector('#ed-libdlg');
    if (dlg) dlg.remove();
    dlg = document.createElement('dialog'); dlg.id = 'ed-libdlg';
    dlg.innerHTML = `<b>Kho video</b> <span class="ed-hint">Tick các video muốn thêm vào dự án</span>
      <div class="ed-lib">${items.map((p, i) => `<label><input type="checkbox" data-p="${i}"> ${esc(baseName(p))}</label>`).join('')}</div>
      <div class="ed-row" style="justify-content:flex-end"><button class="ed-btn" id="ed-lib-no">Huỷ</button><button class="ed-btn pri" id="ed-lib-ok">Thêm vào dự án</button></div>`;
    root.appendChild(dlg);
    dlg.querySelector('#ed-lib-no').onclick = () => dlg.close();
    dlg.querySelector('#ed-lib-ok').onclick = async () => {
      const picked = [...dlg.querySelectorAll('input:checked')].map(c => items[+c.dataset.p]);
      dlg.close();
      if (picked.length) await addMedia(picked, true);
    };
    dlg.showModal();
  }

  /* ---------- lớp phủ / che sub / đoạn âm thanh ---------- */
  const numIn = (k, f, v, w, st) => `<input type="number" step="${st || 0.1}" min="0" data-k="${k}" data-f="${f}" value="${v}" style="width:${w || 58}px">`;
  function renderOverlays() {
    P.overlays = P.overlays || [];
    const box = $('ed-ovs');
    box.innerHTML = P.overlays.map((o, k) => `<div class="ed-item" data-ok="${k}"><div class="ed-row"><b class="ed-hint" style="flex:1" title="${esc(o.path)}">${o.kind === 'video' ? '🎞' : '🖼'} ${esc(baseName(o.path))}</b><button class="ed-btn danger" data-rm="${k}">✕</button></div>
      <div class="ed-row"><label>Từ</label>${numIn(k, 'start', o.start)}<label>đến</label>${numIn(k, 'end', o.end)}<label>Rộng %</label>${numIn(k, 'wp', Math.round((o.w == null ? 0.3 : o.w) * 100), 52, 5)}</div>
      <div class="ed-row"><label>Ngang</label><input type="range" min="0" max="100" data-k="${k}" data-f="xp" value="${Math.round((o.x == null ? 0.5 : o.x) * 100)}"><label>Dọc</label><input type="range" min="0" max="100" data-k="${k}" data-f="yp" value="${Math.round((o.y == null ? 0.5 : o.y) * 100)}"><label>Mờ</label><input type="range" min="10" max="100" data-k="${k}" data-f="opacity" value="${o.opacity == null ? 100 : o.opacity}"></div></div>`).join('') || '<div class="ed-hint">Chưa có lớp phủ.</div>';
    box.querySelectorAll('[data-f]').forEach(el => el.oninput = () => {
      const o = P.overlays[+el.dataset.k], f = el.dataset.f, v = +el.value;
      if (f === 'wp') o.w = v / 100; else if (f === 'xp') o.x = v / 100; else if (f === 'yp') o.y = v / 100; else o[f] = v; mark();
    });
    box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { P.overlays.splice(+b.dataset.rm, 1); mark(); renderOverlays(); });
  }
  function renderMasks() {
    P.masks = P.masks || [];
    const box = $('ed-mks');
    box.innerHTML = P.masks.map((m, k) => `<div class="ed-item"><div class="ed-row"><select data-k="${k}" data-f="mode"><option value="blur"${(m.mode || 'blur') === 'blur' ? ' selected' : ''}>Làm mờ</option><option value="mosaic"${m.mode === 'mosaic' ? ' selected' : ''}>Mosaic (ô vuông)</option><option value="patch"${m.mode === 'patch' ? ' selected' : ''}>Xoá gần đúng (vá từ nền kế bên)</option><option value="box"${m.mode === 'box' ? ' selected' : ''}>Hộp màu</option></select>
      <input type="color" data-k="${k}" data-f="color" value="${esc(String(m.color || '#000000').replace(/^(?!#)/, '#').slice(0, 7))}"><span class="ed-grow"></span><button class="ed-btn danger" data-rm="${k}">✕</button></div>
      <div class="ed-row"><label>Từ</label>${numIn(k, 'start', m.start)}<label>đến</label>${numIn(k, 'end', m.end)}<label>Giữ chi tiết %</label>${numIn(k, 'detail', m.detail == null ? Math.round(100 - ((m.strength == null ? 25 : m.strength) - 3) / 60 * 100) : m.detail, 52, 1)}</div>
      <div class="ed-row"><label>X %</label>${numIn(k, 'xp', Math.round((m.x == null ? 0.1 : m.x) * 100), 48, 1)}<label>Y %</label>${numIn(k, 'yp', Math.round((m.y == null ? 0.8 : m.y) * 100), 48, 1)}<label>R %</label>${numIn(k, 'wp', Math.round((m.w == null ? 0.8 : m.w) * 100), 48, 1)}<label>C %</label>${numIn(k, 'hp', Math.round((m.h == null ? 0.12 : m.h) * 100), 48, 1)}</div></div>`).join('') || '<div class="ed-hint">Chưa có vùng che.</div>';
    box.querySelectorAll('[data-f]').forEach(el => el.oninput = el.onchange = () => {
      const m = P.masks[+el.dataset.k], f = el.dataset.f;
      if (f === 'mode' || f === 'color') m[f] = el.value;
      else if (f === 'detail') m.detail = Math.min(100, Math.max(0, +el.value));
      else if (f === 'xp') m.x = +el.value / 100; else if (f === 'yp') m.y = +el.value / 100; else if (f === 'wp') m.w = +el.value / 100; else if (f === 'hp') m.h = +el.value / 100; else m[f] = +el.value;
      mark();
    });
    box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { P.masks.splice(+b.dataset.rm, 1); mark(); renderMasks(); });
  }
  // Che theo từng câu: mỗi câu trong .srt một vùng che cùng kiểu/vị trí với vùng đầu tiên (hoặc mặc định) trong đúng khoảng thời gian câu đó.
  async function maskPerCue() {
    if (!P.srt) { toast('Chưa có phụ đề .srt — chọn phụ đề (sau khi Áp dụng) rồi thử lại', 'warn'); return; }
    const r = await api.toolkitTtsParseTimed({ filePath: P.srt });
    const cues = (r && r.cues) || [];
    if (!cues.length) { toast('Không đọc được câu nào trong .srt', 'warn'); return; }
    const t = (P.masks && P.masks[0]) || { mode: 'blur', x: 0.1, y: 0.8, w: 0.8, h: 0.12, detail: 60, strength: 25, color: '#000000' };
    const tmpl = { mode: t.mode || 'blur', x: t.x, y: t.y, w: t.w, h: t.h, detail: t.detail, strength: t.strength, color: t.color };
    const sec = v => { v = Number(v); return v > 1000 ? v / 1000 : v; };   // mili-giây → giây nếu cần
    P.masks = P.masks.filter(m => !m.cue);
    cues.forEach(c => { const a = sec(c.startSec != null ? c.startSec : c.start), b = sec(c.endSec != null ? c.endSec : c.end); if (b > a) P.masks.push({ ...tmpl, id: uid(), start: a, end: b, cue: true }); });
    mark(); renderMasks(); toast('Đã tạo ' + P.masks.filter(m => m.cue).length + ' vùng che theo từng câu', 'ok');
  }
  function renderSegs() {
    P.audioSegs = P.audioSegs || [];
    const box = $('ed-segs');
    box.innerHTML = P.audioSegs.map((s, k) => `<div class="ed-item"><div class="ed-row"><b class="ed-hint" style="flex:1" title="${esc(s.path)}">♪ ${esc(baseName(s.path))}</b><button class="ed-btn danger" data-rm="${k}">✕</button></div>
      <div class="ed-row"><label>Bắt đầu tại</label>${numIn(k, 'start', s.start || 0)}<label>s · cắt nguồn từ</label>${numIn(k, 'in', s.in || 0)}<label>đến</label>${numIn(k, 'out', s.out || 0)}</div>
      <div class="ed-row"><label>Vào dần</label>${numIn(k, 'fadeIn', s.fadeIn || 0, 50)}<label>Ra dần</label>${numIn(k, 'fadeOut', s.fadeOut || 0, 50)}<label>Âm lượng</label>${numIn(k, 'volume', s.volume == null ? 30 : s.volume, 56, 5)}<span class="ed-hint">%</span></div>
      <div class="ed-hint">“đến” = 0: phát hết/lặp tới cuối video.</div></div>`).join('') || '<div class="ed-hint">Chưa có đoạn nhạc nào.</div>';
    box.querySelectorAll('[data-f]').forEach(el => el.oninput = () => { P.audioSegs[+el.dataset.k][el.dataset.f] = +el.value; mark(); });
    box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { P.audioSegs.splice(+b.dataset.rm, 1); mark(); renderSegs(); });
  }
  async function addOverlay(kind) {
    const f = kind === 'image' ? await api.pickFile({ title: 'Chọn ảnh lớp phủ', type: 'image' })
      : await api.pickFile({ title: 'Chọn video lớp phủ', filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi'] }] });
    if (!f) return;
    P.overlays = P.overlays || [];
    P.overlays.push({ id: uid(), path: f, kind, start: 0, end: Math.max(2, total()), x: 0.5, y: 0.2, w: 0.3, opacity: 100, in: 0 });
    mark(); renderOverlays();
  }
  async function addSeg() {
    const f = await api.pickFile({ title: 'Chọn nhạc / âm thanh', filters: [{ name: 'Âm thanh', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] }] });
    if (!f) return;
    P.audioSegs = P.audioSegs || [];
    P.audioSegs.push({ id: uid(), path: f, start: 0, in: 0, out: 0, fadeIn: 0, fadeOut: 0, volume: 30 });
    mark(); renderSegs();
  }

  /* ---------- xem trước CẢ timeline (dựng bản nhẹ bằng đúng đồ thị xuất) ---------- */
  async function previewAll() {
    if (busy) return;
    if (!P.clips.length) { toast('Dự án chưa có clip', 'warn'); return; }
    busy = true; const btn = $('ed-apply'); btn.disabled = true; const old = btn.textContent; btn.textContent = '⏳ Đang xử lý…';
    $('ed-status').textContent = 'Đang dựng bản xem trước toàn bộ timeline…';
    const off = api.onEditExportProgress && api.onEditExportProgress(d => { $('ed-status').textContent = 'Dựng xem trước… ' + (d.percent || 0) + '%'; });
    try {
      const r = await api.editPreview({ project: P });
      if (r && r.ok) {
        const stage = root.querySelector('.ed-stage');
        let pv = stage.querySelector('.ed-pv'); if (pv) pv.remove();
        pv = document.createElement('div'); pv.className = 'ed-pv';
        pv.innerHTML = `<video controls autoplay src="${fileUrl(r.outputPath)}"></video><div class="bar"><b>Xem trước toàn bộ</b><span class="ed-hint">${r.duration}s · bản nhẹ, chưa phải chất lượng xuất</span><span class="ed-grow"></span><button class="ed-btn" id="ed-pv-x">Đóng xem trước</button></div>`;
        stage.appendChild(pv); pv.querySelector('#ed-pv-x').onclick = () => { const v = pv.querySelector('video'); v.pause(); pv.remove(); };
        processed = true; lastSig = sigOf(); applyLock();
        $('ed-status').textContent = '✅ Đã áp dụng · ' + r.duration + 's · Phụ đề đã mở';
      } else { $('ed-status').textContent = '⚠ Lỗi xem trước: ' + ((r && r.error) || 'không rõ'); toast((r && r.error) || 'Lỗi xem trước', 'err'); }
    } catch (e) { $('ed-status').textContent = '⚠ Lỗi: ' + e.message; }
    finally { try { off && off(); } catch (_) {} busy = false; btn.disabled = false; btn.textContent = old; }
  }

  /* ---------- text ---------- */
  function renderTexts() {
    const box = $('ed-texts');
    box.innerHTML = P.texts.map((t, k) => `<div class="ed-txt">
      <input type="text" data-k="${k}" data-f="text" value="${esc(t.text)}"><button class="ed-btn danger" data-rm="${k}">✕</button>
      <div class="ed-row"><label>Từ</label><input type="number" step="0.1" min="0" data-k="${k}" data-f="start" value="${t.start}" style="width:62px"><label>đến</label><input type="number" step="0.1" min="0" data-k="${k}" data-f="end" value="${t.end}" style="width:62px">
      <label>Cỡ</label><input type="number" min="8" max="300" data-k="${k}" data-f="size" value="${t.size}" style="width:56px"><input type="color" data-k="${k}" data-f="color" value="${esc(String(t.color || '#FFFFFF').slice(0, 7))}">
      <label>Dọc</label><input type="range" min="5" max="95" data-k="${k}" data-f="y" value="${Math.round((t.y == null ? 0.85 : t.y) * 100)}"></div></div>`).join('') || '<div class="ed-hint">Chưa có chữ nào.</div>';
    box.querySelectorAll('[data-f]').forEach(el => el.oninput = () => {
      const t = P.texts[+el.dataset.k], f = el.dataset.f;
      t[f] = f === 'text' || f === 'color' ? el.value : (f === 'y' ? +el.value / 100 : +el.value); mark();
    });
    box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { P.texts.splice(+b.dataset.rm, 1); mark(); renderTexts(); });
  }

  /* ---------- timeline ---------- */
  function renderTimeline() {
    const tr = $('ed-track'), ru = $('ed-ruler');
    const T = total();
    ru.style.width = Math.max(T * pxPerSec + 60, 300) + 'px';
    let ticks = ''; const step = pxPerSec >= 40 ? 1 : pxPerSec >= 18 ? 2 : pxPerSec >= 9 ? 5 : 10;
    for (let s = 0; s <= T + 1; s += step) ticks += `<i style="left:${s * pxPerSec}px">${fmt(s).slice(0, 5)}</i>`;
    ru.innerHTML = ticks;
    tr.innerHTML = P.clips.map((c, i) => `<div class="ed-clip${i === sel ? ' sel' : ''}" draggable="true" data-i="${i}" style="width:${Math.max(24, clipLen(c) * pxPerSec)}px" title="${esc(c.name)}${transOf(i) > 0 ? ' · chuyển cảnh vào: ' + c.transition.type + ' ' + transOf(i).toFixed(1) + 's' : ''}">
      ${filmstrip(c)}<div class="ed-wave" data-path="${esc(c.path)}" data-in="${c.in}" data-out="${c.out}"></div>${transOf(i) > 0 ? '<span class="tr"></span>' : ''}<b>${i + 1}. ${esc(c.name)}</b><small>${clipLen(c).toFixed(1)}s${(c.speed || 1) !== 1 ? ' · ' + c.speed + '×' : ''}${c.flipH ? ' · ⇋' : ''}${c.flipV ? ' · ⇅' : ''}${c.rot ? ' · ⟳' + c.rot + '°' : ''}</small></div>`).join('') || '<div class="ed-hint" style="padding:18px">Kéo thumbnail hoặc bấm + để chèn clip vào hàng Video.</div>';
    tr.querySelectorAll('.ed-clip').forEach(el => {
      const i = +el.dataset.i;
      el.onclick = () => { sel = i; renderTimeline(); loadPreview(); };
      el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', 'clip:' + i); e.dataTransfer.effectAllowed = 'move'; });
      el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('over'); });
      el.addEventListener('dragleave', () => el.classList.remove('over'));
      el.addEventListener('drop', e => {
        e.preventDefault(); el.classList.remove('over');
        const d = (e.dataTransfer.getData('text/plain') || '').split(':');
        const rect = el.getBoundingClientRect(); const after = e.clientX > rect.left + rect.width / 2;
        let at = i + (after ? 1 : 0);
        if (d[0] === 'clip') {
          const from = +d[1]; const [c] = P.clips.splice(from, 1); if (from < at) at--; P.clips.splice(at, 0, c); sel = at; mark();
        } else if (d[0] === 'media') { insertClip(mediaPool[+d[1]], at); }
        renderTimeline(); loadPreview();
      });
    });
    tr.ondragover = e => e.preventDefault();
    tr.ondrop = e => {
      if (e.target !== tr) return; e.preventDefault();
      const d = (e.dataTransfer.getData('text/plain') || '').split(':');
      if (d[0] === 'media') { insertClip(mediaPool[+d[1]], P.clips.length); renderTimeline(); loadPreview(); }
    };
    refreshLock(); renderProps(); showTime(); paintWaves();
  }

  // Sóng âm thật: lấy PCM bằng ffmpeg (main process), vẽ đoạn [in,out] của từng clip. Không có tiếng → hiện vạch phẳng, không vẽ sóng giả.
  const waveCache = new Map();
  async function paintWaves() {
    const els = [...root.querySelectorAll('.ed-wave')];
    for (const el of els) {
      const p = el.dataset.path;
      if (!waveCache.has(p)) waveCache.set(p, api.editWave({ path: p, perSec: 12 }).catch(() => null));
      const w = await waveCache.get(p);
      if (!el.isConnected) continue;
      if (!w || !w.ok) { el.title = 'Không đọc được âm thanh'; continue; }
      if (!w.hasAudio) { el.classList.add('flat'); el.title = 'Clip không có âm thanh'; continue; }
      const a = Math.floor(Number(el.dataset.in) * w.perSec), b = Math.max(a + 1, Math.ceil(Number(el.dataset.out) * w.perSec));
      const n = Math.max(1, Math.min(160, Math.floor(el.clientWidth / 3) || 40)); const bars = [];
      for (let k = 0; k < n; k++) {
        const i0 = a + Math.floor(k * (b - a) / n), i1 = Math.max(i0 + 1, a + Math.floor((k + 1) * (b - a) / n)); let mx = 0;
        for (let i = i0; i < i1 && i < w.peaks.length; i++) mx = Math.max(mx, w.peaks[i]);
        bars.push('<i style="height:' + Math.max(6, Math.round(mx * 100)) + '%"></i>');
      }
      el.innerHTML = bars.join('');
    }
  }

  // Dải khung hình của clip trên timeline (mỗi ô ~56px lấy một khung tại thời điểm tương ứng)
  function filmstrip(c) {
    const w = Math.max(24, clipLen(c) * pxPerSec); const n = Math.min(40, Math.max(1, Math.ceil(w / 56)));
    const span = (c.out - c.in) || 1; let h = '';
    for (let k = 0; k < n; k++) h += `<video class="fs" src="${fileUrl(c.path)}#t=${(c.in + span * (k + 0.5) / n).toFixed(2)}" preload="metadata" muted tabindex="-1" style="width:${(100 / n).toFixed(3)}%"></video>`;
    return '<div class="ed-film">' + h + '</div>';
  }

  function renderProps() {
    const box = $('ed-prop'); const c = P.clips[sel];
    if (!c) { box.innerHTML = '<span class="ed-hint">Chọn một clip trên timeline để chỉnh điểm vào/ra, tốc độ, âm lượng.</span>'; return; }
    box.innerHTML = `<b>Clip ${sel + 1}</b>
      <label>Vào <input type="number" step="0.1" min="0" max="${c.srcDuration}" id="ed-pin" value="${c.in.toFixed(2)}"> s</label>
      <label>Ra <input type="number" step="0.1" min="0" max="${c.srcDuration}" id="ed-pout" value="${c.out.toFixed(2)}"> s</label>
      <label>Tốc độ <input type="number" step="0.05" min="0.25" max="4" id="ed-psp" value="${c.speed || 1}"> ×</label>
      <label>Âm lượng <input type="number" step="5" min="0" max="300" id="ed-pvol" value="${c.volume == null ? 100 : c.volume}"> %</label>
      <button class="ed-btn" id="ed-pl" title="Đưa clip lên trước">◀</button><button class="ed-btn" id="ed-pr" title="Đưa clip ra sau">▶</button>
      <button class="ed-btn" id="ed-pdup">Nhân đôi</button><button class="ed-btn danger" id="ed-pdel">Xoá clip</button>`;
    const num = (id, f, lo, hi) => $(id).onchange = e => {
      let v = parseFloat(e.target.value); if (!isFinite(v)) return; v = Math.min(hi(), Math.max(lo(), v));
      c[f] = v;
      if (c.out - c.in < 0.2) { if (f === 'in') c.in = Math.max(0, c.out - 0.2); else c.out = Math.min(c.srcDuration, c.in + 0.2); }
      mark(); renderTimeline(); loadPreview();
    };
    num('ed-pin', 'in', () => 0, () => c.srcDuration); num('ed-pout', 'out', () => 0, () => c.srcDuration);
    num('ed-psp', 'speed', () => 0.25, () => 4); num('ed-pvol', 'volume', () => 0, () => 300);
    $('ed-pl').onclick = () => { if (sel > 0) { [P.clips[sel - 1], P.clips[sel]] = [P.clips[sel], P.clips[sel - 1]]; sel--; mark(); renderTimeline(); } };
    $('ed-pr').onclick = () => { if (sel < P.clips.length - 1) { [P.clips[sel + 1], P.clips[sel]] = [P.clips[sel], P.clips[sel + 1]]; sel++; mark(); renderTimeline(); } };
    $('ed-pdup').onclick = () => { P.clips.splice(sel + 1, 0, { ...c, id: uid() }); sel++; mark(); renderTimeline(); };
    $('ed-pdel').onclick = () => { P.clips.splice(sel, 1); sel = Math.min(sel, P.clips.length - 1); mark(); renderTimeline(); loadPreview(); };
  }

  const ADJ_GROUPS = [
    ['MÀU SẮC', [['temp', 'Nhiệt độ'], ['tint', 'Tông màu'], ['sat', 'Bão hòa']]],
    ['ÁNH SÁNG', [['exp', 'Phơi sáng'], ['con', 'Tương phản'], ['hi', 'Vùng sáng'], ['sh', 'Bóng'], ['wh', 'Điểm trắng'], ['bl', 'Điểm đen']]]
  ];
  // Xem trực tiếp trên khung video (gần đúng bằng CSS filter; thông số thật dùng lúc Áp dụng / Xuất)
  function applyPreviewFilter() {
    const v = $('ed-vid'); if (!v) return;
    const c = P && P.clips[sel]; const F = (c && c.filter) || {}; const A = F.adj || {};
    const g = k => Number(A[k]) || 0;
    const br = 1 + (g('exp') / 100) * 0.8 + ((Number(F.brightness) || 0) / 100);
    const ct = (1 + g('con') / 100) * ((Number(F.contrast) || 100) / 100);
    const sa = (1 + g('sat') / 100) * ((Number(F.saturation) || 100) / 100);
    const sep = g('temp') > 0 ? g('temp') / 160 : 0;
    const hue = (g('temp') < 0 ? g('temp') * 0.35 : 0) + g('tint') * -0.4;
    const pre = { bw: 'grayscale(1)', sepia: 'sepia(1)', warm: 'sepia(.35) saturate(1.2)', cool: 'hue-rotate(15deg) saturate(.9)', vivid: 'saturate(1.45) contrast(1.08)', faded: 'saturate(.7) contrast(.92) brightness(1.04)' }[F.preset] || '';
    v.style.filter = `brightness(${Math.max(0.1, br).toFixed(3)}) contrast(${Math.max(0, ct).toFixed(3)}) saturate(${Math.max(0, sa).toFixed(3)}) sepia(${sep.toFixed(3)}) hue-rotate(${hue.toFixed(1)}deg) ${pre}`;
  }

  function renderFilter() {
    const box = $('ed-fbody'); const c = P.clips[sel];
    if (!c) { box.innerHTML = '<h3>Bộ lọc</h3><div class="ed-hint">Chọn một clip trên timeline trước.</div>'; return; }
    const F = (c.filter = c.filter || {}); const A = (F.adj = F.adj || {});
    const row = (k, label, min, max, val) => `<div class="ed-sl"><label>${label}</label><button class="ed-ib" data-d="-1" data-k="${k}">−</button><input type="range" min="${min}" max="${max}" data-k="${k}" value="${val}"><button class="ed-ib" data-d="1" data-k="${k}">＋</button><span class="v" data-v="${k}">${val}</span></div>`;
    box.innerHTML = `<div class="ed-hint" style="margin-bottom:6px">Điều chỉnh không phá hủy · xem ngay trên video và dùng nguyên thông số khi xuất. (Clip ${sel + 1}: ${esc(c.name)})</div>` +
      ADJ_GROUPS.map(([title, items]) => `<div class="ed-gh"><b>${title}</b><button class="ed-ib" data-reset="${title}" title="Đặt lại nhóm">⟳</button></div>` + items.map(([k, l]) => row('adj.' + k, l, -100, 100, Number(A[k]) || 0)).join('')).join('') +
      `<div class="ed-gh"><b>MẪU MÀU &amp; HIỆU ỨNG</b><button class="ed-ib" data-reset="FX" title="Đặt lại">⟳</button></div>
      <div class="ed-sl"><label>Mẫu màu</label><select id="ed-fpre"><option value="none">Gốc</option><option value="bw">Đen trắng</option><option value="sepia">Sepia</option><option value="warm">Ấm</option><option value="cool">Lạnh</option><option value="vivid">Rực</option><option value="faded">Nhạt</option></select></div>
      ${row('f.blur', 'Làm mờ', 0, 30, Number(F.blur) || 0)}
      <div class="ed-gh"><b>CHUYỂN CẢNH VÀO CLIP NÀY</b></div>
      <div class="ed-sl"><select id="ed-tt"><option value="none">Cắt thẳng</option><option value="fade">Mờ dần</option><option value="fadeblack">Qua đen</option><option value="dissolve">Hoà tan</option><option value="wipeleft">Quét trái</option><option value="wiperight">Quét phải</option><option value="slideleft">Trượt trái</option><option value="slideright">Trượt phải</option><option value="circleopen">Mở tròn</option><option value="circleclose">Đóng tròn</option><option value="pixelize">Vỡ hạt</option></select>
        <label style="width:auto">Dài</label><input type="number" step="0.1" min="0.1" max="3" id="ed-td" style="width:60px"> <span class="ed-hint">s</span></div>
      ${sel === 0 ? '<div class="ed-hint">Clip đầu tiên không có chuyển cảnh vào.</div>' : ''}`;
    $('ed-fpre').value = F.preset || 'none';
    const T = (c.transition = c.transition || { type: 'none', dur: 1 });
    $('ed-tt').value = T.type || 'none'; $('ed-td').value = T.dur || 1;
    $('ed-tt').disabled = sel === 0; $('ed-td').disabled = sel === 0;
    const setVal = (key, v) => { if (key.startsWith('adj.')) A[key.slice(4)] = v; else F[key.slice(2)] = v; mark(); applyPreviewFilter(); const sp = box.querySelector('[data-v="' + key + '"]'); if (sp) sp.textContent = v; };
    box.querySelectorAll('input[type=range][data-k]').forEach(r => r.oninput = () => setVal(r.dataset.k, +r.value));
    box.querySelectorAll('button[data-d]').forEach(b => b.onclick = () => { const r = box.querySelector('input[data-k="' + b.dataset.k + '"]'); r.value = +r.value + (+b.dataset.d) * (b.dataset.k === 'f.blur' ? 1 : 5); setVal(b.dataset.k, +r.value); });
    box.querySelectorAll('[data-reset]').forEach(b => b.onclick = () => {
      const g = b.dataset.reset;
      if (g === 'FX') { F.preset = 'none'; F.blur = 0; F.brightness = 0; F.contrast = 100; F.saturation = 100; }
      else (ADJ_GROUPS.find(x => x[0] === g) || [0, []])[1].forEach(([k]) => { A[k] = 0; });
      mark(); renderFilter(); applyPreviewFilter();
    });
    $('ed-fpre').onchange = e => { F.preset = e.target.value; mark(); applyPreviewFilter(); };
    $('ed-tt').onchange = e => { T.type = e.target.value; if (!(T.dur > 0)) T.dur = 1; mark(); renderTimeline(); };
    $('ed-td').onchange = e => { T.dur = Math.min(3, Math.max(0.1, parseFloat(e.target.value) || 1)); mark(); renderTimeline(); };
  }

  function splitAtPlayhead() {
    const c = P.clips[sel]; const v = $('ed-vid');
    if (!c) { toast('Chọn một clip trước', 'warn'); return; }
    const t = v.currentTime;
    if (t <= c.in + 0.3 || t >= c.out - 0.3) { toast('Đặt vị trí xem ở giữa clip (cách hai đầu ≥ 0,3 giây)', 'warn'); return; }
    const b = { ...c, id: uid(), in: t }; c.out = t;
    P.clips.splice(sel + 1, 0, b); mark(); renderTimeline();
    toast('Đã tách clip thành 2 phần', 'ok');
  }

  /* ---------- xem trước ---------- */
  let lastSrc = '';
  function loadPreview() {
    const v = $('ed-vid'); const c = P.clips[sel]; applyPreviewFilter();
    if (!c) { v.removeAttribute('src'); v.load(); lastSrc = ''; return; }
    const url = fileUrl(c.path);
    v.playbackRate = c.speed || 1;
    if (url !== lastSrc) { lastSrc = url; v.src = url; v.addEventListener('loadedmetadata', () => { v.currentTime = c.in; }, { once: true }); }
    else v.currentTime = c.in;
  }
  function showTime() {
    const v = $('ed-vid'); const c = P && P.clips[sel]; if (!v) return;
    let before = 0; for (let i = 0; i < sel; i++) before += clipLen(P.clips[i]);
    const within = c ? Math.max(0, (v.currentTime - c.in) / (c.speed || 1)) : 0;
    const hms = x => { x = Math.max(0, Math.round(x)); const h = Math.floor(x / 3600), m = Math.floor(x % 3600 / 60), sc = x % 60; return [h, m, sc].map(n => String(n).padStart(2, '0')).join(':'); };
    $('ed-time').textContent = `${hms(before + within)} - ${hms(total())}`;
  }

  /* ---------- lưu / xuất ---------- */
  async function save(quiet) {
    const r = await api.editSave(P);
    if (r && r.ok) { dirty = false; if (!quiet) { toast('Đã lưu dự án', 'ok'); $('ed-status').textContent = 'Đã lưu · ' + fmt(r.duration); } return true; }
    toast((r && r.error) || 'Lưu thất bại', 'err'); return false;
  }

  async function doExport() {
    if (busy) return;
    if (!P.clips.length) { toast('Dự án chưa có clip', 'warn'); return; }
    busy = true; const btn = $('ed-export'); btn.disabled = true; btn.textContent = '⏳ Đang xuất…';
    const bar = $('ed-bar'); bar.hidden = false; bar.firstElementChild.style.width = '2%';
    $('ed-status').textContent = 'Đang dựng video…';
    const off = api.onEditExportProgress && api.onEditExportProgress(d => { bar.firstElementChild.style.width = (d.percent || 0) + '%'; $('ed-status').textContent = 'Đang dựng video… ' + (d.percent || 0) + '%'; });
    try {
      await save(true);
      const r = await api.editExport({ project: P });
      if (r && r.ok) {
        bar.firstElementChild.style.width = '100%';
        $('ed-status').innerHTML = `✅ Đã xuất <b>${r.duration}s</b> (${r.width}×${r.height}): <code>${esc(r.outputPath)}</code> <button class="ed-btn" id="ed-open">Mở thư mục</button>`;
        const o = $('ed-open'); if (o) o.onclick = () => api.openPath(r.outputPath.replace(/[^\\/]+$/, ''));
        toast('Đã xuất video', 'ok');
      } else { $('ed-status').textContent = '⚠ Lỗi xuất: ' + ((r && r.error) || 'không rõ'); toast((r && r.error) || 'Lỗi xuất', 'err'); }
    } catch (e) { $('ed-status').textContent = '⚠ Lỗi: ' + e.message; }
    finally { try { off && off(); } catch (_) {} busy = false; btn.disabled = false; btn.textContent = 'Xuất'; }
  }

  document.addEventListener('app:tab', e => { if (e.detail === 'tab-edit' && !P) showList(); });
  if (root.classList.contains('active')) showList();
})();
