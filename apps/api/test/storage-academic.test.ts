import { describe, expect, it } from 'vitest';
import { Browser, pay, setup } from './harness';

type App = ReturnType<typeof setup>['app'];
async function admin(app: App) {
  const a = new Browser(app);
  await a.signIn('admin@vitbhopal.ac.in');
  return a;
}

describe('storage tree', () => {
  it('maps every R2 file to its course, and shows unused files and records whose file is gone', async () => {
    const { app, env } = setup();
    const dbms = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    const used = [...env.db.files.values()].find((f) => f.courseId === dbms.id)!;
    await env.sources.put(`${dbms.r2Prefix}stray.pdf`, new Uint8Array(10), 'application/pdf');
    await env.sources.delete(used.sourceKey);
    const t = (await (await admin(app)).call('GET', '/admin/storage-tree')).json;
    expect(t.entries.find((e: any) => e.key === `${dbms.r2Prefix}stray.pdf`).state).toBe('unused');
    expect(t.entries.find((e: any) => e.key === used.sourceKey)).toMatchObject({
      state: 'missing',
      fileId: used.id,
    });
    expect(t.totals.missing).toBe(1);
    expect(t.entries.some((e: any) => e.key.startsWith('pages/'))).toBe(false);
  });

  it('deleting a folder removes the R2 files, their pages and their database rows', async () => {
    const { app, env } = setup();
    const dbms = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    const files = [...env.db.files.values()].filter((f) => f.courseId === dbms.id);
    const unit = files[0]!.sourceKey.slice(0, files[0]!.sourceKey.lastIndexOf('/') + 1);
    const inUnit = files.filter((f) => f.sourceKey.startsWith(unit));
    for (const f of inUnit) await env.pages.put(`pages/${f.id}/1.webp`, new Uint8Array(5), 'image/webp');
    const a = await admin(app);

    const preview = (await a.call('POST', '/admin/storage-tree/preview', { path: unit })).json;
    expect(preview).toMatchObject({ files: inUnit.length, blocked: null });
    expect(preview.courses[0]).toMatchObject({ id: dbms.id, whole: files.length === inUnit.length });
    expect((await a.call('POST', '/admin/storage-tree/delete', { path: unit })).status).toBe(400); // needs DELETE

    const done = (await a.call('POST', '/admin/storage-tree/delete', { path: unit, confirm: 'DELETE' })).json;
    expect(done.removedFiles).toBe(inUnit.length);
    for (const f of inUnit) {
      expect(env.db.files.has(f.id)).toBe(false);
      expect(await env.sources.get(f.sourceKey)).toBeNull();
      expect((await env.pages.listPage(`pages/${f.id}/`, undefined, 5)).objects).toHaveLength(0);
    }
  });

  it('a sold course emptied by a delete is archived (sales kept); an unsold one is deleted', async () => {
    const { app, env } = setup();
    const dbms = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    const os = [...env.db.courses.values()].find((c) => c.slug === 'os-2025-cse-core')!;
    const s = new Browser(app);
    await s.signIn('buyer@vitbhopal.ac.in');
    await pay(s, { courseId: dbms.id });
    const a = await admin(app);
    const sold = (await a.call('POST', '/admin/storage-tree/preview', { path: dbms.r2Prefix })).json;
    expect(sold.courses[0]).toMatchObject({ whole: true, students: 1 });
    const r1 = (
      await a.call('POST', '/admin/storage-tree/delete', { path: dbms.r2Prefix, confirm: 'DELETE' })
    ).json;
    expect(r1.archivedCourses).toBe(1);
    expect(env.db.courses.get(dbms.id)?.status).toBe('archived');
    expect([...env.db.files.values()].some((f) => f.courseId === dbms.id)).toBe(false);
    const r2 = (await a.call('POST', '/admin/storage-tree/delete', { path: os.r2Prefix, confirm: 'DELETE' }))
      .json;
    expect(r2.deletedCourses).toBe(1);
    expect(env.db.courses.has(os.id)).toBe(false);
  });

  it('refuses protected areas, the top level and path tricks', async () => {
    const { app } = setup();
    const a = await admin(app);
    for (const path of [
      'pages/x/',
      'contributions/u/',
      'support/u/',
      'drive-imports/',
      'drive-imports/../pages/',
      '_system/x/',
    ])
      expect((await a.call('POST', '/admin/storage-tree/preview', { path })).status).toBe(400);
  });
});

describe('years and branches', () => {
  it('add, hide and remove years; move a whole year in one step', async () => {
    const { app, env } = setup();
    const a = await admin(app);
    let y = (await a.call('POST', '/admin/academic/years', { year: 2031 })).json;
    expect(y.years.find((x: any) => x.year === 2031)).toMatchObject({ courses: 0, visible: true });

    const in2025 = [...env.db.courses.values()].filter((c) => c.batchYear === 2025).length;
    const moved = (await a.call('POST', '/admin/academic/move-year', { fromYear: 2025, toYear: 2031 })).json;
    expect(moved.moved).toBe(in2025);
    expect((await new Browser(app).call('GET', '/catalogue')).json.batches.map((b: any) => b.year)).toContain(
      2026,
    );

    y = (await a.call('PUT', '/admin/academic/years/2031', { visible: false })).json;
    expect(
      (await new Browser(app).call('GET', '/catalogue')).json.batches.map((b: any) => b.year),
    ).not.toContain(2031);
    expect((await a.call('DELETE', '/admin/academic/years/2031')).status).toBe(400); // still has courses
    expect((await a.call('DELETE', '/admin/academic/years/2025')).status).toBe(200); // now empty
  });

  it('add a branch, rename it and retire it', async () => {
    const { app } = setup();
    const a = await admin(app);
    let r = (await a.call('POST', '/admin/academic/branches', { code: 'aiml', name: 'B.Tech AI & ML' })).json;
    expect(r.branches.find((b: any) => b.slug === 'aiml')).toMatchObject({ code: 'AIML', isActive: true });
    r = (
      await a.call('POST', '/admin/academic/branches', {
        slug: 'aiml',
        code: 'AIML',
        name: 'AI and ML',
        isActive: false,
      })
    ).json;
    expect(r.branches.find((b: any) => b.slug === 'aiml')).toMatchObject({
      name: 'AI and ML',
      isActive: false,
    });
    const existing = r.branches.find((b: any) => b.slug !== 'aiml');
    expect(
      (await a.call('POST', '/admin/academic/branches', { code: existing.code, name: 'Clash' })).status,
    ).toBe(400);
  });
});

describe('suggestions', () => {
  it('a student can send a suggestion', async () => {
    const { app } = setup();
    const s = new Browser(app);
    await s.signIn('idea@vitbhopal.ac.in');
    const form = new FormData();
    form.set(
      'meta',
      JSON.stringify({
        topic: 'suggestion',
        subject: 'Add a dark PDF mode',
        message: 'Reading at night hurts.',
      }),
    );
    const res = await app.request('/api/support', {
      method: 'POST',
      body: form,
      headers: { authorization: `Bearer ${s.token}`, cookie: s.cookie },
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as any).topic).toBe('suggestion');
  });
});
