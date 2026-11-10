export const COLLEGE_DOMAIN = 'vitbhopal.ac.in';

/**
 * Lower-cases and trims an email. Anything that is not plain ASCII (look-alike letters such as
 * Cyrillic "а" for "a", invisible characters) is left in, so the checks below reject it.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** A local part: letters, digits, dots, hyphens, underscores. No "+tags", no leading, trailing
 *  or doubled dots, so one inbox can't be turned into many accounts. */
const LOCAL = '[a-z0-9](?:[a-z0-9_-]|\\.(?!\\.))*[a-z0-9_-]|[a-z0-9]';

/** Strict college address: exactly `name@domain`, nothing before or after. */
export function isCollegeEmail(email: string, domain: string = COLLEGE_DOMAIN): boolean {
  const normalized = normaliseEmail(email);
  if (normalized.length > 254 || !/^[\x21-\x7e]+$/.test(normalized)) return false;
  const escaped = domain.toLowerCase().replace(/\./g, '\\.');
  return new RegExp(`^(?:${LOCAL})@${escaped}$`).test(normalized);
}

/** Any ordinary, ASCII-only address (used only to decide whether to send a request at all). */
export function isWellFormedEmail(email: string): boolean {
  const normalized = normaliseEmail(email);
  return (
    normalized.length <= 254 &&
    /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(normalized) &&
    !normalized.includes('..')
  );
}

/**
 * Is this signed-in address on the admin list? Exact match only: "Vitbsmashers@Gmail.com" is
 * the same address, but "vit.bsmashers@gmail.com", "vitbsmashers+x@gmail.com" or
 * "vitbsmashers@gmail.com.evil.in" are different people and never match.
 */
export function isListedEmail(email: string, list: readonly string[]): boolean {
  const normalized = normaliseEmail(email);
  if (!isWellFormedEmail(normalized)) return false;
  return list.some((entry) => normaliseEmail(entry) === normalized);
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

/**
 * What a VIT Bhopal address says about a student: "vraj.23bce11796@vitbhopal.ac.in" is the 2023
 * batch, programme code BCE (matched against the codes set in the admin's Years & branches).
 * Null for anything that doesn't follow that pattern (staff, Gmail).
 */
export function studentFromEmail(
  email: string,
  domain: string = COLLEGE_DOMAIN,
): { batchYear: number; branchCode: string } | null {
  const e = normaliseEmail(email);
  if (!e.endsWith(`@${domain.toLowerCase()}`)) return null;
  const m = /\.(\d{2})([a-z]{3})\d{3,6}@/.exec(e);
  if (!m) return null;
  return { batchYear: 2000 + Number(m[1]), branchCode: m[2]!.toUpperCase() };
}
