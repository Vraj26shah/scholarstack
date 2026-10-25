import { describe, expect, it } from 'vitest';
import { Browser, setup } from './harness';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 10, 1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const META = {
  title: 'DBMS unit 2 notes',
  courseHint: 'DBMS',
  kind: 'notes',
  description: '',
  ownWork: true,
};

type App = ReturnType<typeof setup>['app'];

async function upload(app: App, b: Browser, files: [string, Uint8Array][], meta: unknown = META) {
  const form = new FormData();
  form.set('meta', JSON.stringify(meta));
  for (const [name, bytes] of files) form.append('files', new File([bytes as BlobPart], name));
  const res = await app.request('/api/contributions', {
    method: 'POST',
    body: form,
    headers: { authorization: `Bearer ${b.token}`, cookie: b.cookie },
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function signedIn(app: App, email: string) {
  const b = new Browser(app);
  await b.signIn(email);
  return b;
}

describe('contributions', () => {
  it('a student shares notes; the admin downloads, approves with a free course, and the student is emailed', async () => {
    const { app, env } = setup();
    const s = await signedIn(app, 'rahul.23bce1@vitbhopal.ac.in');
    const sent = await upload(app, s, [
      ['unit 2.pdf', PDF],
      ['diagram.png', PNG],
    ]);
    expect(sent.status).toBe(201);
    expect(sent.json.status).toBe('pending');
    expect(sent.json.files).toHaveLength(2);

    const a = await signedIn(app, 'admin@vitbhopal.ac.in');
    const list = (await a.call('GET', '/admin/contributions')).json;
    expect(list.open).toBe(true);
    expect(list.items).toHaveLength(1);
    const item = list.items[0];
    expect(item.contributor.email).toBe('rahul.23bce1@vitbhopal.ac.in');

    const file = await a.call('GET', `/admin/contributions/${item.id}/files/1`);
    expect(file.status).toBe(200);
    expect(file.res.headers.get('content-disposition')).toContain('attachment');
    expect(file.res.headers.get('content-type')).toBe('application/octet-stream');
    expect(new Uint8Array(await file.res.arrayBuffer())).toEqual(PDF);

    const course = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    const reviewed = await a.call('POST', `/admin/contributions/${item.id}/review`, {
      decision: 'approved',
      note: 'Great diagrams, thank you!',
      reward: { type: 'course', courseId: course.id },
    });
    expect(reviewed.status).toBe(200);
    expect(reviewed.json.status).toBe('approved');
    expect([...env.db.entitlements.keys()].some((k) => k.endsWith(`|${course.id}`))).toBe(true);
    expect(env.db.outbox.some((m) => m.to.email === 'rahul.23bce1@vitbhopal.ac.in')).toBe(true);

    const mine = (await s.call('GET', '/contributions/me')).json;
    expect(mine.mine[0].status).toBe('approved');
    expect(mine.mine[0].reward).toMatchObject({ type: 'course', courseTitle: course.title });

    const copied = await a.call('POST', `/admin/contributions/${item.id}/copy`, {
      folder: 'shared/DBMS/Unit 2/',
    });
    expect(copied.status).toBe(200);
    expect(copied.json.copied).toHaveLength(2);
    const listed = await env.sources.listPage('shared/DBMS/Unit 2/', undefined, 10);
    expect(listed.objects.map((o) => o.key).sort()).toEqual(copied.json.copied.sort());
    expect(
      (await a.call('POST', `/admin/contributions/${item.id}/copy`, { folder: 'pages/x/' })).status,
    ).toBe(400);
  });

  it('refuses files that are not what they claim, and enforces the limits', async () => {
    const { app } = setup();
    const s = await signedIn(app, 'rahul.23bce1@vitbhopal.ac.in');
    // A script renamed to .pdf
    expect(
      (await upload(app, s, [['notes.pdf', new TextEncoder().encode('<script>alert(1)</script>')]])).status,
    ).toBe(400);
    expect((await upload(app, s, [['run.exe', PDF]])).status).toBe(400);
    expect((await upload(app, s, [])).status).toBe(400);
    expect(
      (
        await upload(
          app,
          s,
          Array.from({ length: 6 }, (_, i) => [`${i}.pdf`, PDF] as [string, Uint8Array]),
        )
      ).status,
    ).toBe(400);
    expect((await upload(app, s, [['a.pdf', PDF]], { ...META, ownWork: false })).status).toBe(400);
    // Three a day
    for (let i = 0; i < 3; i++) expect((await upload(app, s, [[`n${i}.pdf`, PDF]])).status).toBe(201);
    const fourth = await upload(app, s, [['n4.pdf', PDF]]);
    expect(fourth.status).toBe(400);
    expect(fourth.json.message ?? fourth.json.error).toBeTruthy();
    const status = (await s.call('GET', '/contributions/me')).json;
    expect(status.todayLeft).toBe(0);
    expect(status.pending).toBe(3);
  });

  it('visitors cannot upload; the admin can pause uploads and block a student', async () => {
    const { app } = setup();
    const anon = new Browser(app);
    expect((await upload(app, anon, [['a.pdf', PDF]])).status).toBe(401);

    const s = await signedIn(app, 'rahul.23bce1@vitbhopal.ac.in');
    const a = await signedIn(app, 'admin@vitbhopal.ac.in');
    await a.call('POST', '/admin/contributions-settings', { open: false });
    expect((await s.call('GET', '/contributions/me')).json.open).toBe(false);
    expect((await upload(app, s, [['a.pdf', PDF]])).status).toBe(400);
    await a.call('POST', '/admin/contributions-settings', { open: true });

    const first = await upload(app, s, [['a.pdf', PDF]]);
    expect(first.status).toBe(201);
    const userId = (await a.call('GET', '/admin/contributions')).json.items[0].contributor.id;
    await a.call('POST', '/admin/contributors/block', { userId, blocked: true });
    expect((await s.call('GET', '/contributions/me')).json.blocked).toBe(true);
    expect((await upload(app, s, [['b.pdf', PDF]])).status).toBe(403);
  });

  it('a student can withdraw a pending contribution, but not someone else’s', async () => {
    const { app } = setup();
    const s = await signedIn(app, 'rahul.23bce1@vitbhopal.ac.in');
    const other = await signedIn(app, 'priya.23bce2@vitbhopal.ac.in');
    const sent = await upload(app, s, [['a.pdf', PDF]]);
    expect((await other.call('DELETE', `/contributions/${sent.json.id}`)).status).toBe(404);
    expect((await s.call('DELETE', `/contributions/${sent.json.id}`)).status).toBe(200);
    expect((await s.call('GET', '/contributions/me')).json.mine).toHaveLength(0);
  });

  it('rejecting sends the reason, and the storage map never offers contributions as unused', async () => {
    const { app } = setup();
    const s = await signedIn(app, 'rahul.23bce1@vitbhopal.ac.in');
    const sent = await upload(app, s, [['a.pdf', PDF]]);
    const a = await signedIn(app, 'admin@vitbhopal.ac.in');
    const r = await a.call('POST', `/admin/contributions/${sent.json.id}/review`, {
      decision: 'rejected',
      note: 'These are copied from the textbook.',
    });
    expect(r.json.status).toBe('rejected');
    expect((await s.call('GET', '/contributions/me')).json.mine[0].reviewNote).toContain('textbook');
    const map = (await a.call('GET', '/admin/storage-map')).json;
    expect(JSON.stringify(map.unused ?? map)).not.toContain('contributions/');
  });
});
