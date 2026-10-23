// Sets the theme before first paint (kept as a file so the CSP can forbid inline scripts).
(() => {
  try {
    const saved = localStorage.getItem('ss-theme');
    const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = saved
      ? JSON.parse(saved).state.theme
      : prefersDark
        ? 'dark'
        : 'light';
  } catch {
    document.documentElement.dataset.theme = 'light';
  }
})();
