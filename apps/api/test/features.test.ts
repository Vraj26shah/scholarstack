import { beforeEach, describe, expect, it } from 'vitest';
import { cleanTitle, formatOf, guessBatchYear, guessSemester, parseUnit } from '../src/application/folders';
import { bundlePricing, suggestBundlePrice } from '../src/application/pricing';
import type { memoryContainer } from '../src/composition/memory';
import type { createApp } from '../src/http/app';
import { Browser, type TestClock, pay, setup } from './harness';

let clock: TestClock;
let app: ReturnType<typeof createApp>;
let env: ReturnType<typeof memoryContainer>;

beforeEach(() => {
  ({ clock, env, app } = setup());
});

const courseBySlug = (slug: string) => [...env.db.courses.values()].find((c) => c.slug === slug)!;
const admin = async () => {
  const b = new Browser(app);
  await b.signIn('admin@vitbhopal.ac.in');
  return b;
};
const student = async (email = 'priya@vitbhopal.ac.in') => {
  const b = new Browser(app);
  await b.signIn(email);
  return b;
};

describe('folder names → courses and units', () => {
  it.each([
    ['Unit 1 - ER and relational model', 'unit-1', 'ER and relational model'],
    ['unit-3-normalisation', 'unit-3', 'Normalisation'],
    ['Module 2 - MapReduce', 'module-2', 'MapReduce'],
    ['Unit-2 Network attacks', 'unit-2', 'Network attacks'],
    ['MOD_04 spark streaming', 'module-4', 'Spark Streaming'],
    ['02. Transactions', 'unit-2', 'Transactions'],
    ['Module 1', 'module-1', 'Module 1'],
    ['PYQs', 'pyqs', 'PYQs'],
    ['Maths notes', 'maths-notes', 'Maths notes'],
  ])('%s → %s / %s', (folder, key, title) => {
    expect(parseUnit(folder)).toEqual({ key, title });
  });

  it('reads batch years and semesters from folder names', () => {
    expect(guessBatchYear(['23 Batch'])).toBe(2023);
    expect(guessBatchYear(['Batch 2024', 'DBMS'])).toBe(2024);
    expect(guessBatchYear(['notes'])).toBeNull();
    expect(guessSemester(['23 Batch', 'Sem 7 Electives', 'NLP'])).toBe(7);
    expect(guessSemester(['semester-3'])).toBe(3);
    expect(cleanTitle('software_project_management')).toBe('Software Project Management');
    expect(formatOf('Unit 1 short notes.txt')).toBe('docx');
  });
});

