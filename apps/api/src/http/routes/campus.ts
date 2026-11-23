import {
  MessReportBody,
  MessReportStatusBody,
  PushEndpointBody,
  PushPrefsBody,
  PushRenewBody,
  PushSubscribeBody,
  SaveMessBody,
} from '@ss/contracts';
import { type Context, Hono } from 'hono';
import { fail } from '../../application/errors';
import type { Principal } from '../../domain/entities';
import { type AppEnv, authenticate, requestMeta, requireLive, throttle } from '../helpers';

/** Mess menus and push reminders. Students reach them once the matching tool is live. */
export const campusRoutes = new Hono<AppEnv>();

type Ctx = Context<AppEnv>;

/** The caller, if signed in (these pages also work signed out). */
async function maybeSignedIn(c: Ctx): Promise<Principal | null> {
  if (!c.req.header('authorization')) return null;
  return authenticate(c).catch(() => null);
}

/** Admins may try a tool before it launches. */
async function callerIsAdmin(c: Ctx, principal?: Principal | null) {
  const p = principal === undefined ? await maybeSignedIn(c) : principal;
  return p ? c.get('container').account.isAdmin(p) : false;
}

async function requireAdmin(c: Ctx) {
  const live = await requireLive(c);
  if (!(await c.get('container').account.isAdmin(live.principal))) throw fail.forbidden();
  return live;
}

// ── Mess menus ──

campusRoutes.get('/mess', async (c) => {
  return c.json(await c.get('container').mess.list(await callerIsAdmin(c)));
});

campusRoutes.get('/mess/:slug', async (c) => {
  return c.json(await c.get('container').mess.get(c.req.param('slug'), await callerIsAdmin(c)));
});

/** "Something changed? Tell us": a correction to a menu, read in Admin › Campus. */
campusRoutes.post('/mess/reports', async (c) => {
  const { ipHash } = await requestMeta(c);
  await throttle(c, 'mess-report', ipHash);
  const body = MessReportBody.parse(await c.req.json());
  await c.get('container').mess.report(body, ipHash, await callerIsAdmin(c));
  return c.json({ ok: true });
});

// ── Reminders (one device = one push address) ──

campusRoutes.get('/push/status', async (c) => {
  return c.json(await c.get('container').reminders.status(await callerIsAdmin(c)));
});

campusRoutes.post('/push/subscribe', async (c) => {
  await throttle(c, 'push-subscribe', (await requestMeta(c)).ipHash);
  const body = PushSubscribeBody.parse(await c.req.json());
  const principal = await maybeSignedIn(c);
  await c
    .get('container')
    .reminders.subscribe(body, principal?.userId ?? null, await callerIsAdmin(c, principal));
  return c.json({ ok: true });
});

// The push address is long, random and known only to that browser: it is the device's key.
campusRoutes.put('/push/prefs', async (c) => {
  const { endpoint, prefs } = PushPrefsBody.parse(await c.req.json());
  await c.get('container').reminders.setPrefs(endpoint, prefs);
  return c.json({ ok: true });
});

campusRoutes.post('/push/unsubscribe', async (c) => {
  const { endpoint } = PushEndpointBody.parse(await c.req.json());
  await c.get('container').reminders.unsubscribe(endpoint);
  return c.json({ ok: true });
});

/** "Mute today" on a notification (sent by the service worker). */
campusRoutes.post('/push/mute', async (c) => {
  const { endpoint } = PushEndpointBody.parse(await c.req.json());
  await c.get('container').reminders.mute(endpoint);
  return c.json({ ok: true });
});

campusRoutes.post('/push/renew', async (c) => {
  await throttle(c, 'push-subscribe', (await requestMeta(c)).ipHash);
  await c.get('container').reminders.renew(PushRenewBody.parse(await c.req.json()));
  return c.json({ ok: true });
});

campusRoutes.post('/push/test', async (c) => {
  await throttle(c, 'push-test', (await requestMeta(c)).ipHash);
  const { endpoint } = PushEndpointBody.parse(await c.req.json());
  await c.get('container').reminders.test(endpoint);
  return c.json({ ok: true });
});

/** A signed-in student's devices that get reminders (to switch one off from another). */
campusRoutes.get('/push/devices', async (c) => {
  const principal = await authenticate(c);
  return c.json(await c.get('container').reminders.devices(principal.userId));
});

campusRoutes.delete('/push/devices/:id', async (c) => {
  const principal = await authenticate(c);
  await c.get('container').reminders.removeDevice(principal.userId, c.req.param('id'));
  return c.json({ ok: true });
});

// ── Admin ──

campusRoutes.get('/admin/mess', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').mess.all());
});

campusRoutes.post('/admin/mess', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').mess.create(SaveMessBody.parse(await c.req.json())));
});

campusRoutes.put('/admin/mess/:slug', async (c) => {
  await requireAdmin(c);
  return c.json(
    await c.get('container').mess.update(c.req.param('slug'), SaveMessBody.parse(await c.req.json())),
  );
});

campusRoutes.delete('/admin/mess/:slug', async (c) => {
  await requireAdmin(c);
  await c.get('container').mess.remove(c.req.param('slug'));
  return c.json({ ok: true });
});

campusRoutes.get('/admin/mess-reports', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').mess.listReports());
});

campusRoutes.put('/admin/mess-reports/:id', async (c) => {
  await requireAdmin(c);
  const { status } = MessReportStatusBody.parse(await c.req.json());
  await c.get('container').mess.setReportStatus(c.req.param('id'), status);
  return c.json({ ok: true });
});

campusRoutes.get('/admin/push', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').reminders.adminStats());
});

/** Sends whatever is due right now (the same as the five-minute cron). */
campusRoutes.post('/admin/push/run', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').reminders.run());
});
