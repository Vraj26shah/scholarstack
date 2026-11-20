import { describe, expect, it } from 'vitest';
import { Browser, setup } from './harness';

const DAY = 24 * 60 * 60 * 1000;

/** The check-out slip: every line the student sees before Razorpay, matching what is charged. */
describe('check-out slip', () => {
  async function world() {
    const { env, app, clock } = setup();
    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
    const student = new Browser(app);
    await student.signIn('buyer@vitbhopal.ac.in');
    const dsa = [...env.db.courses.values()].find((c) => c.slug === 'dsa-2025-cse-core')!;
    const at = (d: number) => new Date(clock.now().getTime() + d * DAY).toISOString();
    return { app, admin, student, dsa, at };
  }

  it('shows the plain price, then the offer, then the code, and the order charges the same total', async () => {
    const { admin, student, dsa, at } = await world();
    const plain = await student.call('POST', '/checkout/quote', { courseId: dsa.id });
    expect(plain.status).toBe(200);
    expect(plain.json).toMatchObject({
      kind: 'course',
      courseCount: 1,
      fullPaise: 9900,
      offer: null,
      promo: null,
      totalPaise: 9900,
    });

    await admin.call('POST', '/admin/offers', {
      title: 'Diwali offer',
      percentOff: 20,
      startsAt: at(-1),
      endsAt: at(5),
      status: 'live',
      everything: true,
    });
    const offered = (await student.call('POST', '/checkout/quote', { courseId: dsa.id })).json;
    expect(offered.offer).toMatchObject({ title: 'Diwali offer', percentOff: 20 });
    expect(offered.fullPaise - offered.offer.discountPaise).toBe(offered.totalPaise);
    expect(offered.totalPaise).toBeLessThan(9900);

    await admin.call('POST', '/admin/promo-codes', {
      code: 'extra10',
      kind: 'percent',
      percentOff: 10,
      startsAt: at(-1),
      endsAt: at(5),
      status: 'live',
    });
    const coded = (await student.call('POST', '/checkout/quote', { courseId: dsa.id, code: ' extra10 ' }))
      .json;
    expect(coded.promo.code).toBe('EXTRA10');
    expect(coded.totalPaise).toBe(offered.totalPaise - coded.promo.discountPaise);

    const order = await student.call('POST', '/orders', { courseId: dsa.id, promoCode: 'EXTRA10' });
    expect(order.json.amountPaise).toBe(coded.totalPaise);
  });

  it('refuses a bad code with a plain reason, and needs a signed-in student', async () => {
    const { app, student, dsa } = await world();
    const bad = await student.call('POST', '/checkout/quote', { courseId: dsa.id, code: 'NOPE' });
    expect(bad.status).toBe(400);
    expect(bad.json.error.message).toContain("isn't a valid promo code");
    const visitor = new Browser(app);
    expect((await visitor.call('POST', '/checkout/quote', { courseId: dsa.id })).status).toBe(401);
  });
});
