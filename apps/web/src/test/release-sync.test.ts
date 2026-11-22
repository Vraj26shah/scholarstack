import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A fresh copy of the module: what a reloaded page starts with. */
const freshPage = async () => {
  vi.resetModules();
  return import('../lib/release-sync');
};

describe('a tab left open across a release', () => {
  const reload = vi.fn();
  beforeEach(() => {
    reload.mockReset();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload, pathname: '/shelf' });
  });
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  const settled = async (p: Promise<unknown>) => {
    let done = false;
    const finish = () => {
      done = true;
    };
    p.then(finish, finish);
    await new Promise((r) => setTimeout(r, 0));
    return done;
  };

  it('reloads once when a screen’s code file is gone, then lets a second failure show', async () => {
    const gone = () => Promise.reject(new Error('Failed to fetch dynamically imported module'));
    const first = await freshPage();
    expect(await settled(first.loadScreen(gone)())).toBe(false); // reloads and waits
    expect(reload).toHaveBeenCalledTimes(1);
    // The reloaded page still can't load it: show the error instead of reloading forever.
    const second = await freshPage();
    await expect(second.loadScreen(gone)()).rejects.toThrow(/dynamically imported/);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a screen failing while a reload is on its way waits for it instead of crashing', async () => {
    const { loadScreen, reloadForNewRelease } = await freshPage();
    // Vite's preload error starts the reload first; the screen's own import then fails too.
    expect(reloadForNewRelease()).toBe(true);
    const crash = () =>
      Promise.reject(new TypeError("Cannot read properties of undefined (reading 'AccountPage')"));
    expect(await settled(loadScreen(crash)())).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not swallow Vite’s preload error (that resolved imports with undefined)', async () => {
    const { installReleaseSync } = await freshPage();
    installReleaseSync();
    const event = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a screen that loads clears the marker', async () => {
    const { loadScreen } = await freshPage();
    sessionStorage.setItem('ss_reloaded_for_release', '/shelf');
    await loadScreen(() => Promise.resolve('ok'))();
    expect(sessionStorage.getItem('ss_reloaded_for_release')).toBeNull();
  });
});
