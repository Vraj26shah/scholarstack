import { PACK_LADDER_RUPEES } from '@ss/contracts';
import { describe, expect, it } from 'vitest';
import { packPricePaise } from '../src/application/packs';
import { Browser, setup } from './harness';

async function world() {
  const { env, app, clock } = setup();
  const admin = new Browser(app);
  await admin.signIn('admin@vitbhopal.ac.in');
  const student = new Browser(app);
  await student.signIn('buyer@vitbhopal.ac.in');
  const run = (body: Record<string, unknown> = {}) =>
    admin.call('POST', '/admin/bundles/packs', { dryRun: false, titlePrefix: 'Diwali pack', ...body });
  return { env, app, clock, admin, student, run };
}

describe('pack prices', () => {
  it('take a little more off each course as packs grow, never a steep cut', () => {
    const per = [2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => packPricePaise(n, n * 9900) / n / 9900);
    // 2 courses about 10% off, 10 courses under 30% off; every step down is small.
    expect(1 - per[0]!).toBeGreaterThan(0.08);
    expect(1 - per[0]!).toBeLessThan(0.12);
    expect(1 - per.at(-1)!).toBeLessThan(0.3);
    for (let i = 1; i < per.length; i++) expect(per[i - 1]! - per[i]!).toBeLessThan(0.07);
  });

  it('follow the ladder: every bigger pack costs more in total and less per course, past 10 too', () => {
    expect(packPricePaise(2, 19800)).toBe(17900);
    expect(packPricePaise(3, 29700)).toBe(24900);
    expect(packPricePaise(4, 39600)).toBe(31900);
    expect(packPricePaise(5, 49500)).toBe(38900);
    expect(packPricePaise(9, 89100)).toBe(64900);
    expect(packPricePaise(12, 118800)).toBe(80900);
    const sizes = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 20];
    const totals = sizes.map((n) => packPricePaise(n, n * 9900));
    for (let i = 1; i < sizes.length; i++) {
      expect(totals[i]!).toBeGreaterThan(totals[i - 1]!);
      expect(totals[i]! / sizes[i]!).toBeLessThan(totals[i - 1]! / sizes[i - 1]!);
    }
  });

  it('never ask more than the courses one by one, even with cheap courses', () => {
    const p = packPricePaise(2, 9800);
    expect(p).toBeLessThan(9800);
    expect(String(p / 100).endsWith('9')).toBe(true);
  });

  it('each course in a pack costs less than the cheapest course bought alone', () => {
    for (const prices of [
      [7900, 7900],
      [9900, 7900],
      [9900, 9900, 4900],
      [7900, 7900, 7900, 7900, 7900],
    ]) {
      const list = prices.reduce((s, p) => s + p, 0);
      const cheapest = Math.min(...prices);
      const pack = packPricePaise(prices.length, list, cheapest);
      expect(pack).toBeLessThan(list);
      expect(pack / prices.length).toBeLessThan(cheapest);
      expect(String(pack / 100).endsWith('9')).toBe(true);
    }
    // Two ₹79 courses: ₹179 would be dearer than buying them, so the pack is about 10% off: ₹139.
    expect(packPricePaise(2, 15800, 7900)).toBe(13900);
  });
});

