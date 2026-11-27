import { HANDOVER, NO_SHOW, PAY_FIRST_WINDOW_MS } from '@ss/contracts';
import { describe, expect, it } from 'vitest';
import { memoryContainer } from '../src/composition/memory';
import { createApp } from '../src/http/app';
import { Browser, TestClock } from './harness';

const SLUG = 'radha-rani-ka-dhaba';

async function setup(opts: { upiId?: string; prepayAbove?: number } = {}) {
  const clock = new TestClock();
  const env = memoryContainer({ seed: true, clock, pageProducer: async () => new Uint8Array([1]) });
  const feature = env.db.features.get('mess-menu')!;
  env.db.features.set('mess-menu', { ...feature, status: 'live' });
  const app = createApp(() => env.container);
  const admin = new Browser(app);
  await admin.signIn('admin@vitbhopal.ac.in');
  const { updatedAt: _u, sort: _s, ...input } = (await admin.call('GET', `/mess/${SLUG}`)).json;
  await admin.call('PUT', `/admin/mess/${SLUG}`, {
    ...input,
    published: true,
    ordersOpen: true,
    upiId: opts.upiId ?? '',
    prepayAbove: opts.prepayAbove ?? 0,
  });
  const item = (
    input.order as { items: { name: string; price: number; available: boolean; tiffin?: boolean }[] }[]
  )
    .flatMap((x) => x.items)
    .find((i) => i.available && !i.tiffin && i.price > 0)!;
  const student = new Browser(app);
  await student.signIn('asha.24bce10001@vitbhopal.ac.in');
  const order = (qty = 1) =>
    student.call('POST', `/mess/${SLUG}/orders`, {
      lines: [{ name: item.name, qty, detail: '' }],
      mode: 'pickup',
      name: 'Asha',
      phone: '9123456780',
      phoneConfirmed: true,
    });
  return { clock, app, admin, student, item, order };
}

/** Places an order, has the restaurant accept it, then marks it not collected. */
async function missOne(s: Awaited<ReturnType<typeof setup>>) {
  const placed = await s.order();
  expect(placed.status).toBe(200);
  const id = placed.json.id;
  if (placed.json.payment) {
    await s.student.call('POST', `/me/mess-orders/${id}/paid`);
    await s.admin.call('POST', `/owner/orders/${id}/paid`);
  }
  expect((await s.admin.call('PUT', `/owner/orders/${id}`, { status: 'accepted', note: '' })).status).toBe(
    200,
  );
  s.clock.advance(HANDOVER.noShowAfterMinutes * 60_000); // time to come and collect
  const marked = await s.admin.call('POST', `/owner/orders/${id}/no-show`);
  expect(marked.status).toBe(200);
  s.clock.advance(2 * 60_000); // past the double-tap gap
  return marked.json;
}

