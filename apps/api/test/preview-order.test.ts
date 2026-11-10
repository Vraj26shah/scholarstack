import { describe, expect, it } from 'vitest';
import { coverOf, isPreviewFile, toUnits } from '../src/application/mappers';
import type { CourseFile } from '../src/domain/entities';

const file = (id: string, name: string, sort: number, unitSort: number): CourseFile => ({
  id,
  courseId: 'c',
  unitKey: 'notes',
  unitTitle: 'Notes',
  unitKind: 'notes' as CourseFile['unitKind'],
  unitSort,
  unitHidden: false,
  hidden: false,
  name,
  format: 'pdf',
  sizeBytes: 1,
  pageCount: 10,
  sourceKey: `k/${id}`,
  sourceEtag: 'e',
  conversionStatus: 'ready',
  conversionError: null,
  sort,
  previewKey: `pages/${id}/preview.webp`,
});

describe('free preview of a unit', () => {
  it('the page, the cover and the server agree on which file is the preview', () => {
    // Shaped like a real course: files of one unit carrying different unit ranks.
    const files = [
      file('a', 'analog 1 4 5.pdf', 0, 3),
      file('b', 'Analog Electronics Topics Summary.pdf', 2, 1),
      file('c', 'Analog notes.pdf', 3, 1),
    ];
    const shown = toUnits(files)[0]!.previewFileId!;
    expect(isPreviewFile(files.find((f) => f.id === shown)!, files)).toBe(true);
    expect(coverOf(files)).toBe(shown);
    for (const f of files.filter((x) => x.id !== shown)) expect(isPreviewFile(f, files)).toBe(false);
  });
});
