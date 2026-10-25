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
  if (total <= 0 || rounded(attended, total) <= 75) return 0;
  let miss = 0;
  while (miss < 10000 && rounded(attended, total + miss + 1) > 75) miss++;
  return miss;
}

/** Classes to attend in a row to get above 75% (rounded). 0 when already above. */
export function mustAttend(attended: number, total: number): number {
  let low = 0;
  let high = 10000;
  let ans = high;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (rounded(attended + mid, total + mid) > 75) {
      ans = mid;
      high = mid - 1;
    } else low = mid + 1;
  }
  return ans;
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
  const percent = rounded(attended, total);
  return {
    percent,
    marks: marksFor(percent),
    canMiss: canMiss(attended, total),
    mustAttend: mustAttend(attended, total),
    ...standing(percent),
  };
}
