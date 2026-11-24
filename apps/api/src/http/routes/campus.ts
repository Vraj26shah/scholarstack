import {
  ChatBlockBody,
  ChatMessageBody,
  ChatReportBody,
  ChatReportStatusBody,
  MESS_PHOTO_MAX_BYTES,
  MessOrderStatusBody,
  MessOrdersOpenBody,
  MessReportBody,
  MessReportStatusBody,
  OwnerMessBody,
  PlaceMessOrderBody,
  PushAccountBody,
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

/**
 * A photo upload's raw bytes. Anything declared bigger than the limit is refused
 * before it is read, so a huge body can't use up the Worker's memory.
 */
async function readPhoto(c: Ctx): Promise<Uint8Array> {
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > MESS_PHOTO_MAX_BYTES) throw fail.badRequest('That photo is too big. Use one under 1.5 MB.');
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength > MESS_PHOTO_MAX_BYTES)
    throw fail.badRequest('That photo is too big. Use one under 1.5 MB.');
  return bytes;
}

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

// ── Orders: students order from a restaurant; its owner runs them from /orders ──

/** Ordering needs a signed-in student (a real, verified college address) on their live device. */
campusRoutes.post('/mess/:slug/orders', async (c) => {
  const { principal } = await requireLive(c);
  const { ipHash } = await requestMeta(c);
  await throttle(c, 'mess-order', principal.userId);
  const body = PlaceMessOrderBody.parse(await c.req.json());
  const k = c.get('container');
  return c.json(
    await k.orders.place(principal, await k.account.isAdmin(principal), c.req.param('slug'), body, ipHash),
  );
});

campusRoutes.get('/me/mess-orders', async (c) => {
  const { principal } = await requireLive(c);
  return c.json(await c.get('container').orders.mine(principal));
});

campusRoutes.post('/me/mess-orders/:id/cancel', async (c) => {
  const { principal } = await requireLive(c);
  return c.json(await c.get('container').orders.cancel(principal, c.req.param('id')));
});

/** The restaurants the caller runs (admins: all of them). Empty for everyone else. */
campusRoutes.get('/owner/messes', async (c) => {
  const { principal } = await requireLive(c);
  const k = c.get('container');
  return c.json(await k.orders.owned(principal, await k.account.isAdmin(principal)));
});

campusRoutes.get('/owner/messes/:slug/orders', async (c) => {
  const { principal } = await requireLive(c);
  const k = c.get('container');
  return c.json(await k.orders.board(principal, await k.account.isAdmin(principal), c.req.param('slug')));
});

campusRoutes.put('/owner/messes/:slug/open', async (c) => {
  const { principal } = await requireLive(c);
  const { open } = MessOrdersOpenBody.parse(await c.req.json());
  const k = c.get('container');
  return c.json(
    await k.orders.setOpen(principal, await k.account.isAdmin(principal), c.req.param('slug'), open),
  );
});

/** The owner's dashboard: their restaurant, to edit. */
campusRoutes.get('/owner/messes/:slug', async (c) => {
  const { principal } = await requireLive(c);
  const k = c.get('container');
  return c.json(await k.orders.ownerMess(principal, await k.account.isAdmin(principal), c.req.param('slug')));
});

campusRoutes.put('/owner/messes/:slug', async (c) => {
  const { principal } = await requireLive(c);
  await throttle(c, 'owner-save', principal.userId);
  const body = OwnerMessBody.parse(await c.req.json());
  const k = c.get('container');
  return c.json(
    await k.orders.ownerSave(principal, await k.account.isAdmin(principal), c.req.param('slug'), body),
  );
});

/** An item photo: the raw image bytes as the body (the dashboard shrinks it first). */
campusRoutes.post('/owner/messes/:slug/photos', async (c) => {
  const { principal } = await requireLive(c);
  await throttle(c, 'owner-photo', principal.userId);
  const bytes = await readPhoto(c);
  const k = c.get('container');
  return c.json(
    await k.orders.ownerPhoto(principal, await k.account.isAdmin(principal), c.req.param('slug'), bytes),
  );
});

