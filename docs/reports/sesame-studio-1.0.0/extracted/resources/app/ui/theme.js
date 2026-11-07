// Đổi giao diện sáng/tối (mặc định tối), nhớ lựa chọn.
(function () {
  const KEY = 'sesame-theme';
  const link = document.getElementById('app-theme-css') || document.querySelector('link[href$="app.css"], link[href$="app-dark.css"]');
  function apply(mode) {
    const dark = mode !== 'light';
    if (link) link.setAttribute('href', dark ? './app-dark.css' : './app.css');
    document.body.classList.toggle('sesame-theme-dark', dark);
    document.body.classList.toggle('sesame-theme-light', !dark);
    const btn = document.getElementById('btn-theme-toggle');
    if (btn) btn.textContent = dark ? '🌙' : '☀️';
  }
  let mode = 'dark';
  try { mode = localStorage.getItem(KEY) || 'dark'; } catch (_) {}
  document.addEventListener('DOMContentLoaded', () => {
    apply(mode);
    document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
      mode = document.body.classList.contains('sesame-theme-dark') ? 'light' : 'dark';
      try { localStorage.setItem(KEY, mode); } catch (_) {}
      apply(mode);
    });
  });
})();
