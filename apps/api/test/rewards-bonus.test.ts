import { describe, expect, it } from 'vitest';
import { Browser, pay, setup } from './harness';

type App = ReturnType<typeof setup>['app'];
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 10]);

async function signedIn(app: App, email: string) {
  const b = new Browser(app);
  await b.signIn(email);
  return b;
}
async function upload(app: App, b: Browser, title: string) {
  const form = new FormData();
  form.set('meta', JSON.stringify({ title, kind: 'notes', ownWork: true }));
  form.append('files', new File([PDF as BlobPart], 'notes.pdf'));
  const res = await app.request('/api/contributions', {
    method: 'POST',
    body: form,
    headers: { authorization: `Bearer ${b.token}`, cookie: b.cookie },
  });
  return (await res.json()) as any;
}

describe('cash rewards', () => {
  it('shows as owed until marked paid; the student sees it paid', async () => {
    const { app } = setup();
    const s = await signedIn(app, 'writer.23bce1@vitbhopal.ac.in');
    const c = await upload(app, s, 'OS unit 2 notes');
    const a = await signedIn(app, 'admin@vitbhopal.ac.in');
    await a.call('POST', `/admin/contributions/${c.id}/review`, {
      decision: 'approved',
      reward: { type: 'cash', amountRupees: 300 },
    });
    let e = (await a.call('GET', '/admin/earnings')).json;
    expect(e.totals.cashOwedPaise).toBe(30000);
    expect(e.cashRewards[0]).toMatchObject({ title: 'OS unit 2 notes', amountRupees: 300, paidAt: null });
    expect(
      (await a.call('POST', `/admin/contributions/${c.id}/reward-paid`, { note: 'UPI 991' })).status,
    ).toBe(200);
    e = (await a.call('GET', '/admin/earnings')).json;
    expect(e.totals.cashOwedPaise).toBe(0);
    expect(e.cashRewards[0].paidAt).toBeTruthy();
    expect((await a.call('POST', `/admin/contributions/${c.id}/reward-paid`, {})).status).toBe(400);
    const mine = (await s.call('GET', '/contributions/me')).json.mine[0];
    expect(mine.rewardPaidAt).toBeTruthy();
  });
});

describe('yearly top contributor', () => {
  it('ranks contributors by royalty earned in 12 months; the bonus is that amount again, recorded once', async () => {
    const { app, env } = setup();
    const bySlug = (slug: string) => [...env.db.courses.values()].find((c) => c.slug === slug)!;
    const dbms = bySlug('dbms-2025-cse-core');
    const os = bySlug('os-2025-cse-core');
    const top = await signedIn(app, 'top.23bce1@vitbhopal.ac.in');
    const second = await signedIn(app, 'second.24bai1@vitbhopal.ac.in');
    const a = await signedIn(app, 'admin@vitbhopal.ac.in');
    await a.call('POST', '/admin/royalties', { courseId: dbms.id, email: 'top.23bce1@vitbhopal.ac.in' });
    await a.call('POST', '/admin/royalties', { courseId: os.id, email: 'second.24bai1@vitbhopal.ac.in' });
    for (const n of ['b1', 'b2', 'b3'])
      await pay(await signedIn(app, `${n}@vitbhopal.ac.in`), { courseId: dbms.id });
    await pay(await signedIn(app, 'b4@vitbhopal.ac.in'), { courseId: os.id });
    void top;
    void second;

    const e = (await a.call('GET', '/admin/earnings')).json;
    expect(e.topContributors.map((t: any) => t.email)).toEqual([
      'top.23bce1@vitbhopal.ac.in',
      'second.24bai1@vitbhopal.ac.in',
    ]);
    const first = e.topContributors[0];
    expect(first.earnedPaise).toBe(Math.floor((3 * dbms.pricePaise) / 2));
    expect(first.bonusPaise).toBe(first.earnedPaise);
    const body = {
      userId: first.contributorId,
      year: e.bonusYear,
      amountRupees: Math.ceil(first.bonusPaise / 100),
    };
    expect((await a.call('POST', '/admin/royalties/bonus', body)).status).toBe(201);
    expect((await a.call('POST', '/admin/royalties/bonus', body)).status).toBe(400);
    const after = (await a.call('GET', '/admin/earnings')).json;
    expect(after.topContributors[0].bonusPaidAt).toBeTruthy();
  });
});
