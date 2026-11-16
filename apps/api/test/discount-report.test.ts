import { describe, expect, it } from 'vitest';
import { commissionPaise } from '../src/application/promo-codes';
import { Browser, pay, setup } from './harness';

const DAY = 24 * 60 * 60 * 1000;

async function world() {
  const { env, app, clock } = setup();
  const admin = new Browser(app);
  await admin.signIn('admin@vitbhopal.ac.in');
  const course = (slug: string) => [...env.db.courses.values()].find((c) => c.slug === slug)!;
  const at = (offsetDays: number) => new Date(clock.now().getTime() + offsetDays * DAY).toISOString();
  const student = async (email: string, name?: string) => {
    const b = new Browser(app);
    await b.signIn(email);
    if (name) await b.call('PATCH', '/me', { fullName: name });
    return b;
  };
  const promo = (body: Record<string, unknown>) =>
    admin.call('POST', '/admin/promo-codes', {
      code: 'RAHUL10',
      kind: 'percent',
      percentOff: 10,
      startsAt: at(-1),
      endsAt: at(30),
      status: 'live',
      oncePerStudent: false,
      ...body,
    });
  const offer = (body: Record<string, unknown>) =>
    admin.call('POST', '/admin/offers', {
      title: 'Diwali offer',
      percentOff: 20,
      startsAt: at(-1),
      endsAt: at(5),
      status: 'live',
      ...body,
    });
  const report = async (days = 'all') => (await admin.call('GET', `/admin/discounts?days=${days}`)).json;
  return { env, app, clock, admin, course, at, student, promo, offer, report };
}

