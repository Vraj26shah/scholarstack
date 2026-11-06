// Sets the theme before first paint (kept as a file so the CSP can forbid inline scripts).
// Light unless the visitor chose dark on this device; the phone's own setting doesn't decide it.
(() => {
  try {
    document.documentElement.dataset.theme =
      localStorage.getItem('ss-theme-choice') === 'dark' ? 'dark' : 'light';
  } catch {
    document.documentElement.dataset.theme = 'light';
  }
})();
