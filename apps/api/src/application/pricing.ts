/**
 * Bundle pricing. Pure functions so the rules are easy to test and explain.
 *
 * - List price: the sum of the courses' own prices.
 * - Saving: how much cheaper the bundle is than buying each course.
 * - Owned courses: a buyer who already owns some courses pays the bundle price scaled to
 *   the share of list value they don't own yet, rounded up to the rupee. They never pay
 *   more than buying the remaining courses one by one.
 */
export interface BundlePrice {
  listPaise: number;
  savePercent: number;
  /** What this buyer pays (0 = nothing left to buy). */
  payablePaise: number;
  remainingListPaise: number;
}

export function bundlePricing(
  bundlePaise: number,
  coursePrices: number[],
  ownedPrices: number[],
): BundlePrice {
  const listPaise = coursePrices.reduce((s, p) => s + p, 0);
  const ownedPaise = ownedPrices.reduce((s, p) => s + p, 0);
  const remainingListPaise = Math.max(0, listPaise - ownedPaise);
  const savePercent = listPaise > 0 ? Math.max(0, Math.round((1 - bundlePaise / listPaise) * 100)) : 0;
  let payablePaise = 0;
  if (remainingListPaise > 0 && listPaise > 0) {
    const scaled = Math.ceil((bundlePaise * remainingListPaise) / listPaise / 100) * 100;
    payablePaise = Math.max(100, Math.min(scaled, remainingListPaise));
  }
  return { listPaise, savePercent, payablePaise, remainingListPaise };
}

/** A sensible starting price for a new bundle: about 30% off, ending in 9. */
export function suggestBundlePrice(coursePrices: number[]): number {
  const list = coursePrices.reduce((s, p) => s + p, 0);
  const rupees = Math.max(9, Math.floor((list * 0.7) / 100 / 10) * 10 - 1);
  return rupees * 100;
}
