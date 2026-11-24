import { describe, expect, it } from 'vitest';
import { activityTarget, pageTarget } from '../src/application/activity';
import { Browser, setup } from './harness';

const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0 Safari/537.36' };

async function world() {
  const { env, app } = setup();
  const admin = new Browser(app);
  await admin.signIn('admin@vitbhopal.ac.in');
  const hit = (b: Browser, body: unknown, headers: Record<string, string> = UA) =>
    b.call('POST', '/insights/hit', body, headers);
  const page = (b: Browser, path: string) => hit(b, { kind: 'page', path });
  const activity = async (days = '7') => (await admin.call('GET', `/admin/activity?days=${days}`)).json;
  const userId = (email: string) => [...env.db.profiles.values()].find((p) => p.email === email)!.id;
  return { env, app, admin, hit, page, activity, userId };
}

describe('what pages are recorded as', () => {
  it('keeps known pages by route, every tool by its key, and hides private ids', () => {
    expect(pageTarget('/')).toBe('/');
    expect(pageTarget('/c/dbms-2025-cse-core?ref=wa')).toBe('/c/dbms-2025-cse-core');
    expect(pageTarget('/B/CSE-Sem-3-Pack/')).toBe('/b/cse-sem-3-pack');
    expect(pageTarget('/tools/cgpa')).toBe('/tools/cgpa');
    expect(pageTarget('/tools/a-tool-launched-next-month')).toBe('/tools/a-tool-launched-next-month');
    expect(pageTarget('/read/3f1c0a7e-1111-4222-8333-444455556666')).toBe('/read');
    expect(pageTarget('/checkout/9b9e0000-1111-4222-8333-444455556666')).toBe('/checkout');
    expect(pageTarget('/shelf')).toBe('/shelf');
  });

  it('drops admin pages and sign-in callbacks, and folds anything odd into /other', () => {
    expect(pageTarget('/admin')).toBeNull();
    expect(pageTarget('/admin?section=students')).toBeNull();
    expect(pageTarget('/auth/callback')).toBeNull();
    expect(pageTarget('/c/<script>alert(1)</script>')).toBe('/other');
    expect(pageTarget('/wp-login.php')).toBe('/other');
    expect(pageTarget('/c/a/b/c')).toBe('/other');
    expect(pageTarget(`/c/${'x'.repeat(200)}`)).toBeNull();
  });

  it('an action names the course or bundle it was on', () => {
    expect(activityTarget({ kind: 'action', name: 'peek_open', path: '/c/dbms-2025-cse-core' })).toEqual({
      kind: 'action',
      target: 'peek_open:/c/dbms-2025-cse-core',
    });
    expect(activityTarget({ kind: 'action', name: 'read_open', path: '/read/abc' })).toEqual({
      kind: 'action',
      target: 'read_open',
    });
    // Signing in isn't about the page it lands on.
    expect(activityTarget({ kind: 'action', name: 'login', path: '/c/dbms-2025-cse-core' })).toEqual({
      kind: 'action',
      target: 'login',
    });
  });
});

describe('tool use and "stuck" signals', () => {
  it('records which tool was used and where people got stuck, by page', () => {
    expect(activityTarget({ kind: 'action', name: 'tool_used', path: '/tools/mess-menu' })).toEqual({
      kind: 'action',
      target: 'tool_used:/tools/mess-menu',
    });
    // "Used" only means something on a tool page.
    expect(activityTarget({ kind: 'action', name: 'tool_used', path: '/shelf' })).toBeNull();
    expect(activityTarget({ kind: 'action', name: 'stuck_error', path: '/tools/cgpa?x=1' })).toEqual({
      kind: 'action',
      target: 'stuck_error:/tools/cgpa',
    });
    expect(activityTarget({ kind: 'action', name: 'stuck_form', path: '/sign-in' })).toEqual({
      kind: 'action',
      target: 'stuck_form:/sign-in',
    });
    // A private id in the path never reaches the table.
    expect(activityTarget({ kind: 'action', name: 'stuck_crash', path: '/read/secret-file-id' })).toEqual({
      kind: 'action',
      target: 'stuck_crash:/read',
    });
    expect(
      activityTarget({ kind: 'action', name: 'payment_cancelled', path: '/c/dbms-2025-cse-core' }),
    ).toEqual({
      kind: 'action',
      target: 'payment_cancelled:/c/dbms-2025-cse-core',
    });
  });
});

