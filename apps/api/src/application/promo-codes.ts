import type { PromoCode } from '../domain/entities';

/**
 * Promo codes. Pure functions, so the rules are easy to test and the "Apply" check and checkout
 * always agree on a price.
 *
 * - A code works while it is live, after it starts and before it ends (if it has an end).
 * - It covers everything, every course, every bundle, or the courses and bundles picked for it.
 * - It comes off the price the student would pay right then: running offers and courses they
 *   already own are counted first. Codes never stack with each other (one per order).
 * - Percent codes round the price down to the whole rupee (in the student's favour); flat codes
 *   take the amount off. Either way the price never goes below ₹1.
 */

/** Upper-case, no spaces: how codes are stored and compared. */
export const normaliseCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, '');

export const hasStarted = (promo: PromoCode, now: Date) => promo.startsAt.getTime() <= now.getTime();
export const hasEnded = (promo: PromoCode, now: Date) =>
  promo.endsAt !== null && promo.endsAt.getTime() <= now.getTime();

/** Live and inside its dates (use limits are checked separately). */
export const isOpen = (promo: PromoCode, now: Date) =>
  promo.status === 'live' && hasStarted(promo, now) && !hasEnded(promo, now);

export type PromoItem = { courseId: string } | { bundleId: string };

export function promoCovers(promo: PromoCode, item: PromoItem): boolean {
  if (promo.appliesTo === 'everything') return true;
  if ('courseId' in item)
    return (
      promo.appliesTo === 'courses' ||
      (promo.appliesTo === 'chosen' && promo.courseIds.includes(item.courseId))
    );
  return (
    promo.appliesTo === 'bundles' || (promo.appliesTo === 'chosen' && promo.bundleIds.includes(item.bundleId))
  );
}

/** The price with the code, never below ₹1 (and never above the price without it). */
export function promoPricePaise(
  paise: number,
  promo: Pick<PromoCode, 'kind' | 'percentOff' | 'amountOffPaise'>,
) {
  if (paise <= 100) return paise;
  const next =
    promo.kind === 'percent'
      ? Math.floor((paise * (100 - Math.min(90, Math.max(0, promo.percentOff ?? 0)))) / 100 / 100) * 100
      : paise - Math.max(0, promo.amountOffPaise ?? 0);
  return Math.min(paise, Math.max(100, next));
}

/**
 * The creator's cut of one paid order: a percent of what the student paid (rounded down to the
 * paisa), or a flat amount per use, never more than the student paid.
 */
export function commissionPaise(
  promo: Pick<PromoCode, 'commissionKind' | 'commissionValue'>,
  amountPaise: number,
): number {
  if (!promo.commissionKind || promo.commissionValue == null) return 0;
  const cut =
    promo.commissionKind === 'percent'
      ? Math.floor((amountPaise * Math.min(100, promo.commissionValue)) / 100)
      : promo.commissionValue;
  return Math.max(0, Math.min(amountPaise, cut));
}

/** "20% off" or "₹50 off". */
export const promoLabel = (promo: Pick<PromoCode, 'kind' | 'percentOff' | 'amountOffPaise'>) =>
  promo.kind === 'percent'
    ? `${promo.percentOff}% off`
    : `₹${((promo.amountOffPaise ?? 0) / 100).toLocaleString('en-IN')} off`;