describe('admin import from drive-imports/', () => {
  it('recognizes an extensionless PDF from its signature and imports it as a note', async () => {
    env.sources.put(
      'drive-imports/23 Batch/Introduction to Problem Solving and Programming (CSE1021)/Syllabus',
      new TextEncoder().encode('%PDF-1.7 test content'),
      'application/pdf',
    );
    const a = await admin();
    const tree = (await a.call('GET', '/admin/import')).json;
    const subject = tree.folders
      .find((f: any) => f.name === '23 Batch')
      .children.find((f: any) => f.name === 'Introduction to Problem Solving and Programming (CSE1021)');
    expect(subject.supportedCount).toBe(1);
    const imported = await a.call('POST', '/admin/import', {
      courses: [
        {
          prefix: subject.prefix,
          title: subject.suggested.title,
          courseCode: subject.suggested.courseCode,
          batchYear: 2023,
          branchSlugs: ['bai', 'bce', 'bcg', 'bey', 'bsa', 'mim'],
          semester: 1,
          pricePaise: 9900,
        },
      ],
    });
    expect(imported.json).toMatchObject({
      coursesCreated: 1,
      filesAdded: 1,
      conversionQueued: 1,
      skipped: [],
    });
    const course = (await a.call('GET', '/admin/courses')).json.find(
      (c: any) => c.r2Prefix === subject.prefix,
    );
    const units = (await a.call('GET', `/admin/courses/${course.id}/units`)).json;
    expect(units).toMatchObject([
      { key: 'notes', kind: 'notes', files: [{ name: 'Syllabus', format: 'pdf', status: 'ready' }] },
    ]);
  });

  it('shows the folder tree with suggestions and what is already imported', async () => {
    const a = await admin();
    const tree = (await a.call('GET', '/admin/import')).json;
    expect(tree.root).toBe('drive-imports/');
    const batch23 = tree.folders.find((f: any) => f.name === '23 Batch');
    expect(batch23.suggested.batchYear).toBe(2023);
    const bda = batch23.children.find((f: any) => f.name === 'Big Data Analytics');
    expect(bda).toMatchObject({ fileCount: 4, supportedCount: 4, course: null });
    expect(bda.childNames).toEqual([
      'Module 1 - Hadoop basics',
      'Module 2 - MapReduce',
      'Module 3 - Spark',
      'PYQs',
    ]);
    const cloud = batch23.children.find((f: any) => f.name === 'Cloud Computing');
    expect(cloud.course).toMatchObject({ title: 'Cloud Computing', status: 'live' });
    const spm = batch23.children.find((f: any) => f.name === 'software_project_management');
    expect(spm).toMatchObject({
      fileCount: 3,
      supportedCount: 2,
      ignoredCount: 1,
      suggested: { title: 'Software Project Management' },
    });
    expect(spm.looseObjects.find((f: any) => f.name === 'Thumbs.db').classification).toBe('ignored');
  });

  it('shows root-level and direct folder files by name with support status', async () => {
    env.sources.put('drive-imports/23 Batch/Course List.pdf', new Uint8Array([1, 2, 3]), 'application/pdf');
    const tree = (await (await admin()).call('GET', '/admin/import')).json;
    const batch = tree.folders.find((f: any) => f.name === '23 Batch');
    expect(batch.looseObjects).toMatchObject([{ name: 'Course List.pdf', classification: 'supported' }]);
    expect(tree.rootFiles).toEqual([]);
  });

  it('imports only the folders the admin picks, as drafts, with sub-folders as units', async () => {
    const a = await admin();
    const r = await a.call('POST', '/admin/import', {
      courses: [
        {
          prefix: 'drive-imports/23 Batch/Big Data Analytics/',
          title: 'Big Data Analytics',
          courseCode: 'CDS4001',
          batchYear: 2023,
          branchSlugs: ['bce'],
          semester: 7,
          pricePaise: 8900,
        },
        {
          prefix: 'drive-imports/23 Batch/Information Security/',
          title: 'Information Security',
          batchYear: 2023,
          branchSlugs: ['bai', 'bsa'],
          semester: 7,
          pricePaise: 9900,
        },
      ],
    });
    expect(r.json).toMatchObject({ coursesCreated: 2, filesAdded: 7, conversionQueued: 7 });
    expect(r.json.skipped).toEqual([
      'drive-imports/23 Batch/Information Security/Unit-2 Network attacks/whiteboard.heic (unsupported file type .heic)',
    ]);

    // Not visible until published.
    const before = await new Browser(app).call('GET', '/catalogue/drawer?batch=2023&branch=bce');
    expect(before.json.map((c: any) => c.title)).not.toContain('Big Data Analytics');

    const bda = (await a.call('GET', '/admin/courses')).json.find(
      (c: any) => c.title === 'Big Data Analytics',
    );
    expect(bda).toMatchObject({
      status: 'draft',
      courseCode: 'CDS4001',
      unitCount: 4,
      fileCount: 4,
      pendingFiles: 0,
      previewCount: 4,
    });
    await a.call('PATCH', `/admin/courses/${bda.id}`, { status: 'live' });

    const detail = (await new Browser(app).call('GET', `/courses/${bda.slug}`)).json;
    expect(detail.units.map((u: any) => `${u.label}: ${u.title}`)).toEqual([
      'MODULE 1: Hadoop basics',
      'MODULE 2: MapReduce',
      'MODULE 3: Spark',
      'PYQS: PYQs',
    ]);
    const bsa = await new Browser(app).call('GET', '/catalogue/drawer?batch=2023&branch=bsa');
    expect(bsa.json.map((c: any) => c.title)).not.toContain('Information Security'); // still a draft
    const is = (await a.call('GET', '/admin/courses')).json.find(
      (c: any) => c.title === 'Information Security',
    );
    const publishIncomplete = await a.call('PATCH', `/admin/courses/${is.id}`, { status: 'live' });
    expect(publishIncomplete.status).toBe(409);
    expect(publishIncomplete.json.error.code).toBe('NOT_READY'); // HEIC is unsupported and remains visible in the R2 audit.
    const bsa2 = await new Browser(app).call('GET', '/catalogue/drawer?batch=2023&branch=bsa');
    expect(bsa2.json.map((c: any) => c.title)).not.toContain('Information Security');
    const bai = await new Browser(app).call('GET', '/catalogue/drawer?batch=2023&branch=bai');
    expect(bai.json.map((c: any) => c.title)).not.toContain('Information Security');
  });

  it('real folders: code from "Subject (CODE)", units by kind, reference books and textbooks kept off the site', async () => {
    const a = await admin();
    const tree = (await a.call('GET', '/admin/import')).json;
    const os = tree.folders
      .find((f: any) => f.name === '23 Batch')
      .children.find((f: any) => f.name === 'Operating Systems (CSE3003)');
    expect(os.suggested).toMatchObject({
      title: 'Operating Systems',
      courseCode: 'CSE3003',
      batchYear: 2023,
    });
    expect(os.suggested.branchSlugs).toEqual(expect.arrayContaining(['bai', 'bcg', 'bsa']));

    const r = await a.call('POST', '/admin/import', {
      courses: [
        {
          prefix: os.prefix,
          title: 'Operating Systems',
          courseCode: 'CSE3003',
          batchYear: 2023,
          branchSlugs: os.suggested.branchSlugs,
          semester: 5,
          pricePaise: 9900,
        },
      ],
    });
    // Five files mirrored, only the three real notes converted.
    expect(r.json).toMatchObject({ filesAdded: 5, conversionQueued: 3 });
    expect(r.json.skipped).toEqual(
      expect.arrayContaining([
        expect.stringContaining('(kept off the site: reference folder)'),
        expect.stringContaining('(kept off the site: looks like a textbook)'),
      ]),
    );
    const course = (await a.call('GET', '/admin/courses')).json.find((c: any) => c.r2Prefix === os.prefix);
    expect(course).toMatchObject({ fileCount: 3, hiddenUnits: 1, hiddenFiles: 2 });

    const units = (await a.call('GET', `/admin/courses/${course.id}/units`)).json;
    expect(units.map((u: any) => `${u.kind}:${u.hidden}`)).toEqual([
      'module:false',
      'pyq:false',
      'syllabus:false',
      'notes:false',
      'reference:true',
    ]);
    const textbook = units.find((u: any) => u.kind === 'notes').files[0];
    expect(textbook).toMatchObject({ hidden: true, status: 'pending' });

    expect((await a.call('PATCH', `/admin/courses/${course.id}`, { status: 'live' })).status).toBe(200);
    const detail = (await new Browser(app).call('GET', `/courses/${course.slug}`)).json;
    expect(detail.units.map((u: any) => u.kind)).toEqual(['module', 'pyq', 'syllabus']);
    expect(JSON.stringify(detail.units)).not.toMatch(/Edition|z-lib/);
    // The books are named as a reading list (title + where to find a copy), never served.
    expect(detail.readingList).toEqual([
      expect.objectContaining({ title: 'Galvin Operating Systems', unit: 'Notes' }),
      expect.objectContaining({ title: 'Operating System Concepts 9th Edition', unit: 'Reference books' }),
    ]);
    expect(detail.readingList[0].findUrl).toMatch(/^https:\/\/openlibrary\.org\/search\?q=/);
    expect(JSON.stringify(detail.readingList)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/); // no file ids
    expect((await new Browser(app).call('GET', `/previews/${textbook.id}`)).status).toBe(404);

    // Showing a hidden folder converts it; a live course waits as a draft.
    const shown = (
      await a.call('PUT', `/admin/courses/${course.id}/units/reference-books`, { hidden: false })
    ).json;
    const ref = shown.find((u: any) => u.kind === 'reference');
    expect(ref.hidden).toBe(false);
    // The book inside also looks like a textbook, so it stays hidden until shown on its own.
    expect(ref.files[0].hidden).toBe(true);
    const mid = (await a.call('GET', '/admin/courses')).json.find((c: any) => c.id === course.id);
    expect(mid).toMatchObject({ status: 'live', hiddenUnits: 0, hiddenFiles: 2 });
    await a.call('PUT', `/admin/files/${ref.files[0].id}`, { hidden: false });
    const after = (await a.call('GET', '/admin/courses')).json.find((c: any) => c.id === course.id);
    expect(after).toMatchObject({ status: 'draft', hiddenUnits: 0, hiddenFiles: 1 });

    // Hiding again is instant, and students never see it.
    await a.call('PUT', `/admin/courses/${course.id}/units/reference-books`, { hidden: true });
    await a.call('PATCH', `/admin/courses/${course.id}`, { status: 'live' });
    const again = (await new Browser(app).call('GET', `/courses/${course.slug}`)).json;
    expect(again.units.map((u: any) => u.kind)).toEqual(['module', 'pyq', 'syllabus']);

    const s = await student();
    expect((await s.call('PUT', `/admin/files/${textbook.id}`, { hidden: false })).status).toBe(403);
  });

  it('files without unit folders land in "Notes"; junk files are ignored; re-import updates, not duplicates', async () => {
    const a = await admin();
    const input = {
      prefix: 'drive-imports/23 Batch/software_project_management/',
      title: 'Software Project Management',
      batchYear: 2023,
      branchSlugs: ['bce'],
      semester: 7,
      pricePaise: 7900,
    };
    const first = await a.call('POST', '/admin/import', { courses: [input] });
    expect(first.json).toMatchObject({ coursesCreated: 1, filesAdded: 2, skipped: [] });
    const again = await a.call('POST', '/admin/import', { courses: [{ ...input, pricePaise: 6900 }] });
    expect(again.json).toMatchObject({ coursesCreated: 0, filesAdded: 0 });
    const spm = (await a.call('GET', '/admin/courses')).json.filter(
      (c: any) => c.title === 'Software Project Management',
    );
    expect(spm).toHaveLength(1);
    expect(spm[0]).toMatchObject({ pricePaise: 6900, unitCount: 1 });
  });

  it('assigns an imported course to a matching-year draft bundle without exposing it', async () => {
    const a = await admin();
    const existing = [...env.db.courses.values()].filter((course) => course.batchYear === 2023).slice(0, 2);
    expect(existing).toHaveLength(2);
    const existingTotal = existing.reduce((sum, course) => sum + course.pricePaise, 0);
    const createdBundle = await a.call('POST', '/admin/bundles', {
      title: '2023 Draft pack',
      batchYear: 2023,
      courseIds: existing.map((course) => course.id),
      pricePaise: existingTotal - 100,
      status: 'draft',
    });
    expect(createdBundle.status).toBe(200);

    await a.call('POST', '/admin/import', {
      courses: [
        {
          prefix: 'drive-imports/23 Batch/Big Data Analytics/',
          title: 'Big Data Analytics',
          courseCode: 'CDS3005',
          batchYear: 2023,
          branchSlugs: ['bai', 'bsa'],
          semester: 7,
          pricePaise: 8900,
          bundleId: createdBundle.json.id,
        },
      ],
    });

    const imported = (await a.call('GET', '/admin/courses')).json.find(
      (course: any) => course.title === 'Big Data Analytics',
    );
    const bundle = (await a.call('GET', '/admin/bundles')).json.find(
      (item: any) => item.id === createdBundle.json.id,
    );
    expect(imported).toMatchObject({ status: 'draft', courseCode: 'CDS3005' });
    expect(bundle.courseIds).toContain(imported.id);
    expect(bundle.listPricePaise).toBe(existingTotal + 8900);
    expect(bundle.savePercent).toBeGreaterThan(0);
    expect((await new Browser(app).call('GET', '/bundles?batch=2023')).json).toHaveLength(1);
    expect(
      (await new Browser(app).call('GET', '/catalogue/drawer?batch=2023&branch=bai')).json.map(
        (course: any) => course.title,
      ),
    ).not.toContain('Big Data Analytics');
  });

  it('unpublishes a live course and its live bundles before edits become public', async () => {
    const a = await admin();
    const course = courseBySlug('os-2025-cse-core');
    const companion = courseBySlug('dsa-2025-cse-core');
    const bundle = await a.call('POST', '/admin/bundles', {
      title: 'OS plus DSA',
      batchYear: 2025,
      courseIds: [course.id, companion.id],
      pricePaise: 12900,
      status: 'live',
    });
    expect(bundle.status).toBe(200);
    await a.call('PATCH', `/admin/courses/${course.id}`, { title: 'Operating Systems revised' });
    const edited = (await a.call('GET', '/admin/courses')).json.find((item: any) => item.id === course.id);
    const revisedBundle = (await a.call('GET', '/admin/bundles')).json.find(
      (item: any) => item.id === bundle.json.id,
    );
    expect(edited.status).toBe('draft');
    expect(revisedBundle.status).toBe('draft');
    expect(
      (await new Browser(app).call('GET', '/catalogue/drawer?batch=2025&branch=bce')).json.map(
        (item: any) => item.title,
      ),
    ).not.toContain('Operating Systems revised');
  });

  it('unpublishes live courses and bundles before changed R2 files are reconverted', async () => {
    const a = await admin();
    const course = courseBySlug('os-2025-cse-core');
    const companion = courseBySlug('dsa-2025-cse-core');
    const bundle = await a.call('POST', '/admin/bundles', {
      title: 'OS and DSA refresh',
      batchYear: 2025,
      courseIds: [course.id, companion.id],
      pricePaise: 12900,
      status: 'live',
    });
    expect(bundle.status).toBe(200);
    const newKey = `${course.r2Prefix}Unit 1/new lecture.pdf`;
    env.sources.put(
      newKey,
      new Uint8Array([1, 2, 3]),
      'application/pdf',
      'new-etag',
    );
    await a.call('POST', `/admin/courses/${course.id}/sync-file`, { sourceKey: newKey });
    expect(env.db.courses.get(course.id)?.status).toBe('draft');
    expect(env.db.bundles.get(bundle.json.id)?.status).toBe('draft');
  });

  it('moves a stale live course to draft when a rescan finds no reader-ready files', async () => {
    const a = await admin();
    const course = courseBySlug('os-2025-cse-core');
    for (const file of env.db.files.values()) {
      if (file.courseId !== course.id) continue;
      file.hidden = true;
      file.conversionStatus = 'failed';
      file.pageCount = 0;
      file.conversionError = 'Broken source: saved sign-in page';
    }

    const rescan = await a.call('POST', `/admin/courses/${course.id}/sync`);

    expect(rescan.status).toBe(200);
    expect(env.db.courses.get(course.id)?.status).toBe('draft');
  });

  it('refuses folders outside the import root and unknown branches', async () => {
    const a = await admin();
    const base = { title: 'X', batchYear: 2023, semester: 1, pricePaise: 100 };
    const out = await a.call('POST', '/admin/import', {
      courses: [{ ...base, prefix: 'pages/secret/', branchSlugs: ['bce'] }],
    });
    expect(out.json.error.code).toBe('BAD_REQUEST');
    const branch = await a.call('POST', '/admin/import', {
      courses: [{ ...base, prefix: 'drive-imports/23 Batch/Big Data Analytics/', branchSlugs: ['nope'] }],
    });
    expect(branch.json.error.code).toBe('BAD_REQUEST');
  });

  it('students cannot browse or import', async () => {
    const s = await student();
    expect((await s.call('GET', '/admin/import')).json.error.code).toBe('FORBIDDEN');
  });
});