describe('student activity', () => {
  it('records signed-in students by account and visitors together, and reports both', async () => {
    const { app, hit, page, activity, userId, admin } = await world();
    const visitor = new Browser(app);
    await page(visitor, '/');
    await page(visitor, '/c/dbms-2025-cse-core');
    const student = new Browser(app);
    await student.signIn('active.23bce10001@vitbhopal.ac.in');
    await page(student, '/c/dbms-2025-cse-core');
    await page(student, '/tools/cgpa');
    await page(student, '/tools/cgpa');
    await hit(student, { kind: 'action', name: 'peek_open', path: '/c/dbms-2025-cse-core' });

    const r = await activity();
    expect(r.summary).toEqual({ activeStudents: 1, studentPages: 3, visitorPages: 2, actions: 1 });
    expect(r.daily).toHaveLength(7);
    expect(r.daily.at(-1)).toMatchObject({ students: 1, studentPages: 3, visitorPages: 2 });
    expect(r.pages.find((p: { target: string }) => p.target === '/c/dbms-2025-cse-core')).toEqual({
      target: '/c/dbms-2025-cse-core',
      hits: 2,
      studentHits: 1,
      visitorHits: 1,
      students: 1,
    });
    // Ties sort by name, the same in the database.
    expect(r.pages.map((p: { target: string }) => p.target)).toEqual([
      '/c/dbms-2025-cse-core',
      '/tools/cgpa',
      '/',
    ]);
    expect(r.pages[1]).toMatchObject({ target: '/tools/cgpa', hits: 2, students: 1 });
    expect(r.actions).toEqual([
      { target: 'peek_open:/c/dbms-2025-cse-core', hits: 1, visitorHits: 0, students: 1 },
    ]);
    expect(r.students).toHaveLength(1);
    expect(r.students[0]).toMatchObject({
      email: 'active.23bce10001@vitbhopal.ac.in',
      days: 1,
      hits: 4,
      topPage: '/tools/cgpa',
    });

    const id = userId('active.23bce10001@vitbhopal.ac.in');
    const one = (await admin.call('GET', `/admin/students/${id}/activity?days=30`)).json;
    expect(one.days).toBe(1);
    expect(one.hits).toBe(4);
    expect(one.lastSeenAt).toEqual(expect.any(String));
    expect(one.items.map((i: { target: string }) => i.target).sort()).toEqual([
      '/c/dbms-2025-cse-core',
      '/tools/cgpa',
      'peek_open:/c/dbms-2025-cse-core',
    ]);
  });

  it('never counts admins, admin pages, robots or bad bodies, and always answers 204', async () => {
    const { app, admin, hit, page, activity } = await world();
    expect((await page(admin, '/c/dbms-2025-cse-core')).status).toBe(204);
    const b = new Browser(app);
    expect((await page(b, '/admin')).status).toBe(204);
    expect((await hit(b, { kind: 'page', path: '/' }, { 'user-agent': 'Googlebot/2.1' })).status).toBe(204);
    expect((await hit(b, { kind: 'action', name: 'hack', path: '/' })).status).toBe(204);
    expect((await hit(b, { kind: 'page', path: '/', userId: 'someone' })).status).toBe(204);
    expect((await hit(b, 'junk')).status).toBe(204);
    const r = await activity();
    expect(r.summary).toEqual({ activeStudents: 0, studentPages: 0, visitorPages: 0, actions: 0 });
  });

  it('a student can’t record activity as someone else', async () => {
    const { app, page, activity, env } = await world();
    const student = new Browser(app);
    await student.signIn('honest.23bce10002@vitbhopal.ac.in');
    // The body has no say in who it is: only the token does, and a forged token counts as a visitor.
    await student.call(
      'POST',
      '/insights/hit',
      { kind: 'page', path: '/shelf' },
      {
        ...UA,
        authorization: 'Bearer forged.token.value',
      },
    );
    await page(student, '/help');
    const r = await activity();
    expect(r.students.map((s: { email: string }) => s.email)).toEqual(['honest.23bce10002@vitbhopal.ac.in']);
    expect(r.pages.find((p: { target: string }) => p.target === '/shelf')).toMatchObject({ visitorHits: 1 });
    expect(env.db.activity.size).toBe(2);
  });

  it('the Students list has everyone who signed up, with when they joined and were last seen', async () => {
    const { app, admin, page } = await world();
    const browsing = new Browser(app);
    await browsing.signIn('looking.23bce10004@vitbhopal.ac.in');
    await page(browsing, '/tools/cgpa');
    const quiet = new Browser(app);
    await quiet.signIn('quiet.23bce10005@vitbhopal.ac.in');
    const list = (await admin.call('GET', '/admin/students')).json as {
      email: string;
      courses: unknown[];
      joinedAt: string | null;
      lastSeenAt: string | null;
      batchYear: number | null;
      branchCode: string | null;
    }[];
    const looking = list.find((s) => s.email === 'looking.23bce10004@vitbhopal.ac.in');
    expect(looking).toMatchObject({ courses: [], batchYear: 2023, branchCode: 'BCE' });
    expect(looking?.joinedAt).toEqual(expect.any(String));
    expect(looking?.lastSeenAt).toEqual(expect.any(String));
    expect(list.find((s) => s.email === 'quiet.23bce10005@vitbhopal.ac.in')?.lastSeenAt).toBeNull();
    // Admin accounts aren't listed as students.
    expect(list.some((s) => s.email === 'admin@vitbhopal.ac.in')).toBe(false);
    // Still sorted by email, buyers and everyone else together.
    const emails = list.map((s) => s.email);
    expect(emails).toEqual([...emails].sort((a, b) => a.localeCompare(b)));
  });

  it('only admins can read activity', async () => {
    const { app, userId } = await world();
    const student = new Browser(app);
    await student.signIn('nosy.23bce10003@vitbhopal.ac.in');
    const id = userId('nosy.23bce10003@vitbhopal.ac.in');
    expect((await student.call('GET', '/admin/activity')).status).toBe(403);
    expect((await student.call('GET', `/admin/students/${id}/activity`)).status).toBe(403);
    expect((await new Browser(app).call('GET', '/admin/activity')).status).toBe(401);
  });
});
