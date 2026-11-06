import { describe, expect, it } from 'vitest';
import { Browser, pay, setup } from './harness';

describe('student directory', () => {
  it('lists each student with batch and branch from their email, every course, and the reason given', async () => {
    const { app, env } = setup();
    const a = new Browser(app);
    await a.signIn('admin@vitbhopal.ac.in');
    const dbms = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    const os = [...env.db.courses.values()].find((c) => c.slug === 'os-2025-cse-core')!;
    const s = new Browser(app);
    await s.signIn('riya.23bce10042@vitbhopal.ac.in');
    await pay(s, { courseId: dbms.id });
    await a.call('POST', '/admin/access/grant', {
      courseId: os.id,
      emails: ['riya.23bce10042@vitbhopal.ac.in'],
    });
    const me = (await s.call('GET', '/me')).json.id;

    const blocked = await a.call('POST', '/admin/access/change', {
      courseId: dbms.id,
      userIds: [me],
      action: 'block',
      reason: 'Shared their login with friends.',
    });
    expect(blocked.status).toBe(200);
    // The student is told why: in the email and on their shelf.
    expect(env.db.outbox.at(-1)?.text).toContain('Why: Shared their login with friends.');
    const shelf = (await s.call('GET', '/me/shelf')).json.find((i: any) => i.course.id === dbms.id);
    expect(shelf.access).toMatchObject({ state: 'blocked', note: 'Shared their login with friends.' });

    const dir = (await a.call('GET', '/admin/students')).json;
    const riya = dir.find((x: any) => x.email === 'riya.23bce10042@vitbhopal.ac.in');
    expect(riya).toMatchObject({ batchYear: 2023, branchCode: 'BCE' });
    expect(riya.courses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          courseId: dbms.id,
          state: 'blocked',
          source: 'purchase',
          note: 'Shared their login with friends.',
        }),
        expect.objectContaining({ courseId: os.id, state: 'active', source: 'admin' }),
      ]),
    );
    expect((await new Browser(app).call('GET', '/admin/students')).status).toBe(401);
  });
});
