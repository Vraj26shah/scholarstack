/**
 * Cloudflare's own cache in front of the public catalogue. The home page, drawers, bundles and
 * search are the same for everyone, so a copy is kept at the Cloudflare location near the student
 * and handed out at once; after FRESH_S seconds the next visitor still gets it instantly while the
 * Worker builds a new one in the background. Course and bundle pages are cached only for visitors
 * who aren't signed in (signed-in pages say what the reader owns).
 *
 * An admin change marks the catalogue as changed at that location, so the admin (and anyone near
 * them) sees it on the next load; elsewhere copies catch up within FRESH_S seconds.
 */
const FRESH_S = 60;
const KEEP_S = 6 * 60 * 60;
const ORIGIN = 'https://edge-cache.scholarstack.internal';
const CHANGED = `${ORIGIN}/__catalogue-changed`;

const SHARED = [
  /^\/api\/catalogue$/,
  /^\/api\/catalogue\/drawer$/,
  /^\/api\/catalogue\/search$/,
  /^\/api\/bundles$/,
  /^\/api\/features$/,
];
const ANONYMOUS = [/^\/api\/courses\/[^/]+$/, /^\/api\/bundles\/[^/]+$/];

interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
}

const edgeCache = (): Cache | null =>
  typeof caches !== 'undefined' && 'default' in caches
    ? (caches as unknown as { default: Cache }).default
    : null;

/** Which public read this is (null: not cacheable). */
function cacheable(request: Request): URL | null {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  if (SHARED.some((r) => r.test(url.pathname))) return url;
  if (!request.headers.get('authorization') && ANONYMOUS.some((r) => r.test(url.pathname))) return url;
  return null;
}

const keyOf = (url: URL) => new Request(`${ORIGIN}${url.pathname}${url.search}`);

/** What the browser is told: always check back (it keeps its own copy in the page's storage). */
function forClient(res: Response, age: number, hit: boolean): Response {
  const out = new Response(res.body, res);
  out.headers.set('cache-control', 'no-cache');
  out.headers.set('x-edge-cache', hit ? `HIT age=${Math.round(age)}` : 'MISS');
  out.headers.delete('x-cached-at');
  return out;
}

async function store(cache: Cache, key: Request, res: Response) {
  const copy = new Response(res.body, res);
  copy.headers.set('cache-control', `public, max-age=${KEEP_S}`);
  copy.headers.set('x-cached-at', String(Date.now()));
  copy.headers.delete('set-cookie');
  await cache.put(key, copy);
}

export async function withEdgeCache(
  request: Request,
  ctx: Ctx,
  origin: () => Promise<Response>,
): Promise<Response> {
  const cache = edgeCache();
  const url = cacheable(request);
  if (!cache || !url) {
    const res = await origin();
    // A successful admin change: copies here are out of date from now on.
    if (
      cache &&
      request.method !== 'GET' &&
      res.status < 400 &&
      new URL(request.url).pathname.startsWith('/api/admin')
    )
      ctx.waitUntil(
        cache.put(
          new Request(CHANGED),
          new Response(String(Date.now()), { headers: { 'cache-control': `public, max-age=${KEEP_S}` } }),
        ),
      );
    return res;
  }
  const key = keyOf(url);
  try {
    const [hit, changed] = await Promise.all([cache.match(key), cache.match(new Request(CHANGED))]);
    const changedAt = changed ? Number(await changed.text()) : 0;
    const cachedAt = Number(hit?.headers.get('x-cached-at') ?? 0);
    if (hit && cachedAt > changedAt) {
      const age = (Date.now() - cachedAt) / 1000;
      if (age > FRESH_S)
        ctx.waitUntil(
          origin()
            .then((res) => (res.ok ? store(cache, key, res) : undefined))
            .catch(() => {}),
        );
      return forClient(hit, age, true);
    }
  } catch {
    // The cache had a problem: just answer from the Worker.
  }
  const res = await origin();
  if (res.ok) ctx.waitUntil(store(cache, key, res.clone()).catch(() => {}));
  return forClient(res, 0, false);
}
