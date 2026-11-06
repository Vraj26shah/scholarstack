import { describe, expect, it } from 'vitest';
import { inspectFile, pdfFacts } from '../src/application/contributions/inspect';
import { stepOf } from '../src/application/contributions/pipeline';
import { listZip, unzipEntry } from '../src/application/contributions/zip';
import { Browser, setup } from './harness';
import { zip, zipped } from './zip-helper';

const enc = new TextEncoder();
const pdf = (pages: number, extra = '') =>
  enc.encode(
    `%PDF-1.4\n${Array.from({ length: pages }, (_, i) => `${i + 3} 0 obj << /Type /Page >> endobj`).join('\n')}\n2 0 obj << /Type /Pages /Count ${pages} >> endobj\n${extra}%%EOF`,
  );

describe('the automatic file check', () => {
  it('counts PDF pages and spots a locked PDF', () => {
    expect(pdfFacts(pdf(7)).pages).toBe(7);
    expect(inspectFile('a.pdf', pdf(3))).toMatchObject({
      format: 'pdf',
      ok: true,
      label: 'PDF · about 3 pages',
    });
    const locked = inspectFile('b.pdf', pdf(2, 'trailer << /Encrypt 9 0 R >>\n'));
    expect(locked).toMatchObject({ ok: false, label: 'PDF · password-protected' });
    expect(locked.problem).toContain('password');
  });

  it('counts pages across the 1 MB scan boundary exactly once', () => {
    const filler = 'x'.repeat((1 << 20) - 20);
    const bytes = enc.encode(`%PDF-1.4\n${filler}<< /Type /Page >> << /Type /Page >>%%EOF`);
    expect(pdfFacts(bytes).pages).toBe(2);
  });

  it('lists a zip, leaves out system files, and says what can become pages', async () => {
    const z = zip([
      ['Unit 2/notes.pdf', pdf(4)],
      ['Unit 2/slides.pptx', enc.encode('not really')],
      ['Unit 2/readme.txt', enc.encode('hello')],
      ['__MACOSX/Unit 2/._notes.pdf', enc.encode('junk')],
      ['Unit 2/more.zip', enc.encode('zip')],
    ]);
    const check = inspectFile('unit2.zip', z);
    expect(check.format).toBe('zip');
    expect(check.label).toBe('ZIP · 4 files, 3 usable');
    expect(check.entries!.find((x) => x.path.endsWith('readme.txt'))).toMatchObject({ ok: true });
    expect(check.entries!.find((x) => x.path.endsWith('readme.txt'))).toMatchObject({ ok: true });
    expect(check.entries!.find((x) => x.path.endsWith('more.zip'))!.reason).toContain('archive inside');
    const entry = listZip(z).find((x) => x.path === 'Unit 2/notes.pdf')!;
    expect(new TextDecoder().decode(await unzipEntry(z, entry))).toContain('/Type /Page');
  });

  it('stops an archive that unpacks to more than it claims, and refuses huge files', async () => {
    const big = new Uint8Array(1024 * 1024); // compresses to almost nothing
    const z = zip([['bomb.pdf', big]]);
    const entry = listZip(z)[0]!;
    await expect(unzipEntry(z, { ...entry, size: 10 })).rejects.toThrow('did not unpack cleanly');
    await expect(unzipEntry(z, { ...entry, size: 41 * 1024 * 1024 })).rejects.toThrow('over 40 MB');
    expect((await unzipEntry(z, entry)).length).toBe(big.length);
  });

  it('a docx that is really something else is caught', () => {
    expect(inspectFile('x.docx', zip([['hello.txt', enc.encode('hi')]]))).toMatchObject({
      ok: false,
      format: 'word',
    });
    expect(inspectFile('y.docx', zip([['word/document.xml', enc.encode('<w/>')]]))).toMatchObject({
      ok: true,
      label: 'Word document',
    });
  });
});

