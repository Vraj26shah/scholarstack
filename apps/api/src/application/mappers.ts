import type {
  BundleCardDto,
  CourseCardDto,
  CourseFileDto,
  CourseUnitDto,
  FileFormat,
  PriceOfferDto,
} from '@ss/contracts';
import { courseBlurb } from '@ss/contracts';
import type { Branch, Bundle, Course, CourseFile } from '../domain/entities';
import { isReaderReady } from '../domain/entities';
import { shownBundleTitle } from './offers';
import { bundlePricing } from './pricing';

/** Shown to students on cards and the shelf: year and branch, never semester. */
export function callNo(course: Course, branch: Branch | undefined): string {
  const code = branch?.code ?? course.branchSlug.toUpperCase();
  return `${course.batchYear} · ${code} · ${String(course.seq).padStart(2, '0')}`;
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
    blurb: blurbOf(course),
    previewFileId: coverOf(own),
  };
}

/**
 * One short line for a card: the first sentence of the admin's description, or the syllabus line
 * for the course code (or title) from the Winter 2026-27 list.
 */
export function blurbOf(course: Pick<Course, 'description' | 'courseCode' | 'title'>): string {
  const own = (course.description ?? '').trim().replace(/\s+/g, ' ');
  if (own) {
    const first = own.match(/^.*?[.!?](\s|$)/)?.[0]?.trim() ?? own;
    return first.length <= 140 ? first : `${first.slice(0, 137).trimEnd()}…`;
  }
  return courseBlurb(course.courseCode, course.title);
}

/** Unit order: the importer's rank (modules, revision, PYQs, lab, syllabus, …), then natural order. */
const compareUnits = (a: CourseFile, b: CourseFile) =>
  a.unitSort - b.unitSort || unitOrder(a.unitKey, b.unitKey);

/**
 * The one order files are listed in everywhere: unit, then the file's place, then name. The course
 * page, the cover and the preview check must agree on it, or the page offers one file as the free
 * preview while the server guards another (files of one unit can carry different unit ranks).
 */
export const fileOrder = (a: CourseFile, b: CourseFile) =>
  compareUnits(a, b) || a.sort - b.sort || a.name.localeCompare(b.name);

/** Cover of a course: the preview of its first unit (in unit order) that has one. */
export function coverOf(courseFiles: CourseFile[]): string | null {
  const readyFiles = courseFiles.filter(isReaderReady);
  const units = [...new Set([...readyFiles].sort(compareUnits).map((f) => f.unitKey))];
  for (const u of units) {
    const p = previewFileOf(readyFiles.filter((f) => f.unitKey === u).sort(fileOrder));
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
  for (const f of [...files].filter(isReaderReady).sort(fileOrder)) {
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
    ...(() => {
      const picks = previewsOf(list);
      return {
        previewFileId: picks[0]?.file.id ?? null,
        previewPages: picks[0]?.pages ?? [1],
        previews: picks.map((p) => ({ fileId: p.file.id, pages: p.pages })),
      };
    })(),
  }));
}

/** A unit's free preview: one of its files and which of that file's pages. */
export interface UnitPreviewPick {
  file: CourseFile;
  pages: number[];
}

/** At most this many files per unit, pages per file, and pages in all (as the admin form says). */
const MAX_FILES = 4;
const MAX_PAGES_PER_FILE = 5;
const MAX_PAGES = 10;

/**
 * Every free preview of a unit, in the admin's order: each chosen file that is still in the unit
 * and readable, with its chosen pages that still exist. Nothing chosen (or nothing left of the
 * choice): page 1 of the first ready file that has a page-one preview, so "Peek inside" never breaks.
 */
