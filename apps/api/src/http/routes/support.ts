import { SUPPORT_LIMITS, SupportCreateBody, SupportReplyBody } from '@ss/contracts';
import { Hono } from 'hono';
import { type AppEnv, requireLive, throttle } from '../helpers';
import { attachment, readUploadForm } from '../upload-form';

/** The student's help desk. Signed-in students only; every action is rate limited. */
export const supportRoutes = new Hono<AppEnv>();

supportRoutes.get('/support', async (c) => {
  const { principal } = await requireLive(c);
  return c.json(await c.get('container').support.mine(principal));
});

supportRoutes.post('/support', async (c) => {
  const { principal } = await requireLive(c);
  await throttle(c, 'support', principal.userId);
  const { meta, files } = await readUploadForm(c, SUPPORT_LIMITS.bytesPerFile * SUPPORT_LIMITS.filesPerQuery);
  const body = SupportCreateBody.parse(meta);
  return c.json(await c.get('container').support.ask(principal, body, files), 201);
});

supportRoutes.post('/support/:id/reply', async (c) => {
  const { principal } = await requireLive(c);
  await throttle(c, 'support', principal.userId);
  const { body } = SupportReplyBody.parse(await c.req.json());
  return c.json(await c.get('container').support.reply(principal, c.req.param('id'), body));
});

supportRoutes.post('/support/:id/close', async (c) => {
  const { principal } = await requireLive(c);
  return c.json(await c.get('container').support.close(principal, c.req.param('id')));
});

supportRoutes.get('/support/:id/files/:index', async (c) => {
  const { principal } = await requireLive(c);
  return attachment(
    await c.get('container').support.file(principal, c.req.param('id'), Number(c.req.param('index'))),
  );
});
