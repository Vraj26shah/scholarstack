import { beforeEach, describe, expect, it } from 'vitest';
import { Browser, setup } from './harness';

/**
 * What may stop a course or bundle going on sale. Reproduces the real 409s of 2026-10-24:
 * hidden reference books whose R2 copy was a saved Google sign-in page, and a ZIP in a
 * course folder, blocked publishing and every bundle containing those courses.
 */
describe('publish rules', () => {
  let env: ReturnType<typeof setup>['env'];
  let app: ReturnType<typeof setup>['app'];
  let admin: Browser;
  const html = new TextEncoder().encode('<!doctype html><html><title>Google sign in</title></html>');
  const course = (slug: string) => [...env.db.courses.values()].find((c) => c.slug === slug)!;
  const visibleFiles = (courseId: string) =>
    [...env.db.files.values()].filter((f) => f.courseId === courseId && !f.hidden && !f.unitHidden);

  beforeEach(async () => {
    ({ env, app } = setup());
    admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
  });

  /** Turn a file's R2 copy into a saved web page, the way the broken textbooks were. */
  function breakSource(file: { sourceKey: string; sizeBytes: number; sourceEtag?: string | null }) {
    env.sources.put(file.sourceKey, html, 'application/pdf', 'broken-html');
    file.sizeBytes = html.length;
    file.sourceEtag = 'broken-html';
  }

  it('a hidden broken textbook and a ZIP in the folder do not block a course or its bundle', async () => {
    const os = course('os-2025-cse-core');
    const dsa = course('dsa-2025-cse-core');
    const textbook = visibleFiles(os.id)[0]!;
    textbook.hidden = true;
    breakSource(textbook);
    env.sources.put(
      `${os.r2Prefix}Extra/everything.zip`,
      new Uint8Array([0x50, 0x4b, 3, 4]),
      'application/zip',
      'zip',
    );

    // The audit still shows both problems: nothing is hidden from the admin.
    const audit = (await admin.call('GET', `/admin/storage-audit?courseId=${os.id}`)).json;
    expect(audit.totals.unsupported).toBe(1);
    expect(audit.totals.invalidSources).toBeGreaterThanOrEqual(1);

    os.status = 'draft';
    expect((await admin.call('PATCH', `/admin/courses/${os.id}`, { status: 'live' })).status).toBe(200);
    const bundle = await admin.call('POST', '/admin/bundles', {
      title: 'OS plus DSA',
      batchYear: 2025,
      courseIds: [os.id, dsa.id],
      pricePaise: 12900,
      status: 'live',
    });
    expect(bundle.status).toBe(200);
    expect(bundle.json.status).toBe('live');
  });

  it('a broken file students would see blocks publishing and is named in the message', async () => {
    const os = course('os-2025-cse-core');
    const file = visibleFiles(os.id)[0]!;
    breakSource(file);
    os.status = 'draft';
    const r = await admin.call('PATCH', `/admin/courses/${os.id}`, { status: 'live' });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('NOT_READY');
    expect(r.json.error.message).toContain(file.sourceKey.split('/').at(-1));
    expect(r.json.error.message).toContain('re-upload');
  });

  it('a live bundle is refused with the course problem spelled out', async () => {
    const os = course('os-2025-cse-core');
    const dsa = course('dsa-2025-cse-core');
    const file = visibleFiles(dsa.id)[0]!;
    breakSource(file);
    const r = await admin.call('POST', '/admin/bundles', {
      title: 'OS plus DSA',
      batchYear: 2025,
      courseIds: [os.id, dsa.id],
      pricePaise: 12900,
      status: 'live',
    });
    expect(r.status).toBe(409);
    expect(r.json.error.message).toContain(file.sourceKey.split('/').at(-1));
  });
});

describe('bundle scope', () => {
  it('refuses a bundle that mixes batches and names the odd course out', async () => {
    const { env, app } = setup();
    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
    const courses = [...env.db.courses.values()].filter((c) => c.status === 'live');
    const a = courses.find((c) => c.batchYear === 2025)!;
    const b = courses.find((c) => c.batchYear !== 2025)!;
    const r = await admin.call('POST', '/admin/bundles', {
      title: 'Mixed',
      batchYear: 2025,
      courseIds: [a.id, b.id],
      pricePaise: 100,
      status: 'draft',
    });
    expect(r.status).toBe(400);
    expect(r.json.error.message).toContain(b.title);
  });
});
