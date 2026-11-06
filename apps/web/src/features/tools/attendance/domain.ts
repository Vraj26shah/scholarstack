/**
 * VIT attendance rules as the original calculator applied them: the percentage is rounded to a
 * whole number, you need a rounded percentage *above* 75 to sit the exam, and attendance gives up
 * to 5 internal marks.
 */
export const rounded = (attended: number, total: number) => Math.round((attended / total) * 100);

export function marksFor(roundedPercent: number): number {
  if (roundedPercent > 95) return 5;
  if (roundedPercent > 90) return 4;
  if (roundedPercent > 85) return 3;
  if (roundedPercent > 80) return 2;
  if (roundedPercent > 75) return 1;
  return 0;
}

/** Classes that can be missed in a row and still stay above 75% (rounded). */
export function canMiss(attended: number, total: number): number {
  if (
    !Number.isInteger(attended) ||
    !Number.isInteger(total) ||
    attended < 0 ||
    total <= 0 ||
    attended > total ||
    rounded(attended, total) <= 75
  )
    return 0;
  // Math.round(p) > 75 exactly when p >= 75.5, so solve that boundary directly instead
  // of stopping after an arbitrary number of missed classes.
  let miss = Math.max(0, Math.floor((200 * attended - 151 * total) / 151));
  while (miss > 0 && rounded(attended, total + miss) <= 75) miss--;
  while (rounded(attended, total + miss + 1) > 75) miss++;
  return miss;
}

/** Classes to attend in a row to get above 75% (rounded). Null means it is impossible. */
export function mustAttend(attended: number, total: number): number | null {
  if (
    !Number.isInteger(attended) ||
    !Number.isInteger(total) ||
    attended < 0 ||
    total <= 0 ||
    attended > total
  )
    return null;
  // Solve rounded percentage >= 75.5: 200(A + x) >= 151(T + x).
  let count = Math.max(0, Math.ceil((151 * total - 200 * attended) / 49));
  // Correct a possible floating point boundary rounding by checking the actual rule.
  while (count > 0 && rounded(attended + count - 1, total + count - 1) > 75) count--;
  while (rounded(attended + count, total + count) <= 75) count++;
  return count;
}

export type Standing = 'safe' | 'edge' | 'warning' | 'danger';

export function standing(roundedPercent: number): { standing: Standing; label: string } {
  if (roundedPercent > 75) return { standing: 'safe', label: 'Eligible for the exam' };
  if (roundedPercent === 75)
    return { standing: 'edge', label: 'Exactly 75%: not eligible yet, you need above 75%' };
  if (roundedPercent >= 70) return { standing: 'warning', label: 'Below 75%: not eligible for the exam yet' };
  return { standing: 'danger', label: 'Well below 75%: not eligible for the exam' };
}

export interface AttendanceResult {
  percent: number;
  marks: number;
  canMiss: number;
  mustAttend: number;
  standing: Standing;
  label: string;
}

export function evaluate(attended: number, total: number): AttendanceResult | { error: string } {
  if (!Number.isInteger(total) || total <= 0) return { error: 'Enter how many classes have been held.' };
  if (!Number.isInteger(attended) || attended < 0) return { error: 'Enter how many classes you attended.' };
  if (attended > total) return { error: 'You can’t have attended more classes than were held.' };
  const classesToEligibility = mustAttend(attended, total);
  if (classesToEligibility === null) return { error: 'Check the class counts and try again.' };
  const percent = rounded(attended, total);
  return {
    percent,
    marks: marksFor(percent),
    canMiss: canMiss(attended, total),
    mustAttend: classesToEligibility,
    ...standing(percent),
  };
}
