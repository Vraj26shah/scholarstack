import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadScreen } from '../lib/release-sync';

describe('a tab left open across a release', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('reloads once when a screen’s code file is gone, then lets a second failure show', async () => {
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload, pathname: '/shelf' });
    const broken = loadScreen(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));
    void broken(); // first time: reloads and waits
    await new Promise((r) => setTimeout(r, 0));
    expect(reload).toHaveBeenCalledTimes(1);
    await expect(broken()).rejects.toThrow(/dynamically imported/); // already reloaded for this page
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a screen that loads clears the marker', async () => {
    sessionStorage.setItem('ss_reloaded_for_release', '/shelf');
    await loadScreen(() => Promise.resolve('ok'))();
    expect(sessionStorage.getItem('ss_reloaded_for_release')).toBeNull();
  });
});