describe('orders the student never collects', () => {
  it('one is a warning, two means paying first, three pauses ordering', async () => {
    const s = await setup({ upiId: 'radharani@okaxis' });
    expect((await s.student.call('GET', '/me/order-standing')).json).toEqual({
      noShows: 0,
      payFirst: false,
      pausedUntil: null,
    });
    const first = await missOne(s);
    expect(first).toMatchObject({ status: 'cancelled', noShow: true, ownerNote: 'Not collected' });
    // The student sees it, with the rule spelled out in the chat.
    const chat = (await s.student.call('GET', `/chats/${first.id}`)).json;
    expect(chat.messages.at(-1).body).toMatch(/not collected/);
    expect((await s.student.call('GET', '/me/order-standing')).json.payFirst).toBe(false);
    // The next order is still pay-on-pickup.
    await missOne(s);
    const standing = (await s.student.call('GET', '/me/order-standing')).json;
    expect(standing).toMatchObject({ noShows: 2, payFirst: true, pausedUntil: null });
    // Now every order is paid first, however small.
    const third = await s.order();
    expect(third.json).toMatchObject({ payment: 'due', upiId: 'radharani@okaxis' });
    await s.student.call('POST', `/me/mess-orders/${third.json.id}/paid`);
    await s.admin.call('POST', `/owner/orders/${third.json.id}/paid`);
    await s.admin.call('PUT', `/owner/orders/${third.json.id}`, { status: 'accepted', note: '' });
    s.clock.advance(HANDOVER.noShowAfterMinutes * 60_000); // time to come and collect
    await s.admin.call('POST', `/owner/orders/${third.json.id}/no-show`);
    s.clock.advance(2 * 60_000);
    // Three: paused, with the date it lifts.
    const paused = await s.order();
    expect(paused.status).toBe(400);
    expect(paused.json.error.message).toMatch(/paused until/);
    // The owner sees it on the customer's record.
    const board = (await s.admin.call('GET', `/owner/messes/${SLUG}/customers`)).json;
    const userId = board[0].userId;
    const detail = (await s.admin.call('GET', `/owner/messes/${SLUG}/customers/${userId}`)).json;
    expect(detail).toMatchObject({ noShows: 3, noShowsEverywhere: 3 });
    // 60 days after the oldest, ordering opens again (pay first, since two remain).
    s.clock.advance(NO_SHOW.windowDays * 24 * 3600 * 1000);
    const back = await s.order();
    expect(back.status).toBe(200);
  });

  it('only accepted orders can be marked, and only by the restaurant', async () => {
    const s = await setup();
    const placed = (await s.order()).json;
    expect((await s.admin.call('POST', `/owner/orders/${placed.id}/no-show`)).status).toBe(400);
    await s.admin.call('PUT', `/owner/orders/${placed.id}`, { status: 'accepted', note: '' });
    expect((await s.student.call('POST', `/owner/orders/${placed.id}/no-show`)).status).toBe(403);
  });

  it("a student with no-shows can't order where there's no UPI ID", async () => {
    const s = await setup();
    await missOne(s);
    await missOne(s);
    const r = await s.order();
    expect(r.status).toBe(400);
    expect(r.json.error.message).toMatch(/doesn't take UPI/);
  });
});

describe('pay-first orders', () => {
  it('orders above the owner’s amount wait for the UPI payment before they can be accepted', async () => {
    const s = await setup({ upiId: 'radharani@okaxis', prepayAbove: 1 });
    const small = await s.order();
    expect(small.json.payment).toBe('due');
    const id = small.json.id;
    // Can't be accepted before the money is in.
    const early = await s.admin.call('PUT', `/owner/orders/${id}`, { status: 'accepted', note: '' });
    expect(early.status).toBe(400);
    expect(early.json.error.message).toMatch(/Payment received/);
    // The student says they paid; they can't cancel it in the app any more.
    expect((await s.student.call('POST', `/me/mess-orders/${id}/paid`)).json.payment).toBe('claimed');
    expect((await s.student.call('POST', `/me/mess-orders/${id}/cancel`)).status).toBe(400);
    // The owner sees it, confirms, then accepts.
    const board = (await s.admin.call('GET', `/owner/messes/${SLUG}/orders`)).json;
    expect(board.find((o: { id: string }) => o.id === id)).toMatchObject({
      payment: 'claimed',
      trust: { orders: 0, noShows: 0 },
    });
    expect((await s.admin.call('POST', `/owner/orders/${id}/paid`)).json.payment).toBe('paid');
    expect((await s.admin.call('PUT', `/owner/orders/${id}`, { status: 'accepted', note: '' })).status).toBe(
      200,
    );
  });

  it('small orders under the amount are paid at pickup as before', async () => {
    const s = await setup({ upiId: 'radharani@okaxis', prepayAbove: 100_000 });
    const r = await s.order();
    expect(r.json).toMatchObject({ payment: '', upiId: '' });
  });

  it('an order never paid is cancelled after 20 minutes, not 10', async () => {
    const s = await setup({ upiId: 'radharani@okaxis', prepayAbove: 1 });
    const id = (await s.order()).json.id;
    s.clock.advance(12 * 60_000);
    const mine = (await s.student.call('GET', '/me/mess-orders')).json;
    expect(mine.find((o: { id: string }) => o.id === id).status).toBe('placed');
    s.clock.advance(PAY_FIRST_WINDOW_MS);
    const later = (await s.student.call('GET', '/me/mess-orders')).json;
    expect(later.find((o: { id: string }) => o.id === id)).toMatchObject({
      status: 'cancelled',
      ownerNote: 'Not paid within 20 minutes',
    });
  });
});

describe('every sale is shown to the restaurant', () => {
  it('lists each sale, and a paid order that was never collected still counts', async () => {
    const s = await setup({ upiId: 'radharani@okaxis', prepayAbove: 1 });
    // A paid order the student never collected.
    const paid = (await s.order()).json;
    await s.student.call('POST', `/me/mess-orders/${paid.id}/paid`);
    await s.admin.call('POST', `/owner/orders/${paid.id}/paid`);
    await s.admin.call('PUT', `/owner/orders/${paid.id}`, { status: 'accepted', note: '' });
    s.clock.advance(HANDOVER.noShowAfterMinutes * 60_000); // time to come and collect
    await s.admin.call('POST', `/owner/orders/${paid.id}/no-show`);
    // A declined order: not a sale.
    s.clock.advance(2 * 60_000);
    const declined = (await s.order()).json;
    await s.admin.call('PUT', `/owner/orders/${declined.id}`, { status: 'rejected', note: 'Closed now' });
    const d = (await s.admin.call('GET', '/owner/messes/radha-rani-ka-dhaba/insights?period=day')).json;
    expect(d.sales).toHaveLength(1);
    expect(d.sales[0]).toMatchObject({
      code: paid.code,
      total: paid.total,
      paidUpi: true,
      notCollected: true,
    });
    expect(d.totals.revenue).toBe(paid.total);
  });
});
