import { afterEach, describe, expect, it, vi } from 'vitest';
import { Memo } from '../src/application/memo';

afterEach(() => vi.useRealTimers());

describe('Memo', () => {
  it('shares one read between callers that arrive together', async () => {
    const load = vi.fn(async () => 7);
    const m = new Memo(load, 1000, 60_000);
    expect(await Promise.all(Array.from({ length: 20 }, () => m.get()))).toEqual(Array(20).fill(7));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('serves the old value at once when stale, and refreshes behind it', async () => {
    let n = 0;
    const m = new Memo(async () => ++n, 1000, 60_000);
    expect(await m.get()).toBe(1);
    vi.useFakeTimers({ now: Date.now() + 2000 });
    expect(await m.get()).toBe(1);
    await vi.waitFor(async () => expect(await m.get()).toBe(2));
  });

  it('forget makes the next caller wait for a fresh read, and a read started before is ignored', async () => {
    let n = 0;
    const release: (() => void)[] = [];
    const m = new Memo(
      () =>
        new Promise<number>((r) => {
          const v = ++n;
          release.push(() => r(v));
        }),
      1000,
      60_000,
    );
    const first = m.get();
    m.forget();
    const second = m.get();
    release[1]!();
    expect(await second).toBe(2);
    release[0]!();
    expect(await first).toBe(1);
    // The older read finished last, but the newer value stays.
    expect(await m.get()).toBe(2);
  });
});
