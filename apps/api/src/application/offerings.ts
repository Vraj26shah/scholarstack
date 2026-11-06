import { type CourseOffering, type OfferingSource, curriculumOfferings } from '@ss/contracts';
import type { Branch, Course } from '../domain/entities';

/** First-year subjects deliberately shared across programmes when filed under them. */
export const explicitlySharedCourseCodes = new Set([
  'ENG2005',
  'MAT1001',
  'MAT2001',
  'HUM1002',
  'CHY1005',
  'CSE1021',
]);

export type Offering = CourseOffering & { source: OfferingSource };

/** A cohort studies these semesters now (e.g. 2023 → 7–8 when the latest intake is 2026). */
export function semesterMatchesCohort(intakeYear: number, batchYear: number, semester: number): boolean {
  const studyYear = intakeYear - batchYear + 1;
  return (
    Number.isInteger(semester) &&
    studyYear >= 1 &&
    studyYear <= 5 &&
    semester >= studyYear * 2 - 1 &&
    semester <= studyYear * 2
  );
}

/** The semester a cohort is in this term (the even one: the course list is the Winter term). */
export const termSemester = (intakeYear: number, batchYear: number) =>
  Math.max(1, Math.min(10, (intakeYear - batchYear + 1) * 2));

/**
 * Every drawer (batch × programme) a course shows in. The R2 notes are one course; who reads them
 * is decided here, so the same notes serve every batch and programme that takes the subject:
 *  1. an admin's own choice ("offered to"), when set, is exactly what students see;
 *  2. otherwise the term's course list, by course code (CSE3003 → 2024 BCE, 2025 BCY, …);
 *  3. plus where the course was filed (its batch and programmes), when that cohort is studying
 *     its semester now and the filing fits the programme curriculum.
 */
export function offeringsOf(
  course: Course,
  assignedSlugs: string[],
  branches: Branch[],
  intakeYear: number,
): Offering[] {
  const active = branches.filter((b) => b.isActive !== false);
  const out = new Map<string, Offering>();
  const add = (batchYear: number, branchSlug: string, source: OfferingSource) => {
    const key = `${batchYear}:${branchSlug}`;
    if (!out.has(key)) out.set(key, { batchYear, branchSlug, source });
  };
  if (course.offeredTo?.length) {
    const known = new Set(active.map((b) => b.slug));
    for (const o of course.offeredTo) if (known.has(o.branchSlug)) add(o.batchYear, o.branchSlug, 'admin');
    return [...out.values()];
  }
  const byCode = new Map(active.filter((b) => !b.isCommon).map((b) => [b.code.toUpperCase(), b.slug]));
  for (const o of curriculumOfferings(course.courseCode)) {
    const slug = byCode.get(o.programme);
    if (slug) add(o.batchYear, slug, 'list');
  }
  if (
    semesterMatchesCohort(intakeYear, course.batchYear, course.semester) &&
    hasValidFiling(course, assignedSlugs, active, intakeYear)
  ) {
    const programmes = active.filter((b) => !b.isCommon);
    const assigned = new Set(assignedSlugs);
    const mapped = course.courseCode
      ? programmes.filter((b) => b.courseCodes.includes(course.courseCode!))
      : [];
    const shared = course.courseCode && explicitlySharedCourseCodes.has(course.courseCode);
    for (const b of active) {
      if (!assigned.has(b.slug)) continue;
      // Filed under "all branches": a coded course still goes only to the programmes that take it.
      if (b.isCommon && mapped.length && !shared) {
        for (const m of mapped) add(course.batchYear, m.slug, 'filed');
        continue;
      }
      // A coded course only shows under the programmes whose curriculum has it (unless shared).
      if (!b.isCommon && mapped.length && !shared && !mapped.some((m) => m.slug === b.slug)) continue;
      add(course.batchYear, b.slug, 'filed');
    }
  }
  return [...out.values()];
}

/** Where a course was filed makes sense (kept from the catalogue's earlier rules). */
function hasValidFiling(
  course: Course,
  assignedSlugs: string[],
  branches: Branch[],
  intakeYear: number,
): boolean {
  const activeSlugs = new Set(branches.map((b) => b.slug));
  const assigned = new Set(assignedSlugs.filter((slug) => activeSlugs.has(slug)));
  const programmes = branches.filter((b) => !b.isCommon);
  const mapped = course.courseCode
    ? programmes.filter((b) => b.courseCodes.includes(course.courseCode!))
    : [];
  if (mapped.length) return mapped.some((b) => assigned.has(b.slug));
  if (branches.some((b) => b.isCommon && assigned.has(b.slug))) return true;
  // An unmapped course filed under every programme was an accidental import, except the newest
  // batch's shared first-year material.
  return (
    assigned.size > 0 &&
    (assigned.size < programmes.length ||
      (course.batchYear === intakeYear && assigned.size === programmes.length))
  );
}

/** Does this drawer (batch, programme) show the course? Shared ("all branches") filings count. */
export function inDrawer(
  offerings: Offering[],
  batchYear: number,
  branchSlug: string,
  commonSlugs: string[],
) {
  return offerings.some(
    (o) => o.batchYear === batchYear && (o.branchSlug === branchSlug || commonSlugs.includes(o.branchSlug)),
  );
}
