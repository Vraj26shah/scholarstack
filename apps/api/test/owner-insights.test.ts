import { beforeEach, describe, expect, it } from 'vitest';
import { periodRange } from '../src/application/owner-insights';
import type { memoryContainer } from '../src/composition/memory';
import type { createApp } from '../src/http/app';
import { Browser, type TestClock, setup } from './harness';

let clock: TestClock;
let app: ReturnType<typeof createApp>;
let env: ReturnType<typeof memoryContainer>;
const SLUG = 'radha-rani-ka-dhaba';
const OWNER = 'dhaba.owner@gmail.com';
const MIN = 60_000;

beforeEach(() => {
  ({ clock, env, app } = setup());
});

const signedIn = async (email: string) => {
  const b = new Browser(app);
  await b.signIn(email);
  return b;
};
const order = (qty = 1) => ({
  lines: [{ name: 'Mess thali', qty, detail: '' }],
  mode: 'pickup',
  name: 'Asha',
  phone: '9876543210',
  phoneConfirmed: true,
});

async function open() {
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
  return signedIn(OWNER);
}

describe('periods in campus time', () => {
  it('days, Monday weeks, months and years, with the arrows', () => {
    expect(periodRange('day', '2026-11-25')).toMatchObject({
      from: '2026-11-25',
      to: '2026-11-25',
      label: 'Wed 25 Nov 2026',
    });
    expect(periodRange('week', '2026-11-25')).toMatchObject({
      from: '2026-11-23',
      to: '2026-11-29',
      prev: '2026-11-16',
    });
    expect(periodRange('month', '2026-02-10')).toMatchObject({
      from: '2026-02-01',
      to: '2026-02-28',
      label: 'February 2026',
    });
    expect(periodRange('month', '2026-12-31')).toMatchObject({
      to: '2026-12-31',
      next: '2027-01-01',
      prev: '2026-11-01',
    });
    expect(periodRange('year', '2026-06-01')).toMatchObject({
      from: '2026-01-01',
      to: '2026-12-31',
      label: '2026',
    });
  });
});

describe("a restaurant owner's insights", () => {
  it('counts orders, takings, outcomes, dishes, hours, customers and page views for each period', async () => {
    const owner = await open();
    // 20 Oct 2026, 15:30 campus time. Two students; one also ordered last month.
    const s1 = await signedIn('student1@vitbhopal.ac.in');
    const s2 = await signedIn('student2@vitbhopal.ac.in');
    clock.advance(-30 * 24 * 60 * MIN);
    const old = (await s1.call('POST', `/mess/${SLUG}/orders`, order())).json;
    await owner.call('PUT', `/owner/orders/${old.id}`, { status: 'accepted' });
    await owner.call('PUT', `/owner/orders/${old.id}`, { status: 'rejected', note: 'Kitchen closed' });
    clock.advance(30 * 24 * 60 * MIN);

    const a = (await s1.call('POST', `/mess/${SLUG}/orders`, order(2))).json;
    clock.advance(4 * MIN);
    await owner.call('PUT', `/owner/orders/${a.id}`, { status: 'accepted' });
    await owner.call('PUT', `/owner/orders/${a.id}`, { status: 'ready' });
    await owner.call('PUT', `/owner/orders/${a.id}`, { status: 'done' });
    const b = (await s2.call('POST', `/mess/${SLUG}/orders`, order())).json;
    await s2.call('POST', `/me/mess-orders/${b.id}/cancel`);

    // Page views: two signed-out networks, a student twice, and the owner (not counted).
    const guest = new Browser(app);
    await guest.call('POST', `/mess/${SLUG}/view`, undefined, { 'x-forwarded-for': '1.1.1.1' });
    await guest.call('POST', `/mess/${SLUG}/view`, undefined, { 'cf-connecting-ip': '2.2.2.2' });
    await s1.call('POST', `/mess/${SLUG}/view`);
    await s1.call('POST', `/mess/${SLUG}/view`);
    await owner.call('POST', `/mess/${SLUG}/view`);

    const day = (await owner.call('GET', `/owner/messes/${SLUG}/insights?period=day`)).json;
    expect(day.label).toBe('Tue 20 Oct 2026');
    expect(day.totals).toMatchObject({
      orders: 2,
      confirmed: 1,
      revenue: 160,
      avgOrder: 160,
      cancelledByStudent: 1,
      cancelledByYou: 0,
      customers: 2,
      newCustomers: 1, // student1 ordered last month
      signedInVisitors: 1,
      pastCustomersVisiting: 1,
    });
    expect(day.totals.views).toBeGreaterThanOrEqual(3);
    expect(day.totals.visitors).toBeGreaterThanOrEqual(2);
    expect(day.series).toHaveLength(24);
    expect(day.series[15]).toMatchObject({ label: '3pm', orders: 2, revenue: 160 });
    expect(day.hours[15]).toBe(2);
    expect(day.topDishes[0]).toMatchObject({ name: 'Mess thali', qty: 2, revenue: 160 });
    expect(day.topCustomers[0]).toMatchObject({ name: 'Asha', spent: 160 });
    expect(day.nextAnchor).toBeNull(); // nothing after today

    const month = (await owner.call('GET', `/owner/messes/${SLUG}/insights?period=month`)).json;
    expect(month.label).toBe('October 2026');
    expect(month.series).toHaveLength(31);
    expect(month.series[19]).toMatchObject({ key: '2026-10-20', orders: 2 });
    expect(month.previous).toMatchObject({ orders: 1, cancelledByYou: 1, revenue: 0 });

    const year = (await owner.call('GET', `/owner/messes/${SLUG}/insights?period=year`)).json;
    expect(year.series.map((b: { orders: number }) => b.orders).slice(8, 10)).toEqual([1, 2]);

    const lastMonth = (await owner.call('GET', `/owner/messes/${SLUG}/insights?period=month&date=2026-09-15`))
      .json;
    expect(lastMonth.totals).toMatchObject({ orders: 1, cancelledByYou: 1 });
    expect(lastMonth.nextAnchor).toBe('2026-10-01');

    // Only the owner (or an admin) sees them.
    expect((await s1.call('GET', `/owner/messes/${SLUG}/insights`)).status).toBe(403);
  });

  it('the restaurant can cancel at any step, with a reason the student is told', async () => {
    const owner = await open();
    const s = await signedIn('student1@vitbhopal.ac.in');
    const o = (await s.call('POST', `/mess/${SLUG}/orders`, order())).json;
    await owner.call('PUT', `/owner/orders/${o.id}`, { status: 'accepted' });
    await owner.call('PUT', `/owner/orders/${o.id}`, { status: 'ready' });
    expect((await owner.call('PUT', `/owner/orders/${o.id}`, { status: 'rejected', note: '' })).status).toBe(
      400,
    );
    const r = await owner.call('PUT', `/owner/orders/${o.id}`, {
      status: 'rejected',
      note: 'Ran out of an item',
    });
    expect(r.json.status).toBe('rejected');
    const chat = (await s.call('GET', `/chats/${o.id}`)).json;
    expect(JSON.stringify(chat)).toContain('The restaurant cancelled this order. “Ran out of an item”');
  });
});
