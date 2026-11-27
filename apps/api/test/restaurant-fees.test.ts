import { FEE_CANCEL_GRACE_MINUTES, HANDOVER, campusClock } from '@ss/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import type { memoryContainer } from '../src/composition/memory';
import type { createApp } from '../src/http/app';
import { Browser, type TestClock, setup } from './harness';

let clock: TestClock;
let app: ReturnType<typeof createApp>;
let env: ReturnType<typeof memoryContainer>;
const SLUG = 'radha-rani-ka-dhaba';
const OWNER = 'dhaba.owner@gmail.com';
const MIN = 60_000;
const DAY = 24 * 3600 * 1000;

beforeEach(() => {
  ({ clock, env, app } = setup());
});
const signedIn = async (email: string) => {
  const b = new Browser(app);
  await b.signIn(email);
  return b;
};
const today = () => campusClock(new Date(clock.t)).date;
const month = () => today().slice(0, 7);

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
  const item = (
    input.order as { items: { name: string; price: number; available: boolean; tiffin?: boolean }[] }[]
  )
    .flatMap((x) => x.items)
    .find((i) => i.available && !i.tiffin && i.price > 0)!;
  const owner = await signedIn(OWNER);
  const student = await signedIn('student1@vitbhopal.ac.in');
  const order = async (qty = 1) => {
    const placed = await student.call('POST', `/mess/${SLUG}/orders`, {
      lines: [{ name: item.name, qty, detail: '' }],
      mode: 'pickup',
      name: 'Ravi',
      phone: '9123456789',
      phoneConfirmed: true,
    });
    expect(placed.status).toBe(200);
    clock.advance(2 * MIN);
    return placed.json as { id: string; total: number; code: string };
  };
  const accept = async (id: string) => {
    const r = await owner.call('PUT', `/owner/orders/${id}`, { status: 'accepted', note: '' });
    expect(r.status).toBe(200);
    return r.json;
  };
  const rule = (body: Record<string, unknown>) => admin.call('POST', `/admin/fees/${SLUG}/rules`, body);
  const statement = async (period = '') =>
    (await admin.call('GET', `/admin/fees/${SLUG}${period ? `?period=${period}` : ''}`)).json;
  return { admin, owner, student, order, accept, rule, statement };
}

describe('the fee on each accepted order', () => {
  it('is worked out at acceptance from that day’s rule, once, and past orders keep theirs', async () => {
    const s = await scene();
    // Before any rule: the order is recorded with no fee.
    const free = await s.order();
    await s.accept(free.id);
    let st = await s.statement();
    expect(st.entries[0]).toMatchObject({ kind: 'order', amount: 0, note: 'No fee set' });

    expect((await s.rule({ mode: 'per_order', perOrder: 5, percent: 2 })).status).toBe(200);
    const a = await s.order(2);
    await s.accept(a.id);
    st = await s.statement();
    const fee = 500 + Math.round(a.total * 2);
    expect(st.entries[0]).toMatchObject({ kind: 'order', amount: fee, order: { code: a.code } });
    expect(st).toMatchObject({ orders: 2, charges: fee, balanceNow: fee, closing: fee });

    // A new rule can't start in the past, and doesn't touch the fee already written.
    const yesterday = campusClock(new Date(clock.t - DAY)).date;
    expect((await s.rule({ mode: 'per_order', perOrder: 9, startsOn: yesterday })).status).toBe(400);
    await s.rule({ mode: 'per_order', perOrder: 9 });
    st = await s.statement();
    expect(st.balanceNow).toBe(fee);
    expect(st.rule).toMatchObject({ perOrder: 9 });
    expect(st.rules).toHaveLength(2);

    // The cron never writes a second fee for the same order.
    await env.container.orders.sweepAll();
    expect((await s.statement()).entries.filter((e: { kind: string }) => e.kind === 'order')).toHaveLength(2);
  });

  it('writes a fee the request missed, from the five-minute cron', async () => {
    const s = await scene();
    await s.rule({ mode: 'per_order', perOrder: 4 });
    const a = await s.order();
    await s.accept(a.id);
    // As if the write had failed half way.
    const fees = env.campus.fees;
    fees.ledger.splice(0, fees.ledger.length);
    await env.container.orders.sweepAll();
    expect((await s.statement()).entries[0]).toMatchObject({ kind: 'order', amount: 400 });
  });

  it('nothing in a free period; a monthly plan is charged by the day once the month ends', async () => {
    const s = await scene();
    const in3 = campusClock(new Date(clock.t + 3 * DAY)).date;
    await s.rule({ mode: 'per_order', perOrder: 5, freeUntil: in3 });
    const a = await s.order();
    await s.accept(a.id);
    expect((await s.statement()).entries[0]).toMatchObject({ amount: 0, note: `Free until ${in3}` });

    await s.rule({ mode: 'monthly', monthly: 3100 });
    const thisMonth = month();
    const st = await s.statement();
    expect(st.monthlySoFar).toBeGreaterThan(0);
    // Into next month: last month's charge is written once (only the days on the plan).
    clock.advance(35 * DAY);
    const last = await s.statement(thisMonth);
    const monthly = last.entries.filter((e: { kind: string }) => e.kind === 'monthly');
    expect(monthly).toHaveLength(1);
    expect(monthly[0].amount).toBeGreaterThan(0);
    expect(monthly[0].amount).toBeLessThan(310000);
    await s.statement(thisMonth);
    expect(
      (await s.statement(thisMonth)).entries.filter((e: { kind: string }) => e.kind === 'monthly'),
    ).toHaveLength(1);
  });
});

