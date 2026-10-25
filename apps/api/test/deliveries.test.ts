import { describe, expect, it } from 'vitest';
import { Browser, pay, setup } from './harness';

type App = ReturnType<typeof setup>['app'];
async function signedIn(app: App, email: string) {
  const b = new Browser(app);
  await b.signIn(email);
  return b;
}

describe('announcement deliveries', () => {
  it('spreads over days within the limit, keeps room for personal mail, and lists who got it', async () => {
    const { app, env, clock } = setup();
    for (let i = 0; i < 9; i++) await signedIn(app, `n${i}@vitbhopal.ac.in`);
    env.container.config.emailDailyLimit = 6;
    env.container.config.emailReserve = 2; // 4 announcement emails a day
    const a = await signedIn(app, 'admin@vitbhopal.ac.in');
    const draft = (
      await a.call('POST', '/admin/announcements', {
        subject: 'Hello all',
        heading: 'Hi',
        body: 'Body text here.',
      })
    ).json;
    const first = (await a.call('POST', `/admin/announcements/${draft.id}/send`)).json;
    expect(first.sent).toBe(4);
    expect(first.waiting).toBe(first.recipients - 4);

    const status = (await a.call('GET', '/admin/email')).json;
    expect(status).toMatchObject({ dailyLimit: 6, reserved: 2, leftToday: 0 });
    const tomorrow = new Date(clock.now().getTime() + 86_400_000).toISOString().slice(0, 10);
    expect(status.plan[0]).toEqual({ date: tomorrow, count: 4 });

    const d = (await a.call('GET', `/admin/announcements/${draft.id}/deliveries`)).json;
    expect(d.sent).toBe(4);
    expect(d.recipients.filter((r: any) => r.sentAt).length).toBe(4);
    expect(d.recipients.filter((r: any) => !r.sentAt).length).toBe(d.waiting);
    expect(d.finishesOn).toBeTruthy();

    // A student who opts in while it is going out still gets it, whatever their id.
    await signedIn(app, 'late@vitbhopal.ac.in');
    for (let day = 0; day < 4; day++) {
      clock.advance(86_400_000);
      await env.container.announcements.processPending();
    }
    const done = (await a.call('GET', `/admin/announcements/${draft.id}/deliveries`)).json;
    expect(done.waiting).toBe(0);
    expect(done.recipients.some((r: any) => r.email === 'late@vitbhopal.ac.in' && r.sentAt)).toBe(true);
    const emails = env.db.outbox.filter((m) => m.subject === 'Hello all').map((m) => m.to.email);
    expect(new Set(emails).size).toBe(emails.length); // nobody twice
  });

  it('a sent email can go again to students who opted in afterwards, and only to them', async () => {
    const { app, env } = setup();
    await signedIn(app, 'early@vitbhopal.ac.in');
    const a = await signedIn(app, 'admin@vitbhopal.ac.in');
    const draft = (
      await a.call('POST', '/admin/announcements', {
        subject: 'Once only',
        heading: 'Hi',
        body: 'Body text here.',
      })
    ).json;
    await a.call('POST', `/admin/announcements/${draft.id}/send`);
    expect((await a.call('POST', `/admin/announcements/${draft.id}/send`)).status).toBe(400);
    await signedIn(app, 'newcomer@vitbhopal.ac.in');
    const again = (await a.call('POST', `/admin/announcements/${draft.id}/send`)).json;
    expect(again.status).toBe('sent');
    const to = env.db.outbox.filter((m) => m.subject === 'Once only').map((m) => m.to.email);
    expect(to.filter((e) => e === 'newcomer@vitbhopal.ac.in')).toHaveLength(1);
    expect(to.filter((e) => e === 'early@vitbhopal.ac.in')).toHaveLength(1);
  });
});

describe('admins from the database', () => {
  it('uses the database list when it has one, else the configured list', async () => {
    const { app, env } = setup();
    const a = await signedIn(app, 'admin@vitbhopal.ac.in');
    let list = (await a.call('GET', '/admin/admins')).json;
    expect(list.readFrom).toBe('worker-secret');
    env.db.admins.push({ email: 'admin@vitbhopal.ac.in', source: 'github', addedAt: new Date() });
    env.container.admins.forget();
    list = (await a.call('GET', '/admin/admins')).json;
    expect(list).toMatchObject({ readFrom: 'database', admins: [{ email: 'admin@vitbhopal.ac.in' }] });
    // librarian is in the configured list but not the database one: no longer an admin.
    const l = await signedIn(app, 'librarian@vitbhopal.ac.in');
    expect((await l.call('GET', '/admin/courses')).status).toBe(403);
  });
});