/** Item photos on the public menu. Names are random and never reused, so they cache for good. */
campusRoutes.get('/mess-photos/:slug/:file', async (c) => {
  const found = await c.get('container').orders.photo(c.req.param('slug'), c.req.param('file'));
  if (!found) return c.body(null, 404);
  return new Response(found.body as BodyInit, {
    headers: {
      'content-type': found.contentType,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
});

campusRoutes.put('/owner/orders/:id', async (c) => {
  const { principal } = await requireLive(c);
  const { status, note } = MessOrderStatusBody.parse(await c.req.json());
  const k = c.get('container');
  return c.json(
    await k.orders.setStatus(principal, await k.account.isAdmin(principal), c.req.param('id'), status, note),
  );
});

/** How fast this restaurant usually answers (public, on its page). */
campusRoutes.get('/mess/:slug/reply-time', async (c) => {
  const k = c.get('container');
  await k.mess.get(c.req.param('slug'), await callerIsAdmin(c));
  c.header('cache-control', 'public, max-age=300');
  return c.json(await k.orders.replyTime(c.req.param('slug')));
});

// ── Order chat: the student and the restaurant, one chat per order ──

/** The caller, and whether they are an admin (admins may act as any restaurant's owner). */
async function chatCaller(c: Ctx) {
  const { principal } = await requireLive(c);
  const isAdmin = await c.get('container').account.isAdmin(principal);
  // From the restaurant's dashboard: answer as the restaurant, even on an order of one's own.
  const asOwner = c.req.header('x-chat-side') === 'owner';
  return { principal, admin: { admin: isAdmin, asOwner }, isAdmin };
}

campusRoutes.get('/chats/:id', async (c) => {
  const { principal, admin } = await chatCaller(c);
  return c.json(await c.get('container').chats.get(principal, admin, c.req.param('id')));
});

campusRoutes.post('/chats/:id/messages', async (c) => {
  const { principal, admin } = await chatCaller(c);
  await throttle(c, 'chat-send', principal.userId);
  const body = ChatMessageBody.parse(await c.req.json());
  return c.json(await c.get('container').chats.send(principal, admin, c.req.param('id'), body));
});

/** A photo for the chat: raw image bytes (the page shrinks it first). Then sent as a message. */
campusRoutes.post('/chats/:id/photos', async (c) => {
  const { principal, admin } = await chatCaller(c);
  await throttle(c, 'chat-photo', principal.userId);
  const bytes = await readPhoto(c);
  return c.json(await c.get('container').chats.uploadPhoto(principal, admin, c.req.param('id'), bytes));
});

/** Chat photos are private: only the two sides of the order and admins can load them. */
campusRoutes.get('/chats/:id/photos/:file', async (c) => {
  const principal = await authenticate(c);
  const k = c.get('container');
  const found = await k.chats.photo(
    principal,
    await k.account.isAdmin(principal),
    c.req.param('id'),
    c.req.param('file'),
  );
  if (!found) return c.body(null, 404);
  return new Response(found.body as BodyInit, {
    headers: {
      'content-type': found.contentType,
      'cache-control': 'private, max-age=86400',
      'x-content-type-options': 'nosniff',
    },
  });
});

campusRoutes.post('/chats/:id/read', async (c) => {
  const { principal, admin } = await chatCaller(c);
  await c.get('container').chats.read(principal, admin, c.req.param('id'));
  return c.json({ ok: true });
});

campusRoutes.post('/chats/:id/clear', async (c) => {
  const { principal, admin } = await chatCaller(c);
  await c.get('container').chats.clear(principal, admin, c.req.param('id'));
  return c.json({ ok: true });
});

campusRoutes.post('/chats/:id/report', async (c) => {
  const { principal, admin } = await chatCaller(c);
  await throttle(c, 'chat-report', principal.userId);
  const { reason } = ChatReportBody.parse(await c.req.json());
  await c.get('container').chats.report(principal, admin, c.req.param('id'), reason);
  return c.json({ ok: true });
});

campusRoutes.post('/chats/:id/block', async (c) => {
  const { principal, admin } = await chatCaller(c);
  const { reason } = ChatBlockBody.parse(await c.req.json().catch(() => ({})));
  await c.get('container').chats.block(principal, admin, c.req.param('id'), reason);
  return c.json({ ok: true });
});

campusRoutes.delete('/chats/:id/block', async (c) => {
  const { principal, admin } = await chatCaller(c);
  await c.get('container').chats.unblock(principal, admin, c.req.param('id'));
  return c.json({ ok: true });
});

campusRoutes.get('/owner/messes/:slug/blocks', async (c) => {
  const { principal, isAdmin } = await chatCaller(c);
  return c.json(await c.get('container').chats.ownerBlocks(principal, isAdmin, c.req.param('slug')));
});

campusRoutes.delete('/owner/messes/:slug/blocks/:userId', async (c) => {
  const { principal, isAdmin } = await chatCaller(c);
  await c.get('container').chats.ownerUnblock(principal, isAdmin, c.req.param('slug'), c.req.param('userId'));
  return c.json({ ok: true });
});

/** This device gets order alerts and chat messages for the signed-in account. */
campusRoutes.post('/push/account', async (c) => {
  const principal = await authenticate(c);
  await throttle(c, 'push-subscribe', principal.userId);
  const body = PushAccountBody.parse(await c.req.json());
  await c.get('container').reminders.subscribeAccount(body, principal);
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
  const saved = await c.get('container').mess.create(SaveMessBody.parse(await c.req.json()));
  c.get('container').orders.forgetOwners();
  return c.json(saved);
});

campusRoutes.put('/admin/mess/:slug', async (c) => {
  await requireAdmin(c);
  const saved = await c
    .get('container')
    .mess.update(c.req.param('slug'), SaveMessBody.parse(await c.req.json()));
  c.get('container').orders.forgetOwners();
  return c.json(saved);
});

campusRoutes.delete('/admin/mess/:slug', async (c) => {
  await requireAdmin(c);
  await c.get('container').mess.remove(c.req.param('slug'));
  c.get('container').orders.forgetOwners();
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

// Orders & chats: the whole workflow, notification health, reports, blocks, any chat in full.

campusRoutes.get('/admin/orders/overview', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').chats.adminOverview());
});

campusRoutes.get('/admin/orders', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').chats.adminOrders(c.req.query('mess') || undefined));
});

campusRoutes.get('/admin/orders/:id/chat', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').chats.adminChat(c.req.param('id')));
});

/** Deletes every message of a chat, for everyone (only admins can). */
campusRoutes.delete('/admin/orders/:id/chat', async (c) => {
  await requireAdmin(c);
  await c.get('container').chats.adminClear(c.req.param('id'));
  return c.json({ ok: true });
});

campusRoutes.get('/admin/chat-reports', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').chats.adminReports());
});

campusRoutes.put('/admin/chat-reports/:id', async (c) => {
  await requireAdmin(c);
  const { status } = ChatReportStatusBody.parse(await c.req.json());
  await c.get('container').chats.setReportStatus(c.req.param('id'), status);
  return c.json({ ok: true });
});

campusRoutes.get('/admin/mess-blocks', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').chats.adminBlocks());
});

campusRoutes.delete('/admin/mess-blocks/:slug/:userId', async (c) => {
  await requireAdmin(c);
  await c.get('container').chats.adminUnblock(c.req.param('slug'), c.req.param('userId'));
  return c.json({ ok: true });
});

/** A test notification to every owner device of a restaurant. */
campusRoutes.post('/admin/mess/:slug/test-alert', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').chats.testAlert(c.req.param('slug')));
});

/** Sends whatever is due right now (the same as the five-minute cron). */
campusRoutes.post('/admin/push/run', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').reminders.run());
});
