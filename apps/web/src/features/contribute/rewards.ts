import type { ContributionReward } from '@ss/contracts';

/** A reward in one plain line, the same for the student and the admin. */
export function rewardText(r: ContributionReward | null, paidAt?: string | null): string | null {
  if (!r || r.type === 'none') return null;
  if (r.type === 'thanks') return 'Thank you from the library';
  if (r.type === 'course') return `Free course: ${r.courseTitle}`;
  if (r.type === 'royalty') return `${r.sharePercent}% of every sale of ${r.courseTitle}`;
  if (paidAt !== undefined)
    return paidAt ? `₹${r.amountRupees} · paid` : `₹${r.amountRupees} · we'll pay you by UPI soon`;
  return `₹${r.amountRupees} cash reward`;
}
