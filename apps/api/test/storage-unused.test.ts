import { describe, expect, it } from 'vitest';
import { Browser, setup } from './harness';

describe('unused storage', () => {
  it('finds every kind of unused object, keeps what is waiting, and cleans one group safely', async () => {
    const { app, env } = setup();
    const a = new Browser(app);
    await a.signIn('admin@vitbhopal.ac.in');
    const dbms = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    const bytes = new Uint8Array(1000);
    await env.sources.put(`${dbms.r2Prefix}Unit 1/old copy.pdf`, bytes, 'application/pdf');
    await env.sources.put('drive-imports/27 Batch/New Subject/u1.pdf', bytes, 'application/pdf');
    await env.sources.put('contributions/someone/gone/1-x.pdf', bytes, 'application/pdf');
    await env.sources.put('support/someone/gone/1-shot.png', bytes, 'image/png');
    await env.pages.put('pages/no-such-file/1.webp', bytes, 'image/webp');

    const r = (await a.call('GET', '/admin/storage-unused')).json;
    const g = (k: string) => r.groups.find((x: any) => x.key === k);
    expect(g('leftovers').items.map((i: any) => i.key)).toContain(`${dbms.r2Prefix}Unit 1/old copy.pdf`);
    expect(g('uploads-orphan').items.map((i: any) => i.key)).toEqual(['contributions/someone/gone/1-x.pdf']);
    expect(g('support-orphan').items.map((i: any) => i.key)).toEqual(['support/someone/gone/1-shot.png']);
    expect(g('pages').items.map((i: any) => i.key)).toEqual(['pages/no-such-file/']);
    // Not imported yet: listed apart, never in a group.
    expect(r.notImported.map((f: any) => f.folder)).toContain('drive-imports/27 Batch/New Subject/');
    expect(r.groups.flatMap((x: any) => x.items).some((i: any) => i.key.includes('27 Batch'))).toBe(false);

    const cleaned = (
      await a.call('POST', '/admin/storage-map/clean', { what: 'unused', group: 'uploads-orphan' })
    ).json;
    expect(cleaned.removedObjects).toBe(1);
    expect((await env.sources.list('contributions/someone/')).length).toBe(0);
    // Other groups untouched.
    expect((await env.sources.list('support/someone/')).length).toBe(1);
    expect((await env.sources.list('drive-imports/27 Batch/')).length).toBe(1);
  });

  it('returns every unused object and only deletes an individually confirmed unused key', async () => {
    const { app, env } = setup();
    const a = new Browser(app);
    await a.signIn('admin@vitbhopal.ac.in');
    const bytes = new Uint8Array(3);
    const keys = Array.from({ length: 205 }, (_, i) => `support/orphan/${String(i).padStart(3, '0')}.bin`);
    for (const key of keys) await env.sources.put(key, bytes, 'application/octet-stream');

    const report = (await a.call('GET', '/admin/storage-unused')).json;
    const group = report.groups.find((x: any) => x.key === 'support-orphan');
    expect(group.objects).toBe(205);
    expect(group.items).toHaveLength(205);
    expect(group.items.map((x: any) => x.key)).toContain(keys[204]);

    const currentFile = [...env.db.files.values()][0]!;
    const kept = await a.call('POST', '/admin/storage-map/clean', {
      what: 'unused-object',
      group: 'leftovers',
      key: currentFile.sourceKey,
    });
    expect(kept.status).toBe(400);

    const removed = await a.call('POST', '/admin/storage-map/clean', {
      what: 'unused-object',
      group: 'support-orphan',
      key: keys[204]!,
    });
    expect(removed.status).toBe(200);
    expect(removed.json.removedObjects).toBe(1);
    expect((await env.sources.list(keys[204]!)).length).toBe(0);
  });

  it('deletes only the selected orphan page folder', async () => {
    const { app, env } = setup();
    const a = new Browser(app);
    await a.signIn('admin@vitbhopal.ac.in');
    const bytes = new Uint8Array(5);
    await env.pages.put('pages/no-such-file/1.webp', bytes, 'image/webp');
    await env.pages.put('pages/no-such-file/2.webp', bytes, 'image/webp');
    await env.pages.put('pages/another-file/1.webp', bytes, 'image/webp');

    const removed = await a.call('POST', '/admin/storage-map/clean', {
      what: 'unused-object',
      group: 'pages',
      key: 'pages/no-such-file/',
    });
    expect(removed.status).toBe(200);
    expect(removed.json).toMatchObject({ removedObjects: 2, removedBytes: 10 });
    expect(await env.pages.list('pages/no-such-file/')).toHaveLength(0);
    expect(await env.pages.list('pages/another-file/')).toHaveLength(1);
  });

  it('cleans only inside the chosen folder when a scope is given', async () => {
    const { app, env } = setup();
    const a = new Browser(app);
    await a.signIn('admin@vitbhopal.ac.in');
    const bytes = new Uint8Array(10);
    await env.sources.put('contributions/one/gone/1-a.pdf', bytes, 'application/pdf');
    await env.sources.put('contributions/two/gone/1-b.pdf', bytes, 'application/pdf');
    const cleaned = (
      await a.call('POST', '/admin/storage-map/clean', {
        what: 'unused',
        group: 'uploads-orphan',
        prefix: 'contributions/one/',
      })
    ).json;
    expect(cleaned.removedObjects).toBe(1);
    expect((await env.sources.list('contributions/one/')).length).toBe(0);
    expect((await env.sources.list('contributions/two/')).length).toBe(1);
  });

  it('lists courses not on sale and files whose note is gone, and deletes them from R2 and the database', async () => {
    const { app, env } = setup();
    const a = new Browser(app);
    await a.signIn('admin@vitbhopal.ac.in');
    const courses = [...env.db.courses.values()];
    const live = courses.find((c) => c.status === 'live')!;
    const off = courses.find((c) => c.id !== live.id && c.slug !== 'dbms-2025-cse-core')!;
    off.status = 'archived';
    const offFiles = [...env.db.files.values()].filter((f) => f.courseId === off.id);
    const liveFile = [...env.db.files.values()].find((f) => f.courseId === live.id)!;
    liveFile.sourceMissingAt = new Date().toISOString();

    const report = (await a.call('GET', '/admin/storage-unused')).json;
    const g = (k: string) => report.groups.find((x: any) => x.key === k);
    expect(g('courses-off-sale').items.map((i: any) => i.key)).toContain(`course:${off.id}`);
    expect(g('courses-off-sale').items.map((i: any) => i.key)).not.toContain(`course:${live.id}`);
    expect(g('missing-files').items.map((i: any) => i.key)).toEqual([`file:${liveFile.id}`]);

    // A live course can't be removed through this group.
    const refused = await a.call('POST', '/admin/storage-map/clean', {
      what: 'unused-object',
      group: 'courses-off-sale',
      key: `course:${live.id}`,
    });
    expect(refused.status).toBe(400);

    const gone = await a.call('POST', '/admin/storage-map/clean', {
      what: 'unused-object',
      group: 'courses-off-sale',
      key: `course:${off.id}`,
    });
    expect(gone.status).toBe(200);
    expect(env.db.courses.has(off.id)).toBe(false);
    expect(gone.json.removedRows).toBe(1 + offFiles.length);

    const dropped = await a.call('POST', '/admin/storage-map/clean', {
      what: 'unused',
      group: 'missing-files',
    });
    expect(dropped.status).toBe(200);
    expect(env.db.files.has(liveFile.id)).toBe(false);
    expect(env.db.courses.get(live.id)?.status).toBe('live');
  });
});
