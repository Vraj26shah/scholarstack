import { bestDiscount } from '@ss/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_DHABA_OFFERS } from '../src/application/campus-seed';
import type { memoryContainer } from '../src/composition/memory';
import type { createApp } from '../src/http/app';
import { Browser, type TestClock, setup } from './harness';

let app: ReturnType<typeof createApp>;
let env: ReturnType<typeof memoryContainer>;
let clock: TestClock;
const SLUG = 'radha-rani-ka-dhaba';
const OWNER = 'dhaba.owner@gmail.com';

beforeEach(() => {
  ({ env, app, clock } = setup());
});
const signedIn = async (email: string) => {
  const b = new Browser(app);
  await b.signIn(email);
  return b;
};
const order = (lines: { name: string; qty: number }[], promoCode = '') => ({
  lines: lines.map((l) => ({ ...l, detail: '' })),
  mode: 'pickup',
  name: 'Asha',
  phone: '9876543210',
  phoneConfirmed: true,
  promoCode,
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

describe('the one discount on an order', () => {
  const date = '2026-10-20';
  it('a working code wins; otherwise the best deal; never both', () => {
    expect(bestDiscount(DEMO_DHABA_OFFERS, 400, { date, firstOrder: false })).toMatchObject({ saving: 30 });
    expect(bestDiscount(DEMO_DHABA_OFFERS, 400, { date, code: 'welcome20', firstOrder: true })).toMatchObject(
      {
        saving: 60, // 20% of 400 = 80, capped at 60
        codeProblem: '',
      },
    );
    expect(
      bestDiscount(DEMO_DHABA_OFFERS, 400, { date, code: 'WELCOME20', firstOrder: false }).codeProblem,
    ).toMatch(/first order/);
    expect(
      bestDiscount(DEMO_DHABA_OFFERS, 50, { date, code: 'WELCOME20', firstOrder: true }).codeProblem,
    ).toMatch(/₹100/);
    expect(
      bestDiscount(DEMO_DHABA_OFFERS, 400, { date, code: 'NOPE', firstOrder: true }).codeProblem,
    ).toMatch(/isn't a code/);
    expect(bestDiscount(DEMO_DHABA_OFFERS, 200, { date, firstOrder: false })).toMatchObject({
      saving: 0,
      offer: null,
    });
  });
});

describe('restaurant offers', () => {
  it('the owner sets up a code, a deal and a combo; the server prices orders with them', async () => {
    const owner = await open();
    const current = (await owner.call('GET', `/owner/messes/${SLUG}`)).json;
    const {
      slug: _s,
      kind: _k,
      source: _src,
      ownerEmails: _o,
      ordersOpen: _oo,
      published: _p,
      sort: _so,
      updatedAt: _u,
      ...form
    } = current;
    const menu = [
      {
        title: 'Main course',
        items: [{ name: 'Paneer butter masala', price: 160, note: '', photo: '', available: true }],
      },
      { title: 'Breads', items: [{ name: 'Butter roti', price: 12, note: '', photo: '', available: true }] },
      ...form.order,
    ];
    // A combo naming a dish that isn't on the card is refused.
    const bad = await owner.call('PUT', `/owner/messes/${SLUG}`, {
      ...form,
      order: menu,
      offers: [
        {
          kind: 'combo',
          title: 'Ghost combo',
          items: [
            { name: 'Pizza', qty: 1 },
            { name: 'Butter roti', qty: 1 },
          ],
          price: 99,
        },
      ],
    });
    expect(bad.status).toBe(400);
    expect(bad.json.error.message).toMatch(/Pizza/);

    const saved = await owner.call('PUT', `/owner/messes/${SLUG}`, {
      ...form,
      order: menu,
      offers: [
        {
          id: 'first10',
          kind: 'code',
          title: '₹40 off your first order',
          code: 'hello40',
          flatOff: 40,
          firstOrderOnly: true,
        },
        { id: 'deal25', kind: 'deal', title: '10% off above ₹300', percentOff: 10, minTotal: 300 },
        {
          id: 'paneer',
          kind: 'combo',
          title: 'Paneer meal',
          items: [
            { name: 'Paneer butter masala', qty: 1 },
            { name: 'Butter roti', qty: 3 },
          ],
          price: 175,
        },
      ],
    });
    expect(saved.status).toBe(200);
    expect(saved.json.offers[0].code).toBe('HELLO40');

    const s = await signedIn('student1@vitbhopal.ac.in');
    // First order with the code: ₹160 + ₹24 = ₹184, minus ₹40.
    const a = await s.call(
      'POST',
      `/mess/${SLUG}/orders`,
      order(
        [
          { name: 'Paneer butter masala', qty: 1 },
          { name: 'Butter roti', qty: 2 },
        ],
        'HELLO40',
      ),
    );
    expect(a.json).toMatchObject({ total: 144, discount: 40, offer: 'HELLO40' });
    await owner.call('PUT', `/owner/orders/${a.json.id}`, { status: 'accepted' });
    await owner.call('PUT', `/owner/orders/${a.json.id}`, { status: 'ready' });
    await owner.call('PUT', `/owner/orders/${a.json.id}`, { status: 'done' });

    // A second order: the code was for a first order only.
    clock.advance(2 * 60_000);
    const again = await s.call(
      'POST',
      `/mess/${SLUG}/orders`,
      order([{ name: 'Butter roti', qty: 1 }], 'HELLO40'),
    );
    expect(again.status).toBe(400);
    expect(again.json.error.message).toMatch(/first order only/);
  });

  it('a combo and a deal together: the deal is on the dishes, never on the combo', async () => {
    const owner = await open();
    const current = (await owner.call('GET', `/owner/messes/${SLUG}`)).json;
    const {
      slug: _s,
      kind: _k,
      source: _src,
      ownerEmails: _o,
      ordersOpen: _oo,
      published: _p,
      sort: _so,
      updatedAt: _u,
      ...form
    } = current;
    const menu = [
      {
        title: 'Main course',
        items: [{ name: 'Paneer butter masala', price: 160, note: '', photo: '', available: true }],
      },
      { title: 'Breads', items: [{ name: 'Butter roti', price: 12, note: '', photo: '', available: true }] },
    ];
    await owner.call('PUT', `/owner/messes/${SLUG}`, {
      ...form,
      order: [...menu, ...form.order],
      offers: [
        { id: 'deal10', kind: 'deal', title: '10% off above ₹300', percentOff: 10, minTotal: 300 },
        {
          id: 'paneer',
          kind: 'combo',
          title: 'Paneer meal',
          items: [
            { name: 'Paneer butter masala', qty: 1 },
            { name: 'Butter roti', qty: 3 },
          ],
          price: 175,
        },
      ],
    });
    const s = await signedIn('student2@vitbhopal.ac.in');
    const r = await s.call(
      'POST',
      `/mess/${SLUG}/orders`,
      order([
        { name: 'combo:paneer', qty: 1 },
        { name: 'Paneer butter masala', qty: 2 },
      ]),
    );
    expect(r.status).toBe(200);
    expect(r.json.lines[0]).toMatchObject({
      name: 'Paneer meal (combo)',
      price: 175,
      detail: '1× Paneer butter masala, 3× Butter roti',
    });
    expect(r.json).toMatchObject({ discount: 32, total: 175 + 320 - 32, offer: '10% off above ₹300' });

    // A combo that isn't offered any more is refused.
    const s3 = await signedIn('student3@vitbhopal.ac.in');
    expect(
      (await s3.call('POST', `/mess/${SLUG}/orders`, order([{ name: 'combo:gone', qty: 1 }]))).status,
    ).toBe(400);

    // The owner's insights count the offer and the combo.
    await owner.call('PUT', `/owner/orders/${r.json.id}`, { status: 'accepted' });
    const ins = (await owner.call('GET', `/owner/messes/${SLUG}/insights?period=day`)).json;
    expect(ins.offers).toEqual(
      expect.arrayContaining([
        { label: '10% off above ₹300', orders: 1, discount: 32, revenue: 463 },
        { label: 'Paneer meal (combo)', orders: 1, discount: 0, revenue: 175 },
      ]),
    );
  });

  it("an admin's save never wipes the owner's offers", async () => {
    const owner = await open();
    const current = (await owner.call('GET', `/owner/messes/${SLUG}`)).json;
    const {
      slug: _s,
      kind: _k,
      source: _src,
      ownerEmails: _o,
      ordersOpen: _oo,
      published: _p,
      sort: _so,
      updatedAt: _u,
      ...form
    } = current;
    await owner.call('PUT', `/owner/messes/${SLUG}`, {
      ...form,
      offers: [{ id: 'deal10', kind: 'deal', title: '₹20 off above ₹200', flatOff: 20, minTotal: 200 }],
    });
    const admin = await signedIn('admin@vitbhopal.ac.in');
    const { updatedAt: _u2, sort: _s2, ...input } = (await admin.call('GET', `/mess/${SLUG}`)).json;
    await admin.call('PUT', `/admin/mess/${SLUG}`, { ...input, offers: [] });
    expect((await admin.call('GET', `/mess/${SLUG}`)).json.offers).toHaveLength(1);
  });
});