type App = ReturnType<typeof setup>['app'];
async function upload(app: App, b: Browser, files: [string, Uint8Array][]) {
  const form = new FormData();
  form.set(
    'meta',
    JSON.stringify({
      title: 'DBMS unit 6, handwritten',
      courseHint: 'DBMS',
      kind: 'notes',
      description: '',
      ownWork: true,
    }),
  );
  for (const [name, bytes] of zipped(files)) form.append('files', new File([bytes as BlobPart], name));
  const res = await app.request('/api/contributions', {
    method: 'POST',
    body: form,
    headers: { authorization: `Bearer ${b.token}`, cookie: b.cookie },
  });
  return (await res.json()) as any;
}

async function syncFiledFiles(
  admin: Browser,
  courseId: string,
  prefix: string,
  files: Array<{ to: string; status: string }>,
) {
  const keys: string[] = [];
  for (const file of files.filter((item) => item.status === 'new' || item.status === 'replace')) {
    const key = `${prefix}${file.to}`;
    const result = await admin.call('POST', `/admin/courses/${courseId}/sync-file`, { sourceKey: key });
    expect(result.status).toBe(200);
    keys.push(key);
  }
  return keys;
}

describe('upload → check → decide → file → pages → reward → done', () => {
  it('accepts several files, creates a draft course, and preserves archive folders when filing', async () => {
    const { app, env } = setup();
    const student = new Browser(app);
    await student.signIn('organizer.23bce10111@vitbhopal.ac.in');
    const sent = await upload(app, student, [
      ['lecture.pdf', pdf(2)],
      [
        'extra.zip',
        zip([
          ['Unit 1/notes.pdf', pdf(3)],
          ['Unit 2/summary.txt', enc.encode('summary')],
        ]),
      ],
    ]);
    expect(sent.files).toHaveLength(2);
    expect(sent.files.every((f: any) => f.check.ok)).toBe(true);

    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
    await admin.call('POST', `/admin/contributions/${sent.id}/review`, {
      decision: 'approved',
      note: '',
      reward: { type: 'none' },
      notify: false,
    });
    const created = await admin.call('POST', `/admin/contributions/${sent.id}/course`, {
      title: 'Archive filing test',
      courseCode: 'CSE9999',
      description: '',
      batchYear: 2026,
      branchSlugs: ['bce'],
      semester: 1,
      pricePaise: 9900,
    });
    expect(created.status).toBe(201);
    const course = env.db.courses.get(created.json.id);
    expect(course).toMatchObject({ title: 'Archive filing test', status: 'draft', batchYear: 2026 });

    const plan = await admin.call('POST', `/admin/contributions/${sent.id}/file`, {
      courseId: created.json.id,
      unit: 'Loose notes',
      preserveFolders: true,
      dryRun: true,
    });
    expect(plan.json.preservedFolders).toBe(true);
    expect(plan.json.files.map((f: any) => f.to)).toEqual([
      'Loose notes/lecture.pdf',
      'Unit 1/notes.pdf',
      'Unit 2/summary.txt',
    ]);
    const filed = await admin.call('POST', `/admin/contributions/${sent.id}/file`, {
      courseId: created.json.id,
      unit: 'Loose notes',
      preserveFolders: true,
      dryRun: false,
    });
    expect(filed.status).toBe(200);
    await syncFiledFiles(admin, created.json.id, course!.r2Prefix, filed.json.files);
    const units = await env.container.admin.listUnits(created.json.id);
    expect(units.map((unit: any) => unit.title)).toEqual(
      expect.arrayContaining(['Unit 1', 'Unit 2', 'Loose notes']),
    );
  });

  it('registers every file from a ZIP folder through bounded per-file syncs', async () => {
    const { app, env } = setup();
    const course = [...env.db.courses.values()].find((item) => item.slug === 'dbms-2025-cse-core')!;
    const student = new Browser(app);
    const admin = new Browser(app);
    await student.signIn('ziplarge.23bce10055@vitbhopal.ac.in');
    await admin.signIn('admin@vitbhopal.ac.in');
    const entries = Array.from({ length: 8 }, (_, index) => [
      `Module 9/part-${index + 1}.pdf`,
      pdf(index + 1),
    ]) as [string, Uint8Array][];
    const sent = await upload(app, student, [['module-9.zip', zip(entries)]]);
    await admin.call('POST', `/admin/contributions/${sent.id}/review`, {
      decision: 'approved',
      note: '',
      reward: { type: 'none' },
      notify: false,
    });
    const filed = await admin.call('POST', `/admin/contributions/${sent.id}/file`, {
      courseId: course.id,
      unit: 'Module 9',
      dryRun: false,
    });
    expect(filed.status).toBe(200);
    const keys = await syncFiledFiles(admin, course.id, course.r2Prefix, filed.json.files);
    expect(keys).toHaveLength(8);
    const inventory = await admin.call('GET', `/admin/courses/${course.id}/inventory`);
    expect(inventory.json.objects.filter((object: any) => keys.includes(object.key))).toHaveLength(8);
  });

  it('lets the admin include a usable ZIP entry whose filename is missing its extension', async () => {
    const { app, env } = setup();
    const course = [...env.db.courses.values()].find((item) => item.slug === 'dbms-2025-cse-core')!;
    const student = new Browser(app);
    const admin = new Browser(app);
    await student.signIn('ziprename.23bce10056@vitbhopal.ac.in');
    await admin.signIn('admin@vitbhopal.ac.in');
    const sent = await upload(app, student, [
      [
        'material.zip',
        zip([
          ['slides.pdf', pdf(1)],
          ['syllabus', pdf(2)],
        ]),
      ],
    ]);
    await admin.call('POST', `/admin/contributions/${sent.id}/review`, {
      decision: 'approved',
      note: '',
      reward: { type: 'none' },
      notify: false,
    });
    const initial = await admin.call('POST', `/admin/contributions/${sent.id}/file`, {
      courseId: course.id,
      unit: 'Extension repair',
      dryRun: true,
    });
    const from = initial.json.files.find((file: any) => file.from.endsWith('syllabus')).from;
    expect(initial.json.files.find((file: any) => file.from === from)).toMatchObject({
      status: 'skipped',
      canRename: true,
    });
    const body = { courseId: course.id, unit: 'Extension repair', files: [{ from, name: 'syllabus.pdf' }] };
    const plan = await admin.call('POST', `/admin/contributions/${sent.id}/file`, {
      ...body,
      dryRun: true,
    });
    expect(plan.json.files.find((file: any) => file.from === from)).toMatchObject({
      to: 'Extension repair/syllabus.pdf',
      status: 'new',
    });
    const filed = await admin.call('POST', `/admin/contributions/${sent.id}/file`, {
      ...body,
      dryRun: false,
    });
    await syncFiledFiles(admin, course.id, course.r2Prefix, filed.json.files);
    expect([...env.db.files.values()].some((file) => file.sourceKey.endsWith('/syllabus.pdf'))).toBe(true);
  });

  it('takes one upload all the way, keeps the live course on sale, and tracks the contributor', async () => {
    const { app, env } = setup();
    const dbms = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    expect(dbms.status).toBe('live');
    const s = new Browser(app);
    await s.signIn('maker.23bce10050@vitbhopal.ac.in');
    // A ZIP can include a loose file and a folder of extras.
    const sent = await upload(app, s, [
      [
        'extra.zip',
        zip([
          ['Unit 6 notes.pdf', pdf(5)],
          ['Extra/one.pdf', pdf(2)],
          ['Extra/two.pdf', pdf(3)],
          ['Extra/notes.txt', enc.encode('x')],
        ]),
      ],
    ]);
    // 1. Checked on upload.
    expect(sent.files.map((f: any) => f.check.label)).toEqual(['ZIP · 4 files, 4 usable']);
    expect(sent.progress.step).toBe('review');

    const a = new Browser(app);
    await a.signIn('admin@vitbhopal.ac.in');
    const id = sent.id;
    const item = () =>
      a
        .call('GET', '/admin/contributions?status=all')
        .then((r) => r.json.items.find((x: any) => x.id === id));
    expect((await item()).pipeline.step).toBe('decide');

    // Filing needs an accepted upload (a preview doesn't).
    const preview = await a.call('POST', `/admin/contributions/${id}/file`, {
      courseId: dbms.id,
      unit: 'Unit 6 - Recovery',
      dryRun: true,
    });
    expect(preview.status).toBe(200);
    expect(preview.json.files).toEqual([
      {
        from: 'extra.zip › Unit 6 notes.pdf',
        to: 'Unit 6 - Recovery/Unit 6 notes.pdf',
        status: 'new',
      },
      { from: 'extra.zip › Extra/one.pdf', to: 'Unit 6 - Recovery/Extra/one.pdf', status: 'new' },
      { from: 'extra.zip › Extra/two.pdf', to: 'Unit 6 - Recovery/Extra/two.pdf', status: 'new' },
      { from: 'extra.zip › Extra/notes.txt', to: 'Unit 6 - Recovery/Extra/notes.txt', status: 'new' },
    ]);
    expect(
      (
        await a.call('POST', `/admin/contributions/${id}/file`, {
          courseId: dbms.id,
          unit: 'U6',
          dryRun: false,
        })
      ).status,
    ).toBe(400);

    // 2. Decide.
    await a.call('POST', `/admin/contributions/${id}/review`, {
      decision: 'approved',
      note: '',
      reward: { type: 'none' },
      notify: false,
    });
    expect((await item()).pipeline.step).toBe('file');

    // 3. File: written into the course in our layout, pages queued, the course stays on sale.
    const filed = await a.call('POST', `/admin/contributions/${id}/file`, {
      courseId: dbms.id,
      unit: 'Unit 6 - Recovery',
      dryRun: false,
    });
    expect(filed.status).toBe(200);
    await syncFiledFiles(a, dbms.id, dbms.r2Prefix, filed.json.files);
    const prefix = dbms.r2Prefix;
    const keys = (await env.container.admin.listUnits(dbms.id)).flatMap((u: any) =>
      u.files.map((f: any) => f.name),
    );
    expect(keys).toEqual(
      expect.arrayContaining(['Unit 6 notes.pdf', 'Extra / one.pdf', 'Extra / two.pdf', 'Extra / notes.txt']),
    );
    expect(env.db.courses.get(dbms.id)!.status).toBe('live');
    expect((await item()).pipeline.filed).toMatchObject({
      courseTitle: dbms.title,
      folder: 'Unit 6 - Recovery/',
    });
    expect((await item()).pipeline.filed.files.every((f: any) => f.status === 'ready')).toBe(true);
    expect((await item()).pipeline.step).toBe('reward');
    const current = await item();
    const contribution = env.db.contributions.get(id)!;
    expect(
      stepOf(
        contribution,
        current.pipeline.filed.files.map((file: any) => ({ ...file, status: 'queued' as const })),
      ),
    ).toBe('pages');

    // Filing again doesn't overwrite or duplicate.
    const again = await a.call('POST', `/admin/contributions/${id}/file`, {
      courseId: dbms.id,
      unit: 'Unit 6 - Recovery',
      dryRun: true,
    });
    expect(again.json.files.filter((f: any) => f.status === 'exists')).toHaveLength(4);

    // 4. Reward: 50% royalty on the course it was filed into, after the queued pages are ready.
    await a.call('POST', `/admin/contributions/${id}/review`, {
      decision: 'approved',
      note: '',
      reward: { type: 'royalty', courseId: dbms.id, sharePercent: 50 },
      notify: true,
    });
    // 5. Once every file is readable and rewarded, it moves on to finish.
    for (const f of env.db.files.values())
      if (f.sourceKey.startsWith(`${prefix}Unit 6 - Recovery/`))
        env.db.files.set(f.id, { ...f, conversionStatus: 'ready', pageCount: 4 });
    const ready = await item();
    expect(ready.pipeline.step).toBe('finish');
    expect(ready.pipeline.filed.files.every((f: any) => f.status === 'ready')).toBe(true);

    // The student sees it live.
    const mine = (await s.call('GET', '/contributions/me')).json.mine[0];
    expect(mine.progress).toEqual({ step: 'live', courseTitle: dbms.title, courseSlug: dbms.slug });

    // 6. Done, with one "your notes are live" email.
    const done = await a.call('POST', `/admin/contributions/${id}/complete`, { done: true, notify: true });
    expect(done.json.pipeline.step).toBe('done');
    const live = env.db.outbox.filter((m) => m.subject === `Your notes are live in ${dbms.title}`);
    expect(live).toHaveLength(1);
    expect(live[0]!.text).toContain('16 pages');

    // Contributor tracking.
    const stats = (await a.call('GET', '/admin/contributors')).json;
    expect(stats[0]).toMatchObject({
      email: 'maker.23bce10050@vitbhopal.ac.in',
      uploads: 1,
      accepted: 1,
      filesLive: 4,
      pagesLive: 16,
      royaltyCourses: 1,
    });
  });

  it('each file can go to its own unit, be renamed, or be left out', async () => {
    const { app, env } = setup();
    const dbms = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    const s = new Browser(app);
    await s.signIn('sorter.23bce10052@vitbhopal.ac.in');
    const sent = await upload(app, s, [
      [
        'mix.zip',
        zip([
          ['a.pdf', pdf(2)],
          ['x/one.pdf', pdf(1)],
          ['x/two.pdf', pdf(1)],
        ]),
      ],
    ]);
    const a = new Browser(app);
    await a.signIn('admin@vitbhopal.ac.in');
    await a.call('POST', `/admin/contributions/${sent.id}/review`, {
      decision: 'approved',
      note: '',
      reward: { type: 'none' },
      notify: false,
    });
    const body = {
      courseId: dbms.id,
      unit: 'Unit 7 - Extras',
      files: [
        { from: 'mix.zip › a.pdf', name: 'Summary sheet' },
        { from: 'mix.zip › x/one.pdf', unit: 'Unit 2 - SQL and relational algebra' },
        { from: 'mix.zip › x/two.pdf', skip: true },
      ],
    };
    const plan = (await a.call('POST', `/admin/contributions/${sent.id}/file`, { ...body, dryRun: true }))
      .json;
    expect(plan.files).toEqual([
      { from: 'mix.zip › a.pdf', to: 'Unit 7 - Extras/Summary sheet.pdf', status: 'new' },
      { from: 'mix.zip › x/one.pdf', to: 'Unit 2 - SQL and relational algebra/x/one.pdf', status: 'new' },
      {
        from: 'mix.zip › x/two.pdf',
        to: 'Unit 7 - Extras/x/two.pdf',
        status: 'skipped',
        reason: 'left out by you',
        leftOut: true,
      },
    ]);
    const done = (await a.call('POST', `/admin/contributions/${sent.id}/file`, { ...body, dryRun: false }))
      .json;
    await syncFiledFiles(a, dbms.id, dbms.r2Prefix, done.files);
    const names = (await env.container.admin.listUnits(dbms.id)).flatMap((u: any) =>
      u.files.map((f: any) => `${u.title}|${f.name}`),
    );
    expect(names).toEqual(
      expect.arrayContaining(['Extras|Summary sheet.pdf', 'SQL and relational algebra|x / one.pdf']),
    );
    expect(names.some((n: string) => n.endsWith('|two.pdf'))).toBe(false);
  });

  it('replaces an existing course file only after the admin chooses Replace', async () => {
    const { app, env } = setup();
    const course = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    const student = new Browser(app);
    const admin = new Browser(app);
    await student.signIn('replace.23bce10054@vitbhopal.ac.in');
    await admin.signIn('admin@vitbhopal.ac.in');

    const addAndApprove = async (bytes: Uint8Array) => {
      const sent = await upload(app, student, [['reference.pdf', bytes]]);
      await admin.call('POST', `/admin/contributions/${sent.id}/review`, {
        decision: 'approved',
        note: '',
        reward: { type: 'none' },
        notify: false,
      });
      return sent.id as string;
    };
    const firstId = await addAndApprove(pdf(2));
    const first = await admin.call('POST', `/admin/contributions/${firstId}/file`, {
      courseId: course.id,
      unit: 'Replacement test',
      dryRun: false,
    });
    await syncFiledFiles(admin, course.id, course.r2Prefix, first.json.files);

    const secondId = await addAndApprove(pdf(3));
    const from = 'reference.pdf';
    const input = {
      courseId: course.id,
      unit: 'Replacement test',
      files: [{ from, replace: true }],
    };
    const preview = await admin.call('POST', `/admin/contributions/${secondId}/file`, {
      ...input,
      dryRun: true,
    });
    expect(preview.json.files).toEqual([
      {
        from,
        to: 'Replacement test/reference.pdf',
        status: 'replace',
        reason: 'will replace the existing file',
      },
    ]);
    const result = await admin.call('POST', `/admin/contributions/${secondId}/file`, {
      ...input,
      dryRun: false,
    });
    await syncFiledFiles(admin, course.id, course.r2Prefix, result.json.files);
    const saved = await env.sources.get(`${course.r2Prefix}Replacement test/reference.pdf`);
    expect(new TextDecoder().decode(saved!.body as Uint8Array)).toContain('/Count 3');
  });

  it('a whole-subject ZIP keeps its own units: syllabus, units and PYQs land as course units', async () => {
    const { app, env } = setup();
    const os = [...env.db.courses.values()].find((c) => c.slug === 'os-2025-cse-core')!;
    const s = new Browser(app);
    await s.signIn('whole.23bce10053@vitbhopal.ac.in');
    const sent = await upload(app, s, [
      [
        'Operating Systems (CSE3003).zip',
        zip([
          ['Operating Systems (CSE3003)/Syllabus/syllabus.pdf', pdf(2)],
          ['Operating Systems (CSE3003)/Unit 1 - Basics/u1.pdf', pdf(3)],
          ['Operating Systems (CSE3003)/Unit 2 - Scheduling/u2.pdf', pdf(4)],
          ['Operating Systems (CSE3003)/PYQs/2024.pdf', pdf(1)],
          ['Operating Systems (CSE3003)/cover.pdf', pdf(1)],
        ]),
      ],
    ]);
    const a = new Browser(app);
    await a.signIn('admin@vitbhopal.ac.in');
    await a.call('POST', `/admin/contributions/${sent.id}/review`, {
      decision: 'approved',
      note: '',
      reward: { type: 'royalty', courseId: os.id, sharePercent: 30 },
      notify: false,
    });
    // No unit needed: the ZIP's own folders are the units; a loose file goes to "Notes".
    const plan = (
      await a.call('POST', `/admin/contributions/${sent.id}/file`, {
        courseId: os.id,
        unit: '',
        dryRun: true,
      })
    ).json;
    expect(plan.wholeSubject).toBe(true);
    expect(plan.folder).toBe('');
    expect(plan.files.map((f: any) => f.to)).toEqual([
      'Syllabus/syllabus.pdf',
      'Unit 1 - Basics/u1.pdf',
      'Unit 2 - Scheduling/u2.pdf',
      'PYQs/2024.pdf',
      'Notes/cover.pdf',
    ]);
    const done = await a.call('POST', `/admin/contributions/${sent.id}/file`, {
      courseId: os.id,
      unit: '',
      dryRun: false,
    });
    expect(done.status).toBe(200);
    await syncFiledFiles(a, os.id, os.r2Prefix, done.json.files);
    const units = (await env.container.admin.listUnits(os.id)).map((u: any) => u.title);
    expect(units).toEqual(expect.arrayContaining(['Basics', 'Scheduling']));
    for (const key of plan.files.map((f: any) => `${os.r2Prefix}${f.to}`))
      expect([...env.db.files.values()].some((f) => f.sourceKey === key)).toBe(true);
    // A single file still needs a unit.
    const single = await upload(app, s, [['one.pdf', pdf(2)]]);
    await a.call('POST', `/admin/contributions/${single.id}/review`, {
      decision: 'approved',
      note: '',
      reward: { type: 'none' },
      notify: false,
    });
    expect(
      (
        await a.call('POST', `/admin/contributions/${single.id}/file`, {
          courseId: os.id,
          unit: '',
          dryRun: true,
        })
      ).status,
    ).toBe(400);
  });

  it('an older upload can be checked on demand', async () => {
    const { app, env } = setup();
    const s = new Browser(app);
    await s.signIn('old.23bce10051@vitbhopal.ac.in');
    const sent = await upload(app, s, [['old.pdf', pdf(2)]]);
    const row = env.db.contributions.get(sent.id)!;
    env.db.contributions.set(sent.id, { ...row, files: row.files.map(({ check: _c, ...f }) => f) });
    const a = new Browser(app);
    await a.signIn('admin@vitbhopal.ac.in');
    const checked = await a.call('POST', `/admin/contributions/${sent.id}/check`);
    expect(checked.json.files[0].check.label).toBe('PDF · about 2 pages');
  });
});