describe('three months from purchase', () => {
  it('each purchase lasts 3 months from its own day, and an email goes out when it ends', async () => {
    const { app, env } = setup();
    const dbms = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    const s = await signedIn(app, 'buyer.23bce10001@vitbhopal.ac.in');
    await pay(s, { courseId: dbms.id });
    const until = new Date((await s.call('GET', '/me/shelf')).json[0].access.until);
    const days = (until.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(88);
    expect(days).toBeLessThan(93);
    expect((await s.call('GET', `/courses/${dbms.slug}`)).json).toMatchObject({
      accessMonths: 3,
      accessUntil: null,
    });
    // When the window is over, the student is emailed once.
    const key = [...env.db.entitlements.keys()].find((k) => k.endsWith(`|${dbms.id}`))!;
    env.db.entitlements.set(key, {
      ...env.db.entitlements.get(key)!,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await env.container.accessMail.notifyEnded()).toBe(1);
    expect(env.db.outbox.at(-1)?.subject).toContain('has ended');
    expect(await env.container.accessMail.notifyEnded()).toBe(0);
  });

  it('the admin can give a course by email before the student signs up', async () => {
    const { app, env } = setup();
    const os = [...env.db.courses.values()].find((c) => c.slug === 'os-2025-cse-core')!;
    const a = await signedIn(app, 'admin@vitbhopal.ac.in');
    const r = (
      await a.call('POST', '/admin/access/grant', {
        courseId: os.id,
        emails: ['new.24bai10002@vitbhopal.ac.in', 'x@gmail.com'],
      })
    ).json;
    expect(r.notFound).toEqual(['new.24bai10002@vitbhopal.ac.in']);
    expect(r.invalid).toEqual(['x@gmail.com']);
    const s = await signedIn(app, 'new.24bai10002@vitbhopal.ac.in');
    const shelf = (await s.call('GET', '/me/shelf')).json;
    expect(shelf.map((i: any) => i.course.id)).toContain(os.id);
  });
});

describe('course update emails and batches', () => {
  it('new notes in a course email only its students, tracked by batch', async () => {
    const { app, env } = setup();
    const dbms = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    const owner = await signedIn(app, 'own.23bce10003@vitbhopal.ac.in');
    await pay(owner, { courseId: dbms.id });
    await signedIn(app, 'other.24bai10004@vitbhopal.ac.in'); // doesn't have the course
    const file = [...env.db.files.values()].find((f) => f.courseId === dbms.id)!;
    env.db.files.set(file.id, {
      ...file,
      conversionStatus: 'ready',
      conversionUpdatedAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(await env.container.announcements.announceCourseUpdates(env.container.courseUpdates)).toBe(1);
    const sent = env.db.outbox
      .filter((m) => m.subject === `New notes in ${dbms.title}`)
      .map((m) => m.to.email);
    expect(sent).toEqual(['own.23bce10003@vitbhopal.ac.in']);
    const a = await signedIn(app, 'admin@vitbhopal.ac.in');
    const ann = (await a.call('GET', '/admin/announcements')).json.find((x: any) => x.course?.id === dbms.id);
    expect(ann).toMatchObject({ status: 'sent', sent: 1, waiting: 0, course: { title: dbms.title } });
    const d = (await a.call('GET', `/admin/announcements/${ann.id}/deliveries`)).json;
    expect(d.byBatch).toEqual([{ batch: '2023', sent: 1, waiting: 0 }]);
    // Nothing new: no second email.
    expect(await env.container.announcements.announceCourseUpdates(env.container.courseUpdates)).toBe(0);
  });

  it('counts a tool announcement per batch, sent and still to go', async () => {
    const { app, env } = setup();
    for (const e of ['a.23bce1@vitbhopal.ac.in', 'b.23bce2@vitbhopal.ac.in', 'c.24bai3@vitbhopal.ac.in'])
      await signedIn(app, e);
    env.container.config.emailDailyLimit = 4;
    env.container.config.emailReserve = 0;
    const a = await signedIn(app, 'admin@vitbhopal.ac.in');
    const draft = (await a.call('POST', '/admin/features/cgpa/launch')).json;
    await a.call('POST', `/admin/announcements/${draft.id}/send`);
    const d = (await a.call('GET', `/admin/announcements/${draft.id}/deliveries`)).json;
    const total = d.byBatch.reduce((t: number, b: any) => t + b.sent + b.waiting, 0);
    expect(total).toBe(d.sent + d.waiting);
    expect(d.sent).toBe(4);
    expect(
      d.byBatch.find((b: any) => b.batch === '2023').sent +
        d.byBatch.find((b: any) => b.batch === '2023').waiting,
    ).toBe(2);
  });
});

describe('admins with any email', () => {
  it('an admin on the list can sign in with a Gmail; anyone else with a Gmail cannot', async () => {
    const { app } = setup();
    const owner = new Browser(app);
    expect((await owner.signIn('owner.demo@gmail.com')).status).toBe(200);
    expect((await owner.call('GET', '/admin/courses')).status).toBe(200);
    expect((await new Browser(app).call('POST', '/dev/login', { email: 'someone@gmail.com' })).status).toBe(
      403,
    );
  });
});