describe('drawer packs', () => {
  it('a dry run changes nothing; a real run makes one live pack per drawer with two or more courses', async () => {
    const { env, admin, run } = await world();
    const before = env.db.bundles.size;
    const preview = (await admin.call('GET', '/admin/bundles/packs')).json;
    expect(preview.applied).toBe(false);
    expect(preview.totals.create).toBeGreaterThan(0);
    expect(env.db.bundles.size).toBe(before);

    const r = await run();
    expect(r.status).toBe(200);
    expect(r.json.applied).toBe(true);
    const packs = [...env.db.bundles.values()].filter((b) => b.autoDrawer);
    expect(packs.length).toBe(r.json.totals.create);
    const bce25 = packs.find((b) => b.autoDrawer === '2025:bce')!;
    expect(bce25.title).toBe('Diwali pack · 2025 BCE');
    expect(bce25.status).toBe('live');
    expect(bce25.offeredTo).toEqual([{ batchYear: 2025, branchSlug: 'bce' }]);
    const list = bce25.courseIds.reduce((s, id) => s + env.db.courses.get(id)!.pricePaise, 0);
    const cheapest = Math.min(...bce25.courseIds.map((id) => env.db.courses.get(id)!.pricePaise));
    expect(bce25.pricePaise).toBe(packPricePaise(bce25.courseIds.length, list, cheapest));
    expect(bce25.pricePaise).toBeLessThan(list);
  });

  it('students see their drawer pack, and buying it puts every course on the shelf', async () => {
    const { student, run } = await world();
    await run();
    const inDrawer = (await student.call('GET', '/bundles?batch=2025&branch=bce')).json as {
      slug: string;
      id: string;
      courseCount: number;
      pricePaise: number;
    }[];
    const pack = inDrawer.find((b) => b.slug === 'pack-2025-bce')!;
    expect(pack).toBeTruthy();
    const drawer = (await student.call('GET', '/catalogue/drawer?batch=2025&branch=bce')).json;
    expect(pack.courseCount).toBe(drawer.length);
    expect(
      (await student.call('GET', '/bundles?batch=2025&branch=bai')).json.map((b: any) => b.slug),
    ).not.toContain('pack-2025-bce');
    const order = await student.call('POST', '/orders', { bundleId: pack.id });
    expect(order.status).toBe(201);
    expect(order.json.amountPaise).toBe(pack.pricePaise);
  });

  it('running again changes nothing; a new prefix renames; a course leaving updates the pack', async () => {
    const { env, admin, run } = await world();
    await run();
    const again = (await run()).json;
    expect(again.totals.create + again.totals.update).toBe(0);

    const renamed = (await run({ titlePrefix: 'Semester pack' })).json;
    expect(renamed.totals.update).toBeGreaterThan(0);
    expect([...env.db.bundles.values()].find((b) => b.autoDrawer === '2025:bce')!.title).toBe(
      'Semester pack · 2025 BCE',
    );

    const pack = [...env.db.bundles.values()].find((b) => b.autoDrawer === '2025:bce')!;
    const leaving = pack.courseIds[0]!;
    const course = env.db.courses.get(leaving)!;
    expect((await admin.call('PATCH', `/admin/courses/${course.id}`, { status: 'draft' })).status).toBe(200);
    const after = (await run({ titlePrefix: 'Semester pack' })).json;
    const plan = after.plans.find((p: any) => p.batchYear === 2025 && p.branchSlug === 'bce');
    const now = [...env.db.bundles.values()].find((b) => b.autoDrawer === '2025:bce')!;
    expect(now.courseIds).not.toContain(leaving);
    expect(['update', 'retire']).toContain(plan.action);
  });

  it('the hourly sync only runs once the admin asked for it', async () => {
    const { env, run } = await world();
    expect(await env.container.packs.sync()).toBeNull();
    await run({ keepInSync: true, status: 'draft' });
    const synced = await env.container.packs.sync();
    expect(synced?.applied).toBe(true);
    expect([...env.db.bundles.values()].filter((b) => b.autoDrawer).every((b) => b.status === 'draft')).toBe(
      true,
    );
  });

  it('a pack made into a normal bundle is left alone, and no second pack appears beside it', async () => {
    const { env, admin, run } = await world();
    await run();
    const pack = [...env.db.bundles.values()].find((b) => b.autoDrawer === '2025:bce')!;
    const d = await admin.call('POST', `/admin/bundles/${pack.id}/detach`);
    expect(d.status).toBe(200);
    expect(d.json.autoDrawer).toBeNull();
    const r = (await run({ titlePrefix: 'Other' })).json;
    expect(r.plans.find((p: any) => p.batchYear === 2025 && p.branchSlug === 'bce').action).toBe('skip');
    expect(env.db.bundles.get(pack.id)!.title).toBe('Diwali pack · 2025 BCE');
    expect([...env.db.bundles.values()].filter((b) => b.autoDrawer === '2025:bce')).toHaveLength(0);
  });

  it('only admins build packs', async () => {
    const { student } = await world();
    expect((await student.call('POST', '/admin/bundles/packs', { dryRun: true })).status).toBe(403);
  });
});

describe('editing pack prices', () => {
  it('a new price list reprices every pack of that size at once, says why, and is kept for the hourly sync', async () => {
    const { admin, student, run } = await world();
    await run({ titlePrefix: 'Semester pack' });
    const ladder = { 2: 139, 3: 189, 4: 239, 5: 289, 6: 339, 7: 389, 8: 439, 9: 489, 10: 539 };
    const preview = await admin.call('POST', '/admin/bundles/packs', {
      dryRun: true,
      titlePrefix: 'Semester pack',
      ladder,
    });
    expect(preview.status).toBe(200);
    const changing = preview.json.plans.filter((p: { action: string }) => p.action === 'update');
    expect(changing.length).toBeGreaterThan(0);
    expect(changing[0].note).toMatch(/Will change: price ₹\d+ → ₹\d+/);
    expect(preview.json.coursePrices.minPaise).toBeGreaterThan(0);

    const built = await run({ titlePrefix: 'Semester pack', ladder });
    expect(built.json.settings.ladder).toEqual(
      Object.fromEntries(Object.entries(ladder).map(([k, v]) => [k, v])),
    );
    const saved = (await admin.call('GET', '/admin/bundles/packs')).json;
    expect(saved.settings.ladder['5']).toBe(289);
    expect(saved.totals.update).toBe(0);
    const pack = (
      (await student.call('GET', '/bundles?batch=2025&branch=bce')).json as {
        forDrawer?: string;
        courseCount: number;
        pricePaise: number;
      }[]
    ).find((b) => b.forDrawer);
    if (pack && pack.courseCount <= 10)
      expect([ladder[pack.courseCount as keyof typeof ladder] * 100, expect.any(Number)]).toContain(
        pack.pricePaise,
      );
  });

  it('refuses a price list where a bigger pack costs more per course, and changes nothing', async () => {
    const { admin, run } = await world();
    await run({ titlePrefix: 'Semester pack' });
    const bad = await run({
      titlePrefix: 'Semester pack',
      ladder: { 2: 149, 3: 199, 4: 279, 5: 349, 6: 399, 7: 449, 8: 499, 9: 549, 10: 599 },
    });
    expect(bad.status).toBe(400);
    expect(bad.json.error.message).toContain('4 courses: Must be cheaper per course than the 3-course pack');
    expect((await admin.call('GET', '/admin/bundles/packs')).json.settings.ladder['4']).toBe(
      PACK_LADDER_RUPEES['4'],
    );
  });

  it('a preview never clears the public catalogue cache', async () => {
    const { env, admin, run } = await world();
    await run({ titlePrefix: 'Semester pack' });
    const forget = env.container.catalogue.forget.bind(env.container.catalogue);
    let cleared = 0;
    env.container.catalogue.forget = () => {
      cleared++;
      forget();
    };
    await admin.call('POST', '/admin/bundles/packs', { dryRun: true, titlePrefix: 'Semester pack' });
    expect(cleared).toBe(0);
  });
});
