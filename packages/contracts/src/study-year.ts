/** Academic study year for a semester number: semesters 1–2 are Year 1, 3–4 Year 2, etc. */
export function studyYearFromSemester(semester: number | null | undefined): number | null {
  if (!Number.isInteger(semester) || semester == null || semester < 1) return null;
  return Math.ceil(semester / 2);
}

/** Intake cohort for the Winter 2026-27 term (semesters 7-8 belong to 2023). */
export function cohortYearFromSemester(semester: number | null | undefined): number | null {
  if (!Number.isInteger(semester) || semester == null || semester < 1 || semester > 10) return null;
  return 2027 - Math.ceil(semester / 2);
}
