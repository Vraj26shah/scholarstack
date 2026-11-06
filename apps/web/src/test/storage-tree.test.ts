import { describe, expect, it } from 'vitest';
import { buildTree } from '../features/admin/storage-tree';

const data = {
  scannedAt: '',
  courses: [{ id: 'c1', title: 'DBMS', status: 'live', r2Prefix: 'drive-imports/23 Batch/DBMS/' }],
  totals: { objects: 3, bytes: 60, pageBytes: 5, unused: 1, missing: 1 },
  entries: [
    {
      key: 'drive-imports/23 Batch/DBMS/Unit 10/b.pdf',
      size: 10,
      state: 'used',
      fileId: 'f1',
      courseId: 'c1',
      pageObjects: 1,
      pageBytes: 5,
    },
    {
      key: 'drive-imports/23 Batch/DBMS/Unit 2/a.pdf',
      size: 20,
      state: 'unused',
      fileId: null,
      courseId: null,
      pageObjects: 0,
      pageBytes: 0,
    },
    {
      key: 'drive-imports/23 Batch/DBMS/Unit 2/gone.pdf',
      size: 0,
      state: 'missing',
      fileId: 'f2',
      courseId: 'c1',
      pageObjects: 0,
      pageBytes: 0,
    },
    {
      key: 'drive-imports/23 Batch/loose.pdf',
      size: 30,
      state: 'unused',
      fileId: null,
      courseId: null,
      pageObjects: 0,
      pageBytes: 0,
    },
  ],
} as const;

describe('storage tree', () => {
  it('nests folders, rolls up sizes and counts, and marks course folders', () => {
    const root = buildTree(data as never);
    const batch = root.children[0]!.children[0]!;
    expect(batch.path).toBe('drive-imports/23 Batch/');
    expect(batch.files).toBe(4);
    expect(batch.bytes).toBe(60);
    expect(batch.pageBytes).toBe(5);
    expect(batch.unused).toBe(2);
    expect(batch.missing).toBe(1);
    const dbms = batch.children.find((c) => c.name === 'DBMS')!;
    expect(dbms.course?.title).toBe('DBMS');
    // folders first, then files; numbers in natural order (Unit 2 before Unit 10)
    expect(batch.children.map((c) => c.name)).toEqual(['DBMS', 'loose.pdf']);
    expect(dbms.children.map((c) => c.name)).toEqual(['Unit 2', 'Unit 10']);
  });

  it('filters entries before building', () => {
    const root = buildTree(data as never, (e) => e.state === 'missing');
    expect(root.files).toBe(1);
  });
});
