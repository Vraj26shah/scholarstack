import { describe, expect, it } from 'vitest';
import { periodStart } from '../src/application/insights-service';
import { Browser, pay, setup } from './harness';

const UA = { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36' };

async function world() {
  const { env, app, clock } = setup();
  const admin = new Browser(app);
  await admin.signIn('admin@vitbhopal.ac.in');
  const course = (slug: string) => [...env.db.courses.values()].find((c) => c.slug === slug)!;
  const view = (b: Browser, body: unknown, headers: Record<string, string> = UA) =>
    b.call('POST', '/insights/view', body, headers);
  const insights = async (days = '7') => (await admin.call('GET', `/admin/insights?days=${days}`)).json;
  return { env, app, clock, admin, course, view, insights };
}

describe('insights', () => {
  it('a period starts at midnight IST, today included', () => {
    // 22 Nov 2026, 01:00 IST (21 Nov 19:30 UTC).
    const now = new Date('2026-11-21T19:30:00Z');
    expect(periodStart(1, now).toISOString()).toBe('2026-11-21T18:30:00.000Z');
    expect(periodStart(7, now).toISOString()).toBe('2026-11-15T18:30:00.000Z');
  });

  it('counts course and bundle page views, signed in or not, and ties them to checkouts', async () => {
    const { app, course, view, insights } = await world();
    const dsa = course('dsa-2025-cse-core');
    const visitor = new Browser(app);
    expect((await view(visitor, { courseId: dsa.id })).status).toBe(204);
    const student = new Browser(app);
    await student.signIn('viewer@vitbhopal.ac.in');
    await view(student, { courseId: dsa.id, signedIn: true });
    const pack = (await student.call('GET', '/bundles/cse-sem-3-pack')).json;
    await view(student, { bundleId: pack.id, signedIn: true });
    await pay(student, { courseId: dsa.id });

    const r = await insights();
    expect(r.days).toBe('7');
    expect(r.daily).toHaveLength(7);
    expect(r.summary).toMatchObject({
      views: 3,
      signedInViews: 2,
      checkouts: 1,
      paidOrders: 1,
      buyers: 1,
      firstPurchases: 1,
      revenuePaise: 9900,
    });
    expect(r.summary.signups).toBeGreaterThanOrEqual(1);
    expect(r.summary.signupsWhoBought).toBe(1);
    expect(r.topItems[0]).toMatchObject({
      kind: 'course',
      id: dsa.id,
      views: 2,
      signedInViews: 1,
      checkouts: 1,
      paid: 1,
    });
    expect(r.topItems.some((i: { id: string }) => i.id === pack.id)).toBe(true);
    const today = r.daily.at(-1);
    expect(today).toMatchObject({ views: 3, checkouts: 1, paid: 1, revenuePaise: 9900 });
  });

  it('ignores robots, made-up and draft items, and bad bodies, and always answers 204', async () => {
    const { env, app, course, view, insights } = await world();
    const b = new Browser(app);
    const dsa = course('dsa-2025-cse-core');
    expect((await view(b, { courseId: dsa.id }, { 'user-agent': 'LinkedInBot/1.0' })).status).toBe(204);
    expect((await view(b, { courseId: dsa.id }, { 'user-agent': 'WhatsApp/2.23' })).status).toBe(204);
    expect((await view(b, { courseId: 'not-a-course' })).status).toBe(204);
    expect((await view(b, { courseId: dsa.id, userId: 'x' })).status).toBe(204);
    expect((await view(b, 'junk')).status).toBe(204);
    const draft = [...env.db.courses.values()].find((c) => c.status !== 'live');
    if (draft) await view(b, { courseId: draft.id });
    expect((await insights()).summary.views).toBe(0);
  });

  it('one network and browser can add only so many views a minute', async () => {
    const { app, course, view, insights } = await world();
    const b = new Browser(app);
    const dsa = course('dsa-2025-cse-core');
    for (let i = 0; i < 60; i++) await view(b, { courseId: dsa.id });
    expect((await insights()).summary.views).toBe(40);
  });

  it('only admins can read the report, and the period is checked', async () => {
    const { app, admin } = await world();
    const student = new Browser(app);
    await student.signIn('nosy@vitbhopal.ac.in');
    expect((await student.call('GET', '/admin/insights')).status).toBe(403);
    expect((await new Browser(app).call('GET', '/admin/insights')).status).toBe(401);
    expect((await admin.call('GET', '/admin/insights?days=365')).status).toBe(400);
    const month = (await admin.call('GET', '/admin/insights')).json;
    expect(month.days).toBe('30');
    expect(month.daily).toHaveLength(30);
  });
});
