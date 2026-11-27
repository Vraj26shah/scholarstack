import {
  AdminPushTestBody,
  ChatBlockBody,
  ChatMessageBody,
  ChatReportBody,
  ChatReportStatusBody,
  HandoverBody,
  INSIGHT_PERIODS,
  type InsightPeriod,
  MESS_PHOTO_MAX_BYTES,
  MessOrderStatusBody,
  MessOrdersOpenBody,
  MessReportBody,
  MessReportStatusBody,
  OrderDisputeBody,
  OwnerMessBody,
  PhoneCheckBody,
  PhoneStartBody,
  PlaceMessOrderBody,
  PresenceLeaveBody,
  PushAccountBody,
  PushEndpointBody,
  PushPrefsBody,
  PushReceiptBody,
  PushRenewBody,
  PushSubscribeBody,
  PushTestBody,
  SaveMessBody,
  TiffinConfirmBody,
  TiffinMarkBody,
  partnerLoginSchema,
  partnerSetPinSchema,
} from '@ss/contracts';
import { type Context, Hono } from 'hono';
import { fail } from '../../application/errors';
import type { Principal } from '../../domain/entities';
import { whatsappSignatureOk, whatsappTexts } from '../../infrastructure/whatsapp';
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

/**
 * This person has this order screen open (its regular refresh says so): notifications about what
 * it shows are skipped while they look. Written after the answer when the platform allows.
 */
async function seen(c: Ctx, scope: string, email: string) {
  const job = c
    .get('container')
    .orders.here(scope, email)
    .catch(() => {});
  try {
    c.executionCtx.waitUntil(job);
  } catch {
    await job;
  }
}
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

/** A restaurant page was opened (once per visitor per day, from the page): its owner's view count. */
campusRoutes.post('/mess/:slug/view', async (c) => {
  const { ipHash } = await requestMeta(c);
  await throttle(c, 'mess-view', ipHash);
  const principal = await maybeSignedIn(c);
  const k = c.get('container');
  await k.orders
    .recordView(c.req.param('slug'), principal, await callerIsAdmin(c, principal), ipHash)
    .catch(() => {});
  return c.json({ ok: true });
});