describe('first-page previews', () => {
  it('each unit exposes exactly one public preview, served without signing in', async () => {
    const course = (await new Browser(app).call('GET', '/courses/dbms-2025-cse-core')).json;
    expect(course.units.every((u: any) => typeof u.previewFileId === 'string')).toBe(true);
    const unit3 = course.units[2];
    expect(unit3.previewFileId).toBe(unit3.files[0].id);
    const img = await new Browser(app).call('GET', `/previews/${unit3.previewFileId}`);
    expect(img.status).toBe(200);
    expect(img.res.headers.get('cache-control')).toContain('public');
  });

  it('course cards and bundles carry real page-one covers', async () => {
    const cards = (await new Browser(app).call('GET', '/catalogue/drawer?batch=2025&branch=bce')).json;
    expect(cards.every((c: any) => typeof c.previewFileId === 'string')).toBe(true);
    const dbms = cards.find((c: any) => c.slug === 'dbms-2025-cse-core');
    const detail = (await new Browser(app).call('GET', '/courses/dbms-2025-cse-core')).json;
    expect(dbms.previewFileId).toBe(detail.units[0].previewFileId); // Unit 1, not "Revision"
    const bundles = (await new Browser(app).call('GET', '/bundles?batch=2025')).json;
    expect(bundles[0].coverFileIds).toHaveLength(3);
    // A course whose files aren't converted yet has no cover (the UI shows a skeleton, never a fake page).
    for (const f of env.db.files.values())
      if (f.courseId === courseBySlug('os-2025-cse-core').id)
        env.db.files.set(f.id, { ...f, previewKey: null });
    const os = (await new Browser(app).call('GET', '/catalogue/drawer?batch=2025&branch=bce')).json.find(
      (c: any) => c.slug === 'os-2025-cse-core',
    );
    expect(os.previewFileId).toBeNull();
  });

  it('other files in a unit and draft courses have no preview', async () => {
    const course = (await new Browser(app).call('GET', '/courses/dbms-2025-cse-core')).json;
    const second = course.units[2].files[1].id;
    expect((await new Browser(app).call('GET', `/previews/${second}`)).status).toBe(404);
    const dbms = courseBySlug('dbms-2025-cse-core');
    env.db.courses.set(dbms.id, { ...dbms, status: 'draft' });
    expect((await new Browser(app).call('GET', `/previews/${course.units[0].previewFileId}`)).status).toBe(
      404,
    );
  });
});

