import { describe, expect, it } from 'vitest';
import { bundleAudience, drawersMeet, offerPricePaise } from '../src/application/offers';
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
  const drawer = async (batch: number, branch: string) =>
    (await student.call('GET', `/catalogue/drawer?batch=${batch}&branch=${branch}`)).json as {
      id: string;
      pricePaise: number;
      offer?: { title: string; percentOff: number; fullPricePaise: number };
    }[];
  const bundlesIn = async (batch: number, branch: string) =>
    ((await student.call('GET', `/bundles?batch=${batch}&branch=${branch}`)).json as { slug: string }[]).map(
      (b) => b.slug,
    );
  const offer = (body: Record<string, unknown>) =>
    admin.call('POST', '/admin/offers', {
      title: 'Diwali offer',
      percentOff: 20,
      startsAt: at(-1),
      endsAt: at(5),
      status: 'live',
      ...body,
    });
  return { env, app, clock, admin, student, course, at, drawer, bundlesIn, offer };
}

describe('bundles across batches and programmes', () => {
  it('mixes courses from different batches and shows in exactly the drawers picked', async () => {
    const { admin, course, bundlesIn } = await world();
    const r = await admin.call('POST', '/admin/bundles', {
      title: 'Networks and DSA',
      courseIds: [course('cn-2024-cse-core').id, course('dsa-2025-cse-core').id],
      pricePaise: 14900,
      status: 'live',
      offeredTo: [
        { batchYear: 2024, branchSlug: 'bce' },
        { batchYear: 2025, branchSlug: 'bce' },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.json.audience).toHaveLength(2);
    expect(await bundlesIn(2024, 'bce')).toContain('networks-and-dsa');
    expect(await bundlesIn(2025, 'bce')).toContain('networks-and-dsa');
    expect(await bundlesIn(2025, 'bai')).not.toContain('networks-and-dsa');
  });

  it('"*" shows a bundle to every programme of a batch', async () => {
    const { admin, course, bundlesIn } = await world();
    await admin.call('POST', '/admin/bundles', {
      title: 'First years',
      courseIds: [course('physics-2026-common').id, course('calculus-2026-common').id],
      pricePaise: 12900,
      status: 'live',
      offeredTo: [{ batchYear: 2026, branchSlug: '*' }],
    });
    expect(await bundlesIn(2026, 'bai')).toContain('first-years');
    expect(await bundlesIn(2026, 'bme')).toContain('first-years');
    expect(await bundlesIn(2025, 'bai')).not.toContain('first-years');
  });

  it('refuses to publish a bundle no drawer would ever show, and an unknown programme', async () => {
    const { admin, course } = await world();
    const lonely = await admin.call('POST', '/admin/bundles', {
      title: 'Nowhere',
      courseIds: [course('iot-2023-cse-core').id, course('dsa-2025-cse-core').id],
      pricePaise: 12900,
      status: 'live',
    });
    expect(lonely.status).toBe(400);
    expect(lonely.json.error.message).toContain('Pick the batches and programmes');
    const odd = await admin.call('POST', '/admin/bundles', {
      title: 'Odd',
      courseIds: [course('iot-2023-cse-core').id, course('dsa-2025-cse-core').id],
      pricePaise: 12900,
      status: 'draft',
      offeredTo: [{ batchYear: 2025, branchSlug: 'nope' }],
    });
    expect(odd.status).toBe(400);
  });

  it('automatic: every drawer that shows two or more of its courses', () => {
    const offerings: Record<string, { batchYear: number; branchSlug: string }[]> = {
      a: [
        { batchYear: 2025, branchSlug: 'bce' },
        { batchYear: 2024, branchSlug: 'bcy' },
      ],
      b: [
        { batchYear: 2025, branchSlug: 'bce' },
        { batchYear: 2024, branchSlug: 'bcy' },
      ],
      c: [{ batchYear: 2025, branchSlug: 'common' }],
    };
    const audience = bundleAudience(
      { courseIds: ['a', 'b', 'c'], offeredTo: null, batchYear: null },
      (id) => offerings[id] ?? [],
      ['bce', 'bcy', 'bai'],
      ['common'],
    );
    expect(audience).toEqual([
      { batchYear: 2025, branchSlug: 'bce' },
      { batchYear: 2024, branchSlug: 'bcy' },
    ]);
    // An older one-batch bundle stays in its batch.
    expect(
      bundleAudience(
        { courseIds: ['a', 'b'], offeredTo: null, batchYear: 2024 },
        (id) => offerings[id] ?? [],
        ['bce', 'bcy'],
        [],
      ),
    ).toEqual([{ batchYear: 2024, branchSlug: 'bcy' }]);
  });
});

describe('offers', () => {
  it('rounds to whole rupees and never below ₹1', () => {
    expect(offerPricePaise(9900, 20)).toBe(7900);
    expect(offerPricePaise(19900, 25)).toBe(14900);
    expect(offerPricePaise(100, 90)).toBe(100);
    expect(offerPricePaise(27900, 20)).toBe(21900);
    expect(offerPricePaise(7900, 20)).toBe(5900);
    expect(offerPricePaise(34900, 20)).toBe(27900);
    expect(
      drawersMeet([{ batchYear: 2025, branchSlug: '*' }], [{ batchYear: 2025, branchSlug: 'bai' }]),
    ).toBe(true);
  });

  it('a Diwali offer on everything changes the card, the course page, the bundle and the charge, then ends', async () => {
    const { env, clock, student, course, drawer, offer } = await world();
    const saved = await offer({
      everything: true,
      endsAt: new Date(clock.now().getTime() + 2 * DAY).toISOString(),
    });
    expect(saved.status).toBe(200);
    expect(saved.json.running).toBe(true);
    expect(saved.json.reach.courses).toBeGreaterThan(5);

    const dsa = course('dsa-2025-cse-core');
    const card = (await drawer(2025, 'bce')).find((c) => c.id === dsa.id)!;
    expect(card.pricePaise).toBe(7900);
    expect(card.offer).toMatchObject({ title: 'Diwali offer', percentOff: 20, fullPricePaise: 9900 });
    expect((await student.call('GET', `/courses/${dsa.slug}`)).json.pricePaise).toBe(7900);

    const pack = (await student.call('GET', '/bundles/cse-sem-3-pack')).json;
    expect(pack.pricePaise).toBe(15900);
    expect(String(pack.pricePaise / 100).endsWith('9')).toBe(true);
    expect(pack.offer.fullPricePaise).toBe(19900);

    const order = await student.call('POST', '/orders', { courseId: dsa.id });
    expect(order.status).toBe(201);
    expect(order.json.amountPaise).toBe(7900);
    // The base price was never touched.
    expect(env.db.courses.get(dsa.id)!.pricePaise).toBe(9900);

    clock.advance(3 * DAY);
    const after = (await drawer(2025, 'bce')).find((c) => c.id === dsa.id)!;
    expect(after.pricePaise).toBe(9900);
    expect(after.offer).toBeUndefined();
    expect((await student.call('POST', '/orders', { courseId: dsa.id })).json.amountPaise).toBe(9900);
  });

  it('an offer for some drawers only touches what shows there; the bigger offer wins, offers never stack', async () => {
    const { course, drawer, offer } = await world();
    await offer({
      title: '23 batch farewell',
      percentOff: 30,
      drawers: [{ batchYear: 2023, branchSlug: '*' }],
    });
    await offer({ title: 'Small', percentOff: 10, courseIds: [course('iot-2023-cse-core').id] });
    const old = await drawer(2023, 'bce');
    const iot = old.find((c) => c.id === course('iot-2023-cse-core').id)!;
    expect(iot.offer?.title).toBe('23 batch farewell');
    expect(iot.pricePaise).toBe(6900);
    const now = await drawer(2025, 'bce');
    expect(now.every((c) => !c.offer)).toBe(true);
  });

  it('a draft or future offer changes nothing; dates and scope are checked', async () => {
    const { at, drawer, offer } = await world();
    await offer({ everything: true, status: 'draft' });
    await offer({ everything: true, startsAt: at(3), endsAt: at(6) });
    expect((await drawer(2025, 'bce')).every((c) => !c.offer)).toBe(true);
    expect((await offer({ everything: true, startsAt: at(2), endsAt: at(1) })).status).toBe(400);
    expect((await offer({})).status).toBe(400);
    expect((await offer({ percentOff: 95, everything: true })).status).toBe(400);
  });

  it('a big course sale never leaves the bundle the dearer way to buy', async () => {
    const { student, course, offer } = await world();
    const ids = ['dbms-2025-cse-core', 'dsa-2025-cse-core', 'maths3-2025-cse-core'].map((s) => course(s).id);
    await offer({ title: 'Flash sale', percentOff: 80, courseIds: ids });
    const pack = (await student.call('GET', '/bundles/cse-sem-3-pack')).json;
    // At sale prices the three cost ₹53 one by one; the bundle stays under that, ending in 9.
    expect(pack.pricePaise).toBe(3900);
    expect(pack.pricePaise).toBeLessThan(1900 + 1900 + 1500);
    expect(pack.yourPricePaise).toBe(3900);
    const order = await student.call('POST', '/orders', { bundleId: pack.id });
    expect(order.json.amountPaise).toBe(3900);
  });

  it('only admins manage offers, and one can be deleted', async () => {
    const { student, admin, offer } = await world();
    expect((await student.call('GET', '/admin/offers')).status).toBe(403);
    const o = await offer({ everything: true });
    expect((await admin.call('GET', '/admin/offers')).json).toHaveLength(1);
    expect((await admin.call('DELETE', `/admin/offers/${o.json.id}`)).status).toBe(200);
    expect((await admin.call('GET', '/admin/offers')).json).toHaveLength(0);
  });
});
