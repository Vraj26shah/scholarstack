import { describe, expect, it } from 'vitest';
import { promoPricePaise } from '../src/application/promo-codes';
import { Browser, setup } from './harness';

const DAY = 24 * 60 * 60 * 1000;

async function world() {
  const { env, app, clock } = setup();
  const admin = new Browser(app);
  await admin.signIn('admin@vitbhopal.ac.in');
  const student = new Browser(app);
  await student.signIn('buyer@vitbhopal.ac.in');
  const course = (slug: string) => [...env.db.courses.values()].find((c) => c.slug === slug)!;
  const at = (offsetDays: number) => new Date(clock.now().getTime() + offsetDays * DAY).toISOString();
  const promo = (body: Record<string, unknown>) =>
    admin.call('POST', '/admin/promo-codes', {
      code: 'diwali20',
      kind: 'percent',
      percentOff: 20,
      startsAt: at(-1),
      endsAt: at(5),
      status: 'live',
      ...body,
    });
  /** Buy and pay, end to end. */
  const pay = async (b: Browser, item: Record<string, unknown>) => {
    const order = (await b.call('POST', '/orders', item)).json;
    const p = await env.gateway.simulatePayment(order.gatewayOrderId, 'captured');
    await b.call('POST', '/orders/verify', {
      orderId: order.orderId,
      gatewayOrderId: order.gatewayOrderId,
      ...p,
    });
    return order;
  };
  return { env, app, clock, admin, student, course, at, promo, pay };
}

describe('promo codes', () => {
  it('rounds the price down to the rupee, takes flat amounts off, and never goes below ₹1', () => {
    expect(promoPricePaise(9900, { kind: 'percent', percentOff: 20, amountOffPaise: null })).toBe(7900);
    expect(promoPricePaise(19900, { kind: 'percent', percentOff: 15, amountOffPaise: null })).toBe(16900);
    expect(promoPricePaise(9900, { kind: 'flat', percentOff: null, amountOffPaise: 5000 })).toBe(4900);
    expect(promoPricePaise(9900, { kind: 'flat', percentOff: null, amountOffPaise: 20000 })).toBe(100);
  });

  it('without a code nothing changes; a code lowers the quote and the charge, and is stored upper-case', async () => {
    const { student, course, promo } = await world();
    const dsa = course('dsa-2025-cse-core');
    expect((await student.call('GET', '/promo/active')).json.active).toBe(false);
    expect((await student.call('POST', '/orders', { courseId: dsa.id })).json.amountPaise).toBe(9900);

    const saved = await promo({});
    expect(saved.status).toBe(200);
    expect(saved.json.code).toBe('DIWALI20');
    expect(saved.json.running).toBe(true);
    expect((await student.call('GET', '/promo/active')).json.active).toBe(true);

    const quote = await student.call('POST', '/promo/check', { courseId: dsa.id, code: ' diwali20 ' });
    expect(quote.status).toBe(200);
    expect(quote.json).toEqual({ code: 'DIWALI20', fullPaise: 9900, pricePaise: 7900, discountPaise: 2000 });

    const order = await student.call('POST', '/orders', { courseId: dsa.id, promoCode: 'Diwali20' });
    expect(order.status).toBe(201);
    expect(order.json.amountPaise).toBe(7900);
    // Without the code the price is the normal one.
    expect((await student.call('POST', '/orders', { courseId: dsa.id })).json.amountPaise).toBe(9900);
  });

  it('refuses unknown, draft, future, expired and wrong-item codes with a plain reason', async () => {
    const { student, course, promo, at, clock } = await world();
    const dsa = course('dsa-2025-cse-core');
    const check = (code: string, item: Record<string, unknown> = { courseId: dsa.id }) =>
      student.call('POST', '/promo/check', { ...item, code });

    expect((await check('NOPE')).json.error.message).toContain("isn't a valid promo code");
    await promo({ code: 'DRAFTY', status: 'draft' });
    expect((await check('DRAFTY')).status).toBe(400);
    await promo({ code: 'LATER', startsAt: at(2), endsAt: at(4) });
    expect((await check('LATER')).status).toBe(400);

    await promo({ code: 'BUNDLESONLY', appliesTo: 'bundles' });
    expect((await check('BUNDLESONLY')).json.error.message).toContain("doesn't work on this course");
    const pack = (await student.call('GET', '/bundles/cse-sem-3-pack')).json;
    expect((await check('BUNDLESONLY', { bundleId: pack.id })).status).toBe(200);

    await promo({ code: 'SHORT', endsAt: at(1) });
    expect((await check('SHORT')).status).toBe(200);
    clock.advance(2 * DAY);
    expect((await check('SHORT')).json.error.message).toContain('expired');

    // Starting checkout with a bad code fails too: it never silently charges full price.
    expect((await student.call('POST', '/orders', { courseId: dsa.id, promoCode: 'NOPE' })).status).toBe(400);
  });

  it('chosen courses only, and a flat amount off a bundle', async () => {
    const { student, course, promo } = await world();
    const dsa = course('dsa-2025-cse-core');
    const dbms = course('dbms-2025-cse-core');
    await promo({ code: 'DSAONLY', appliesTo: 'chosen', courseIds: [dsa.id] });
    expect((await student.call('POST', '/promo/check', { courseId: dsa.id, code: 'DSAONLY' })).status).toBe(
      200,
    );
    expect((await student.call('POST', '/promo/check', { courseId: dbms.id, code: 'DSAONLY' })).status).toBe(
      400,
    );

    await promo({ code: 'FIFTY', kind: 'flat', percentOff: null, amountOffPaise: 5000 });
    const pack = (await student.call('GET', '/bundles/cse-sem-3-pack')).json;
    const order = await student.call('POST', '/orders', { bundleId: pack.id, promoCode: 'fifty' });
    expect(order.json.amountPaise).toBe(pack.yourPricePaise - 5000);
  });

  it('comes off the offer price during a festival sale', async () => {
    const { admin, student, course, promo, at } = await world();
    await admin.call('POST', '/admin/offers', {
      title: 'Diwali offer',
      percentOff: 20,
      startsAt: at(-1),
      endsAt: at(5),
      status: 'live',
      allCourses: true,
    });
    const dsa = course('dsa-2025-cse-core');
    await promo({ code: 'EXTRA10', percentOff: 10 });
    const quote = (await student.call('POST', '/promo/check', { courseId: dsa.id, code: 'EXTRA10' })).json;
    // ₹99 → ₹79 with the offer → ₹71 with the code.
    expect(quote).toMatchObject({ fullPaise: 7900, pricePaise: 7100 });
  });

  it('counts only paid orders; once per student and a total limit are kept', async () => {
    const { app, admin, student, course, promo, pay } = await world();
    const saved = (await promo({ code: 'ONCE', maxUses: 2 })).json;
    const dsa = course('dsa-2025-cse-core');
    const dbms = course('dbms-2025-cse-core');

    // An order started but never paid doesn't use the code up.
    await student.call('POST', '/orders', { courseId: dsa.id, promoCode: 'ONCE' });
    expect((await admin.call('GET', '/admin/promo-codes')).json[0].uses).toBe(0);

    await pay(student, { courseId: dsa.id, promoCode: 'ONCE' });
    const listed = (await admin.call('GET', '/admin/promo-codes')).json[0];
    expect(listed).toMatchObject({ id: saved.id, uses: 1, discountGivenPaise: 2000 });
    const again = await student.call('POST', '/promo/check', { courseId: dbms.id, code: 'ONCE' });
    expect(again.json.error.message).toContain('already used');

    const second = new Browser(app);
    await second.signIn('second@vitbhopal.ac.in');
    await pay(second, { courseId: dsa.id, promoCode: 'ONCE' });
    const third = new Browser(app);
    await third.signIn('third@vitbhopal.ac.in');
    const full = await third.call('POST', '/promo/check', { courseId: dsa.id, code: 'ONCE' });
    expect(full.json.error.message).toContain('fully used');
    expect((await admin.call('GET', '/admin/promo-codes')).json[0].running).toBe(false);
  });

  it('only admins manage codes; names are unique; a code can be deleted', async () => {
    const { admin, student, promo } = await world();
    expect((await student.call('GET', '/admin/promo-codes')).status).toBe(403);
    expect((await promo({ code: 'has space' })).status).toBe(400);
    expect((await promo({ appliesTo: 'chosen' })).status).toBe(400);
    const first = await promo({ code: 'SAME' });
    expect((await promo({ code: 'same' })).json.error.message).toContain('already a code called SAME');
    // Editing it under its own name is fine.
    expect((await promo({ id: first.json.id, code: 'SAME', percentOff: 30 })).json.percentOff).toBe(30);
    expect((await admin.call('DELETE', `/admin/promo-codes/${first.json.id}`)).status).toBe(200);
    expect((await admin.call('GET', '/admin/promo-codes')).json).toHaveLength(0);
  });
});

