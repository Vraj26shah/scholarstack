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
  it('follow the ladder: 5 courses for ₹349, cheaper per course as packs grow', () => {
    expect(packPricePaise(2, 19800)).toBe(14900);
    expect(packPricePaise(3, 29700)).toBe(19900);
    expect(packPricePaise(4, 39600)).toBe(27900);
    expect(packPricePaise(5, 49500)).toBe(34900);
    expect(packPricePaise(9, 89100)).toBe(54900);
    expect(packPricePaise(12, 118800)).toBe(69900);
    const perCourse = [2, 5, 8].map((n) => packPricePaise(n, n * 9900) / n);
    expect(perCourse[0]!).toBeGreaterThan(perCourse[1]!);
    expect(perCourse[1]!).toBeGreaterThan(perCourse[2]!);
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
    // Two ₹79 courses: ₹149 would be ₹74.50 each, too close to ₹79, so the pack is ₹129.
    expect(packPricePaise(2, 15800, 7900)).toBe(12900);
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
    expect(bce25.pricePaise).toBe(packPricePaise(bce25.courseIds.length, list));
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
