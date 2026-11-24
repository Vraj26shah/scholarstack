import { chatTextProblem } from '@ss/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import type { memoryContainer } from '../src/composition/memory';
import type { createApp } from '../src/http/app';
import { Browser, type TestClock, setup } from './harness';

let clock: TestClock;
let app: ReturnType<typeof createApp>;
let env: ReturnType<typeof memoryContainer>;

const OWNER = 'dhaba.owner@gmail.com';
const SLUG = 'radha-rani-ka-dhaba';

beforeEach(() => {
  ({ clock, env, app } = setup());
});

const signedIn = async (email: string) => {
  const b = new Browser(app);
  await b.signIn(email);
  return b;
};
const device = (n: number) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/account-${n}`,
  keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
  label: 'Android · Chrome',
});
const order = () => ({
  lines: [{ name: 'Mess thali', qty: 1, detail: '' }],
  mode: 'pickup',
  name: 'Asha',
  phone: '+91 98765 43210',
  phoneConfirmed: true,
});

/** The dhaba open for orders, run by OWNER; a student with an order; both with alerts on. */
async function scene() {
  const f = env.db.features.get('mess-menu')!;
  env.db.features.set('mess-menu', { ...f, status: 'live' });
  const admin = await signedIn('admin@vitbhopal.ac.in');
  const { updatedAt: _u, sort: _s, ...input } = (await admin.call('GET', `/mess/${SLUG}`)).json;
  await admin.call('PUT', `/admin/mess/${SLUG}`, {
    ...input,
    published: true,
    ordersOpen: true,
    ownerEmails: [OWNER],
  });
  const owner = await signedIn(OWNER);
  const student = await signedIn('student1@vitbhopal.ac.in');
  expect((await owner.call('POST', '/push/account', device(1))).status).toBe(200);
  expect((await student.call('POST', '/push/account', device(2))).status).toBe(200);
  const placed = (await student.call('POST', `/mess/${SLUG}/orders`, order())).json;
  return { admin, owner, student, placed };
}
const sentTo = (n: number) => env.campus.pushSender.sent.filter((s) => s.endpoint === device(n).endpoint);

describe('new-order alerts and the timers', () => {
  it("alerts the owner's devices, nudges at 3 minutes, and cancels at 10", async () => {
    const { owner, student, placed } = await scene();
    expect(sentTo(1).at(-1)!.message).toMatchObject({
      title: expect.stringContaining(placed.code),
      requireInteraction: true,
    });
    const admin = await signedIn('admin@vitbhopal.ac.in');
    const rows = (await admin.call('GET', '/admin/orders')).json;
    expect(rows[0]).toMatchObject({
      alertNote: 'Alert sent to 1 of 1 owner device',
      email: 'student1@vitbhopal.ac.in',
    });

    clock.t += 3.5 * 60_000;
    await owner.call('GET', `/owner/messes/${SLUG}/orders`);
    expect(sentTo(1).at(-1)!.message.title).toMatch(/Still waiting/);
    const nudges = sentTo(1).length;
    await owner.call('GET', `/owner/messes/${SLUG}/orders`);
    expect(sentTo(1).length).toBe(nudges); // only once

    clock.t += 7 * 60_000;
    const mine = (await student.call('GET', '/me/mess-orders')).json;
    expect(mine[0]).toMatchObject({ status: 'cancelled', endedBy: 'auto', unread: 1 });
    expect(sentTo(2).at(-1)!.message.body).toMatch(/didn't answer within 10 minutes/);
  });

  it('accepting stops the timers and counts toward the public reply time', async () => {
    const { owner, student, placed } = await scene();
    clock.t += 2 * 60_000;
    expect(
      (await owner.call('PUT', `/owner/orders/${placed.id}`, { status: 'accepted' })).json.respondedAt,
    ).toBeTruthy();
    expect(sentTo(2).at(-1)!.message.body).toMatch(/accepted/i);
    clock.t += 20 * 60_000;
    expect((await student.call('GET', '/me/mess-orders')).json[0].status).toBe('accepted');
    // Two more answered orders, so there are enough to show.
    for (let i = 0; i < 2; i++) {
      clock.t += 2 * 60_000;
      await owner.call('PUT', `/owner/orders/${placed.id}`, { status: i ? 'done' : 'ready' });
    }
    const other = await signedIn('student2@vitbhopal.ac.in');
    for (let i = 0; i < 2; i++) {
      clock.t += 61_000;
      const o = (await other.call('POST', `/mess/${SLUG}/orders`, order())).json;
      clock.t += 4 * 60_000;
      await owner.call('PUT', `/owner/orders/${o.id}`, { status: 'rejected', note: 'Closed now' });
    }
    const reply = (await other.call('GET', `/mess/${SLUG}/reply-time`)).json;
    expect(reply).toEqual({ minutes: 4, samples: 3 });
  });
});

describe('the chat on an order', () => {
  it('both sides write, get notified, see unread counts and read ticks', async () => {
    const { owner, student, placed } = await scene();
    const sent = await student.call('POST', `/chats/${placed.id}/messages`, { body: 'Less spicy please' });
    expect(sent.status).toBe(200);
    expect(sentTo(1).at(-1)!.message).toMatchObject({
      body: 'Less spicy please',
      tag: `chat-${placed.id}`,
      quietWhen: `chat=${placed.id}`,
    });
    const board = (await owner.call('GET', `/owner/messes/${SLUG}/orders`)).json;
    expect(board[0]).toMatchObject({ unread: 1, last: { sender: 'student', body: 'Less spicy please' } });
    expect((await owner.call('GET', '/owner/messes')).json[0].unread).toBe(1);

    const chat = (await owner.call('GET', `/chats/${placed.id}`)).json;
    expect(chat).toMatchObject({ role: 'owner', canSend: true, callPhone: '+919876543210' });
    await owner.call('POST', `/chats/${placed.id}/read`);
    expect((await student.call('GET', `/chats/${placed.id}`)).json.otherReadAt).toBeTruthy();

    clock.t += 90_000;
    await owner.call('POST', `/chats/${placed.id}/messages`, { body: 'Sure, ready in 10' });
    expect(sentTo(2).at(-1)!.message.body).toBe('Sure, ready in 10');
    expect((await student.call('GET', '/me/mess-orders')).json[0].unread).toBe(1);
    // The owner's answer counts as a reply time (90 s).
    expect(env.campus.orderChat.rows.at(-1)!.replyMs).toBe(90_000);
  });

  it('refuses links, phone numbers and emails, and strangers see nothing', async () => {
    const { student, placed } = await scene();
    for (const body of ['call me on 98765 43210', 'see www.example.com', 'mail me a@b.com', 'https://x.io/a'])
      expect((await student.call('POST', `/chats/${placed.id}/messages`, { body })).status).toBe(400);
    expect(
      (await student.call('POST', `/chats/${placed.id}/messages`, { body: '2 × ₹120 and 1 × ₹80' })).status,
    ).toBe(200);
    const stranger = await signedIn('student9@vitbhopal.ac.in');
    expect((await stranger.call('GET', `/chats/${placed.id}`)).status).toBe(404);
    expect((await stranger.call('POST', `/chats/${placed.id}/messages`, { body: 'hi' })).status).toBe(404);
  });

  it('limits how fast one person can send', async () => {
    const { student, placed } = await scene();
    let last = 0;
    for (let i = 0; i < 21; i++)
      last = (await student.call('POST', `/chats/${placed.id}/messages`, { body: `m${i}` })).status;
    expect(last).toBe(429);
  });

  it('clearing hides the chat only for whoever cleared it; the admin clears it for everyone', async () => {
    const { admin, owner, student, placed } = await scene();
    await student.call('POST', `/chats/${placed.id}/messages`, { body: 'Hello' });
    await owner.call('POST', `/chats/${placed.id}/messages`, { body: 'Hi!' });
    clock.t += 1000;
    expect((await owner.call('POST', `/chats/${placed.id}/clear`)).status).toBe(200);
    expect((await owner.call('GET', `/chats/${placed.id}`)).json.messages).toEqual([]);
    expect(
      (await student.call('GET', `/chats/${placed.id}`)).json.messages.map((m: { body: string }) => m.body),
    ).toEqual(['Hello', 'Hi!']);
    expect((await admin.call('GET', `/admin/orders/${placed.id}/chat`)).json.messages).toHaveLength(2);

    expect((await admin.call('DELETE', `/admin/orders/${placed.id}/chat`)).status).toBe(200);
    const after = (await student.call('GET', `/chats/${placed.id}`)).json.messages;
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ sender: 'system', body: expect.stringContaining('removed') });
  });

  it('the owner blocks and unblocks a student; a blocked student cannot order or write', async () => {
    const { admin, owner, student, placed } = await scene();
    expect((await student.call('POST', `/chats/${placed.id}/block`, {})).status).toBe(403); // students can't
    expect((await owner.call('POST', `/chats/${placed.id}/block`, { reason: 'Fake orders' })).status).toBe(
      200,
    );
    const chat = (await student.call('GET', `/chats/${placed.id}`)).json;
    expect(chat).toMatchObject({ blocked: true, canSend: false });
    expect((await student.call('POST', `/chats/${placed.id}/messages`, { body: 'hello?' })).status).toBe(400);
    await student.call('POST', `/me/mess-orders/${placed.id}/cancel`);
    clock.t += 2 * 60_000;
    const again = await student.call('POST', `/mess/${SLUG}/orders`, order());
    expect(again.status).toBe(400);
    expect(again.json.error.message).toMatch(/isn't taking orders from this account/);

    const blocks = (await owner.call('GET', `/owner/messes/${SLUG}/blocks`)).json;
    expect(blocks).toEqual([expect.objectContaining({ name: 'Asha', reason: 'Fake orders', email: '' })]);
    expect((await admin.call('GET', '/admin/mess-blocks')).json[0].email).toBe('student1@vitbhopal.ac.in');
    expect((await owner.call('DELETE', `/owner/messes/${SLUG}/blocks/${blocks[0].userId}`)).status).toBe(200);
    expect((await student.call('POST', `/mess/${SLUG}/orders`, order())).status).toBe(200);
  });

  it('a report from either side reaches the admin queue', async () => {
    const { admin, owner, placed } = await scene();
    expect((await owner.call('POST', `/chats/${placed.id}/report`, { reason: 'Rude messages' })).status).toBe(
      200,
    );
    const reports = (await admin.call('GET', '/admin/chat-reports')).json;
    expect(reports[0]).toMatchObject({
      by: 'owner',
      orderCode: placed.code,
      studentPhone: '9876543210',
      status: 'new',
    });
    expect((await admin.call('PUT', `/admin/chat-reports/${reports[0].id}`, { status: 'done' })).status).toBe(
      200,
    );
    const overview = (await admin.call('GET', '/admin/orders/overview')).json;
    expect(overview.restaurants[0]).toMatchObject({ slug: SLUG, ownerDevices: 1 });
    expect((await admin.call('POST', `/admin/mess/${SLUG}/test-alert`)).json).toEqual({
      devices: 1,
      sent: 1,
    });
  });
});

describe('chat text rules', () => {
  it('lets prices, codes and times through', () => {
    for (const ok of ['₹120 x 2', 'Order K7Q2 at 7:30', 'Room 214, block B', 'Ready in 15 min'])
      expect(chatTextProblem(ok)).toBeNull();
    expect(chatTextProblem('+91-98765-43210')).toMatch(/Phone/);
    expect(chatTextProblem('insta.com/me')).toMatch(/Links/);
  });
});

describe('testing your own restaurant', () => {
  it('an admin who placed an order answers it as the restaurant from the dashboard', async () => {
    const { admin } = await scene();
    const own = (await admin.call('POST', `/mess/${SLUG}/orders`, order())).json;
    expect((await admin.call('GET', `/chats/${own.id}`)).json.role).toBe('student');
    const asOwner = await admin.call('GET', `/chats/${own.id}`, undefined, { 'x-chat-side': 'owner' });
    expect(asOwner.json.role).toBe('owner');
    await admin.call(
      'POST',
      `/chats/${own.id}/messages`,
      { body: 'From the kitchen' },
      { 'x-chat-side': 'owner' },
    );
    const mine = (await admin.call('GET', '/me/mess-orders')).json.find(
      (o: { id: string }) => o.id === own.id,
    );
    expect(mine).toMatchObject({ unread: 1, last: { sender: 'owner', body: 'From the kitchen' } });
    // A stranger can't claim to be the restaurant.
    const other = await signedIn('student7@vitbhopal.ac.in');
    expect((await other.call('GET', `/chats/${own.id}`, undefined, { 'x-chat-side': 'owner' })).status).toBe(
      404,
    );
  });
});

describe('security', () => {
  it('refuses push addresses that are not a real push service (no SSRF)', async () => {
    const { student } = await scene();
    for (const endpoint of [
      'https://169.254.169.254/latest',
      'https://evil.example.com/hook',
      'https://fcm.googleapis.com.evil.com/x',
      'https://fcm.googleapis.com:8443/x',
      'http://fcm.googleapis.com/x',
    ])
      expect((await student.call('POST', '/push/account', { ...device(9), endpoint })).status).toBe(400);
  });

  it('does not let hidden characters or wide digits slip a phone number past the filter', () => {
    expect(chatTextProblem('9\u200B8\u200B7\u200B6\u200B5\u200B4\u200B3\u200B2\u200B1\u200B0')).toMatch(
      /Phone/,
    );
    expect(chatTextProblem('９８７６５４３２１０')).toMatch(/Phone/);
  });

  it('owners of another restaurant and signed-out visitors get nothing', async () => {
    const { placed } = await scene();
    expect((await new Browser(app).call('GET', `/chats/${placed.id}`)).status).toBe(401);
    expect(
      (await new Browser(app).call('GET', `/chats/${placed.id}/photos/${'a'.repeat(24)}.jpg`)).status,
    ).toBe(401);
    const otherOwner = await signedIn('student8@vitbhopal.ac.in');
    expect(
      (await otherOwner.call('GET', `/chats/${placed.id}`, undefined, { 'x-chat-side': 'owner' })).status,
    ).toBe(404);
    expect((await otherOwner.call('GET', '/admin/orders')).status).toBe(403);
    expect((await otherOwner.call('DELETE', `/admin/orders/${placed.id}/chat`)).status).toBe(403);
  });
});

describe('owners, devices and limits', () => {
  it('a restaurant owner can stay signed in on many devices (students keep two)', async () => {
    await scene();
    for (let i = 0; i < 6; i++) {
      const b = new Browser(app);
      expect((await b.signIn(OWNER, `Kitchen phone ${i}`)).status).toBe(200);
    }
    const me = (await (await signedIn(OWNER)).call('GET', '/me')).json;
    expect(me).toMatchObject({ maxDevices: 100, instantDeviceRemoval: true });
    // A student is still held to two.
    const s = 'student5@vitbhopal.ac.in';
    for (let i = 0; i < 2; i++) expect((await new Browser(app).signIn(s, `Phone ${i}`)).status).toBe(200);
    expect((await new Browser(app).signIn(s, 'Third phone')).status).not.toBe(200);
  });

  it("the owner's daily order limit stops orders for the rest of the day", async () => {
    const { owner } = await scene(); // one order already placed today
    const mess = (await owner.call('GET', `/owner/messes/${SLUG}`)).json;
    const { name, place, note, prices, phone, orderNote, order: card, meals, weeks, cycleStart } = mess;
    const saved = await owner.call('PUT', `/owner/messes/${SLUG}`, {
      ...{ name, place, note, prices, phone, orderNote, order: card, meals, weeks, cycleStart },
      dailyOrderCap: 1,
    });
    expect(saved.json.dailyOrderCap).toBe(1);
    const other = await signedIn('student2@vitbhopal.ac.in');
    const r = await other.call('POST', `/mess/${SLUG}/orders`, order());
    expect(r.status).toBe(400);
    expect(r.json.error.message).toMatch(/all the orders it can today/);
  });

  it('"Send a test" works on a device that also gets order alerts', async () => {
    await scene();
    const admin = await signedIn('admin@vitbhopal.ac.in');
    const before = env.campus.pushSender.sent.length;
    expect((await admin.call('POST', '/push/test', { endpoint: device(1).endpoint })).status).toBe(200);
    expect(env.campus.pushSender.sent.length).toBe(before + 1);
  });
});