describe('bundles', () => {
  it('pricing: list price, saving, and scaled price for courses already owned', () => {
    expect(bundlePricing(19900, [9900, 9900, 7900], [])).toEqual({
      listPaise: 27700,
      savePercent: 28,
      payablePaise: 19900,
      remainingListPaise: 27700,
    });
    // Owns DBMS (₹99): pays 199 × 178/277 = ₹127.88 → ₹128, never more than ₹178.
    expect(bundlePricing(19900, [9900, 9900, 7900], [9900]).payablePaise).toBe(12800);
    expect(bundlePricing(19900, [9900, 9900, 7900], [9900, 9900, 7900]).payablePaise).toBe(0);
    expect(suggestBundlePrice([9900, 9900, 7900])).toBe(18900);
  });

  it('shows bundle cards per batch with the saving', async () => {
    const r = await new Browser(app).call('GET', '/bundles?batch=2025');
    expect(r.json).toHaveLength(1);
    expect(r.json[0]).toMatchObject({
      slug: 'cse-sem-3-pack',
      courseCount: 3,
      pricePaise: 19900,
      listPricePaise: 27700,
      savePercent: 28,
    });
    const course = (await new Browser(app).call('GET', '/courses/dbms-2025-cse-core')).json;
    expect(course.bundles[0].slug).toBe('cse-sem-3-pack');
  });

  it('buying a bundle puts every course on the shelf', async () => {
    const s = await student();
    const bundle = (await s.call('GET', '/bundles/23-batch-complete-set')).json;
    expect(bundle).toMatchObject({ yourPricePaise: 16900, ownedCount: 0, courseCount: 3 });
    const paid = await pay(s, { bundleId: bundle.id });
    expect(paid.json).toMatchObject({ status: 'paid', bundleId: bundle.id });
    expect(paid.json.courseIds).toHaveLength(3);
    const shelf = (await s.call('GET', '/me/shelf')).json;
    expect(shelf.map((i: any) => i.course.title).sort()).toEqual([
      'Cloud Computing',
      'Distributed Systems',
      'Internet of Things',
    ]);
    expect((await s.call('POST', '/orders', { bundleId: bundle.id })).json.error.code).toBe('ALREADY_OWNED');
  });

  it('owning one course lowers the bundle price and only grants the rest', async () => {
    const s = await student();
    await pay(s, { courseId: courseBySlug('dbms-2025-cse-core').id });
    const bundle = (await s.call('GET', '/bundles/cse-sem-3-pack')).json;
    expect(bundle).toMatchObject({ ownedCount: 1, yourPricePaise: 12800 });
    const start = await s.call('POST', '/orders', { bundleId: bundle.id });
    expect(start.json.amountPaise).toBe(12800);
    const order = env.db.orders.get(start.json.orderId)!;
    expect(order.courseIds).toHaveLength(2);
    expect(order.courseIds).not.toContain(courseBySlug('dbms-2025-cse-core').id);
  });

  it('a lost dispute on a bundle revokes every course it granted', async () => {
    const s = await student();
    const bundle = (await s.call('GET', '/bundles/23-batch-complete-set')).json;
    await pay(s, { bundleId: bundle.id });
    const order = [...env.db.orders.values()].find((o) => o.bundleId === bundle.id)!;
    const body = JSON.stringify({
      event: 'payment.dispute.lost',
      payload: { dispute: { entity: { payment_id: order.gatewayPaymentId } } },
    });
    const signature = await env.gateway.signWebhook(body);
    await new Browser(app).call('POST', '/webhooks/razorpay', body, {
      'content-type': 'application/json',
      'x-razorpay-signature': signature,
    });
    expect((await s.call('GET', '/me/shelf')).json).toHaveLength(0);
  });

  it('admin creates a bundle; it must cost less than its courses', async () => {
    const a = await admin();
    const ids = ['os-2025-cse-core', 'dsa-2025-cse-core'].map((s) => courseBySlug(s).id);
    const suggested = (await a.call('POST', '/admin/bundles/suggest-price', { courseIds: ids })).json
      .pricePaise;
    expect(suggested).toBe(12900);
    const tooDear = await a.call('POST', '/admin/bundles', {
      title: 'OS + DSA',
      batchYear: 2025,
      courseIds: ids,
      pricePaise: 25000,
      status: 'live',
    });
    expect(tooDear.json.error.code).toBe('BAD_REQUEST');
    const ok = await a.call('POST', '/admin/bundles', {
      title: 'OS + DSA',
      batchYear: 2025,
      courseIds: ids,
      pricePaise: suggested,
      status: 'live',
    });
    expect(ok.json).toMatchObject({ slug: 'os-dsa', savePercent: 35, status: 'live' });
    expect((await new Browser(app).call('GET', '/bundles?batch=2025')).json).toHaveLength(2);
  });
});

