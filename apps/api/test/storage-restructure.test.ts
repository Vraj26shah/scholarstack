import { describe, expect, it } from 'vitest';
import { Browser, setup } from './harness';

async function world() {
  const { app, env } = setup();
  const a = new Browser(app);
  await a.signIn('admin@vitbhopal.ac.in');
  const course = (slug: string) => [...env.db.courses.values()].find((c) => c.slug === slug)!;
  const dbms = course('dbms-2025-cse-core');
  const os = course('os-2025-cse-core');
  const filesOf = (id: string) => [...env.db.files.values()].filter((f) => f.courseId === id);
  const has = async (key: string) => (await env.sources.list(key)).some((o) => o.key === key);
  return { app, env, a, dbms, os, filesOf, has };
}

describe('restructuring stored notes', () => {
  it('moves a file to a new unit of its course, keeping its id, pages and the course on sale', async () => {
    const { a, env, dbms, filesOf, has } = await world();
    const f = filesOf(dbms.id).find((x) => x.conversionStatus === 'ready')!;
    const body = { paths: [f.sourceKey], toFolder: `${dbms.r2Prefix}Unit 9 - Extra reading/` };
    const plan = (await a.call('POST', '/admin/storage-tree/move', { ...body, dryRun: true })).json;
    expect(plan.blocked).toBeNull();
    expect(plan.moves).toEqual([
      {
        from: f.sourceKey,
        to: `${dbms.r2Prefix}Unit 9 - Extra reading/${f.sourceKey.split('/').pop()}`,
        file: { name: f.name, fromCourse: dbms.title, toCourse: dbms.title },
      },
    ]);
    const done = (await a.call('POST', '/admin/storage-tree/move', { ...body, dryRun: false })).json;
    expect(done.done).toMatchObject({ moved: 1, files: 1, leftovers: 0 });
    const after = env.db.files.get(f.id)!;
    expect(after).toMatchObject({
      sourceKey: plan.moves[0].to,
      unitKey: 'unit-9',
      unitTitle: 'Extra reading',
      conversionStatus: 'ready',
      pageCount: f.pageCount,
    });
    expect(await has(f.sourceKey)).toBe(false);
    expect(await has(after.sourceKey)).toBe(true);
    expect(env.db.courses.get(dbms.id)!.status).toBe('live');
  });

  it('moves a file into another course', async () => {
    const { a, env, dbms, os, filesOf } = await world();
    const f = filesOf(dbms.id)[0]!;
    const r = await a.call('POST', '/admin/storage-tree/move', {
      paths: [f.sourceKey],
      toFolder: `${os.r2Prefix}Unit 1 - Foundations/`,
      dryRun: false,
    });
    expect(r.status).toBe(200);
    expect(env.db.files.get(f.id)).toMatchObject({ courseId: os.id, unitKey: 'unit-1' });
  });

  it('renames a file (keeping its type) and a whole unit folder', async () => {
    const { a, env, dbms, filesOf } = await world();
    const f = filesOf(dbms.id)[0]!;
    const r = (
      await a.call('POST', '/admin/storage-tree/rename', {
        path: f.sourceKey,
        newName: 'Clean notes',
        dryRun: false,
      })
    ).json;
    expect(r.moves[0].to.endsWith('/Clean notes.pdf')).toBe(true);
    expect(env.db.files.get(f.id)!.name).toBe('Clean notes.pdf');

    const unitFolder = env.db.files.get(f.id)!.sourceKey.replace(/[^/]+$/, '');
    const inUnit = filesOf(dbms.id).filter((x) => x.sourceKey.startsWith(unitFolder));
    const renamed = (
      await a.call('POST', '/admin/storage-tree/rename', {
        path: unitFolder,
        newName: 'Unit 1 - Basics',
        dryRun: false,
      })
    ).json;
    expect(renamed.done.files).toBe(inUnit.length);
    for (const x of inUnit)
      expect(env.db.files.get(x.id)).toMatchObject({ unitKey: 'unit-1', unitTitle: 'Basics' });
  });

  it('refuses what would break things, and changes nothing then', async () => {
    const { a, env, dbms, os, filesOf } = await world();
    const [f, g] = filesOf(dbms.id);
    const sameName = await a.call('POST', '/admin/storage-tree/rename', {
      path: f!.sourceKey,
      newName: g!.sourceKey.split('/').pop()!,
      dryRun: true,
    });
    // Only a clash when they share a folder.
    if (f!.sourceKey.replace(/[^/]+$/, '') === g!.sourceKey.replace(/[^/]+$/, ''))
      expect(sameName.json.blocked).toContain('already exists');
    const whole = await a.call('POST', '/admin/storage-tree/move', {
      paths: [dbms.r2Prefix],
      toFolder: os.r2Prefix,
      dryRun: true,
    });
    expect(whole.json.blocked).toContain('Move or rename a course');
    const outside = await a.call('POST', '/admin/storage-tree/move', {
      paths: [f!.sourceKey],
      toFolder: 'drive-imports/Loose/',
      dryRun: false,
    });
    expect(outside.status).toBe(400);
    expect(env.db.files.get(f!.id)!.sourceKey).toBe(f!.sourceKey);
    expect(
      (
        await a.call('POST', '/admin/storage-tree/move', {
          paths: ['pages/x/1.webp'],
          toFolder: 'a/b/',
          dryRun: true,
        })
      ).status,
    ).toBe(400);
  });

  it('a live course that loses its last readable file comes off sale', async () => {
    const { a, env, dbms, os, filesOf } = await world();
    const paths = filesOf(os.id).map((f) => f.sourceKey);
    const r = await a.call('POST', '/admin/storage-tree/move', {
      paths,
      toFolder: `${dbms.r2Prefix}From OS/`,
      dryRun: false,
    });
    expect(r.json.done.coursesUnpublished).toBe(1);
    expect(env.db.courses.get(os.id)!.status).toBe('draft');
  });
});
