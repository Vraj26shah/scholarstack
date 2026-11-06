import { describe, expect, it } from 'vitest';
import { Browser, setup } from './harness';

type App = ReturnType<typeof setup>['app'];
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 10, 1, 2, 3]);

async function admin(app: App) {
  const a = new Browser(app);
  await a.signIn('admin@vitbhopal.ac.in');
  return a;
}
async function upload(app: App, b: Browser, meta: unknown, files: [string, Uint8Array][]) {
  const form = new FormData();
  form.set('meta', JSON.stringify(meta));
  for (const [name, bytes] of files) form.append('files', new File([bytes as BlobPart], name));
  const res = await app.request('/api/admin/storage-tree/upload', {
    method: 'POST',
    body: form,
    headers: { authorization: `Bearer ${b.token}`, cookie: b.cookie },
  });
  return { status: res.status, json: (await res.json()) as any };
}

describe('folder explorer', () => {
  it('makes a folder, and files uploaded into a course folder show on the course at once', async () => {
    const { app, env } = setup();
    const a = await admin(app);
    const dbms = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    const made = await a.call('POST', '/admin/storage-tree/folder', {
      parent: dbms.r2Prefix,
      name: 'Unit 6 - Recovery',
    });
    expect(made.status).toBe(201);
    expect(made.json.path).toBe(`${dbms.r2Prefix}Unit 6 - Recovery/`);
    expect(
      (
        await a.call('POST', '/admin/storage-tree/folder', {
          parent: dbms.r2Prefix,
          name: 'Unit 6 - Recovery',
        })
      ).status,
    ).toBe(400);
    // The empty folder is there (and never counted as unused).
    const tree = (await a.call('GET', '/admin/storage-tree')).json;
    expect(tree.entries.find((e: any) => e.key === made.json.path).state).toBe('used');

    const up = await upload(app, a, { folder: made.json.path }, [['recovery notes.pdf', PDF]]);
    expect(up.status).toBe(201);
    expect(up.json).toMatchObject({ courseId: dbms.id, keys: [`${made.json.path}recovery notes.pdf`] });
    expect(up.json.queued).toBe(1);
    const units = (await a.call('GET', `/admin/courses/${dbms.id}/units`)).json;
    expect(units.some((u: any) => u.files.some((f: any) => f.name === 'recovery notes.pdf'))).toBe(true);

    // Same name again is refused unless replacing.
    expect((await upload(app, a, { folder: made.json.path }, [['recovery notes.pdf', PDF]])).status).toBe(
      400,
    );
    expect(
      (await upload(app, a, { folder: made.json.path, replace: true }, [['recovery notes.pdf', PDF]])).status,
    ).toBe(201);
  });

  it('refuses the wrong file types, fake files and folders outside the notes area', async () => {
    const { app } = setup();
    const a = await admin(app);
    expect((await upload(app, a, { folder: 'drive-imports/New/' }, [['x.exe', PDF]])).status).toBe(400);
    expect(
      (await upload(app, a, { folder: 'drive-imports/New/' }, [['fake.pdf', new Uint8Array([1, 2, 3])]]))
        .status,
    ).toBe(400);
    expect((await upload(app, a, { folder: 'pages/' }, [['a.pdf', PDF]])).status).toBe(400);
    expect((await upload(app, a, { folder: 'drive-imports/../x/' }, [['a.pdf', PDF]])).status).toBe(400);
    expect(
      (await a.call('POST', '/admin/storage-tree/folder', { parent: 'contributions/', name: 'x' })).status,
    ).toBe(400);
    // A folder that is not a course just stores the file (it shows as "not on the site").
    const r = await upload(app, a, { folder: 'drive-imports/27 Batch/New subject/' }, [['intro.pdf', PDF]]);
    expect(r.status).toBe(201);
    expect(r.json.courseId).toBeNull();
  });

  it('students cannot touch storage', async () => {
    const { app } = setup();
    const s = new Browser(app);
    await s.signIn('student@vitbhopal.ac.in');
    expect((await upload(app, s, { folder: 'drive-imports/x/' }, [['a.pdf', PDF]])).status).toBe(403);
  });

  it('a file uploaded into a live course keeps it on sale', async () => {
    const { app, env } = setup();
    const a = await admin(app);
    const dsa = [...env.db.courses.values()].find((c) => c.slug === 'dsa-2025-cse-core')!;
    expect(dsa.status).toBe('live');
    const r = await upload(app, a, { folder: `${dsa.r2Prefix}Unit 8 - New/` }, [['extra.pdf', PDF]]);
    expect(r.status).toBe(201);
    expect(r.json.queued).toBe(1);
    expect(env.db.courses.get(dsa.id)!.status).toBe('live');
  });
});
