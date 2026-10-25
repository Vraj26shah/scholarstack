import { describe, expect, it } from 'vitest';
import { Browser, pay, setup } from './harness';

async function admin(app: ReturnType<typeof setup>['app']) {
  const a = new Browser(app);
  await a.signIn('admin@vitbhopal.ac.in');
  return a;
}

describe('storage tree', () => {
  it('lists every notes file with what it belongs to, and flags unused and missing ones', async () => {
    const { app, env } = setup();
    const f = [...env.db.files.values()][0]!;
    const folder = f.sourceKey.slice(0, f.sourceKey.lastIndexOf('/') + 1);
    await env.sources.put(`${folder}stray.pdf`, new Uint8Array(10), 'application/pdf');
    await env.sources.delete(f.sourceKey);
    const a = await admin(app);
    const t = (await a.call('GET', '/admin/storage-tree')).json;
    expect(t.entries.find((e: any) => e.key === `${folder}stray.pdf`).state).toBe('unused');
    expect(t.entries.find((e: any) => e.key === f.sourceKey)).toMatchObject({
      state: 'missing',
      fileId: f.id,
    });
    expect(t.entries.some((e: any) => e.key.startsWith('pages/'))).toBe(false);
  });

  it('deleting a unit folder removes its R2 files, generated pages and database rows', async () => {
    const { app, env } = setup();
    const dbms = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    const files = [...env.db.files.values()].filter((f) => f.courseId === dbms.id);
    const f = files[0]!;
    const unitFolder = f.sourceKey.slice(0, f.sourceKey.lastIndexOf('/') + 1);
    const inUnit = files.filter((x) => x.sourceKey.startsWith(unitFolder));
    await env.pages.put(`pages/${f.id}/1.webp`, new Uint8Array(100), 'image/webp');
    const a = await admin(app);

    const preview = (await a.call('POST', '/admin/storage-tree/preview', { path: unitFolder })).json;
    expect(preview.files).toBe(inUnit.length);
    expect(preview.courses[0]).toMatchObject({ id: dbms.id, whole: inUnit.length === files.length });
    expect((await a.call('POST', '/admin/storage-tree/delete', { path: unitFolder })).status).toBe(400); // no DELETE
    const done = (await a.call('POST', '/admin/storage-tree/delete', { path: unitFolder, confirm: 'DELETE' }))
      .json;
    expect(done.removedFiles).toBe(inUnit.length);
    for (const x of inUnit) {
      expect(env.db.files.has(x.id)).toBe(false);
      expect(await env.sources.get(x.sourceKey)).toBeNull();
    }
    expect((await env.pages.listPage(`pages/${f.id}/`, undefined, 10)).objects).toHaveLength(0);
    expect([...env.db.units.keys()].some((k) => k === `${dbms.id}|${f.unitKey}`)).toBe(false);
  });

  it('deleting a whole sold course folder keeps the course archived for sales history', async () => {
    const { app, env } = setup();
    const dbms = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    const s = new Browser(app);
    await s.signIn('buyer@vitbhopal.ac.in');
    await pay(s, { courseId: dbms.id });
    const a = await admin(app);
    const preview = (await a.call('POST', '/admin/storage-tree/preview', { path: dbms.r2Prefix })).json;
    expect(preview.courses[0]).toMatchObject({ whole: true, students: 1 });
    const done = (
      await a.call('POST', '/admin/storage-tree/delete', { path: dbms.r2Prefix, confirm: 'DELETE' })
    ).json;
    expect(done).toMatchObject({ archivedCourses: 1, deletedCourses: 0 });
    expect(env.db.courses.get(dbms.id)?.status).toBe('archived');
    expect([...env.db.files.values()].some((f) => f.courseId === dbms.id)).toBe(false);
  });

  it('deleting an unsold course folder removes the course too, and protected areas are refused', async () => {
    const { app, env } = setup();
    const os = [...env.db.courses.values()].find((c) => c.slug === 'os-2025-cse-core')!;
    const a = await admin(app);
    const done = (
      await a.call('POST', '/admin/storage-tree/delete', { path: os.r2Prefix, confirm: 'DELETE' })
    ).json;
    expect(done.deletedCourses).toBe(1);
    expect(env.db.courses.has(os.id)).toBe(false);
    for (const path of ['pages/x/', 'contributions/u/', 'drive-imports/', '../etc/'])
      expect((await a.call('POST', '/admin/storage-tree/preview', { path })).status).toBe(400);
  });
});
