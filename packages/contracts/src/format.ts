export const COLLEGE_DOMAIN = 'vitbhopal.ac.in';

export function isCollegeEmail(email: string, domain: string = COLLEGE_DOMAIN): boolean {
  const normalized = email.trim().toLowerCase();
  const escaped = domain.toLowerCase().replace(/\./g, '\\.');
  return new RegExp(`^[a-z0-9._%+-]+@${escaped}$`).test(normalized);
}

export function formatRupees(paise: number): string {
  const rupees = paise / 100;
  return Number.isInteger(rupees) ? `₹${rupees}` : `₹${rupees.toFixed(2)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "2025" → "2nd year" relative to the academic year that started in `currentIntakeYear`. */
export function yearLabel(batchYear: number, currentIntakeYear: number): string {
  const n = currentIntakeYear - batchYear + 1;
  const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
  return `${n}${suffix} year`;
}

export function semesterRange(batchYear: number, currentIntakeYear: number): string {
  const n = currentIntakeYear - batchYear + 1;
  return `Sem ${n * 2 - 1}–${n * 2}`;
}
