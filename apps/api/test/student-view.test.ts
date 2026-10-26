import { describe, expect, it } from 'vitest';
import { Browser, setup } from './harness';

describe('what students see', () => {
  it('a file whose pages are not made yet is never listed for students', async () => {
    const { app, env } = setup();
    const dbms = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    const file = [...env.db.files.values()].find((f) => f.courseId === dbms.id)!;
    env.db.files.set(file.id, { ...file, conversionStatus: 'pending', pageCount: 0 });
    const ids = (body: any) => body.units.flatMap((u: any) => u.files.map((f: any) => f.id));

    const student = new Browser(app);
    await student.signIn('viewer.23bce10010@vitbhopal.ac.in');
    expect(ids((await student.call('GET', `/courses/${dbms.slug}`)).json)).not.toContain(file.id);
    expect(ids((await new Browser(app).call('GET', `/courses/${dbms.slug}`)).json)).not.toContain(file.id);
  });

  it('admins can look at a draft course or bundle before publishing; students cannot', async () => {
    const { app, env } = setup();
    const dbms = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    env.db.courses.set(dbms.id, { ...dbms, status: 'draft' });
    const bundle = [...env.db.bundles.values()][0]!;
    env.db.bundles.set(bundle.id, { ...bundle, status: 'draft' });
    const admin = new Browser(app);
    await admin.signIn('admin@vitbhopal.ac.in');
    const student = new Browser(app);
    await student.signIn('peek.23bce10012@vitbhopal.ac.in');
    expect((await admin.call('GET', `/courses/${dbms.slug}`)).json.preview).toBe(true);
    expect((await student.call('GET', `/courses/${dbms.slug}`)).status).toBe(404);
    const b = await admin.call('GET', `/bundles/${bundle.slug}`);
    expect(b.status).toBe(200);
    expect(b.json.preview).toBe(true);
    expect((await student.call('GET', `/bundles/${bundle.slug}`)).status).toBe(404);
    // Live ones carry no preview flag.
    const os = [...env.db.courses.values()].find((c) => c.slug === 'os-2025-cse-core')!;
    expect((await admin.call('GET', `/courses/${os.slug}`)).json.preview).toBeUndefined();
  });

  it('an oversized upload is cut off while reading, even without a declared length', async () => {
    const { app } = setup();
    const s = new Browser(app);
    await s.signIn('big.23bce10013@vitbhopal.ac.in');
    const form = new FormData();
    form.set('meta', JSON.stringify({ topic: 'help', subject: 'Big file', body: 'Here it is.' }));
    form.append('files', new File([new Uint8Array(70 * 1024 * 1024) as BlobPart], 'huge.png'));
    const res = await app.request('/api/support', {
      method: 'POST',
      body: form,
      headers: { authorization: `Bearer ${s.token}`, cookie: s.cookie },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.message).toMatch(/under \d+ MB/);
  });

  it('unexpected server errors never reach the student', async () => {
    const { app, env } = setup();
    const s = new Browser(app);
    await s.signIn('crash.23bce10011@vitbhopal.ac.in');
    (env.container.catalogue as any).course = async () => {
      throw new Error('relation "public.courses" does not exist at pg 42P01');
    };
    const r = await s.call('GET', '/courses/dbms-2025-cse-core');
    expect(r.status).toBe(500);
    expect(r.json.error.message).toBe('Something went wrong on our side.');
    expect(JSON.stringify(r.json)).not.toMatch(/relation|public\.|42P01|stack/);
  });
});
