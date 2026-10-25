import { describe, expect, it } from 'vitest';
import { Browser, pay, setup } from './harness';

type App = ReturnType<typeof setup>['app'];
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 10]);

async function signedIn(app: App, email: string) {
  const b = new Browser(app);
  await b.signIn(email);
  return b;
}

async function sendForm(
  app: App,
  b: Browser,
  path: string,
  meta: unknown,
  files: [string, Uint8Array][] = [],
) {
  const form = new FormData();
  form.set('meta', JSON.stringify(meta));
  for (const [name, bytes] of files) form.append('files', new File([bytes as BlobPart], name));
  const res = await app.request(`/api${path}`, {
    method: 'POST',
    body: form,
    headers: { authorization: `Bearer ${b.token}`, cookie: b.cookie },
  });
  return { status: res.status, json: (await res.json()) as any };
}

describe('earnings and royalties', () => {
  it('counts buyers and revenue per course, splitting bundles by price', async () => {
    const { app, env } = setup();
    const bySlug = (slug: string) => [...env.db.courses.values()].find((c) => c.slug === slug)!;
    const dbms = bySlug('dbms-2025-cse-core');
    const os = bySlug('os-2025-cse-core');
    const a = await signedIn(app, 'admin@vitbhopal.ac.in');
    const bundle = await a.call('POST', '/admin/bundles', {
      title: 'DBMS and OS',
      batchYear: 2025,
      courseIds: [dbms.id, os.id],
      pricePaise: dbms.pricePaise + os.pricePaise - 1000,
      status: 'live',
    });
    expect(bundle.status).toBe(200);

    const s1 = await signedIn(app, 'one@vitbhopal.ac.in');
    const s2 = await signedIn(app, 'two@vitbhopal.ac.in');
    expect((await pay(s1, { courseId: dbms.id })).status).toBe(200);
    expect((await pay(s2, { bundleId: bundle.json.id })).status).toBe(200);

    const e = (await a.call('GET', '/admin/earnings')).json;
    const row = e.courses.find((c: any) => c.courseId === dbms.id);
    const osRow = e.courses.find((c: any) => c.courseId === os.id);
    expect(row.sales).toBe(2);
    expect(row.buyers).toBe(2);
    expect(osRow.sales).toBe(1);
    const bundlePrice = dbms.pricePaise + os.pricePaise - 1000;
    // Every rupee counted once: single sale + the bundle split between its two courses.
    expect(row.revenuePaise + osRow.revenuePaise).toBe(dbms.pricePaise + bundlePrice);
    expect(e.totals.sales).toBe(2);
    expect(e.totals.buyers).toBe(2);
    expect(e.totals.revenuePaise).toBe(dbms.pricePaise + bundlePrice);
  });

  it('a contribution accepted with a royalty earns 50% of later sales, and payouts are capped at what is owed', async () => {
    const { app, env, clock } = setup();
    const dbms = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    const early = await signedIn(app, 'early@vitbhopal.ac.in');
    await pay(early, { courseId: dbms.id }); // before the royalty: not counted
    clock.advance(60_000);

    const author = await signedIn(app, 'author@vitbhopal.ac.in');
    const sent = await sendForm(
      app,
      author,
      '/contributions',
      {
        title: 'Full DBMS notes, all units',
        kind: 'notes',
        ownWork: true,
      },
      [['dbms.pdf', PDF]],
    );
    expect(sent.status).toBe(201);
    const a = await signedIn(app, 'admin@vitbhopal.ac.in');
    const r = await a.call('POST', `/admin/contributions/${sent.json.id}/review`, {
      decision: 'approved',
      reward: { type: 'royalty', courseId: dbms.id },
    });
    expect(r.json.reward).toMatchObject({ type: 'royalty', sharePercent: 50, courseTitle: dbms.title });
    expect(env.db.outbox.at(-1)?.text).toContain('50%');

    clock.advance(60_000);
    for (const who of ['b1', 'b2', 'b3'])
      await pay(await signedIn(app, `${who}@vitbhopal.ac.in`), { courseId: dbms.id });

    const row = (await a.call('GET', '/admin/earnings')).json.courses.find(
      (c: any) => c.courseId === dbms.id,
    );
    expect(row.sales).toBe(4);
    expect(row.royalty).toMatchObject({ email: 'author@vitbhopal.ac.in', sharePercent: 50, sales: 3 });
    expect(row.royalty.earnedPaise).toBe(Math.floor((3 * dbms.pricePaise) / 2));

    const mine = (await author.call('GET', '/contributions/me')).json.royalties;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ courseTitle: dbms.title, sales: 3, owedPaise: row.royalty.earnedPaise });

    const tooMuch = await a.call('POST', '/admin/royalties/payouts', {
      courseId: dbms.id,
      amountRupees: Math.floor(row.royalty.owedPaise / 100) + 1,
    });
    expect(tooMuch.status).toBe(400);
    const paid = await a.call('POST', '/admin/royalties/payouts', {
      courseId: dbms.id,
      amountRupees: 100,
      note: 'UPI ref 123',
    });
    expect(paid.status).toBe(201);
    const after = (await author.call('GET', '/contributions/me')).json.royalties[0];
    expect(after.paidPaise).toBe(10000);
    expect(after.owedPaise).toBe(row.royalty.earnedPaise - 10000);
  });

  it('the admin can give a royalty directly by email, and remove it', async () => {
    const { app, env } = setup();
    const os = [...env.db.courses.values()].find((c) => c.slug === 'os-2025-cse-core')!;
    const a = await signedIn(app, 'admin@vitbhopal.ac.in');
    expect(
      (await a.call('POST', '/admin/royalties', { courseId: os.id, email: 'nobody@vitbhopal.ac.in' })).status,
    ).toBe(400);
    await signedIn(app, 'writer@vitbhopal.ac.in');
    expect(
      (
        await a.call('POST', '/admin/royalties', {
          courseId: os.id,
          email: 'Writer@vitbhopal.ac.in',
          sharePercent: 40,
        })
      ).status,
    ).toBe(200);
    let row = (await a.call('GET', '/admin/earnings')).json.courses.find((c: any) => c.courseId === os.id);
    expect(row.royalty).toMatchObject({ email: 'writer@vitbhopal.ac.in', sharePercent: 40 });
    await a.call('DELETE', `/admin/royalties/${os.id}`);
    row = (await a.call('GET', '/admin/earnings')).json.courses.find((c: any) => c.courseId === os.id);
    expect(row.royalty).toBeNull();
  });

  it('students cannot see earnings', async () => {
    const { app } = setup();
    const s = await signedIn(app, 'one@vitbhopal.ac.in');
    expect((await s.call('GET', '/admin/earnings')).status).toBe(403);
  });
});

