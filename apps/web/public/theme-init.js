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

// Inside the Android apps: the animated splash (index.html) takes over from the native one at once.
// Its look starts exactly where the native splash ends, so the native one can go immediately.
(() => {
  try {
    const m = /ScholarsStackApp\/(student|partner)/.exec(navigator.userAgent);
    if (!m) return;
    document.documentElement.dataset.appSplash = m[1];
    window.__ssSplashAt = Date.now();
    const hideNative = () => {
      const s = window.Capacitor?.Plugins?.SplashScreen;
      if (s?.hide) s.hide({ fadeOutDuration: 0 }).catch(() => {});
    };
    // Once the splash below is on screen (two frames after the page starts showing).
    const go = () => requestAnimationFrame(() => requestAnimationFrame(hideNative));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go, { once: true });
    else go();
    // Never stuck: gone after 12 s whatever happens.
    setTimeout(() => {
      const el = document.getElementById('ss-splash');
      if (el) el.remove();
      delete document.documentElement.dataset.appSplash;
    }, 12000);
  } catch {
    // no splash: the app simply opens
  }
})();
