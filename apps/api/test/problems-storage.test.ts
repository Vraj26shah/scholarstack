import { describe, expect, it } from 'vitest';
import { Browser, setup } from './harness';

async function admin(app: ReturnType<typeof setup>['app']) {
  const a = new Browser(app);
  await a.signIn('admin@vitbhopal.ac.in');
  return a;
}

describe('problems log', () => {
  it('a browser report reaches the admin, grouped, with personal details removed', async () => {
    const { app } = setup();
    const report = (message: string) =>
      new Browser(app).call('POST', '/problems', {
        kind: 'image',
        message,
        path: '/c/dbms-2025-cse-core?x=1',
        detail: 'signed in as rahul.23bce1@vitbhopal.ac.in token=abc123',
      });
    expect((await report('A page-one preview would not load')).status).toBe(204);
    await report('A page-one preview would not load');
    const a = await admin(app);
    const list = (await a.call('GET', '/admin/problems')).json;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      source: 'browser',
      kind: 'image',
      count: 2,
      path: '/c/dbms-2025-cse-core',
    });
    expect(list[0].detail).not.toContain('rahul');
    expect(list[0].detail).not.toContain('abc123');
    const cleared = await a.call('POST', '/admin/problems/clear', {});
    expect(cleared.json.cleared).toBe(1);
    expect((await a.call('GET', '/admin/problems')).json).toHaveLength(0);
  });

  it('a malformed or oversized report is ignored without an error', async () => {
    const { app } = setup();
    expect((await new Browser(app).call('POST', '/problems', { kind: 'nope', message: '' })).status).toBe(
      204,
    );
    expect((await new Browser(app).call('POST', '/problems', 'x'.repeat(5000))).status).toBe(204);
    const a = await admin(app);
    expect((await a.call('GET', '/admin/problems')).json).toHaveLength(0);
  });
});

describe('storage map', () => {
  it('maps R2 folders to courses, finds unused files, and deletes only those', async () => {
    const { env, app } = setup();
    const course = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    const used = [...env.db.files.values()].find((f) => f.courseId === course.id)!;
    const folder = used.sourceKey.slice(0, used.sourceKey.lastIndexOf('/') + 1);
    await env.sources.put(`${folder}old-draft.pdf`, new Uint8Array(1234), 'application/pdf');
    await env.sources.put('leftovers/unused/notes.pdf', new Uint8Array(50), 'application/pdf');
    const a = await admin(app);
    const map = (await a.call('GET', '/admin/storage-map')).json;
    const row = map.folders.find((f: { folder: string }) => f.folder === folder);
    expect(row.course.title).toBe(course.title);
    expect(row.unusedObjects).toBe(1);
    const stray = map.folders.find((f: { folder: string }) => f.folder === 'leftovers/unused/');
    expect(stray).toMatchObject({ course: null, objects: 1, unusedObjects: 1 });
    expect(map.database.length).toBeGreaterThan(0);

    const r = (
      await a.call('POST', '/admin/storage-map/clean', {
        what: 'notes',
        folders: [folder, 'leftovers/unused/'],
      })
    ).json;
    expect(r.removedObjects).toBe(2);
    expect(await env.sources.get(used.sourceKey)).not.toBeNull();
    expect(await env.sources.get(`${folder}old-draft.pdf`)).toBeNull();
  });

  it('never deletes generated pages through the notes clean-up', async () => {
    const { env, app } = setup();
    const a = await admin(app);
    const r = (await a.call('POST', '/admin/storage-map/clean', { what: 'notes', folders: ['pages/'] })).json;
    expect(r.removedObjects).toBe(0);
    expect(env).toBeTruthy();
  });
});