describe('help desk', () => {
  const ask = {
    topic: 'feature',
    subject: 'Timetable PNG is blank',
    message: 'The download is an empty image.',
    page: '/tools/timetable',
  };

  it('a student asks with a screenshot; the admin answers, the student is emailed and can reply', async () => {
    const { app, env } = setup();
    const s = await signedIn(app, 'asker@vitbhopal.ac.in');
    const made = await sendForm(app, s, '/support', ask, [['screen.png', PNG]]);
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({ status: 'open', page: '/tools/timetable' });
    expect(made.json.files).toHaveLength(1);

    const a = await signedIn(app, 'admin@vitbhopal.ac.in');
    const list = (await a.call('GET', '/admin/support')).json;
    expect(list.counts.open).toBe(1);
    expect(list.items[0].student.email).toBe('asker@vitbhopal.ac.in');
    const file = await a.call('GET', `/admin/support/${made.json.id}/files/1`);
    expect(file.res.headers.get('content-disposition')).toContain('attachment');

    const answered = await a.call('POST', `/admin/support/${made.json.id}/reply`, {
      body: 'Fixed, please try again.',
    });
    expect(answered.json.status).toBe('answered');
    expect(
      env.db.outbox.some((m) => m.to.email === 'asker@vitbhopal.ac.in' && m.subject.includes('Timetable')),
    ).toBe(true);

    const mine = (await s.call('GET', '/support')).json;
    expect(mine.queries[0].messages.map((m: any) => m.fromAdmin)).toEqual([false, true]);
    const again = await s.call('POST', `/support/${made.json.id}/reply`, {
      body: 'Still blank on my phone.',
    });
    expect(again.json.status).toBe('open');
    const closed = await s.call('POST', `/support/${made.json.id}/close`, {});
    expect(closed.json.status).toBe('closed');
  });

  it('refuses non-image attachments, enforces limits, and keeps queries private', async () => {
    const { app } = setup();
    const s = await signedIn(app, 'asker@vitbhopal.ac.in');
    expect(
      (await sendForm(app, s, '/support', ask, [['notes.zip', new Uint8Array([0x50, 0x4b, 3, 4])]])).status,
    ).toBe(400);
    expect(
      (await sendForm(app, s, '/support', ask, [['fake.png', new TextEncoder().encode('<svg onload=x>')]]))
        .status,
    ).toBe(400);
    expect((await sendForm(app, s, '/support', { ...ask, page: 'https://evil.example' })).status).toBe(400);
    expect((await sendForm(app, new Browser(app), '/support', ask)).status).toBe(401);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await sendForm(app, s, '/support', { ...ask, subject: `Question ${i}` });
      expect(r.status).toBe(201);
      ids.push(r.json.id);
    }
    expect((await sendForm(app, s, '/support', ask)).status).toBe(400);

    const other = await signedIn(app, 'other@vitbhopal.ac.in');
    expect((await other.call('POST', `/support/${ids[0]}/reply`, { body: 'hi' })).status).toBe(404);
    expect((await other.call('GET', `/support/${ids[0]}/files/1`)).status).toBe(404);
    expect((await other.call('GET', '/admin/support')).status).toBe(403);
  });
});
