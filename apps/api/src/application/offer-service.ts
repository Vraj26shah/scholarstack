import type { AdminOfferDto, SaveOfferBody } from '@ss/contracts';
import type { Offer } from '../domain/entities';
import type { BundleRepository, CatalogueReader, OfferRepository } from '../domain/ports';
import { fail } from './errors';
import { ALL, coversBundle, coversCourse, isRunning } from './offers';
import type { PriceBook } from './price-book';

/** Admin: create, change and end offers (Diwali and the like). Prices themselves are never edited. */
export class OfferService {
  constructor(
    private readonly offers: OfferRepository,
    private readonly bundles: BundleRepository,
    private readonly catalogue: CatalogueReader,
    private readonly prices: PriceBook,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(): Promise<AdminOfferDto[]> {
    const [offers, reach, bundles] = await Promise.all([
      this.offers.listAll(),
      this.prices.reach(),
      this.bundles.listLive(),
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
    }));
  }

  async save(input: SaveOfferBody): Promise<AdminOfferDto> {
    const branches = await this.catalogue.listBranches();
    const known = new Set(branches.map((b) => b.slug));
    const odd = input.drawers.filter((d) => d.branchSlug !== ALL && !known.has(d.branchSlug));
    if (odd.length) throw fail.badRequest(`Unknown programme: ${odd.map((d) => d.branchSlug).join(', ')}.`);
    if (input.id && !(await this.offers.listAll()).some((o) => o.id === input.id))
      throw fail.notFound('That offer');
    const offer: Omit<Offer, 'id'> & { id?: string } = {
      ...(input.id ? { id: input.id } : {}),
      title: input.title,
      percentOff: input.percentOff,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      status: input.status,
      everything: input.everything,
      // "Everything" already covers the rest; keeping the lists would only confuse a later edit.
      courseIds: input.everything ? [] : [...new Set(input.courseIds)],
      bundleIds: input.everything ? [] : [...new Set(input.bundleIds)],
      drawers: input.everything
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