export function previewsOf(unitFiles: CourseFile[]): UnitPreviewPick[] {
  const chosen = unitFiles[0]?.unitPreviews ?? [];
  const picks: UnitPreviewPick[] = [];
  let total = 0;
  const seen = new Set<string>();
  for (const c of chosen) {
    if (picks.length >= MAX_FILES || total >= MAX_PAGES || seen.has(c.fileId)) continue;
    const file = unitFiles.find((f) => f.id === c.fileId && isReaderReady(f));
    if (!file) continue;
    const pages = [...new Set(c.pages)]
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= file.pageCount)
      .sort((x, y) => x - y)
      .slice(0, Math.min(MAX_PAGES_PER_FILE, MAX_PAGES - total));
    if (!pages.length) continue;
    seen.add(file.id);
    total += pages.length;
    picks.push({ file, pages });
  }
  if (picks.length) return picks;
  const fallback = unitFiles.find((f) => isReaderReady(f) && f.previewKey);
  return fallback ? [{ file: fallback, pages: [1] }] : [];
}

/** True when the admin's choice for this unit still holds (at least one pick survives). */
export function previewChosen(unitFiles: CourseFile[]): boolean {
  const chosen = unitFiles[0]?.unitPreviews ?? [];
  return chosen.length > 0 && previewsOf(unitFiles).some((p) => chosen.some((c) => c.fileId === p.file.id));
}

/** The unit's first free preview file (its cover in the catalogue). */
export function previewFileOf(unitFiles: CourseFile[]): CourseFile | undefined {
  return previewsOf(unitFiles)[0]?.file;
}

/** Which pages of the unit's first preview file are public. */
export function previewPagesOf(unitFiles: CourseFile[]): number[] {
  return previewsOf(unitFiles)[0]?.pages ?? [1];
}

const unitOf = (file: CourseFile, courseFiles: CourseFile[]) =>
  courseFiles.filter((f) => f.unitKey === file.unitKey).sort(fileOrder);

/** True when this file is one of its unit's public previews. */
export function isPreviewFile(file: CourseFile, courseFiles: CourseFile[]): boolean {
  return previewsOf(unitOf(file, courseFiles)).some((p) => p.file.id === file.id);
}

/** True when this page of this file is one the public may see. */
export function isPreviewPage(file: CourseFile, page: number, courseFiles: CourseFile[]): boolean {
  return previewsOf(unitOf(file, courseFiles)).some((p) => p.file.id === file.id && p.pages.includes(page));
}

export function toBundleCard(
  bundle: Bundle,
  courses: Course[],
  files: CourseFile[],
  includeDrafts = false,
  /** Today's price (a running offer); the bundle's own price when left out. */
  today?: { pricePaise: number; offer?: PriceOfferDto },
): BundleCardDto {
  const inBundle = courses.filter(
    (c) =>
      bundle.courseIds.includes(c.id) && c.status !== 'archived' && (includeDrafts || c.status === 'live'),
  );
  const ids = new Set(inBundle.map((c) => c.id));
  const own = files.filter((f) => ids.has(f.courseId) && isReaderReady(f));
  const pricePaise = today?.pricePaise ?? bundle.pricePaise;
  const price = bundlePricing(
    pricePaise,
    inBundle.map((c) => c.pricePaise),
    [],
  );
  return {
    id: bundle.id,
    slug: bundle.slug,
    title: shownBundleTitle(bundle, today?.offer),
    description: bundle.description,
    batchYear: bundle.batchYear,
    courseCount: inBundle.length,
    fileCount: own.length,
    pageCount: own.reduce((s, f) => s + f.pageCount, 0),
    pricePaise,
    listPricePaise: price.listPaise,
    savePercent: price.savePercent,
    ...(today?.offer ? { offer: today.offer } : {}),
    ...(bundle.autoDrawer ? { forDrawer: bundle.autoDrawer } : {}),
    courseTitles: [...inBundle]
      .sort((a, b) => a.semester - b.semester || a.title.localeCompare(b.title))
      .map((c) => c.title),
    coverFileIds: inBundle
      .map((c) => coverOf(files.filter((f) => f.courseId === c.id)))
      .filter((id): id is string => id !== null)
      .slice(0, 3),
  };
}
