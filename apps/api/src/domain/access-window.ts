import { ACCESS_MONTHS } from '@ss/contracts';

/** When a purchase (or a gift) made at `from` ends: the same day, ACCESS_MONTHS later. */
export function accessEnd(from: Date, months = ACCESS_MONTHS): Date {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  // 31 Nov doesn't exist: stop at the month's last day instead of spilling into the next.
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}
