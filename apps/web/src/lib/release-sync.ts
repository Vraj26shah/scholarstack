/**
 * Keeps an open tab in step with the live site.
 *
 * Each deploy replaces the site's code files. A tab opened before it still points at the old
 * ones, so the next screen it loads would fail ("Failed to fetch dynamically imported module")
 * and the page would look broken. Two things prevent that:
 *  - a missing code file reloads the page once, quietly, onto the new release;
 *  - the tab checks /version.json when it comes back into view (and every few minutes) and, if a
 *    new release is out, swaps to it on the next move between screens, never mid-task.
 */
declare const __BUILD_ID__: string;

const RELOADED = 'ss_reloaded_for_release';
let newReleaseReady = false;

/** Reload once per release for a missing code file; a second failure shows the error screen. */
export function reloadForNewRelease(): boolean {
  try {
    if (sessionStorage.getItem(RELOADED) === location.pathname) return false;
    sessionStorage.setItem(RELOADED, location.pathname);
  } catch {
    // no storage: still reload once (this page view)
  }
  location.reload();
  return true;
}

/** Wraps a lazy screen's import so a stale tab recovers instead of breaking. */
export function loadScreen<T>(load: () => Promise<T>): () => Promise<T> {
  return () =>
    load().then(
      (m) => {
        try {
          sessionStorage.removeItem(RELOADED);
        } catch {
          // ignore
        }
        return m;
      },
      (error: unknown) => {
        if (reloadForNewRelease()) return new Promise<T>(() => {}); // the page is reloading
        throw error;
      },
    );
}

async function checkRelease() {
  if (typeof __BUILD_ID__ === 'undefined' || newReleaseReady) return;
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    if (!res.ok) return;
    const { build } = (await res.json()) as { build?: string };
    if (build && build !== __BUILD_ID__) newReleaseReady = true;
  } catch {
    // offline or blocked: try again later
  }
}

/** True once a newer release is live: the router reloads on the next screen change. */
export const releaseWaiting = () => newReleaseReady;

export function installReleaseSync() {
  // Vite reports a failed preload of a code file here.
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    reloadForNewRelease();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkRelease();
  });
  window.setInterval(() => void checkRelease(), 5 * 60_000);
}