/** The owner's insights: ?period=day|week|month|year&date=YYYY-MM-DD (default today). */
campusRoutes.get('/owner/messes/:slug/insights', async (c) => {
  const { principal } = await requireLive(c);
  const k = c.get('container');
  const raw = c.req.query('period');
  const period = (INSIGHT_PERIODS as readonly string[]).includes(raw ?? '') ? (raw as InsightPeriod) : 'day';
  return c.json(
    await k.orders.insights(
      principal,
      await k.account.isAdmin(principal),
      c.req.param('slug'),
      period,
      c.req.query('date'),
    ),
  );
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

// ── The student's mobile number: checked once with an SMS code, then used on every order ──

campusRoutes.get('/me/phone', async (c) => {
  const { principal } = await requireLive(c);
  return c.json(await c.get('container').phones.status(principal.userId));
});

campusRoutes.post('/me/phone/start', async (c) => {
  const { principal } = await requireLive(c);
  await throttle(c, 'phone-otp', principal.userId);
  const { phone } = PhoneStartBody.parse(await c.req.json());
  return c.json(await c.get('container').phones.start(principal.userId, phone));
});

campusRoutes.post('/me/phone/check', async (c) => {
  const { principal } = await requireLive(c);
  await throttle(c, 'phone-otp', principal.userId);
  const { phone, code } = PhoneCheckBody.parse(await c.req.json());
  return c.json(await c.get('container').phones.check(principal.userId, phone, code));
});

campusRoutes.get('/me/mess-orders', async (c) => {
  const { principal } = await requireLive(c);
  await seen(c, 'orders', principal.email);
  return c.json(await c.get('container').orders.mine(principal));
});

/** The student got the food ("I got it"), or confirms a handover marked without their code. */
campusRoutes.post('/me/mess-orders/:id/received', async (c) => {
  const { principal } = await requireLive(c);
  return c.json(await c.get('container').orders.confirmReceived(principal, c.req.param('id')));
});

/** The student contests: food that never came, or a "didn't collect". The admin decides. */
campusRoutes.post('/me/mess-orders/:id/dispute', async (c) => {
  const { principal } = await requireLive(c);
  await throttle(c, 'order-dispute', principal.userId);
  const { kind, note } = OrderDisputeBody.parse(await c.req.json());
  return c.json(await c.get('container').orders.dispute(principal, c.req.param('id'), kind, note));
});

/** The student about one tiffin meal: got it, or didn't. Answers with their orders. */
campusRoutes.post('/me/tiffin/confirm', async (c) => {
  const { principal } = await requireLive(c);
  const body = TiffinConfirmBody.parse(await c.req.json());
  return c.json(await c.get('container').orders.confirmTiffin(principal, body));
});

/** They left these order screens (tab hidden, app sent to the background): notify them again. */
campusRoutes.post('/me/presence/leave', async (c) => {
  const { principal } = await requireLive(c);
  const { scopes } = PresenceLeaveBody.parse(await c.req.json());
  await c.get('container').orders.left(scopes, principal.email);
  return c.json({ ok: true });
});

campusRoutes.post('/me/mess-orders/:id/cancel', async (c) => {
  const { principal } = await requireLive(c);
  return c.json(await c.get('container').orders.cancel(principal, c.req.param('id')));
});

/** The student paid a pay-first order by UPI: the restaurant is told to check. */
campusRoutes.post('/me/mess-orders/:id/paid', async (c) => {
  const { principal } = await requireLive(c);
  return c.json(await c.get('container').orders.claimPaid(principal, c.req.param('id')));
});

/** Orders not collected, and whether that means paying first or a pause (for the cart). */
campusRoutes.get('/me/order-standing', async (c) => {
  const { principal } = await requireLive(c);
  return c.json(await c.get('container').orders.standing(principal));
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
  await seen(c, `board:${c.req.param('slug')}`, principal.email);
  return c.json(await k.orders.board(principal, await k.account.isAdmin(principal), c.req.param('slug')));
});

/** The restaurant's own fee statement for a month (?period=YYYY-MM): read only. */
campusRoutes.get('/owner/messes/:slug/fees', async (c) => {
  const { principal } = await requireLive(c);
  const k = c.get('container');
  await k.orders.ownedMess(principal, await k.account.isAdmin(principal), c.req.param('slug'));
  return c.json(await k.fees.statement(c.req.param('slug'), c.req.query('period'), true));
});

/** One customer's record at this restaurant (12 months): visits, every order, habits. */
campusRoutes.get('/owner/messes/:slug/customers/:userId', async (c) => {
  const { principal } = await requireLive(c);
  const k = c.get('container');
  return c.json(
    await k.orders.customer(
      principal,
      await k.account.isAdmin(principal),
      c.req.param('slug'),
      c.req.param('userId'),
    ),
  );
});

/** The owner's customers: everyone who ordered in the last 90 days. */
campusRoutes.get('/owner/messes/:slug/customers', async (c) => {
  const { principal } = await requireLive(c);
  const k = c.get('container');
  return c.json(await k.orders.customers(principal, await k.account.isAdmin(principal), c.req.param('slug')));
});

/** The tiffin delivery sheet for a day (?date=YYYY-MM-DD, default today on campus). */
/** The owner marks a tiffin meal delivered or missed (or a make-up meal given). */
campusRoutes.put('/owner/tiffin/marks', async (c) => {
  const { principal } = await requireLive(c);
  const body = TiffinMarkBody.parse(await c.req.json());
  const k = c.get('container');
  return c.json(await k.orders.markTiffin(principal, await k.account.isAdmin(principal), body));
});

campusRoutes.get('/owner/messes/:slug/tiffin', async (c) => {
  const { principal } = await requireLive(c);
  const k = c.get('container');
  return c.json(
    await k.orders.tiffinSheet(
      principal,
      await k.account.isAdmin(principal),
      c.req.param('slug'),
      c.req.query('date'),
    ),
  );
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

/** The owner saw a pay-first order's UPI payment arrive. */
campusRoutes.post('/owner/orders/:id/paid', async (c) => {
  const { principal } = await requireLive(c);
  const k = c.get('container');
  return c.json(await k.orders.confirmPaid(principal, await k.account.isAdmin(principal), c.req.param('id')));
});

/** The restaurant hands the food over: with the student's code, or without (the student confirms). */
campusRoutes.post('/owner/orders/:id/handover', async (c) => {
  const { principal } = await requireLive(c);
  const body = HandoverBody.parse(await c.req.json());
  const k = c.get('container');
  return c.json(
    await k.orders.handover(principal, await k.account.isAdmin(principal), c.req.param('id'), body),
  );
});

/** The student never collected an accepted order. */
campusRoutes.post('/owner/orders/:id/no-show', async (c) => {
  const { principal } = await requireLive(c);
  const k = c.get('container');
  return c.json(await k.orders.noShow(principal, await k.account.isAdmin(principal), c.req.param('id')));
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
  await seen(c, `chat:${c.req.param('id')}`, principal.email);
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

/**
 * "It reached the screen": the service worker reports each notification it showed. The push
 * address is the device's secret key, so only that device can report for itself.
 */
campusRoutes.post('/push/receipt', async (c) => {
  await throttle(c, 'push-receipt', (await requestMeta(c)).ipHash);
  const { endpoint, tag, event } = PushReceiptBody.parse(await c.req.json());
  await c.get('container').reminders.receipt(endpoint, tag, event);
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
  const { endpoint, kind } = PushTestBody.parse(await c.req.json());
  await c.get('container').reminders.test(endpoint, kind);
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

/** Clears every chat (?mess=slug for one restaurant) for everyone. Admins only. */
campusRoutes.delete('/admin/chats', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').chats.adminClearAll(c.req.query('mess') || undefined));
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

/** Every device of these people (comma-separated emails), with when each last showed one. */
campusRoutes.get('/admin/push/devices', async (c) => {
  await requireAdmin(c);
  const emails = (c.req.query('emails') ?? '').split(',').slice(0, 10);
  return c.json(await c.get('container').reminders.devicesOf(emails));
});

/** A test notification to every device of one person. */
/** A student changed SIMs: forget their checked number so they can check the new one. */
campusRoutes.post('/admin/phones/reset', async (c) => {
  await requireAdmin(c);
  const { email } = AdminPushTestBody.parse(await c.req.json());
  return c.json(await c.get('container').phones.resetByEmail(email));
});

campusRoutes.post('/admin/push/test-person', async (c) => {
  await requireAdmin(c);
  const { email } = AdminPushTestBody.parse(await c.req.json());
  return c.json(await c.get('container').reminders.testPerson(email));
});

/** Sends whatever is due right now (the same as the five-minute cron). */
campusRoutes.post('/admin/push/run', async (c) => {
  await requireAdmin(c);
  return c.json(await c.get('container').reminders.run());
});

// ── Partner app: restaurant owners sign in with mobile number + PIN ──

campusRoutes.get('/partner/status', (c) => c.json({ available: c.get('container').partnerLogin.available }));

/** Step one: what this number needs next (its PIN, or the setup code and a new PIN). */
campusRoutes.post('/partner/lookup', async (c) => {
  await throttle(c, 'partner-login', (await requestMeta(c)).ipHash);
  const { phone } = partnerLoginSchema.pick({ phone: true }).parse(await c.req.json());
  return c.json(await c.get('container').partnerLogin.lookup(phone));
});

campusRoutes.post('/partner/login', async (c) => {
  await throttle(c, 'partner-login', (await requestMeta(c)).ipHash);
  const body = partnerLoginSchema.parse(await c.req.json());
  return c.json(await c.get('container').partnerLogin.login(body));
});

campusRoutes.post('/partner/set-pin', async (c) => {
  await throttle(c, 'partner-login', (await requestMeta(c)).ipHash);
  const body = partnerSetPinSchema.parse(await c.req.json());
  return c.json(await c.get('container').partnerLogin.setPin(body));
});

// ── Free phone checks through WhatsApp ──

/** A one-time code for this account; the student sends "VERIFY <code>" from their WhatsApp. */
campusRoutes.post('/me/phone/whatsapp', async (c) => {
  const { principal } = await requireLive(c);
  await throttle(c, 'phone-whatsapp', principal.userId);
  return c.json(await c.get('container').phones.startWhatsApp(principal.userId));
});

/** Meta's one-time handshake when the webhook is set up (echo the challenge if the token matches). */
campusRoutes.get('/whatsapp/webhook', (c) => {
  const token = c.get('container').config.whatsappVerifyToken ?? '';
  const ok = c.req.query('hub.mode') === 'subscribe' && !!token && c.req.query('hub.verify_token') === token;
  return ok ? c.text(c.req.query('hub.challenge') ?? '') : c.text('Forbidden', 403);
});

/** Messages to the site's WhatsApp number. Signed by Meta; only "VERIFY <code>" does anything. */
campusRoutes.post('/whatsapp/webhook', async (c) => {
  const k = c.get('container');
  const raw = await c.req.text();
  if (
    !(await whatsappSignatureOk(k.config.whatsappAppSecret ?? '', raw, c.req.header('x-hub-signature-256')))
  )
    return c.text('Bad signature', 401);
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    return c.text('ok');
  }
  for (const m of whatsappTexts(body)) await k.phones.receiveWhatsApp(m.from, m.text).catch(() => false);
  // Always 200: Meta retries anything else, and a sender learns nothing either way.
  return c.text('ok');
});
