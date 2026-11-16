import { offerPackName } from '@ss/contracts';
import type { DrawerRef, Offer } from '../domain/entities';

/**
 * The email that tells students about an offer, written from the offer itself, so its name,
 * percentage, what it covers and when it ends are always right. The admin reviews it (and can
 * edit it) in Emails before it goes out.
 *
 * - launch:   "Diwali offer: 20% off every course and bundle, till Sun 22 Nov"
 * - reminder: "Last day: Diwali offer ends tonight" (for the offer's final day)
 */
export type InviteKind = 'launch' | 'reminder';

export interface OfferInvite {
  subject: string;
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  /** Only these batches (an offer on chosen drawers or courses); null = every opted-in student. */
  batchYears: number[] | null;
}

/** "Sun 22 Nov, 11:59 pm", in India's time (where the students are). */
export const endsText = (d: Date) =>
  d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

const covers = (o: Offer) =>
  o.everything
    ? 'every course and bundle'
    : o.allCourses
      ? 'every course'
      : o.allBundles
        ? 'every bundle'
        : 'the notes for your batch';

/**
 * Which batches an offer reaches: none named (everyone) for a whole-shop, all-courses or
 * all-bundles offer; otherwise the batches of its drawers, of the courses it names (by where
 * they're offered) and of the bundles it names (by where they show).
 */
export function offerBatchYears(
  o: Offer,
  courseDrawers: (courseId: string) => DrawerRef[],
  bundleDrawers: (bundleId: string) => DrawerRef[],
): number[] | null {
  if (o.everything || o.allCourses || o.allBundles) return null;
  const years = new Set<number>(o.drawers.map((d) => d.batchYear));
  for (const id of o.courseIds) for (const d of courseDrawers(id)) years.add(d.batchYear);
  for (const id of o.bundleIds) for (const d of bundleDrawers(id)) years.add(d.batchYear);
  return [...years].sort((a, b) => b - a);
}

export function offerInvite(o: Offer, kind: InviteKind, batchYears: number[] | null): OfferInvite {
  const what = covers(o);
  const until = endsText(o.endsAt);
  const packs = o.everything || o.allBundles;
  const howTo =
    'The prices on the site already show it, so there is no code to type: open your drawer, peek at page one of every unit, and buy at the offer price.';
  const packLine = packs
    ? `\n\nThe ${offerPackName(o.title)}s (every course in your drawer, together) are ${o.percentOff}% off too, the best deal on the site.`
    : '';
  if (kind === 'reminder')
    return {
      subject: `Last day: ${o.title} ends ${until}`,
      heading: `Last day for ${o.percentOff}% off.`,
      body: `${o.title} ends ${until}. Until then, ${what} is ${o.percentOff}% off.${packLine}\n\n${howTo}`,
      ctaLabel: 'See the offer prices',
      ctaUrl: '/#catalogue',
      batchYears,
    };
  return {
    subject: `${o.title}: ${o.percentOff}% off ${what}, till ${until}`,
    heading: `${o.title}: ${o.percentOff}% off.`,
    body: `${capital(what)} on Scholars Stack is ${o.percentOff}% off until ${until}.${packLine}\n\n${howTo}\n\nPurchases are final, so check the units against your syllabus before you buy.`,
    ctaLabel: 'See the offer prices',
    ctaUrl: '/#catalogue',
    batchYears,
  };
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
