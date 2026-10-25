import type { CourseEarningRow, CourseRoyalty } from '../../domain/entities';

/** A contributor's share of what a course brought in since their royalty began, in whole paise. */
export function royaltyEarned(
  row: Pick<CourseEarningRow, 'royaltyRevenuePaise'>,
  r: Pick<CourseRoyalty, 'sharePercent'>,
) {
  return Math.floor((row.royaltyRevenuePaise * r.sharePercent) / 100);
}

/** Earned, paid and still owed, never negative (an over-payment just shows as nothing owed). */
export function royaltyBalance(row: CourseEarningRow, r: CourseRoyalty) {
  const earnedPaise = royaltyEarned(row, r);
  const paidPaise = row.paidOutPaise;
  return { sales: row.royaltySales, earnedPaise, paidPaise, owedPaise: Math.max(0, earnedPaise - paidPaise) };
}
