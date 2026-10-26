import { CatalogueQuery, ClientProblemBody, SearchQuery, UnsubscribeBody } from '@ss/contracts';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { type AppEnv, bearer, requestMeta, throttle } from '../helpers';

export const catalogueRoutes = new Hono<AppEnv>();

catalogueRoutes.get('/catalogue', async (c) => {
  c.header('cache-control', 'no-store');
  return c.json(await c.get('container').catalogue.index());
});

catalogueRoutes.get('/catalogue/drawer', async (c) => {
  const q = CatalogueQuery.parse(c.req.query());
  c.header('cache-control', 'no-store');
  return c.json(await c.get('container').catalogue.drawer(q.batch, q.branch));
});

/** Search every live course and bundle, across batches and programmes. */
catalogueRoutes.get('/catalogue/search', async (c) => {
  const { q } = SearchQuery.parse({ q: c.req.query('q') ?? '' });
  // Each search reads the whole catalogue: 40 a minute per network is plenty for a person.
  await throttle(c, 'search', (await requestMeta(c)).ipHash);
  c.header('cache-control', 'no-store');
  return c.json(await c.get('container').catalogue.search(q));
});

/** Who's asking, if they sent a valid token. Anonymous is fine on public pages. */
async function optionalViewer(c: Context<AppEnv>) {
  const container = c.get('container');
  const token = bearer(c.req.header('authorization'));
  if (!token) return { userId: null, isAdmin: false };
  try {
    const principal = await container.auth.verify(token);
    return { userId: principal.userId, isAdmin: await container.account.isAdmin(principal) };
  } catch {
    return { userId: null, isAdmin: false };
  }
}

/** Public course page. If a valid token is sent, `owned` reflects the caller. */
catalogueRoutes.get('/courses/:idOrSlug', async (c) => {
  const { userId, isAdmin } = await optionalViewer(c);
  return c.json(await c.get('container').catalogue.course(c.req.param('idOrSlug'), userId, isAdmin));
});

catalogueRoutes.get('/bundles', async (c) => {
  const batch = z.coerce
    .number()
    .int()
    .min(2000)
    .max(2100)
    .optional()
    .parse(c.req.query('batch') || undefined);
  c.header('cache-control', 'no-store');
  return c.json(await c.get('container').catalogue.bundleCards(batch));
});

catalogueRoutes.get('/bundles/:idOrSlug', async (c) => {
  const { userId, isAdmin } = await optionalViewer(c);
  return c.json(await c.get('container').catalogue.bundle(c.req.param('idOrSlug'), userId, isAdmin));
});

/** First page of a unit, watermarked "PREVIEW". Public and cacheable. */
catalogueRoutes.get('/previews/:fileId', async (c) => {
  const obj = await c.get('container').catalogue.preview(c.req.param('fileId'));
  return new Response(obj.body as BodyInit, {
    headers: {
      'content-type': obj.contentType,
      'cache-control': 'public, max-age=86400',
      'x-content-type-options': 'nosniff',
    },
  });
});

/** The free toolbox on the home page. */
catalogueRoutes.get('/features', async (c) => {
  c.header('cache-control', 'no-store');
  return c.json(await c.get('container').announcements.publicFeatures());
});

/** From the link in every announcement email (and one-click List-Unsubscribe). */
catalogueRoutes.post('/email/unsubscribe', async (c) => {
  await throttle(c, 'unsubscribe', (await requestMeta(c)).ipHash);
  const fromQuery = c.req.query('t');
  const token = fromQuery ?? UnsubscribeBody.parse(await c.req.json()).token;
  await c.get('container').announcements.unsubscribe(token);
  return c.json({ ok: true });
});

/**
 * A student's browser reporting something unexpected (a crash, a page image that would not load,
 * a blocked script). Anonymous and rate-limited; it goes to the admin's Problems log only.
 */
catalogueRoutes.post('/problems', async (c) => {
  const meta = await requestMeta(c);
  await throttle(c, 'problems', meta.ipHash);
  const raw = await c.req.text();
  if (raw.length > 4000) return c.body(null, 204);
  const parsed = ClientProblemBody.safeParse(JSON.parse(raw || '{}'));
  if (parsed.success) await c.get('container').problems.fromBrowser(parsed.data, meta.userAgent);
  return c.body(null, 204);
});