describe('offers on all courses or all bundles', () => {
  it('"all courses" discounts every course and "all bundles" every bundle, each on its own', async () => {
    const { env, admin, student, course, at } = await world();
    const offer = (body: Record<string, unknown>) =>
      admin.call('POST', '/admin/offers', {
        title: 'Festival',
        percentOff: 20,
        startsAt: at(-1),
        endsAt: at(5),
        status: 'live',
        ...body,
      });
    const dsa = course('dsa-2025-cse-core');

    const bundlesOnly = await offer({ allBundles: true });
    expect(bundlesOnly.status).toBe(200);
    expect(bundlesOnly.json).toMatchObject({ allBundles: true, allCourses: false, everything: false });
    expect((await student.call('GET', `/courses/${dsa.slug}`)).json.pricePaise).toBe(9900);
    const pack = (await student.call('GET', '/bundles/cse-sem-3-pack')).json;
    expect(pack.pricePaise).toBe(15900);
    expect(pack.offer.title).toBe('Festival');

    await admin.call('DELETE', `/admin/offers/${bundlesOnly.json.id}`);
    const coursesOnly = await offer({ allCourses: true, courseIds: [dsa.id] });
    // The hand-picked list is dropped: "all courses" already covers it.
    expect(coursesOnly.json).toMatchObject({ allCourses: true, courseIds: [] });
    expect(coursesOnly.json.reach.courses).toBeGreaterThan(5);
    expect((await student.call('GET', `/courses/${dsa.slug}`)).json.pricePaise).toBe(7900);
    expect(env.db.courses.get(dsa.id)!.pricePaise).toBe(9900);

    // Both together is just "everything".
    expect((await offer({ allCourses: true, allBundles: true })).json.everything).toBe(true);
  });
});
