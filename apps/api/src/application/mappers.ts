import type { BundleCardDto, CourseCardDto, CourseFileDto, CourseUnitDto, FileFormat } from '@ss/contracts';
import type { Branch, Bundle, Course, CourseFile } from '../domain/entities';
import { isReaderReady } from '../domain/entities';
import { bundlePricing } from './pricing';

export function callNo(course: Course, branch: Branch | undefined): string {
  const code = branch?.code ?? course.branchSlug.toUpperCase();
  return `S${course.semester} · ${code} · ${String(course.seq).padStart(2, '0')}`;
}

export function toCard(
  course: Course,
  files: CourseFile[],
  branch: Branch | undefined,
  branchSlug = course.branchSlug,
): CourseCardDto {
  const own = files.filter((f) => f.courseId === course.id && isReaderReady(f));
  const formats = [...new Set(own.map((f) => f.format))].sort() as FileFormat[];
  return {
    id: course.id,
    slug: course.slug,
    title: course.title,
    courseCode: course.courseCode,
    callNo: callNo(course, branch),
    batchYear: course.batchYear,
    branchSlug,
    semester: course.semester,
    fileCount: own.length,
    pageCount: own.reduce((sum, f) => sum + f.pageCount, 0),
    formats,
    pricePaise: course.pricePaise,
    previewFileId: coverOf(own),
  };
}

/** Unit order: the importer's rank (modules, revision, PYQs, lab, syllabus, …), then natural order. */
const compareUnits = (a: CourseFile, b: CourseFile) =>
  a.unitSort - b.unitSort || unitOrder(a.unitKey, b.unitKey);

/** Cover of a course: the preview of its first unit (in unit order) that has one. */
export function coverOf(courseFiles: CourseFile[]): string | null {
  const readyFiles = courseFiles.filter(isReaderReady);
  const units = [...new Set([...readyFiles].sort(compareUnits).map((f) => f.unitKey))];
  for (const u of units) {
    const p = previewFileOf(
      readyFiles
        .filter((f) => f.unitKey === u)
        .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)),
    );
    if (p) return p.id;
  }
  return null;
}

export function toFileDto(file: CourseFile): CourseFileDto {
  return {
    id: file.id,
    name: file.name,
    format: file.format,
    pageCount: file.pageCount,
    sizeBytes: file.sizeBytes,
    status: file.conversionStatus,
  };
}

const NUMBERED = /^(unit|module|chapter|part|week|lecture)-(\d+)$/;

/** "unit-3" → "UNIT 3", "module-2" → "MODULE 2", "revision" → "REVISION". */
export function unitLabel(unitKey: string): string {
  const m = NUMBERED.exec(unitKey);
  return m ? `${m[1]!.toUpperCase()} ${m[2]}` : unitKey.replace(/-/g, ' ').toUpperCase();
}

/** Numbered units first (1, 2, … 10), then extras like "revision" alphabetically, loose notes last. */
export function unitOrder(a: string, b: string): number {
  const na = NUMBERED.exec(a)?.[2];
  const nb = NUMBERED.exec(b)?.[2];
  if (na && nb) return Number(na) - Number(nb) || a.localeCompare(b);
  if (na) return -1;
  if (nb) return 1;
  if (a === 'notes' || b === 'notes') return a === 'notes' ? 1 : -1;
  return a.localeCompare(b);
}

export function toUnits(files: CourseFile[]): CourseUnitDto[] {
  const byUnit = new Map<string, CourseFile[]>();
  for (const f of [...files]
    .filter(isReaderReady)
    .sort((a, b) => compareUnits(a, b) || a.sort - b.sort || a.name.localeCompare(b.name))) {
    const list = byUnit.get(f.unitKey) ?? [];
    list.push(f);
    byUnit.set(f.unitKey, list);
  }
  return [...byUnit.entries()].map(([key, list]) => ({
    key,
    label: unitLabel(key),
    title: list[0]?.unitTitle ?? key,
    kind: list[0]?.unitKind ?? 'other',
    fileCount: list.length,
    pageCount: list.reduce((s, f) => s + f.pageCount, 0),
    files: list.map(toFileDto),
    previewFileId: previewFileOf(list)?.id ?? null,
  }));
}

/** The one file per unit whose first page is public: the first ready file that has a preview. */
export function previewFileOf(unitFiles: CourseFile[]): CourseFile | undefined {
  return unitFiles.find((f) => isReaderReady(f) && f.previewKey);
}

/** True when this file is its unit's public preview. */
export function isPreviewFile(file: CourseFile, courseFiles: CourseFile[]): boolean {
  const unit = courseFiles
    .filter((f) => f.unitKey === file.unitKey)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  return previewFileOf(unit)?.id === file.id;
}

export function toBundleCard(
  bundle: Bundle,
  courses: Course[],
  files: CourseFile[],
  includeDrafts = false,
): BundleCardDto {
  const inBundle = courses.filter(
    (c) =>
      bundle.courseIds.includes(c.id) && c.status !== 'archived' && (includeDrafts || c.status === 'live'),
  );
  const ids = new Set(inBundle.map((c) => c.id));
  const own = files.filter((f) => ids.has(f.courseId) && isReaderReady(f));
  const price = bundlePricing(
    bundle.pricePaise,
    inBundle.map((c) => c.pricePaise),
    [],
  );
  return {
    id: bundle.id,
    slug: bundle.slug,
    title: bundle.title,
    description: bundle.description,
    batchYear: bundle.batchYear,
    courseCount: inBundle.length,
    fileCount: own.length,
    pageCount: own.reduce((s, f) => s + f.pageCount, 0),
    pricePaise: bundle.pricePaise,
    listPricePaise: price.listPaise,
    savePercent: price.savePercent,
    coverFileIds: inBundle
      .map((c) => coverOf(files.filter((f) => f.courseId === c.id)))
      .filter((id): id is string => id !== null)
      .slice(0, 3),
  };
}