describe('discount report', () => {
  it('works out a creator commission from what the student paid', () => {
    expect(commissionPaise({ commissionKind: 'percent', commissionValue: 10 }, 7100)).toBe(710);
    expect(commissionPaise({ commissionKind: 'flat', commissionValue: 2000 }, 7100)).toBe(2000);
    // Never more than the order itself.
    expect(commissionPaise({ commissionKind: 'flat', commissionValue: 9000 }, 7100)).toBe(7100);
    expect(commissionPaise({ commissionKind: null, commissionValue: null }, 7100)).toBe(0);
  });

  it('lists every paid order with its student, and counts who used a code, an offer, or neither', async () => {
    const { course, student, promo, offer, report } = await world();
    const dsa = course('dsa-2025-cse-core');
    const dbms = course('dbms-2025-cse-core');
    await offer({ courseIds: [dsa.id] });
    await promo({});

    const asha = await student('asha@vitbhopal.ac.in', 'Asha Verma');
    expect((await pay(asha, { courseId: dsa.id, promoCode: 'rahul10' })).json.status).toBe('paid');
    const ben = await student('ben@vitbhopal.ac.in', 'Ben Thomas');
    await pay(ben, { courseId: dsa.id });
    const chen = await student('chen@vitbhopal.ac.in', 'Chen Li');
    await pay(chen, { courseId: dbms.id });

    const r = await report();
    expect(r.totals).toMatchObject({
      paidOrders: 3,
      buyers: 3,
      promoOrders: 1,
      promoBuyers: 1,
      offerOrders: 2,
      offerBuyers: 2,
      fullPriceOrders: 1,
      fullPriceBuyers: 1,
    });
    // ₹99 → ₹79 (offer) → ₹71 (code): Asha saved ₹28; Ben saved ₹20.
    expect(r.totals.discountPaise).toBe(2800 + 2000);
    const ashaRow = r.orders.find((o: { studentEmail: string }) => o.studentEmail === 'asha@vitbhopal.ac.in');
    expect(ashaRow).toMatchObject({
      studentName: 'Asha Verma',
      itemKind: 'course',
      itemTitle: dsa.title,
      fullPaise: 9900,
      amountPaise: 7100,
      offer: { title: 'Diwali offer', percentOff: 20, discountPaise: 2000 },
      promo: { code: 'RAHUL10', discountPaise: 800 },
    });
    const chenRow = r.orders.find((o: { studentEmail: string }) => o.studentEmail === 'chen@vitbhopal.ac.in');
    expect(chenRow).toMatchObject({ fullPaise: chenRow.amountPaise, offer: null, promo: null });
  });

  it('shows each offer’s and each code’s buyers, and orders that were never paid are left out', async () => {
    const { admin, course, student, promo, offer } = await world();
    const dsa = course('dsa-2025-cse-core');
    const o = (await offer({ allCourses: true })).json;
    const p = (await promo({})).json;
    const asha = await student('asha@vitbhopal.ac.in', 'Asha Verma');
    await pay(asha, { courseId: dsa.id, promoCode: 'RAHUL10' });
    const ben = await student('ben@vitbhopal.ac.in');
    await ben.call('POST', '/orders', { courseId: dsa.id, promoCode: 'RAHUL10' }); // never paid

    const offers = (await admin.call('GET', '/admin/offers')).json;
    expect(offers[0]).toMatchObject({ id: o.id, uses: 1, buyers: 1, discountGivenPaise: 2000 });
    const offerOrders = (await admin.call('GET', `/admin/offers/${o.id}/orders`)).json;
    expect(offerOrders).toHaveLength(1);
    expect(offerOrders[0].studentEmail).toBe('asha@vitbhopal.ac.in');

    const codeOrders = (await admin.call('GET', `/admin/promo-codes/${p.id}/orders`)).json;
    expect(codeOrders.map((x: { studentName: string }) => x.studentName)).toEqual(['Asha Verma']);
  });

  it('keeps what each creator earned, was paid and is owed; a rate change never rewrites the past', async () => {
    const { admin, course, student, promo, report } = await world();
    const dsa = course('dsa-2025-cse-core');
    const dbms = course('dbms-2025-cse-core');
    const saved = (
      await promo({
        creatorName: 'Rahul Sharma',
        creatorContact: 'rahul@example.com',
        commissionKind: 'percent',
        commissionValue: 10,
      })
    ).json;
    expect(saved).toMatchObject({
      creatorName: 'Rahul Sharma',
      commissionKind: 'percent',
      commissionValue: 10,
    });
    await promo({
      code: 'RAHULFLAT',
      creatorName: 'rahul  sharma',
      commissionKind: 'flat',
      commissionValue: 500,
    });

    const asha = await student('asha@vitbhopal.ac.in');
    await pay(asha, { courseId: dsa.id, promoCode: 'RAHUL10' }); // pays ₹89 → ₹8.90 commission
    const ben = await student('ben@vitbhopal.ac.in');
    await pay(ben, { courseId: dbms.id, promoCode: 'RAHULFLAT' }); // ₹5 per use

    // A later rate change applies only to new orders.
    await promo({
      id: saved.id,
      creatorName: 'Rahul Sharma',
      commissionKind: 'percent',
      commissionValue: 50,
    });

    let r = await report();
    expect(r.creators).toHaveLength(1);
    expect(r.creators[0]).toMatchObject({
      name: 'Rahul Sharma',
      contact: 'rahul@example.com',
      codes: ['RAHUL10', 'RAHULFLAT'],
      uses: 2,
      earnedPaise: 890 + 500,
      paidPaise: 0,
      owedPaise: 1390,
    });
    expect(r.totals.commissionPaise).toBe(1390);

    const tooMuch = await admin.call('POST', '/admin/discounts/payouts', {
      creatorName: 'Rahul Sharma',
      amountPaise: 5000,
    });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.json.error.message).toContain('owed');
    expect(
      (await admin.call('POST', '/admin/discounts/payouts', { creatorName: 'Nobody', amountPaise: 100 }))
        .status,
    ).toBe(404);
    const paid = await admin.call('POST', '/admin/discounts/payouts', {
      creatorName: 'RAHUL SHARMA',
      amountPaise: 1000,
      note: 'UPI 12 Nov',
    });
    expect(paid.status).toBe(200);
    expect(paid.json).toMatchObject({ creatorName: 'Rahul Sharma', recordedBy: 'admin@vitbhopal.ac.in' });

    r = await report();
    expect(r.creators[0]).toMatchObject({ paidPaise: 1000, owedPaise: 390 });
    expect(r.payouts[0]).toMatchObject({ amountPaise: 1000, note: 'UPI 12 Nov' });
    const codes = (await admin.call('GET', '/admin/promo-codes')).json;
    expect(codes.find((c: { code: string }) => c.code === 'RAHUL10').earnedPaise).toBe(890);
  });

  it('a commission needs a creator; the period filter works; students cannot see any of it', async () => {
    const { clock, course, student, promo, report } = await world();
    expect((await promo({ commissionKind: 'percent', commissionValue: 10 })).status).toBe(400);
    expect(
      (await promo({ creatorName: 'Rahul', commissionKind: 'percent', commissionValue: 150 })).status,
    ).toBe(400);
    await promo({});
    const asha = await student('asha@vitbhopal.ac.in');
    await pay(asha, { courseId: course('dsa-2025-cse-core').id });
    expect((await report('7')).totals.paidOrders).toBe(1);
    clock.advance(10 * DAY);
    expect((await report('7')).totals.paidOrders).toBe(0);
    expect((await report('all')).totals.paidOrders).toBe(1);
    expect((await asha.call('GET', '/admin/discounts')).status).toBe(403);
    expect(
      (await asha.call('POST', '/admin/discounts/payouts', { creatorName: 'x', amountPaise: 100 })).status,
    ).toBe(403);
  });
});

