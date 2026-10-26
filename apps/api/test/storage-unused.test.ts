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
});
