import { afterEach, describe, expect, it, vi } from 'vitest';
import { withEdgeCache } from '../src/http/edge-cache';

/** A stand-in for Cloudflare's caches.default. */
class FakeCache {
  store = new Map<string, Response>();
  async match(req: Request) {
    const hit = this.store.get(req.url);
    return hit ? hit.clone() : undefined;
  }
  async put(req: Request, res: Response) {
    this.store.set(req.url, new Response(await res.clone().text(), res));
  }
}

const later: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => void later.push(p) };
const settle = async () => {
  await Promise.all(later.splice(0));
};

function setup() {
  const cache = new FakeCache();
  vi.stubGlobal('caches', { default: cache });
  let n = 0;
  const origin = vi.fn(
    async () => new Response(JSON.stringify({ n: ++n }), { headers: { 'content-type': 'application/json' } }),
  );
  return { cache, origin };
}
const get = (path: string, init?: RequestInit) => new Request(`https://x.dev${path}`, init);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('edge cache', () => {
  it('answers the public catalogue from the cache, refreshing in the background once it is a minute old', async () => {
    const { origin } = setup();
    const a = await withEdgeCache(get('/api/catalogue/drawer?batch=2025&branch=bce'), ctx, origin);
    expect(a.headers.get('x-edge-cache')).toBe('MISS');
    await settle();
    const b = await withEdgeCache(get('/api/catalogue/drawer?batch=2025&branch=bce'), ctx, origin);
    expect(b.headers.get('x-edge-cache')).toMatch(/^HIT/);
    expect(await b.json()).toEqual({ n: 1 });
    expect(origin).toHaveBeenCalledTimes(1);
    expect(b.headers.get('cache-control')).toBe('no-cache');

    vi.useFakeTimers({ now: Date.now() + 61_000 });
    const c = await withEdgeCache(get('/api/catalogue/drawer?batch=2025&branch=bce'), ctx, origin);
    expect(await c.json()).toEqual({ n: 1 }); // instant, still the old copy
    await settle();
    expect(origin).toHaveBeenCalledTimes(2); // refreshed behind the scenes
    const d = await withEdgeCache(get('/api/catalogue/drawer?batch=2025&branch=bce'), ctx, origin);
    expect(await d.json()).toEqual({ n: 2 });
  });

  it('never caches account pages, writes, or a signed-in course page', async () => {
    const { origin, cache } = setup();
    await withEdgeCache(get('/api/me'), ctx, origin);
    await withEdgeCache(get('/api/orders', { method: 'POST' }), ctx, origin);
    await withEdgeCache(get('/api/courses/dsa', { headers: { authorization: 'Bearer t' } }), ctx, origin);
    await settle();
    expect(cache.store.size).toBe(0);
    await withEdgeCache(get('/api/courses/dsa'), ctx, origin);
    await settle();
    expect(cache.store.size).toBe(1);
  });

  it('an admin change makes the next read fresh', async () => {
    const { origin } = setup();
    await withEdgeCache(get('/api/catalogue'), ctx, origin);
    await settle();
    await new Promise((r) => setTimeout(r, 5));
    await withEdgeCache(get('/api/admin/courses/1', { method: 'PATCH' }), ctx, origin);
    await settle();
    const after = await withEdgeCache(get('/api/catalogue'), ctx, origin);
    expect(after.headers.get('x-edge-cache')).toBe('MISS');
  });

  it('a failed answer is never cached', async () => {
    setup();
    const failing = vi.fn(async () => new Response('no', { status: 503 }));
    await withEdgeCache(get('/api/catalogue'), ctx, failing);
    await settle();
    await withEdgeCache(get('/api/catalogue'), ctx, failing);
    expect(failing).toHaveBeenCalledTimes(2);
  });
});
