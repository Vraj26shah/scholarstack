import { beforeEach, describe, expect, it } from 'vitest';
import type { memoryContainer } from '../src/composition/memory';
import type { createApp } from '../src/http/app';
import { Browser, type TestClock, setup } from './harness';

let clock: TestClock;
let app: ReturnType<typeof createApp>;
let env: ReturnType<typeof memoryContainer>;

const SLUG = 'radha-rani-ka-dhaba';
const OWNER = 'dhaba.owner@gmail.com';

beforeEach(() => {
  ({ clock, env, app } = setup());
});

const signedIn = async (email: string) => {
  const b = new Browser(app);
  await b.signIn(email);
  return b;
};

async function openDhaba() {
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
  return (input.order as { items: { name: string; price: number; available: boolean; tiffin?: boolean }[] }[])
    .flatMap((s) => s.items)
    .filter((i) => i.available && !i.tiffin);
}

const order = (name: string, qty = 1, mode: 'pickup' | 'delivery' = 'pickup') => ({
  lines: [{ name, qty, detail: '' }],
  mode,
  ...(mode === 'delivery' ? { address: 'Hostel A, room 12' } : {}),
  name: 'Asha',
  phone: '9123456780',
  phoneConfirmed: true,
});

describe("an owner's record of one customer", () => {
  it('counts orders, spending, favourites, cancellations, visits and keeps the full history', async () => {
    const items = await openDhaba();
    const [a, b] = [items[0]!.name, items[1]!.name];
    const student = await signedIn('asha.24bce10001@vitbhopal.ac.in');
    const owner = await signedIn(OWNER);

    // Opens the page (a visit), orders three times: one done, one declined, one cancelled by her.
    await student.call('POST', `/mess/${SLUG}/view`);
    const first = (await student.call('POST', `/mess/${SLUG}/orders`, order(a, 2))).json;
    await owner.call('PUT', `/owner/orders/${first.id}`, { status: 'accepted' });
    await owner.call('PUT', `/owner/orders/${first.id}`, { status: 'done' });
    clock.advance(3_600_000);
    const second = (await student.call('POST', `/mess/${SLUG}/orders`, order(b, 1, 'delivery'))).json;
    await owner.call('PUT', `/owner/orders/${second.id}`, { status: 'rejected', note: 'Sold out' });
    clock.advance(3_600_000);
    const third = (await student.call('POST', `/mess/${SLUG}/orders`, order(a, 1))).json;
    await student.call('POST', `/me/mess-orders/${third.id}/cancel`);

    const list = (await owner.call('GET', `/owner/messes/${SLUG}/customers`)).json;
    expect(list).toHaveLength(1);
    const record = await owner.call('GET', `/owner/messes/${SLUG}/customers/${list[0].userId}`);
    expect(record.status).toBe(200);
    const r = record.json;
    expect(r.customer).toMatchObject({ name: 'Asha', orders: 3, spent: first.total });
    expect(r.completed).toBe(1);
    expect(r.declinedByYou).toBe(1);
    expect(r.cancelledByThem).toBe(1);
    expect(r.avgOrder).toBe(first.total);
    expect(r.modes).toEqual({ delivery: 1, pickup: 2 });
    expect(r.favourites[0]).toEqual({ name: a, qty: 2 });
    expect(r.visitDays).toBe(1);
    expect(r.history.map((h: { id: string }) => h.id)).toEqual([third.id, second.id, first.id]);
    expect(r.history[2].items).toBe(`2 × ${a}`);
    expect(r.months.reduce((n: number, m: { orders: number }) => n + m.orders, 0)).toBe(3);
  });

  it('is only for the restaurant’s owner, and unknown customers are not found', async () => {
    const items = await openDhaba();
    const student = await signedIn('asha.24bce10001@vitbhopal.ac.in');
    await student.call('POST', `/mess/${SLUG}/orders`, order(items[0]!.name));
    const owner = await signedIn(OWNER);
    const id = (await owner.call('GET', `/owner/messes/${SLUG}/customers`)).json[0].userId;
    expect((await student.call('GET', `/owner/messes/${SLUG}/customers/${id}`)).status).toBe(403);
    expect((await owner.call('GET', `/owner/messes/${SLUG}/customers/nobody`)).status).toBe(404);
  });
});
