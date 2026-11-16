import type { AdminOfferDto, AnnouncementDto, SaveOfferBody } from '@ss/contracts';
import type { Offer } from '../domain/entities';
import type { BundleRepository, CatalogueReader, OfferRepository } from '../domain/ports';
import type { AnnouncementService } from './announcement-service';
import type { OfferStats } from './discount-report';
import { fail } from './errors';
import { type InviteKind, offerBatchYears, offerInvite } from './offer-invite';
import { ALL, coversBundle, coversCourse, isRunning } from './offers';
import type { PriceBook } from './price-book';

/** Admin: create, change and end offers (Diwali and the like). Prices themselves are never edited. */
export class OfferService {
  constructor(
    private readonly offers: OfferRepository,
    private readonly bundles: BundleRepository,
    private readonly catalogue: CatalogueReader,
    private readonly prices: PriceBook,
    private readonly stats: { offerStats(): Promise<Map<string, OfferStats>> },
    private readonly now: () => Date = () => new Date(),
    /** The emails about each offer (optional: without it, offers simply have none). */
    private readonly emails?: Pick<AnnouncementService, 'byOffer' | 'draftOfferInvite'>,
  ) {}

  /**
   * Drafts the email that invites students to an offer (or reminds them on its last day), sent
   * only to the batches it reaches. The admin reads it, sends a test and sends it from Emails.
   */
  async invite(id: string, kind: InviteKind) {
    if (!this.emails) throw fail.badRequest('Email is not set up here.');
    const offer = (await this.offers.listAll()).find((o) => o.id === id);
    if (!offer) throw fail.notFound('That offer');
    if (offer.status !== 'live' || offer.endsAt.getTime() <= this.now().getTime())
      throw fail.badRequest(
        'Switch the offer on (and give it an end in the future) before inviting students.',
      );
    const reach = await this.prices.reach();
    const bundles = new Map((await this.bundles.listAll()).map((b) => [b.id, b]));
    const audiences = new Map(
      await Promise.all(
        offer.bundleIds
          .filter((b) => bundles.has(b))
          .map(async (b) => [b, await this.prices.audience(bundles.get(b)!)] as const),
      ),
    );
    const years = offerBatchYears(
      offer,
      (c) => reach.offerings.get(c) ?? [],
      (b) => audiences.get(b) ?? [],
    );
    if (years && years.length === 0)
      throw fail.badRequest('This offer reaches no batch yet, so there is no one to invite.');
    return this.emails.draftOfferInvite({ offerId: offer.id, ...offerInvite(offer, kind, years) });
  }

  async list(): Promise<AdminOfferDto[]> {
    const [offers, reach, bundles, used, emails] = await Promise.all([
      this.offers.listAll(),
      this.prices.reach(),
      this.bundles.listLive(),
      // Usage counts are extra: if they can't be read, the offers still show (with zeros).
      this.stats
        .offerStats()
        .catch((error) => {
          console.error(
            '[offers] could not read offer usage:',
            error instanceof Error ? error.message : error,
          );
          return new Map<string, OfferStats>();
        }),
      // Like the usage counts: a hiccup reading emails never hides the offers.
      (this.emails?.byOffer() ?? Promise.resolve(new Map<string, AnnouncementDto[]>())).catch(
        () => new Map<string, AnnouncementDto[]>(),
      ),
    ]);
    const audiences = await Promise.all(bundles.map((b) => this.prices.audience(b)));
    const now = this.now();
    return offers.map((o) => ({
      id: o.id,
      title: o.title,
      percentOff: o.percentOff,
      startsAt: o.startsAt.toISOString(),
      endsAt: o.endsAt.toISOString(),
      status: o.status,
      everything: o.everything,
      allCourses: o.allCourses,
      allBundles: o.allBundles,
      courseIds: o.courseIds,
      bundleIds: o.bundleIds,
      drawers: o.drawers,
      running: isRunning(o, now),
      reach: {
        courses: [...reach.offerings].filter(([id, offerings]) =>
          coversCourse(id, offerings, reach.commonSlugs)(o),
        ).length,
        bundles: bundles.filter((b, i) => coversBundle(b.id, audiences[i] ?? [])(o)).length,
      },
      invitations: (emails.get(o.id) ?? []).map((a) => ({
        id: a.id,
        subject: a.subject,
        status: a.status,
        sent: a.sent,
        waiting: a.waiting,
      })),
      uses: used.get(o.id)?.uses ?? 0,
      buyers: used.get(o.id)?.buyers ?? 0,
      discountGivenPaise: used.get(o.id)?.discountGivenPaise ?? 0,
    }));
  }

  async save(input: SaveOfferBody): Promise<AdminOfferDto> {
    const branches = await this.catalogue.listBranches();
    const known = new Set(branches.map((b) => b.slug));
    const odd = input.drawers.filter((d) => d.branchSlug !== ALL && !known.has(d.branchSlug));
    if (odd.length) throw fail.badRequest(`Unknown programme: ${odd.map((d) => d.branchSlug).join(', ')}.`);
    if (input.id && !(await this.offers.listAll()).some((o) => o.id === input.id))
      throw fail.notFound('That offer');
    // All courses and all bundles together is simply everything.
    const everything = input.everything || (input.allCourses && input.allBundles);
    const allCourses = !everything && input.allCourses;
    const allBundles = !everything && input.allBundles;
    // A whole-shop, all-courses or all-bundles offer already covers the rest; keeping the lists
    // would only confuse a later edit.
    const wide = everything || allCourses || allBundles;
    const offer: Omit<Offer, 'id'> & { id?: string } = {
      ...(input.id ? { id: input.id } : {}),
      title: input.title,
      percentOff: input.percentOff,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      status: input.status,
      everything,
      allCourses,
      allBundles,
      courseIds: wide ? [] : [...new Set(input.courseIds)],
      bundleIds: wide ? [] : [...new Set(input.bundleIds)],
      drawers: wide
        ? []
        : [...new Map(input.drawers.map((d) => [`${d.batchYear}:${d.branchSlug}`, d] as const)).values()],
    };
    const saved = await this.offers.save(offer);
    this.prices.forget();
    return (await this.list()).find((o) => o.id === saved.id)!;
  }

  async remove(id: string) {
    if (!(await this.offers.remove(id))) throw fail.notFound('That offer');
    this.prices.forget();
    return { ok: true as const };
  }
}
