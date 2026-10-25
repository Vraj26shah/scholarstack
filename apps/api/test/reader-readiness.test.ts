import { beforeEach, describe, expect, it } from 'vitest';
import { Browser, setup } from './harness';

describe('reader readiness', () => {
  let env: ReturnType<typeof setup>['env'];
  let app: ReturnType<typeof setup>['app'];

  beforeEach(() => {
    ({ env, app } = setup());
  });

  it('omits pending and failed files from public units and card totals', async () => {
    const course = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    const rows = [...env.db.files.values()].filter((f) => f.courseId === course.id);
    const failed = rows[0]!;
    const pending = rows[1]!;
    env.db.files.set(failed.id, { ...failed, conversionStatus: 'failed', pageCount: 0, previewKey: null });
    env.db.files.set(pending.id, { ...pending, conversionStatus: 'pending', pageCount: 0, previewKey: null });

    const publicCourse = await new Browser(app).call('GET', `/courses/${course.slug}`);
    const listedFiles = publicCourse.json.units.flatMap((unit: { files: { id: string }[] }) => unit.files);
    expect(listedFiles.some((file: { id: string }) => file.id === failed.id)).toBe(false);
    expect(listedFiles.some((file: { id: string }) => file.id === pending.id)).toBe(false);
    expect(publicCourse.json.fileCount).toBe(rows.length - 2);
    expect(publicCourse.json.pageCount).toBe(rows.slice(2).reduce((sum, file) => sum + file.pageCount, 0));
  });

  it('keeps failed sources in the admin audit and can take one offline', async () => {
    const course = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    const file = [...env.db.files.values()].find((f) => f.courseId === course.id)!;
    env.db.files.set(file.id, { ...file, conversionStatus: 'failed', pageCount: 0, previewKey: null });

    const admin = await env.container.admin.inventory(course.id);
    const entry = admin.objects.find((object) => object.fileId === file.id);
    expect(entry).toMatchObject({ status: 'registered', conversionStatus: 'failed', pageCount: 0 });
    expect(entry?.hidden).toBe(false);

    await env.container.admin.setFileHidden(file.id, true);
    const offline = await env.container.admin.inventory(course.id);
    expect(offline.objects.find((object) => object.fileId === file.id)?.hidden).toBe(true);
  });
});
