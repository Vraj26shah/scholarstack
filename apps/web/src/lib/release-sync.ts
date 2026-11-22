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
/** A reload is already on its way: anything else that fails now just waits for it. */
let reloading = false;

/** Reload once per release for a missing code file; a second failure shows the error screen. */
export function reloadForNewRelease(): boolean {
  if (reloading) return true;
  try {
    if (sessionStorage.getItem(RELOADED) === location.pathname) return false;
    sessionStorage.setItem(RELOADED, location.pathname);
  } catch {
    // no storage: still reload once (this page view)
  }
  reloading = true;
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
  // Vite reports a failed preload of a code file here. Start the reload, but don't call
  // preventDefault(): that makes Vite resolve the import with `undefined`, and the screen then
  // crashed reading it ("Cannot read properties of undefined (reading 'AccountPage')", Sentry
  // SCHOLARSTACK-WEB-4) while the reload was still on its way. Left alone, the import fails as
  // it should and loadScreen waits for the reload.
  window.addEventListener('vite:preloadError', () => {
    reloadForNewRelease();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkRelease();
  });
  window.setInterval(() => void checkRelease(), 5 * 60_000);
}
