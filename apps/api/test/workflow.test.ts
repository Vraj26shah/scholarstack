import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_SECRETS } from '../src/composition/memory';
import { Browser, setup } from './harness';

describe('admin workflow', () => {
  let env: ReturnType<typeof setup>['env'];
  let app: ReturnType<typeof setup>['app'];
  let admin: Browser;

  beforeEach(async () => {
    ({ env, app } = setup());
    admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
  });

  const dbms = () => [...env.db.courses.values()].find((course) => course.slug === 'dbms-2025-cse-core')!;
  const filesOf = (courseId: string) =>
    [...env.db.files.values()].filter((file) => file.courseId === courseId);

  it('is admin only', async () => {
    const student = new Browser(app);
    await student.signIn('student@vitbhopal.ac.in');
    expect((await student.call('GET', '/admin/overview')).status).toBe(403);
    expect((await student.call('POST', '/admin/storage-compare', { scopes: [''] })).status).toBe(403);
    expect((await student.call('POST', '/admin/conversions/query', { scopes: [''] })).status).toBe(403);
    expect((await student.call('POST', '/admin/convert', { courseId: dbms().id })).status).toBe(403);
  });

  it('counts courses and files for the step chips', async () => {
    const course = dbms();
    const [failed, waiting] = filesOf(course.id);
    failed!.conversionStatus = 'failed';
    waiting!.conversionStatus = 'pending';
    waiting!.conversionStage = null;
    const res = await admin.call('GET', '/admin/overview');
    expect(res.status).toBe(200);
    expect(res.json.courses.total).toBe(env.db.courses.size);
    expect(res.json.files.failed).toBeGreaterThanOrEqual(1);
    expect(res.json.files.waiting).toBeGreaterThanOrEqual(1);
    expect(res.json.files.total).toBe(env.db.files.size);
  });

  it('compares R2 with Supabase without changing anything (R2 is the source of truth)', async () => {
    const course = dbms();
    const [changed, removed] = filesOf(course.id);
    const before = JSON.stringify([...env.db.files.values()]);
    env.sources.put(
      `${course.r2Prefix}Unit 9 - New/brand-new.pdf`,
      new TextEncoder().encode('%PDF-1.7 new'),
      'application/pdf',
      'e-new',
    );
    env.sources.put(
      changed!.sourceKey,
      new TextEncoder().encode('%PDF-1.7 edited'),
      'application/pdf',
      'e-edit',
    );
    await env.sources.delete(removed!.sourceKey);

    const res = await admin.call('POST', '/admin/storage-compare', { scopes: [''] });
    expect(res.status).toBe(200);
    const row = res.json.courses.find((c: { courseId: string }) => c.courseId === course.id);
    expect(row.newInR2).toEqual([`${course.r2Prefix}Unit 9 - New/brand-new.pdf`]);
    expect(row.changedInR2).toEqual([changed!.sourceKey]);
    expect(row.missingFromR2).toEqual([removed!.sourceKey]);
    expect(res.json.totals.inSync).toBe(res.json.totals.courses - 1);
    expect(JSON.stringify([...env.db.files.values()])).toBe(before);
  });

  it('makes pages for exactly one unit and leaves the rest of the course alone', async () => {
    const course = dbms();
    const files = filesOf(course.id);
    const unitKey = files[0]!.unitKey;
    for (const file of files) {
      file.conversionStatus = 'failed';
      file.conversionError = 'earlier failure';
      file.pageCount = 0;
    }
    const inUnit = new Set(
      files.filter((file) => file.unitKey === unitKey && !file.hidden && !file.unitHidden).map((f) => f.id),
    );

    const res = await admin.call('POST', '/admin/convert', {
      courseId: course.id,
      unitKey,
      include: 'failed',
    });
    expect(res.status).toBe(200);
    expect(res.json.queued).toBe(inUnit.size);
    for (const file of filesOf(course.id)) {
      expect(file.conversionStatus).toBe(inUnit.has(file.id) ? 'ready' : 'failed');
    }

    const board = await admin.call('POST', '/admin/conversions/query', { scopes: [course.r2Prefix] });
    expect(board.status).toBe(200);
    expect(board.json.totals.ready).toBe(inUnit.size);
    expect(board.json.files[0].state).toBe('failed');
  });

  it('pauses a job so it is skipped, then resumes it so it converts', async () => {
    const course = dbms();
    const file = filesOf(course.id).find((item) => !item.hidden && !item.unitHidden)!;
    file.conversionStatus = 'pending';

    const paused = await admin.call('POST', '/admin/conversions/pause', { fileIds: [file.id] });
    expect(paused.status).toBe(200);
    expect(paused.json.paused).toBe(1);
    expect(env.db.files.get(file.id)?.conversionHeld).toBe(true);

    const board1 = await admin.call('POST', '/admin/conversions/query', { scopes: [course.r2Prefix] });
    expect(board1.json.files.find((f: { fileId: string }) => f.fileId === file.id).state).toBe('paused');

    const skipped = await admin.call('POST', '/admin/convert', { courseId: course.id, fileIds: [file.id] });
    expect(skipped.json.queued).toBe(0);
    expect(skipped.json.skipped[0]).toMatch(/paused/);
    expect(env.db.files.get(file.id)?.conversionStatus).toBe('pending');

    const resumed = await admin.call('POST', '/admin/conversions/resume', { fileIds: [file.id] });
    expect(resumed.status).toBe(200);
    expect(resumed.json.queued).toBe(1);
    expect(env.db.files.get(file.id)?.conversionHeld).toBe(false);
    expect(env.db.files.get(file.id)?.conversionStatus).toBe('ready');
  });

  it('lets the converter claim only the current unpaused queue version', async () => {
    const course = dbms();
    const file = filesOf(course.id).find((item) => !item.hidden && !item.unitHidden)!;
    const queueId = 'a3cdfa30-d5f2-42b3-a381-8f5df0d95c94';
    file.conversionStatus = 'pending';
    file.conversionQueueId = queueId;

    const claim = (id: string) =>
      admin.call(
        'POST',
        '/internal/conversion-claim',
        { fileId: file.id, queueId: id },
        { 'x-ss-converter': DEMO_SECRETS.converter },
      );
    expect((await claim(queueId)).json.current).toBe(true);
    expect((await claim('b3cdfa30-d5f2-42b3-a381-8f5df0d95c94')).json.current).toBe(false);

    await admin.call('POST', '/admin/conversions/pause', { fileIds: [file.id] });
    expect((await claim(queueId)).json.current).toBe(false);
  });

  it('never lets hidden reference material be claimed for conversion', async () => {
    const course = dbms();
    const file = filesOf(course.id).find((item) => !item.hidden && !item.unitHidden)!;
    file.conversionStatus = 'pending';
    file.conversionQueueId = 'a3cdfa30-d5f2-42b3-a381-8f5df0d95c94';
    env.db.units.get(`${file.courseId}|${file.unitKey}`)!.hidden = true;

    const claim = await admin.call(
      'POST',
      '/internal/conversion-claim',
      { fileId: file.id, queueId: file.conversionQueueId },
      { 'x-ss-converter': DEMO_SECRETS.converter },
    );

    expect(claim.json.current).toBe(false);
  });

  it('cancels a stuck job back to needs-pages', async () => {
    const course = dbms();
    const file = filesOf(course.id).find((item) => !item.hidden && !item.unitHidden)!;
    file.conversionStatus = 'failed';
    file.conversionError = 'earlier failure';
    file.pageCount = 3;

    const res = await admin.call('POST', '/admin/conversions/cancel', { fileIds: [file.id] });
    expect(res.status).toBe(200);
    expect(res.json.cancelled).toBe(1);
    const after = env.db.files.get(file.id)!;
    expect(after.conversionStatus).toBe('pending');
    expect(after.conversionHeld).toBe(false);
    expect(after.pageCount).toBe(0);

    const board = await admin.call('POST', '/admin/conversions/query', { scopes: [course.r2Prefix] });
    expect(board.json.files.find((f: { fileId: string }) => f.fileId === file.id).state).toBe('waiting');
  });

  it('refuses to convert a file whose R2 copy changed until Supabase is updated', async () => {
    const course = dbms();
    const file = filesOf(course.id).find((item) => !item.hidden && !item.unitHidden)!;
    file.conversionStatus = 'failed';
    env.sources.put(file.sourceKey, new TextEncoder().encode('%PDF-1.7 edited'), 'application/pdf', 'e-edit');
    const res = await admin.call('POST', '/admin/convert', { courseId: course.id, fileIds: [file.id] });
    expect(res.status).toBe(200);
    expect(res.json.queued).toBe(0);
    expect(res.json.skipped[0]).toMatch(/changed in R2/);
    expect(env.db.files.get(file.id)?.conversionStatus).toBe('failed');
  });

  it('says why chosen files were skipped', async () => {
    const course = dbms();
    const ready = filesOf(course.id).find(
      (item) => !item.hidden && !item.unitHidden && item.conversionStatus === 'ready',
    )!;
    const res = await admin.call('POST', '/admin/convert', { courseId: course.id, fileIds: [ready.id] });
    expect(res.json).toEqual({ queued: 0, skipped: [`${ready.name}: pages are already complete.`] });
  });

  describe('free-form R2 selection', () => {
    const edit = (key: string) =>
      env.sources.put(key, new TextEncoder().encode('%PDF-1.7 edited'), 'application/pdf', `e-${key.length}`);

    it('compares only the chosen folder', async () => {
      const course = dbms();
      const files = filesOf(course.id);
      const first = files[0]!;
      const folder = `${course.r2Prefix}${first.sourceKey.slice(course.r2Prefix.length).split('/')[0]}/`;
      const outside = files.find((file) => !file.sourceKey.startsWith(folder))!;
      edit(first.sourceKey);
      edit(outside.sourceKey);
      const res = await admin.call('POST', '/admin/storage-compare', { scopes: [folder] });
      expect(res.status).toBe(200);
      expect(res.json.courses).toHaveLength(1);
      expect(res.json.courses[0].changedInR2).toEqual([first.sourceKey]);
      expect(res.json.scopes).toEqual([folder]);
    });

    it('compares exactly one file', async () => {
      const course = dbms();
      const [one, two] = filesOf(course.id);
      edit(one!.sourceKey);
      edit(two!.sourceKey);
      const res = await admin.call('POST', '/admin/storage-compare', { scopes: [one!.sourceKey] });
      expect(res.json.courses[0].changedInR2).toEqual([one!.sourceKey]);
      expect(res.json.courses[0].supabaseFiles).toBe(1);
    });

    it('whole bucket covers every course and lists files that belong to no course', async () => {
      const res = await admin.call('POST', '/admin/storage-compare', { scopes: [''] });
      expect(res.status).toBe(200);
      expect(res.json.courses.length).toBe(
        [...env.db.courses.values()].filter((c) => c.status !== 'archived').length,
      );
      expect(res.json.unassigned.count).toBeGreaterThan(0);
    });

    it('refuses selections outside the import root', async () => {
      for (const scopes of [['pages/'], ['drive-imports/../secret/'], ['other/file.pdf']]) {
        expect((await admin.call('POST', '/admin/storage-compare', { scopes })).status).toBe(400);
      }
    });

    it('makes pages for one chosen file and shows only that file on the board', async () => {
      const course = dbms();
      const target = filesOf(course.id).find((file) => !file.hidden && !file.unitHidden)!;
      const other = filesOf(course.id).find(
        (file) => file.id !== target.id && !file.hidden && !file.unitHidden,
      )!;
      target.conversionStatus = 'failed';
      other.conversionStatus = 'failed';
      const res = await admin.call('POST', '/admin/convert-selection', {
        scopes: [target.sourceKey],
        include: 'failed',
      });
      expect(res.json.queued).toBe(1);
      expect(env.db.files.get(target.id)?.conversionStatus).toBe('ready');
      expect(env.db.files.get(other.id)?.conversionStatus).toBe('failed');
      const board = await admin.call('POST', '/admin/conversions/query', { scopes: [target.sourceKey] });
      expect(board.json.files.map((row: { fileId: string }) => row.fileId)).toEqual([target.id]);
    });

    it('says to import first when the selection has no course', async () => {
      const res = await admin.call('POST', '/admin/convert-selection', {
        scopes: ['drive-imports/not-a-course/'],
      });
      expect(res.json).toEqual({
        queued: 0,
        skipped: ['Nothing in this selection belongs to a course yet. Import it first.'],
      });
    });
  });
});
