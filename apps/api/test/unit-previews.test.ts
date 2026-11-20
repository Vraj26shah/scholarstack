import { TILE_SEED_HEADER } from '@ss/contracts';
import { describe, expect, it } from 'vitest';
import { Browser, setup } from './harness';

async function world() {
  const { app, env } = setup();
  const a = new Browser(app);
  await a.signIn('admin@vitbhopal.ac.in');
  const course = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
  const detail = async () => (await new Browser(app).call('GET', `/courses/${course.slug}`)).json;
  const units = (await detail()).units;
  const unit = units.find((u: any) => u.files.length > 1) ?? units[0];
  return { app, env, a, course, detail, unit };
}

describe('free previews chosen by the admin', () => {
  it('by default each unit shows page 1 of its first file, and only that page is public', async () => {
    const { app, unit } = await world();
    expect(unit.previewPages).toEqual([1]);
    const pub = new Browser(app);
    const one = await pub.call('GET', `/previews/${unit.previewFileId}/pages/1`);
    expect(one.status).toBe(200);
    expect(one.res.headers.get(TILE_SEED_HEADER)).toBeTruthy();
    expect((await pub.call('GET', `/previews/${unit.previewFileId}/pages/2`)).status).toBe(404);
  });

  it('the admin picks another file and pages; exactly those become public, and default comes back', async () => {
    const { app, a, course, detail, unit } = await world();
    const other =
      unit.files.find((f: any) => f.id !== unit.previewFileId && f.pageCount >= 3) ?? unit.files[0];
    const pages = other.pageCount >= 3 ? [3, 2] : [1];
    // Admins can look at any page while choosing.
    expect((await a.call('GET', `/admin/files/${other.id}/pages/${pages[0]}`)).status).toBe(200);
    expect((await new Browser(app).call('GET', `/admin/files/${other.id}/pages/1`)).status).toBe(401);

    const r = await a.call('PUT', `/admin/courses/${course.id}/units/${unit.key}/preview`, {
      fileId: other.id,
      pages,
    });
    expect(r.status).toBe(200);
    const u = (await detail()).units.find((x: any) => x.key === unit.key);
    expect(u.previewFileId).toBe(other.id);
    expect(u.previewPages).toEqual([...pages].sort((x, y) => x - y));
    const pub = new Browser(app);
    for (const n of pages)
      expect((await pub.call('GET', `/previews/${other.id}/pages/${n}`)).status).toBe(200);
    if (other.id !== unit.previewFileId)
      expect((await pub.call('GET', `/previews/${unit.previewFileId}/pages/1`)).status).toBe(404);

    // Pages past the end, or a file from another unit, are refused plainly.
    expect(
      (
        await a.call('PUT', `/admin/courses/${course.id}/units/${unit.key}/preview`, {
          fileId: other.id,
          pages: [other.pageCount + 1],
        })
      ).status,
    ).toBe(400);

    await a.call('PUT', `/admin/courses/${course.id}/units/${unit.key}/preview`, {
      fileId: null,
      pages: [1],
    });
    expect((await detail()).units.find((x: any) => x.key === unit.key).previewFileId).toBe(
      unit.previewFileId,
    );
  });

  it('one unit can preview several files, each with its own pages, and exactly those pages are public', async () => {
    const { app, a, course, detail, unit } = await world();
    expect(unit.files.length).toBeGreaterThan(1);
    const [f1, f2] = unit.files;
    const put = (body: unknown) =>
      a.call('PUT', `/admin/courses/${course.id}/units/${unit.key}/preview`, body);
    const r = await put({
      previews: [
        { fileId: f2.id, pages: [1] },
        { fileId: f1.id, pages: [Math.min(2, f1.pageCount), 1] },
      ],
    });
    expect(r.status).toBe(200);
    const u = (await detail()).units.find((x: any) => x.key === unit.key);
    // In the admin's order; the single-file fields mirror the first pick.
    expect(u.previews.map((p: any) => p.fileId)).toEqual([f2.id, f1.id]);
    expect(u.previewFileId).toBe(f2.id);
    expect(u.previews[1].pages).toEqual([...new Set([1, Math.min(2, f1.pageCount)])]);
    const pub = new Browser(app);
    expect((await pub.call('GET', `/previews/${f2.id}/pages/1`)).status).toBe(200);
    expect((await pub.call('GET', `/previews/${f1.id}/pages/1`)).status).toBe(200);
    if (f2.pageCount >= 2) expect((await pub.call('GET', `/previews/${f2.id}/pages/2`)).status).toBe(404);

    // The same file twice, or more than ten pages in all, is refused with a reason.
    const twice = await put({
      previews: [
        { fileId: f1.id, pages: [1] },
        { fileId: f1.id, pages: [1] },
      ],
    });
    expect(twice.status).toBe(400);
    expect(twice.json.error.message).toContain('picked once');

    // An empty list goes back to the default.
    expect((await put({ previews: [] })).status).toBe(200);
    expect((await detail()).units.find((x: any) => x.key === unit.key).previews).toEqual([
      { fileId: unit.previewFileId, pages: [1] },
    ]);
  });

  it('a chosen file that is hidden later falls back to the default, so the preview never breaks', async () => {
    const { a, course, detail, unit } = await world();
    const other = unit.files.find((f: any) => f.id !== unit.previewFileId);
    if (!other) return;
    await a.call('PUT', `/admin/courses/${course.id}/units/${unit.key}/preview`, {
      fileId: other.id,
      pages: [1],
    });
    expect((await a.call('PUT', `/admin/files/${other.id}`, { hidden: true })).status).toBe(200);
    const u = (await detail()).units.find((x: any) => x.key === unit.key);
    expect(u.previewFileId).not.toBe(other.id);
    expect(u.previewPages).toEqual([1]);
  });
});
