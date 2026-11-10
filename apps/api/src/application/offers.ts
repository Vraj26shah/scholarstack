import type { PriceOfferDto } from '@ss/contracts';
import type { Bundle, DrawerRef, Offer } from '../domain/entities';

/**
 * Offers (a Diwali sale, an end-of-term sale) and where bundles show. Pure functions, so the rules
 * are easy to test and the catalogue and checkout always agree on a price.
 *
 * - An offer runs while it is live and between its start and end.
 * - It covers everything, or the courses and bundles picked for it, or whatever shows in the
 *   drawers (batch × programme) picked for it. "*" as the programme means the whole batch.
 * - When several offers cover the same thing, the biggest saving wins. Offers never stack.
 * - Prices are rounded to whole rupees and never go below ₹1.
 */

export const ALL = '*';

export const isRunning = (offer: Offer, now: Date) =>
  offer.status === 'live' &&
  offer.startsAt.getTime() <= now.getTime() &&
  now.getTime() < offer.endsAt.getTime();

/**
 * The offer price: the percentage off, then down to the nearest price ending in 9 (₹223 → ₹219,
 * ₹63.2 → ₹59), so offer prices look like the rest of the shop and the saving is never less than
 * the percentage promised. Under ₹20 it is simply whole rupees, and never below ₹1.
 */
export function offerPricePaise(fullPaise: number, percentOff: number): number {
  const pct = Math.min(90, Math.max(0, percentOff));
  return charmDownPaise((fullPaise * (100 - pct)) / 100);
}

/** Down to the nearest price ending in 9 (whole rupees under ₹20), never below ₹1. */
export function charmDownPaise(paise: number): number {
  const rupees = Math.floor(paise / 100 + 1e-9);
  const charm = rupees >= 20 ? rupees - ((rupees + 1) % 10) : rupees;
  return Math.max(100, charm * 100);
}

/**
 * Does any drawer in `drawers` show something offered to `reach`? A "*" on either side covers the
 * whole batch; an offering under a shared ("all branches") programme shows in every programme.
 */
export function drawersMeet(drawers: DrawerRef[], reach: DrawerRef[], commonSlugs: string[] = []): boolean {
  return drawers.some((d) =>
    reach.some(
      (r) =>
        r.batchYear === d.batchYear &&
        (d.branchSlug === ALL ||
          r.branchSlug === ALL ||
          r.branchSlug === d.branchSlug ||
          commonSlugs.includes(r.branchSlug)),
    ),
  );
}

export interface Priced {
  pricePaise: number;
  offer?: PriceOfferDto;
}

/** The lowest price any running offer gives, with that offer's label; the full price when none do. */
export function bestPrice(running: Offer[], covers: (offer: Offer) => boolean, fullPaise: number): Priced {
  let best: Priced = { pricePaise: fullPaise };
  for (const offer of running) {
    if (!covers(offer)) continue;
    const pricePaise = offerPricePaise(fullPaise, offer.percentOff);
    if (pricePaise < best.pricePaise)
      best = {
        pricePaise,
        offer: {
          title: offer.title,
          percentOff: offer.percentOff,
          endsAt: offer.endsAt.toISOString(),
          fullPricePaise: fullPaise,
        },
      };
  }
  return best;
}

export const coversCourse =
  (courseId: string, offerings: DrawerRef[], commonSlugs: string[]) => (offer: Offer) =>
    offer.everything ||
    offer.courseIds.includes(courseId) ||
    drawersMeet(offer.drawers, offerings, commonSlugs);

export const coversBundle = (bundleId: string, audience: DrawerRef[]) => (offer: Offer) =>
  offer.everything || offer.bundleIds.includes(bundleId) || drawersMeet(offer.drawers, audience);

/**
 * The drawers a bundle shows in. Picked by hand when the admin chose them; otherwise every drawer
 * that shows at least two of its courses (all of them, for a one-course bundle). Courses are often
 * shared by several batches and programmes, so one bundle can reach many drawers. An older bundle
 * kept to one batch stays in that batch.
 */
export function bundleAudience(
  bundle: Pick<Bundle, 'courseIds' | 'offeredTo' | 'batchYear'>,
  offeringsOf: (courseId: string) => DrawerRef[],
  programmeSlugs: string[],
  commonSlugs: string[],
): DrawerRef[] {
  if (bundle.offeredTo) return sortDrawers(bundle.offeredTo);
  const ids = [...new Set(bundle.courseIds)];
  const count = new Map<string, number>();
  let reaching = 0;
  for (const id of ids) {
    const keys = new Set<string>();
    for (const o of offeringsOf(id)) {
      const slugs =
        o.branchSlug === ALL || commonSlugs.includes(o.branchSlug) ? programmeSlugs : [o.branchSlug];
      for (const slug of slugs) keys.add(`${o.batchYear}:${slug}`);
    }
    if (keys.size) reaching++;
    for (const key of keys) count.set(key, (count.get(key) ?? 0) + 1);
  }
  const need = Math.max(1, Math.min(2, reaching));
  const out: DrawerRef[] = [];
  for (const [key, n] of count) {
    if (n < need) continue;
    const [year, branchSlug] = key.split(':') as [string, string];
    const batchYear = Number(year);
    if (bundle.batchYear != null && batchYear !== bundle.batchYear) continue;
    out.push({ batchYear, branchSlug });
  }
  return sortDrawers(out);
}

/** Does this drawer (or, without a programme, any drawer of the batch) show the bundle? */
export function audienceShows(audience: DrawerRef[], batchYear: number, branchSlug?: string): boolean {
  return audience.some(
    (a) =>
      a.batchYear === batchYear &&
      (branchSlug === undefined || a.branchSlug === ALL || a.branchSlug === branchSlug),
  );
}

const sortDrawers = (list: DrawerRef[]) =>
  [...list].sort((a, b) => b.batchYear - a.batchYear || a.branchSlug.localeCompare(b.branchSlug));
