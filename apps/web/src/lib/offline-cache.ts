import { isDemo } from './env';

/**
 * Registers the small offline cache (public/sw.js) once the page has loaded, so it never
 * competes with the first paint. Skipped in demo builds and wherever service workers aren't
 * available; failing to register changes nothing for the visitor.
 */
export function installOfflineCache() {
  if (isDemo || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  });
}
