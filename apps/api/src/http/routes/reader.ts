import { HeartbeatBody, OpenReaderBody, TILE_SEED_HEADER, VIEWER_TOKEN_HEADER } from '@ss/contracts';
import { Hono } from 'hono';
import { fail } from '../../application/errors';
import { type AppEnv, requestMeta, requireLive } from '../helpers';

export const readerRoutes = new Hono<AppEnv>();

readerRoutes.post('/reader/open', async (c) => {
  const { principal, deviceId } = await requireLive(c);
  const { fileId } = OpenReaderBody.parse(await c.req.json());
  const container = c.get('container');
  return c.json(
    await container.reader.open(principal, deviceId, fileId, container.account.isAdmin(principal)),
  );
});

readerRoutes.post('/reader/heartbeat', async (c) => {
  const { principal, deviceId } = await requireLive(c);
  const token = c.req.header(VIEWER_TOKEN_HEADER);
  if (!token) throw fail.viewerToken();
  const body = HeartbeatBody.parse(await c.req.json());
  return c.json(
    await c.get('container').reader.heartbeat(principal, deviceId, token, body, await requestMeta(c)),
  );
});

/**
 * Hot path. Authorised by the short-lived viewer token alone (no database hit).
 * The image is tile-scrambled; the seed rides in a header and the reader reassembles it.
 */
readerRoutes.get('/reader/pages/:fileId/:page', async (c) => {
  const token = c.req.header(VIEWER_TOKEN_HEADER);
  if (!token) throw fail.viewerToken();
  const page = await c
    .get('container')
    .reader.page(token, c.req.param('fileId'), Number(c.req.param('page')));
  return new Response(page.body as BodyInit, {
    headers: {
      'content-type': page.contentType,
      'cache-control': 'no-store, private',
      'content-disposition': 'inline',
      'x-content-type-options': 'nosniff',
      [TILE_SEED_HEADER]: page.tileSeed,
      'access-control-expose-headers': TILE_SEED_HEADER,
    },
  });
});