describe('waivers', () => {
  it('a cancel soon after accepting is free; later it is charged; the admin can waive and undo', async () => {
    const s = await scene();
    await s.rule({ mode: 'per_order', perOrder: 10 });
    const soon = await s.order();
    await s.accept(soon.id);
    await s.owner.call('PUT', `/owner/orders/${soon.id}`, { status: 'rejected', note: 'Ran out of an item' });
    let st = await s.statement();
    expect(st.balanceNow).toBe(0);
    expect(st.waived).toBe(1);

    const late = await s.order();
    await s.accept(late.id);
    clock.advance((FEE_CANCEL_GRACE_MINUTES + 1) * MIN);
    await s.owner.call('PUT', `/owner/orders/${late.id}`, { status: 'rejected', note: 'Kitchen closed' });
    expect((await s.statement()).balanceNow).toBe(1000);

    const w = (body: Record<string, unknown>) =>
      s.admin.call('POST', `/admin/fees/${SLUG}/orders/${late.id}/waive`, body);
    expect((await w({ waive: true, note: 'Gas ran out, genuine' })).json.balanceNow).toBe(0);
    expect((await w({ waive: true, note: 'again' })).status).toBe(400);
    expect((await w({ waive: false, note: 'Changed my mind' })).json.balanceNow).toBe(1000);
    st = await s.statement();
    // Every step is its own entry: nothing was edited.
    expect(st.entries.map((e: { kind: string }) => e.kind)).toEqual(
      expect.arrayContaining(['order', 'waive', 'unwaive', 'order', 'waive']),
    );
  });

  it('food the admin decides never reached the student is not charged', async () => {
    const s = await scene();
    await s.rule({ mode: 'per_order', perOrder: 6 });
    const a = await s.order();
    await s.accept(a.id);
    await s.owner.call('PUT', `/owner/orders/${a.id}`, { status: 'ready', note: '' });
    await s.owner.call('PUT', `/owner/orders/${a.id}`, { status: 'done', note: '' });
    await s.student.call('POST', `/me/mess-orders/${a.id}/dispute`, {
      kind: 'not_received',
      note: 'Never came',
    });
    await s.admin.call('POST', `/admin/disputes/orders/${a.id}`, { decision: 'student' });
    expect((await s.statement()).balanceNow).toBe(0);
    await s.admin.call('POST', `/admin/disputes/orders/${a.id}`, { decision: 'owner' });
    expect((await s.statement()).balanceNow).toBe(600);
  });
});

