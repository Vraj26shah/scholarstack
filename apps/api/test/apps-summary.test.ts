import { describe, expect, it } from 'vitest';
import { Browser, setup } from './harness';

const SLUG = 'radha-rani-ka-dhaba';

describe('admin overview of apps and restaurants', () => {
  it('counts owners, devices, orders and takings; admins only', async () => {
    const { env, app } = setup();
    const f = env.db.features.get('mess-menu')!;
    env.db.features.set('mess-menu', { ...f, status: 'live' });
    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
    const { updatedAt: _u, sort: _s, ...input } = (await admin.call('GET', `/mess/${SLUG}`)).json;
    await admin.call('PUT', `/admin/mess/${SLUG}`, {
      ...input,
      published: true,
      ordersOpen: true,
      ownerEmails: ['dhaba.owner@gmail.com'],
    });
    await admin.call('POST', '/admin/owner-logins', { phone: '9876543210', messSlug: SLUG });

    const item = (input.order as { items: { name: string; available: boolean; tiffin?: boolean }[] }[])
      .flatMap((s) => s.items)
      .find((i) => i.available && !i.tiffin)!;
    const student = new Browser(app);
    await student.signIn('asha.24bce10001@vitbhopal.ac.in');
    const placed = (
      await student.call('POST', `/mess/${SLUG}/orders`, {
        lines: [{ name: item.name, qty: 1, detail: '' }],
        mode: 'pickup',
        name: 'Asha',
        phone: '9123456780',
        phoneConfirmed: true,
      })
    ).json;
    const owner = new Browser(app);
    await owner.signIn('dhaba.owner@gmail.com');
    await owner.call('PUT', `/owner/orders/${placed.id}`, { status: 'accepted' });

    const res = await admin.call('GET', '/admin/apps-summary');
    expect(res.status).toBe(200);
    expect(res.json.owners).toMatchObject({ total: 1, withPin: 0 });
    expect(res.json.restaurants.openNow).toBeGreaterThanOrEqual(1);
    expect(res.json.orders).toMatchObject({
      today: 1,
      todayRevenue: placed.total,
      year: 1,
      customersThisYear: 1,
    });
    expect(res.json.byRestaurant[0]).toMatchObject({ slug: SLUG, orders: 1, revenue: placed.total });
    expect((await student.call('GET', '/admin/apps-summary')).status).toBe(403);
  });
});
