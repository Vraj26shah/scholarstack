import type { CourseInventoryDto } from '@ss/contracts';
import { describe, expect, it } from 'vitest';
import { firstBlocker, publishCheck } from '../src/application/publish-check';
import type { Course } from '../src/domain/entities';

type Obj = CourseInventoryDto['objects'][number];
const obj = (name: string, o: Partial<Obj> = {}): Obj => ({
  key: `drive-imports/25 Batch/OS/${name}`,
  name,
  sizeBytes: 100,
  status: 'registered',
  fileId: `f-${name}`,
  unitKey: 'unit-1',
  unit: 'Unit 1',
  conversionStatus: 'ready',
  conversionError: null,
  conversionErrorStage: null,
  conversionStage: null,
  conversionProgressCurrent: 0,
  conversionProgressTotal: 0,
  conversionQueueId: null,
  conversionQueuePosition: 0,
  conversionQueueTotal: 0,
  conversionUpdatedAt: null,
  pageCount: 10,
  pageAssetsComplete: true,
  pageAssetsFound: 10,
  missingPageNumbers: [],
  previewPresent: true,
  sourceIssue: null,
  pageMappingIssues: [],
  hidden: false,
  unitHidden: false,
  ...o,
});
const course = { id: 'c1', title: 'Operating Systems', status: 'draft', pricePaise: 9900 } as Course;
const inv = (objects: Obj[]) => ({ objects }) as CourseInventoryDto;

describe('publish checklist', () => {
  it('is ready only when every visible file has every page', () => {
    const check = publishCheck(course, inv([obj('a.pdf'), obj('b.pdf')]));
    expect(check.ready).toBe(true);
    expect(check.steps.map((s) => s.done)).toEqual([true, true, true, true, true]);
    expect(firstBlocker(check)).toBeNull();
  });

  it('blocks on a supported file that has not been added to the course structure', () => {
    const check = publishCheck(
      course,
      inv([obj('a.pdf'), obj('new.pdf', { status: 'unmapped', fileId: null, conversionStatus: null })]),
    );
    expect(check.ready).toBe(false);
    expect(check.steps[0]).toMatchObject({ key: 'storage', done: true });
    expect(check.steps[1]).toMatchObject({ key: 'structure', done: false });
    expect(firstBlocker(check)).toContain('new.pdf');
  });

  it('blocks on missing page objects and names how many', () => {
    const check = publishCheck(
      course,
      inv([obj('a.pdf', { pageAssetsComplete: false, pageAssetsFound: 8, missingPageNumbers: [9, 10] })]),
    );
    expect(check.files[0]).toMatchObject({ state: 'pages-missing', problem: '2 pages missing from storage' });
    expect(check.steps.find((s) => s.key === 'pages')?.done).toBe(false);
  });

  it('blocks on files still waiting or being made', () => {
    const check = publishCheck(
      course,
      inv([
        obj('a.pdf', { conversionStatus: 'pending', pageCount: 0 }),
        obj('b.pdf', { conversionStatus: 'pending', conversionStage: 'rendering_pages' }),
      ]),
    );
    expect(check.files.map((f) => f.state)).toEqual(['needs-pages', 'working']);
    expect(check.ready).toBe(false);
  });

  it('leaves hidden files, ZIPs and system files out', () => {
    const check = publishCheck(
      course,
      inv([
        obj('a.pdf'),
        obj('book.pdf', { hidden: true, conversionStatus: 'failed' }),
        obj('all.zip', { status: 'unsupported', fileId: null }),
        obj('.DS_Store', { status: 'ignored', fileId: null }),
      ]),
    );
    expect(check.ready).toBe(true);
    expect(check.skipped).toHaveLength(3);
  });

  it('needs a price and a readable file', () => {
    const check = publishCheck({ ...course, pricePaise: 0 }, inv([]));
    expect(check.steps.find((s) => s.key === 'details')).toMatchObject({ done: false });
    expect(check.ready).toBe(false);
  });
});