describe('admin devices', () => {
  it('an admin can use more than two devices and removes one at once; students keep two and three days', async () => {
    const { app } = setup();
    const devices: Browser[] = [];
    for (const label of ['Laptop', 'Phone', 'Lab PC', 'Tablet']) {
      const b = new Browser(app);
      const claim = await b.signIn('admin@vitbhopal.ac.in', label);
      expect(claim.status).toBe(200);
      devices.push(b);
    }
    const me = (await devices[0]!.call('GET', '/me')).json;
    expect(me).toMatchObject({ maxDevices: 10, instantDeviceRemoval: true, deviceCooldownUntil: null });
    expect(me.devices).toHaveLength(4);

    // Removing is immediate, and another removal straight after is fine too.
    const phone = me.devices.find((d: { label: string }) => d.label === 'Phone');
    const lab = me.devices.find((d: { label: string }) => d.label === 'Lab PC');
    expect((await devices[0]!.call('DELETE', `/me/devices/${phone.id}`)).status).toBe(200);
    expect((await devices[0]!.call('DELETE', `/me/devices/${lab.id}`)).status).toBe(200);
    expect((await devices[1]!.call('GET', '/me')).status).toBe(401);
    expect((await devices[0]!.call('GET', '/me')).json.devices).toHaveLength(2);
    const self = (await devices[0]!.call('GET', '/me')).json.devices.find(
      (d: { current: boolean }) => d.current,
    );
    expect((await devices[0]!.call('DELETE', `/me/devices/${self.id}`)).status).toBe(400);

    // Students: unchanged.
    const one = new Browser(app);
    await one.signIn('stu@vitbhopal.ac.in', 'Laptop');
    const two = new Browser(app);
    await two.signIn('stu@vitbhopal.ac.in', 'Phone');
    const three = new Browser(app);
    expect((await three.signIn('stu@vitbhopal.ac.in', 'Tablet')).json.error.code).toBe('DEVICE_LIMIT');
    const stuMe = (await one.call('GET', '/me')).json;
    expect(stuMe).toMatchObject({ maxDevices: 2, instantDeviceRemoval: false });
    const other = stuMe.devices.find((d: { current: boolean }) => !d.current);
    await one.call('DELETE', `/me/devices/${other.id}`);
    const after = (await one.call('GET', '/me')).json;
    expect(after.devices.find((d: { id: string }) => d.id === other.id).removalAt).not.toBeNull();
    expect(after.deviceCooldownUntil).not.toBeNull();
  });
});