describe('deleting a course for good', () => {
  it('only archived, never-sold courses; removes records, pages and (if asked) its notes', async () => {
    const { env, app } = setup();
    const a = await admin(app);
    const course = [...env.db.courses.values()].find((c) => c.slug === 'os-2025-cse-core')!;
    const file = [...env.db.files.values()].find((f) => f.courseId === course.id)!;
    const live = await a.call('POST', `/admin/courses/${course.id}/delete`, { deleteNotes: true });
    expect(live.status).toBe(400);
    expect(live.json.error.message).toContain('Archive');
    await a.call('PATCH', `/admin/courses/${course.id}`, { status: 'archived' });
    const r = await a.call('POST', `/admin/courses/${course.id}/delete`, { deleteNotes: true });
    expect(r.status).toBe(200);
    expect(r.json.notesRemoved).toBeGreaterThan(0);
    expect(env.db.courses.has(course.id)).toBe(false);
    expect(env.db.files.has(file.id)).toBe(false);
    expect(await env.sources.get(file.sourceKey)).toBeNull();
  });

  it('a course someone bought is kept', async () => {
    const { env, app } = setup();
    const course = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    const s = new Browser(app);
    await s.signIn('buyer2@vitbhopal.ac.in');
    const start = await s.call('POST', '/orders', { courseId: course.id });
    const p = await s.call('POST', '/dev/pay', { gatewayOrderId: start.json.gatewayOrderId });
    await s.call('POST', '/orders/verify', {
      orderId: start.json.orderId,
      gatewayOrderId: start.json.gatewayOrderId,
      ...p.json,
    });
    const a = await admin(app);
    await a.call('PATCH', `/admin/courses/${course.id}`, { status: 'archived' });
    const r = await a.call('POST', `/admin/courses/${course.id}/delete`, { deleteNotes: true });
    expect(r.status).toBe(400);
    expect(r.json.error.message).toContain('sales history');
    expect(env.db.courses.has(course.id)).toBe(true);
  });
});

describe('moving a course folder', () => {
  it('moves the files and the records together, keeps the course live and its pages', async () => {
    const { env, app } = setup();
    const course = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    const files = [...env.db.files.values()].filter((f) => f.courseId === course.id);
    const before = files.map((f) => f.sourceKey);
    const pagesBefore = (await env.pages.list(`pages/${files[0]!.id}/`)).length;
    const a = await admin(app);
    const r = await a.call('POST', '/admin/storage-map/move-course', {
      courseId: course.id,
      newFolder: '25 Batch/DBMS renamed',
    });
    expect(r.status).toBe(200);
    expect(r.json.to).toBe('drive-imports/25 Batch/DBMS renamed/');
    expect(r.json.movedFiles).toBe(files.length);
    const moved = env.db.courses.get(course.id)!;
    expect(moved.r2Prefix).toBe('drive-imports/25 Batch/DBMS renamed/');
    expect(moved.status).toBe('live');
    for (const f of files) {
      const now = env.db.files.get(f.id)!;
      expect(now.sourceKey.startsWith('drive-imports/25 Batch/DBMS renamed/')).toBe(true);
      expect(await env.sources.get(now.sourceKey)).not.toBeNull();
    }
    for (const old of before) expect(await env.sources.get(old)).toBeNull();
    expect((await env.pages.list(`pages/${files[0]!.id}/`)).length).toBe(pagesBefore);
  });

  it('refuses a folder that already has files, overlaps another course, or escapes the import folder', async () => {
    const { env, app } = setup();
    const [c1, c2] = [...env.db.courses.values()];
    const a = await admin(app);
    await env.sources.put('drive-imports/busy/x.pdf', new Uint8Array(3), 'application/pdf');
    const busy = await a.call('POST', '/admin/storage-map/move-course', {
      courseId: c1!.id,
      newFolder: 'busy',
    });
    expect(busy.status).toBe(400);
    const overlap = await a.call('POST', '/admin/storage-map/move-course', {
      courseId: c1!.id,
      newFolder: c2!.r2Prefix,
    });
    expect(overlap.status).toBe(400);
    const sneaky = await a.call('POST', '/admin/storage-map/move-course', {
      courseId: c1!.id,
      newFolder: '../pages/x',
    });
    expect(sneaky.status).toBe(400);
    expect(env.db.courses.get(c1!.id)!.r2Prefix).toBe(c1!.r2Prefix);
  });
});
