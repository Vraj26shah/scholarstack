/** VIT grade points (the scale the original calculator used). */
export const GRADE_POINTS = { S: 10, A: 9, B: 8, C: 7, D: 6, E: 5, F: 0 } as const;
export type Grade = keyof typeof GRADE_POINTS;
export const GRADES = Object.keys(GRADE_POINTS) as Grade[];

export interface SubjectRow {
  id: string;
  name: string;
  credits: number | '';
  grade: Grade | '';
}

export interface SemesterRow {
  id: string;
  label: string;
  gpa: number | '';
  credits: number | '';
}

/** Credit-weighted average of the rows that have both credits and a grade; null if none do. */
export function semesterGpa(rows: SubjectRow[]): { gpa: number; credits: number; counted: number } | null {
  let points = 0;
  let credits = 0;
  let counted = 0;
  for (const r of rows) {
    if (r.grade === '' || r.credits === '' || !(r.credits > 0)) continue;
    points += r.credits * GRADE_POINTS[r.grade];
    credits += r.credits;
    counted++;
  }
  return credits > 0 ? { gpa: points / credits, credits, counted } : null;
}

/** CGPA from each semester's GPA and credits. */
export function overallCgpa(rows: SemesterRow[]): { cgpa: number; credits: number } | null {
  let points = 0;
  let credits = 0;
  for (const r of rows) {
    if (r.gpa === '' || r.credits === '' || !(r.credits > 0) || r.gpa < 0 || r.gpa > 10) continue;
    points += r.gpa * r.credits;
    credits += r.credits;
  }
  return credits > 0 ? { cgpa: points / credits, credits } : null;
}

/**
 * The GPA needed next semester to reach a target CGPA. `reachable` is false when it would need
 * more than a perfect 10 (or the target is already guaranteed).
 */
export function neededNext(current: number, doneCredits: number, nextCredits: number, target: number) {
  if (!(nextCredits > 0) || doneCredits < 0) return null;
  const needed = (target * (doneCredits + nextCredits) - current * doneCredits) / nextCredits;
  return { needed, reachable: needed <= 10, alreadyThere: needed <= 0 };
}

/** One decimal place is how VIT prints a CGPA on grade sheets; we show two for planning. */
export const fmt = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