describe('toolbox and announcements', () => {
  it('the toolbox is public and starts with tools marked "coming soon"', async () => {
    const r = await new Browser(app).call('GET', '/features');
    expect(r.json.map((f: any) => [f.key, f.status, f.path])).toEqual([
      ['cgpa', 'soon', '/tools/cgpa'],
      ['timetable', 'soon', '/tools/timetable'],
    ]);
  });

  it('launching a tool drafts an email that goes to every opted-in student, with a working unsubscribe', async () => {
    const students = await Promise.all(['a', 'b', 'c'].map((n) => student(`${n}.student@vitbhopal.ac.in`)));
    await students[2]!.call('PUT', '/me/email', { emailOptIn: false });
    const a = await admin();

    const draft = (await a.call('POST', '/admin/features/cgpa/launch')).json;
    expect(draft).toMatchObject({ status: 'draft', ctaUrl: '/tools/cgpa', featureKey: 'cgpa' });
    expect((await new Browser(app).call('GET', '/features')).json[0].status).toBe('live');

    const preview = (await a.call('GET', `/admin/announcements/${draft.id}/preview`)).json;
    expect(preview.html).toContain('CGPA calculator is here.');

    const sent = (await a.call('POST', `/admin/announcements/${draft.id}/send`)).json;
    expect(sent).toMatchObject({ status: 'sent', recipients: 3, sent: 3 }); // a, b and the admin
    const to = env.db.outbox.map((m) => m.to.email).sort();
    expect(to).toEqual(['a.student@vitbhopal.ac.in', 'admin@vitbhopal.ac.in', 'b.student@vitbhopal.ac.in']);
    expect(env.db.outbox[0]!.html).toContain('http://localhost:5173/tools/cgpa');

    // The personal link in the email opts that student out.
    const mailToA = env.db.outbox.find((m) => m.to.email === 'a.student@vitbhopal.ac.in')!;
    const token = decodeURIComponent(/unsubscribe\?t=([^"&]+)/.exec(mailToA.html)![1]!);
    expect((await new Browser(app).call('POST', '/email/unsubscribe', { token })).status).toBe(200);
    expect((await students[0]!.call('GET', '/me')).json.emailOptIn).toBe(false);
    expect(
      (await new Browser(app).call('POST', '/email/unsubscribe', { token: 'forged.token.value' })).status,
    ).toBe(400);
  });

  it('respects the daily limit and resumes the next day from where it stopped', async () => {
    for (let i = 0; i < 5; i++) await student(`s${i}@vitbhopal.ac.in`);
    env.container.config.emailDailyLimit = 3;
    const a = await admin();
    const draft = (
      await a.call('POST', '/admin/announcements', {
        subject: 'New notes for 23 Batch',
        heading: 'Big Data Analytics is on the shelf',
        body: 'All four modules, with solved PYQs.',
        ctaLabel: 'Have a look',
        ctaUrl: '/c/big-data',
      })
    ).json;
    const first = (await a.call('POST', `/admin/announcements/${draft.id}/send`)).json;
    expect(first).toMatchObject({ status: 'sending', recipients: 6, sent: 3 });
    clock.advance(24 * 3600 * 1000);
    await env.container.announcements.processPending();
    const done = (await a.call('GET', '/admin/announcements')).json[0];
    expect(done).toMatchObject({ status: 'sent', sent: 6 });
    expect(new Set(env.db.outbox.map((m) => m.to.email)).size).toBe(6); // nobody twice
  });

  it('a provider error pauses the send; resuming continues without duplicates', async () => {
    await student('x@vitbhopal.ac.in');
    const a = await admin();
    const draft = (
      await a.call('POST', '/admin/announcements', {
        subject: 'Hi there',
        heading: 'Hello',
        body: 'A short note for everyone.',
      })
    ).json;
    env.mailer.failNext = true;
    expect((await a.call('POST', `/admin/announcements/${draft.id}/send`)).json).toMatchObject({
      status: 'failed',
      sent: 0,
    });
    expect((await a.call('POST', `/admin/announcements/${draft.id}/send`)).json).toMatchObject({
      status: 'sent',
      sent: 2,
    });
    expect(env.db.outbox).toHaveLength(2);
  });

  it('admin adds a new tool; it shows in the public toolbox as "coming soon"', async () => {
    const a = await admin();
    const made = await a.call('POST', '/admin/features', {
      key: 'Attendance',
      title: 'Attendance tracker',
      blurb: 'See how many classes you can still miss.',
    });
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({ key: 'attendance', status: 'soon', path: '/tools/attendance' });
    const pub = (await new Browser(app).call('GET', '/features')).json as { key: string }[];
    expect(pub.at(-1)?.key).toBe('attendance');
    expect(
      (await a.call('POST', '/admin/features', { key: 'attendance', title: 'Again', blurb: '' })).status,
    ).toBe(400);
    expect(
      (await a.call('POST', '/admin/features', { key: 'no spaces', title: 'Bad key', blurb: '' })).status,
    ).toBe(400);
    const s = await student();
    expect(
      (await s.call('POST', '/admin/features', { key: 'x-tool', title: 'Nope', blurb: '' })).status,
    ).toBe(403);
  });

  it('students cannot send announcements', async () => {
    const s = await student();
    expect((await s.call('GET', '/admin/announcements')).json.error.code).toBe('FORBIDDEN');
  });
});

describe('folder rules on real R2 names', () => {
  it.each([
    ['Database Management Systems (CSE3001)', 'Database Management Systems', 'CSE3001'],
    [
      'Probability, Statistics and Reliability (MAT3003)',
      'Probability, Statistics and Reliability',
      'MAT3003',
    ],
    ['Object Oriented Programming with C++ (CSE2001)', 'Object Oriented Programming with C++', 'CSE2001'],
    ['Big Data Analytics', 'Big Data Analytics', null],
  ])('%s', async (folder, title, code) => {
    const { parseCourseFolder } = await import('../src/application/folders');
    expect(parseCourseFolder(folder)).toEqual({ title, code });
  });

  it.each([
    ['Module 4', 'module'],
    ['module 2', 'module'],
    ['PYQs', 'pyq'],
    ['Syllabus', 'syllabus'],
    ['Lab File', 'lab'],
    ['Lab Manual', 'lab'],
    ['Reference Books', 'reference'],
    ['Ref Books', 'reference'],
    ['Reference book', 'reference'],
    ['Revision Notes', 'revision'],
    ['Other topics', 'other'],
  ])('unit "%s" is %s', async (folder, kind) => {
    const { unitKindOf } = await import('../src/application/folders');
    expect(unitKindOf(folder)).toBe(kind);
  });

  it('spots publishers’ textbooks but not notes that mention a method', async () => {
    const { looksLikeTextbook } = await import('../src/application/folders');
    expect(
      looksLikeTextbook('Higher Engineering Mathematics By Dr. B.S. Grewal by B.S Grewal (z-lib.org).pdf'),
    ).toBe(true);
    expect(looksLikeTextbook('Thomas_Calculus.pdf')).toBe(true);
    expect(looksLikeTextbook('C_The_Complete_Reference_Fourth_Edition.pdf')).toBe(true);
    expect(looksLikeTextbook('advanced-engineering-mathematics.pdf')).toBe(true);
    expect(looksLikeTextbook('Reference book.pdf')).toBe(true);
    const { bookTitle } = await import('../src/application/folders');
    expect(bookTitle('Higher Engineering Mathematics By Dr. B.S. Grewal by B.S Grewal (z-lib.org).pdf')).toBe(
      'Higher Engineering Mathematics By Dr. B.S. Grewal',
    );
    expect(bookTitle('Thomas_Calculus.pdf')).toBe('Thomas Calculus');
    expect(bookTitle('ADVANCED ENGINEERING MATHEMATICS BY ERWIN ERESZIG1.pdf')).toBe(
      'Advanced Engineering Mathematics By Erwin Ereszig',
    );
    expect(looksLikeTextbook('Applecation of DE by Matrix method.pdf')).toBe(false);
    expect(looksLikeTextbook('Unit-3-IoT-solved.pdf')).toBe(false);
  });
});

describe('broken R2 copies', () => {
  it('rejects a ready callback when R2 still contains a Google sign-in page', async () => {
    const course = [...env.db.courses.values()].find((c) => c.status === 'live')!;
    const file = [...env.db.files.values()].find((f) => f.courseId === course.id)!;
    const sources = env.sources as unknown as {
      put(key: string, body: Uint8Array, type: string, etag: string): void;
    };
    sources.put(
      file.sourceKey,
      new TextEncoder().encode('<!doctype html><html><base href="https://accounts.google.com/">'),
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'html-in-pptx',
    );

    await env.container.admin.applyConversion({
      fileId: file.id,
      status: 'ready',
      pages: [{ pageNo: 1, imageKey: `pages/${file.id}/1.webp`, tileSeed: 'test-seed' }],
      previewKey: `pages/${file.id}/preview.webp`,
    });

    const rejected = env.db.files.get(file.id)!;
    expect(rejected).toMatchObject({ hidden: true, conversionStatus: 'failed', pageCount: 0 });
    expect(rejected.conversionError).toMatch(/Google sign-in page/);
    expect(env.db.pages.has(file.id)).toBe(false);
  });

  it('a file whose R2 copy is a Google sign-in page is kept off the site, with the reason for the admin', async () => {
    const a = await admin();
    const course = [...env.db.courses.values()].find((c) => c.status === 'live')!;
    const file = [...env.db.files.values()].find((f) => f.courseId === course.id)!;
    await env.container.admin.applyConversion({
      fileId: file.id,
      status: 'failed',
      error:
        'Broken source: this "pdf" is really a web page (a Google sign-in page saved instead of the file).',
      pages: [],
    });
    const units = (await a.call('GET', `/admin/courses/${course.id}/units`)).json;
    const seen = units.flatMap((u: any) => u.files).find((f: any) => f.id === file.id);
    expect(seen).toMatchObject({ hidden: true, status: 'failed' });
    expect(seen.error).toMatch(/Google sign-in page/);
    const detail = (await new Browser(app).call('GET', `/courses/${course.slug}`)).json;
    expect(detail.units.flatMap((u: any) => u.files).map((f: any) => f.id)).not.toContain(file.id);
    // Re-uploading a good copy to R2 brings it back on the next rescan.
    const src = env.sources as unknown as { put(k: string, b: Uint8Array, t: string, e: string): void };
    src.put(file.sourceKey, new Uint8Array(16), 'application/pdf', 'fixed-copy');
    await a.call('POST', `/admin/courses/${course.id}/sync-file`, { sourceKey: file.sourceKey });
    expect(env.db.files.get(file.id)!.hidden).toBe(false);
    // An ordinary converter failure (our fault, retryable) is not hidden.
    const other = [...env.db.files.values()].find((f) => f.courseId === course.id && f.id !== file.id)!;
    await env.container.admin.applyConversion({
      fileId: other.id,
      status: 'failed',
      error: 'timeout',
      pages: [],
    });
    expect(env.db.files.get(other.id)!.hidden).toBe(false);
  });
});
