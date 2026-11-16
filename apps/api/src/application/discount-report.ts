import type {
  DiscountOrderDto,
  DiscountReportDto,
  PromoCreatorDto,
  PromoPayoutBody,
  PromoPayoutDto,
} from '@ss/contracts';
import type { PaidOrderRecord, PromoPayout } from '../domain/entities';
import type { BundleRepository, CatalogueReader, DiscountLedger, PromoCodeRepository } from '../domain/ports';
import { fail } from './errors';
import { creatorKey } from './promo-service';

const DAY = 24 * 60 * 60 * 1000;
const MAX_ORDERS = 500;

const toPayoutDto = (p: PromoPayout): PromoPayoutDto => ({
  id: p.id,
  creatorName: p.creatorName,
  amountPaise: p.amountPaise,
  note: p.note,
  paidAt: p.paidAt.toISOString(),
  recordedBy: p.recordedBy,
});

export interface OfferStats {
  uses: number;
  buyers: number;
  discountGivenPaise: number;
}

/**
 * Admin → Money → Discounts: every paid order with its student and where its discount came from
 * (a festival offer, a promo code, both, or none), and what each promo code's creator has earned,
 * been paid and is still owed.
 */
export class DiscountReportService {
  constructor(
    private readonly ledger: DiscountLedger,
    private readonly codes: PromoCodeRepository,
    private readonly catalogue: CatalogueReader,
    private readonly bundles: BundleRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async report(days: '7' | '30' | '90' | 'all'): Promise<DiscountReportDto> {
    const since = days === 'all' ? null : new Date(this.now().getTime() - Number(days) * DAY);
    const [period, allTime, codes, payouts] = await Promise.all([
      this.ledger.paidOrders(since),
      since ? this.ledger.paidOrders(null) : null,
      this.codes.listAll(),
      this.ledger.payouts(),
    ]);
    const orders = period;
    const everything = allTime ?? period;

    const buyers = (list: PaidOrderRecord[]) => new Set(list.map((o) => o.userId)).size;
    const promoOrders = orders.filter((o) => o.promo);
    const offerOrders = orders.filter((o) => o.offer);
    const fullPrice = orders.filter((o) => !o.promo && !o.offer);

    const shown = orders.slice(0, MAX_ORDERS);
    const titles = await this.titles(shown);
    return {
      since: since?.toISOString() ?? null,
      totals: {
        paidOrders: orders.length,
        buyers: buyers(orders),
        revenuePaise: orders.reduce((s, o) => s + o.amountPaise, 0),
        promoOrders: promoOrders.length,
        promoBuyers: buyers(promoOrders),
        offerOrders: offerOrders.length,
        offerBuyers: buyers(offerOrders),
        fullPriceOrders: fullPrice.length,
        fullPriceBuyers: buyers(fullPrice),
        discountPaise: orders.reduce(
          (s, o) => s + (o.offer?.discountPaise ?? 0) + (o.promo?.discountPaise ?? 0),
          0,
        ),
        commissionPaise: orders.reduce((s, o) => s + (o.promo?.commissionPaise ?? 0), 0),
      },
      creators: this.creators(everything, codes, payouts),
      payouts: payouts.map(toPayoutDto),
      orders: shown.map((o) => this.toOrderDto(o, titles)),
      ordersTruncated: orders.length > MAX_ORDERS,
    };
  }

  /** Paid orders that used one promo code, newest first (the code's "Students" list). */
  async promoOrders(promoCodeId: string): Promise<DiscountOrderDto[]> {
    const list = (await this.ledger.paidOrders(null)).filter((o) => o.promo?.promoCodeId === promoCodeId);
    const titles = await this.titles(list);
    return list.map((o) => this.toOrderDto(o, titles));
  }

  /** Paid orders that got their price from one offer, newest first. */
  async offerOrders(offerId: string): Promise<DiscountOrderDto[]> {
    const list = (await this.ledger.paidOrders(null)).filter((o) => o.offer?.offerId === offerId);
    const titles = await this.titles(list);
    return list.map((o) => this.toOrderDto(o, titles));
  }

  /** Uses, buyers and money taken off, per offer id (for the Offers list). */
  async offerStats(): Promise<Map<string, OfferStats>> {
    const out = new Map<string, OfferStats & { users: Set<string> }>();
    for (const o of await this.ledger.paidOrders(null)) {
      const id = o.offer?.offerId;
      if (!id) continue;
      const s = out.get(id) ?? { uses: 0, buyers: 0, discountGivenPaise: 0, users: new Set<string>() };
      s.uses++;
      s.users.add(o.userId);
      s.discountGivenPaise += o.offer!.discountPaise;
      out.set(id, s);
    }
    return new Map(
      [...out].map(([id, s]) => [
        id,
        { uses: s.uses, buyers: s.users.size, discountGivenPaise: s.discountGivenPaise },
      ]),
    );
  }

  /** Record money paid to a creator. Refuses unknown names and more than they are owed. */
  async addPayout(input: PromoPayoutBody, recordedBy: string): Promise<PromoPayoutDto> {
    const [orders, codes, payouts] = await Promise.all([
      this.ledger.paidOrders(null),
      this.codes.listAll(),
      this.ledger.payouts(),
    ]);
    const creator = this.creators(orders, codes, payouts).find(
      (c) => creatorKey(c.name) === creatorKey(input.creatorName),
    );
    if (!creator) throw fail.notFound(`A creator called ${input.creatorName}`);
    if (input.amountPaise > creator.owedPaise)
      throw fail.badRequest(
        creator.owedPaise > 0
          ? `${creator.name} is owed ₹${(creator.owedPaise / 100).toLocaleString('en-IN')}; enter that or less.`
          : `${creator.name} isn't owed anything right now.`,
      );
    const saved = await this.ledger.addPayout({
      creatorName: creator.name,
      amountPaise: input.amountPaise,
      note: input.note,
      recordedBy,
    });
    return toPayoutDto(saved);
  }

  private creators(
    orders: PaidOrderRecord[],
    codes: Awaited<ReturnType<PromoCodeRepository['listAll']>>,
    payouts: PromoPayout[],
  ): PromoCreatorDto[] {
    const by = new Map<string, PromoCreatorDto>();
    const get = (name: string) => {
      const key = creatorKey(name);
      let c = by.get(key);
      if (!c) {
        c = {
          name: name.trim(),
          contact: null,
          codes: [],
          uses: 0,
          salesPaise: 0,
          earnedPaise: 0,
          paidPaise: 0,
          owedPaise: 0,
        };
        by.set(key, c);
      }
      return c;
    };
    // Oldest code first, so the name and contact the creator was first set up with stand.
    for (const code of [...codes].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
      if (!code.creatorName) continue;
      const c = get(code.creatorName);
      c.contact ??= code.creatorContact;
      if (!c.codes.includes(code.code)) c.codes.push(code.code);
    }
    for (const o of orders) {
      if (!o.promo?.creatorName) continue;
      const c = get(o.promo.creatorName);
      c.uses++;
      c.salesPaise += o.amountPaise;
      c.earnedPaise += o.promo.commissionPaise;
      if (!c.codes.includes(o.promo.code)) c.codes.push(o.promo.code);
    }
    for (const p of payouts) get(p.creatorName).paidPaise += p.amountPaise;
    return [...by.values()]
      .map((c) => ({ ...c, codes: c.codes.sort(), owedPaise: Math.max(0, c.earnedPaise - c.paidPaise) }))
      .sort(
        (a, b) => b.owedPaise - a.owedPaise || b.earnedPaise - a.earnedPaise || a.name.localeCompare(b.name),
      );
  }

  /** Course and bundle titles for these orders, in two reads. */
  private async titles(orders: PaidOrderRecord[]) {
    const courseIds = [...new Set(orders.map((o) => o.courseId).filter((id): id is string => !!id))];
    const needBundles = orders.some((o) => o.bundleId);
    const [courses, bundles] = await Promise.all([
      courseIds.length ? this.catalogue.coursesByIds(courseIds) : [],
      needBundles ? this.bundles.listAll() : [],
    ]);
    return new Map<string, string>([
      ...courses.map((c) => [c.id, c.title] as const),
      ...bundles.map((b) => [b.id, b.title] as const),
    ]);
  }

  private toOrderDto(o: PaidOrderRecord, titles: Map<string, string>): DiscountOrderDto {
    const itemId = o.bundleId ?? o.courseId ?? '';
    return {
      orderId: o.orderId,
      paidAt: o.paidAt.toISOString(),
      studentName: o.fullName,
      studentEmail: o.email,
      itemKind: o.bundleId ? 'bundle' : 'course',
      itemTitle: titles.get(itemId) ?? (o.bundleId ? 'A deleted bundle' : 'A deleted course'),
      // Before any offer or code: the offer's starting price, else the code's, else what was paid.
      fullPaise: o.offer?.fullPaise ?? o.promo?.fullPaise ?? o.amountPaise,
      amountPaise: o.amountPaise,
      offer: o.offer
        ? { title: o.offer.title, percentOff: o.offer.percentOff, discountPaise: o.offer.discountPaise }
        : null,
      promo: o.promo
        ? {
            code: o.promo.code,
            discountPaise: o.promo.discountPaise,
            creatorName: o.promo.creatorName,
            commissionPaise: o.promo.commissionPaise,
          }
        : null,
    };
  }
}
