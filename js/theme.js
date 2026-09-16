// ============================================================
// THEME TOGGLE - Light / Night Mode
// ============================================================
const Theme = {
  init() {
    const saved = localStorage.getItem('qb_theme');
    if (saved) {
      document.documentElement.setAttribute('data-theme', saved);
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  },

  toggle() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('qb_theme', next);
  },

  get current() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  }
};

Theme.init();