describe('payments and closing a month', () => {
  it('payments lower the balance; a closed month is final and carries its balance on', async () => {
    const s = await scene();
    await s.rule({ mode: 'per_order', perOrder: 20 });
    for (let i = 0; i < 3; i++) {
      const o = await s.order();
      await s.accept(o.id);
      await s.owner.call('PUT', `/owner/orders/${o.id}`, { status: 'ready', note: '' });
      await s.owner.call('PUT', `/owner/orders/${o.id}`, { status: 'done', note: '' });
    }
    const entry = (body: Record<string, unknown>) =>
      s.admin.call('POST', `/admin/fees/${SLUG}/entries`, body);
    const tomorrow = campusClock(new Date(clock.t + DAY)).date;
    expect((await entry({ kind: 'payment', amount: 1000, day: tomorrow, note: 'UPI' })).status).toBe(400);
    expect((await entry({ kind: 'payment', amount: 1000, note: 'x' })).status).toBe(400); // note too short
    let st = (await entry({ kind: 'payment', amount: 4000, method: 'UPI', note: 'Paid at the counter' }))
      .json;
    expect(st).toMatchObject({ charges: 6000, payments: 4000, balanceNow: 2000 });
    st = (await entry({ kind: 'adjust', amount: -500, note: 'Launch goodwill' })).json;
    expect(st).toMatchObject({ credits: -500, balanceNow: 1500 });

    const first = month();
    expect(
      (await s.admin.call('POST', `/admin/fees/${SLUG}/close`, { period: first })).json.error.message,
    ).toMatch(/once it has ended/);
    clock.advance(32 * DAY);
    const closed = (
      await s.admin.call('POST', `/admin/fees/${SLUG}/close`, { period: first, note: 'Oct done' })
    ).json;
    expect(closed.settlement).toMatchObject({ period: first, charges: 6000, payments: 4000, closing: 1500 });
    expect((await s.admin.call('POST', `/admin/fees/${SLUG}/close`, { period: first })).status).toBe(400);
    // Nothing more can go into the closed month.
    expect(
      (await entry({ kind: 'payment', amount: 1500, day: `${first}-28`, note: 'Late record' })).json.error
        .message,
    ).toMatch(/is closed/);
    // The new month opens with what was owed.
    st = (await entry({ kind: 'payment', amount: 1500, method: 'Cash', note: 'Settled up' })).json;
    expect(st).toMatchObject({ opening: 1500, payments: 1500, closing: 0, balanceNow: 0 });
    const rows = (await s.admin.call('GET', '/admin/fees')).json;
    expect(rows.find((r: { slug: string }) => r.slug === SLUG)).toMatchObject({
      balanceNow: 0,
      lastClosed: first,
    });
  });
});

describe('who sees what', () => {
  it('the owner reads only their own statement; students get nothing', async () => {
    const s = await scene();
    await s.rule({ mode: 'per_order', perOrder: 5 });
    await s.accept((await s.order()).id);
    const mine = await s.owner.call('GET', `/owner/messes/${SLUG}/fees`);
    expect(mine.status).toBe(200);
    expect(mine.json.rule.createdBy).toBe('');
    expect(mine.json.balanceNow).toBe(500);
    expect((await s.student.call('GET', `/owner/messes/${SLUG}/fees`)).status).toBe(403);
    expect((await s.owner.call('GET', '/admin/fees')).status).toBe(403);
    expect(
      (
        await s.owner.call('POST', `/admin/fees/${SLUG}/entries`, {
          kind: 'payment',
          amount: 500,
          note: 'self',
        })
      ).status,
    ).toBe(403);
  });

  it("the student's number shows to the restaurant only while it has their order", async () => {
    const s = await scene();
    const a = await s.order();
    let board = (await s.owner.call('GET', `/owner/messes/${SLUG}/orders`)).json;
    expect(board[0].phone).toBe('');
    await s.accept(a.id);
    board = (await s.owner.call('GET', `/owner/messes/${SLUG}/orders`)).json;
    expect(board[0].phone).toBe('9123456789');
    clock.advance(HANDOVER.noShowAfterMinutes * MIN);
    await s.owner.call('POST', `/owner/orders/${a.id}/handover`, { withoutCode: true });
    clock.advance(DAY + MIN);
    const customers = (await s.owner.call('GET', `/owner/messes/${SLUG}/customers`)).json;
    expect(customers[0].phone).toBe('');
    const detail = (await s.owner.call('GET', `/owner/messes/${SLUG}/customers/${customers[0].userId}`)).json;
    expect(detail.customer.phone).toBe('');
  });
});
