import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { inspectFile, pdfFacts } from '../src/application/contributions/inspect';
import { listZip, unzipEntry } from '../src/application/contributions/zip';
import { Browser, setup } from './harness';

const enc = new TextEncoder();
const pdf = (pages: number, extra = '') =>
  enc.encode(
    `%PDF-1.4\n${Array.from({ length: pages }, (_, i) => `${i + 3} 0 obj << /Type /Page >> endobj`).join('\n')}\n2 0 obj << /Type /Pages /Count ${pages} >> endobj\n${extra}%%EOF`,
  );

/** A real (deflated) zip, written the way every zip tool does. */
function zip(files: [string, Uint8Array][]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const n = enc.encode(name);
    const body = deflateRawSync(data);
    const local = new Uint8Array(30 + n.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(8, 8, true);
    v.setUint32(18, body.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, n.length, true);
    local.set(n, 30);
    const dir = new Uint8Array(46 + n.length);
    const d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(10, 8, true);
    d.setUint32(20, body.length, true);
    d.setUint32(24, data.length, true);
    d.setUint16(28, n.length, true);
    d.setUint32(42, offset, true);
    dir.set(n, 46);
    chunks.push(local, body);
    central.push(dir);
    offset += local.length + body.length;
  }
  const dirSize = central.reduce((t, c) => t + c.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, dirSize, true);
  e.setUint32(16, offset, true);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((t, c) => t + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

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
    expect(check.label).toBe('ZIP · 4 files, 2 usable');
    expect(check.entries!.find((x) => x.path.endsWith('readme.txt'))).toMatchObject({ ok: false });
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
  for (const [name, bytes] of files) form.append('files', new File([bytes as BlobPart], name));
  const res = await app.request('/api/contributions', {
    method: 'POST',
    body: form,
    headers: { authorization: `Bearer ${b.token}`, cookie: b.cookie },
  });
  return (await res.json()) as any;
}

describe('upload → check → decide → file → reward → pages → done', () => {
  it('takes one upload all the way, keeps the live course on sale, and tracks the contributor', async () => {
    const { app, env } = setup();
    const dbms = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    expect(dbms.status).toBe('live');
    const s = new Browser(app);
    await s.signIn('maker.23bce10050@vitbhopal.ac.in');
    const sent = await upload(app, s, [
      ['Unit 6 notes.pdf', pdf(5)],
      [
        'extra.zip',
        zip([
          ['Extra/one.pdf', pdf(2)],
          ['Extra/two.pdf', pdf(3)],
          ['Extra/notes.txt', enc.encode('x')],
        ]),
      ],
    ]);
    // 1. Checked on upload.
    expect(sent.files.map((f: any) => f.check.label)).toEqual([
      'PDF · about 5 pages',
      'ZIP · 3 files, 2 usable',
    ]);
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
      { from: 'Unit 6 notes.pdf', to: 'Unit 6 - Recovery/Unit 6 notes.pdf', status: 'new' },
      { from: 'extra.zip › Extra/one.pdf', to: 'Unit 6 - Recovery/one.pdf', status: 'new' },
      { from: 'extra.zip › Extra/two.pdf', to: 'Unit 6 - Recovery/two.pdf', status: 'new' },
      expect.objectContaining({ from: 'extra.zip › Extra/notes.txt', status: 'skipped' }),
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
    expect(filed.json.queued).toBe(3);
    const prefix = dbms.r2Prefix;
    const keys = (await env.container.admin.listUnits(dbms.id)).flatMap((u: any) =>
      u.files.map((f: any) => f.name),
    );
    expect(keys).toEqual(expect.arrayContaining(['Unit 6 notes.pdf', 'one.pdf', 'two.pdf']));
    expect(env.db.courses.get(dbms.id)!.status).toBe('live');
    expect((await item()).pipeline.filed).toMatchObject({
      courseTitle: dbms.title,
      folder: 'Unit 6 - Recovery/',
    });
    expect((await item()).pipeline.step).toBe('reward');

    // Filing again doesn't overwrite or duplicate.
    const again = await a.call('POST', `/admin/contributions/${id}/file`, {
      courseId: dbms.id,
      unit: 'Unit 6 - Recovery',
      dryRun: true,
    });
    expect(again.json.files.filter((f: any) => f.status === 'exists')).toHaveLength(3);

    // 4. Reward: 50% royalty on the course it was filed into.
    await a.call('POST', `/admin/contributions/${id}/review`, {
      decision: 'approved',
      note: '',
      reward: { type: 'royalty', courseId: dbms.id, sharePercent: 50 },
      notify: true,
    });
    // 5. Pages: once every file is readable, it's ready to finish.
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
    expect(live[0]!.text).toContain('12 pages');

    // Contributor tracking.
    const stats = (await a.call('GET', '/admin/contributors')).json;
    expect(stats[0]).toMatchObject({
      email: 'maker.23bce10050@vitbhopal.ac.in',
      uploads: 1,
      accepted: 1,
      filesLive: 3,
      pagesLive: 12,
      royaltyCourses: 1,
    });
  });

  it('each file can go to its own unit, be renamed, or be left out', async () => {
    const { app, env } = setup();
    const dbms = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    const s = new Browser(app);
    await s.signIn('sorter.23bce10052@vitbhopal.ac.in');
    const sent = await upload(app, s, [
      ['a.pdf', pdf(2)],
      [
        'mix.zip',
        zip([
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
        { from: 'a.pdf', name: 'Summary sheet' },
        { from: 'mix.zip › x/one.pdf', unit: 'Unit 2 - SQL and relational algebra' },
        { from: 'mix.zip › x/two.pdf', skip: true },
      ],
    };
    const plan = (await a.call('POST', `/admin/contributions/${sent.id}/file`, { ...body, dryRun: true }))
      .json;
    expect(plan.files).toEqual([
      { from: 'a.pdf', to: 'Unit 7 - Extras/Summary sheet.pdf', status: 'new' },
      { from: 'mix.zip › x/one.pdf', to: 'Unit 2 - SQL and relational algebra/one.pdf', status: 'new' },
      {
        from: 'mix.zip › x/two.pdf',
        to: 'Unit 7 - Extras/two.pdf',
        status: 'skipped',
        reason: 'left out by you',
        leftOut: true,
      },
    ]);
    const done = (await a.call('POST', `/admin/contributions/${sent.id}/file`, { ...body, dryRun: false }))
      .json;
    expect(done.queued).toBe(2);
    const names = (await env.container.admin.listUnits(dbms.id)).flatMap((u: any) =>
      u.files.map((f: any) => `${u.title}|${f.name}`),
    );
    expect(names).toEqual(
      expect.arrayContaining(['Extras|Summary sheet.pdf', 'SQL and relational algebra|one.pdf']),
    );
    expect(names.some((n: string) => n.endsWith('|two.pdf'))).toBe(false);
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
