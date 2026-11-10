import type { Branch, Bundle, Course, DrawerRef, Offer } from '../domain/entities';
import type { CatalogueReader, OfferRepository } from '../domain/ports';
import type { AppConfig } from './config';
import { Memo } from './memo';
import { offeringsOf } from './offerings';
import {
  type Priced,
  bestPrice,
  bundleAudience,
  charmDownPaise,
  coversBundle,
  coversCourse,
  isRunning,
} from './offers';

/** How long offers and offerings are reused before they are read again. */
const FRESH_MS = 20_000;

interface Reach {
  offerings: Map<string, DrawerRef[]>;
  commonSlugs: string[];
  programmeSlugs: string[];
}

/**
 * Today's prices. The catalogue shows them and checkout charges them, from the same rules, so a
 * student never pays more (or less) than the card said. Base prices live on courses and bundles;
 * running offers are applied here, never written over the base price, so an offer ending simply
 * puts the old price back.
 */
export class PriceBook {
  constructor(
    private readonly offers: OfferRepository,
    private readonly catalogue: CatalogueReader,
    private readonly config: AppConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // One read shared by every price on a page (a drawer prices dozens of cards at once).
  private readonly offerMemo = new Memo<Offer[]>(
    async () => {
      try {
        return await this.offers.listAll();
      } catch (error) {
        // No offers table yet, or the database hiccuped: sell at the normal price.
        console.error('[offers] could not read offers:', error instanceof Error ? error.message : error);
        return [];
      }
    },
    FRESH_MS,
    15 * 60_000,
  );
  private readonly reachMemo = new Memo<Reach>(
    async () => {
      const [links, branches] = await Promise.all([
        this.catalogue.listLiveCourseLinks(),
        this.catalogue.listBranches(),
      ]);
      return reachOf(
        links.map((l) => ({ course: l.course, branchSlugs: l.branchSlugs })),
        branches,
        this.config.currentIntakeYear,
      );
    },
    FRESH_MS,
    15 * 60_000,
  );

  forget() {
    this.offerMemo.forget();
    this.reachMemo.forget();
  }

  /** Offers running right now. The list is remembered briefly; dates are checked on every call. */
  async running(): Promise<Offer[]> {
    const now = this.now();
    return (await this.offerMemo.get()).filter((o) => isRunning(o, now));
  }

  /** Every live course's drawers, and which programmes are shared or real. */
  reach(): Promise<Reach> {
    return this.reachMemo.get();
  }

  async coursePrice(course: Pick<Course, 'id' | 'pricePaise'>): Promise<Priced> {
    return (await this.coursePrices([course])).get(course.id) ?? { pricePaise: course.pricePaise };
  }

  /** Today's price of each course, by id. */
  async coursePrices(courses: Pick<Course, 'id' | 'pricePaise'>[]): Promise<Map<string, Priced>> {
    const running = await this.running();
    const out = new Map<string, Priced>();
    if (!running.length) {
      for (const c of courses) out.set(c.id, { pricePaise: c.pricePaise });
      return out;
    }
    const reach = running.some((o) => o.drawers.length) ? await this.reach() : null;
    for (const c of courses)
      out.set(
        c.id,
        bestPrice(
          running,
          coversCourse(c.id, reach?.offerings.get(c.id) ?? [], reach?.commonSlugs ?? []),
          c.pricePaise,
        ),
      );
    return out;
  }

  /** Cards (or anything with an id and base price) at today's price. Leaves the input untouched. */
  async priceCards<T extends { id: string; pricePaise: number }>(cards: T[]): Promise<T[]> {
    const prices = await this.coursePrices(cards);
    return cards.map((card) => {
      const p = prices.get(card.id);
      if (!p?.offer) return card;
      return { ...card, pricePaise: p.pricePaise, offer: p.offer };
    });
  }

  async audience(bundle: Pick<Bundle, 'courseIds' | 'offeredTo' | 'batchYear'>): Promise<DrawerRef[]> {
    if (bundle.offeredTo) return bundleAudience(bundle, () => [], [], []);
    const reach = await this.reach();
    return bundleAudience(
      bundle,
      (id) => reach.offerings.get(id) ?? [],
      reach.programmeSlugs,
      reach.commonSlugs,
    );
  }

  /**
   * A bundle's price today: its own offer, and never more than its courses would cost one by one
   * at today's prices (so a big course sale can't make the bundle the worse deal).
   */
  async bundlePrice(
    bundle: Bundle,
    courses: Pick<Course, 'id' | 'pricePaise'>[],
    audience?: DrawerRef[],
  ): Promise<Priced & { coursePrices: Map<string, Priced> }> {
    const running = await this.running();
    const coursePrices = await this.coursePrices(courses);
    const own = running.length
      ? bestPrice(
          running,
          coversBundle(bundle.id, audience ?? (await this.audience(bundle))),
          bundle.pricePaise,
        )
      : { pricePaise: bundle.pricePaise };
    const separately = courses.reduce((s, c) => s + (coursePrices.get(c.id)?.pricePaise ?? c.pricePaise), 0);
    // A big sale on single courses must never make the bundle the dearer (or equal) way to buy:
    // then it stays about 15% under its courses at their sale prices, ending in 9.
    const listPaise = courses.reduce((s, c) => s + c.pricePaise, 0);
    // Only while single courses are on sale: the admin's own bundle price stands otherwise.
    if (courses.length > 1 && separately < listPaise && own.pricePaise >= separately * 0.9) {
      const first = [...coursePrices.values()].find((p) => p.offer)?.offer;
      return {
        pricePaise: Math.min(own.pricePaise, charmDownPaise(separately * 0.85)),
        ...(first ? { offer: { ...first, fullPricePaise: bundle.pricePaise } } : {}),
        coursePrices,
      };
    }
    return { ...own, coursePrices };
  }
}

/** Drawers per course id, from courses and how they were filed. */
export function reachOf(
  links: { course: Course; branchSlugs: string[] }[],
  branches: Branch[],
  intakeYear: number,
): Reach {
  const active = branches.filter((b) => b.isActive !== false);
  const offerings = new Map<string, DrawerRef[]>();
  for (const l of links)
    offerings.set(
      l.course.id,
      offeringsOf(l.course, l.branchSlugs, branches, intakeYear).map((o) => ({
        batchYear: o.batchYear,
        branchSlug: o.branchSlug,
      })),
    );
  return {
    offerings,
    commonSlugs: active.filter((b) => b.isCommon).map((b) => b.slug),
    programmeSlugs: active.filter((b) => !b.isCommon).map((b) => b.slug),
  };
}
