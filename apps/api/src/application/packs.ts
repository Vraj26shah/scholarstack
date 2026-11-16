import {
  type CourseCardDto,
  PACK_LADDER_RUPEES,
  type PackLadder,
  type PackPlanDto,
  type PackRunBody,
  type PackRunDto,
  ladderProblems,
  ladderRupees,
} from '@ss/contracts';
import type { Bundle } from '../domain/entities';
import type { BundleRepository, SettingsRepository } from '../domain/ports';
import type { CatalogueService } from './catalogue-service';
import { fail } from './errors';
import { charmDownPaise } from './offers';

/**
 * Drawer packs: for every drawer (batch × programme) one bundle with every live course that drawer
 * shows, on a fixed price ladder. Courses are shared across years and programmes, so the drawer is
 * the one place that knows what a student studies this term; the pack simply follows it.
 *
 * The builder is safe to run again and again: it creates packs for new drawers, updates the courses
 * and price of existing ones, and takes a pack off sale when its drawer drops below two courses.
 * A drawer that already has a hand-made bundle shown only there is left alone.
 */

const SETTINGS_KEY = 'drawer_packs';
type PackSettings = PackRunDto['settings'];
const DEFAULTS: PackSettings = {
  status: 'live',
  titlePrefix: 'Semester pack',
  keepInSync: false,
  ladder: PACK_LADDER_RUPEES,
};

/** A usable ladder: the saved one when it is whole and sound, else the suggested prices. */
function usableLadder(ladder: PackLadder | undefined): PackLadder {
  return ladder && ladderProblems(ladder).length === 0 ? { ...ladder } : { ...PACK_LADDER_RUPEES };
}

/**
 * The pack price for this many courses: the admin's price for that size, but always clearly the
 * better deal: under 85% of the courses one by one, and each course in it under 95% of the
 * cheapest course bought alone. When the ladder price would break that (two cheap courses, say),
 * the pack drops to 15% off, at most 90% of the cheapest each, ending in 9.
 */
export function packPricePaise(
  count: number,
  listPaise: number,
  cheapestPaise = listPaise / Math.max(1, count),
  ladder: PackLadder = PACK_LADDER_RUPEES,
): number {
  return packPrice(count, listPaise, cheapestPaise, ladder).pricePaise;
}

function packPrice(count: number, listPaise: number, cheapestPaise: number, ladder: PackLadder) {
  const rupees = ladderRupees(ladder, count) * 100;
  if (rupees > 0 && rupees <= listPaise * 0.85 && rupees / count <= cheapestPaise * 0.95)
    return { pricePaise: rupees, lowered: false, ladderPaise: rupees };
  return {
    pricePaise: charmDownPaise(Math.min(listPaise * 0.85, cheapestPaise * 0.9 * count)),
    lowered: rupees > 0,
    ladderPaise: rupees,
  };
}

const fullPrice = (c: CourseCardDto) => c.offer?.fullPricePaise ?? c.pricePaise;

function describe(titles: string[]): string {
  const list =
    titles.length <= 1 ? titles.join('') : `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}`;
  const text = `Every course in your drawer this term, together for less: ${list}.`;
  return text.length <= 600 ? text : `${text.slice(0, 596)}….`;
}

export class PackService {
  constructor(
    private readonly catalogue: CatalogueService,
    private readonly bundles: BundleRepository,
    private readonly settings: SettingsRepository,
  ) {}

  async savedSettings(): Promise<PackSettings> {
    const saved = await this.settings.get<Partial<PackSettings>>(SETTINGS_KEY, {});
    return { ...DEFAULTS, ...saved, ladder: usableLadder(saved.ladder) };
  }

  /** What the builder would do with the saved settings (nothing is changed). */
  async preview(): Promise<PackRunDto> {
    const s = await this.savedSettings();
    return this.run({ ...s, dryRun: true });
  }

  /** The hourly run: only when the admin asked packs to stay in sync. */
  async sync(): Promise<PackRunDto | null> {
    const s = await this.savedSettings();
    if (!s.keepInSync) return null;
    const out = await this.run({ ...s, dryRun: false }, false);
    if (out.totals.create + out.totals.update + out.totals.retire > 0) this.catalogue.forget();
    return out;
  }

  async run(input: PackRunBody, remember = true): Promise<PackRunDto> {
    if (input.ladder) {
      const problems = ladderProblems(input.ladder);
      if (problems.length)
        throw fail.badRequest(
          `Pack prices: ${problems.map((p) => `${p.size} courses: ${p.message}`).join(' ')}`,
        );
    }
    const settings: PackSettings = {
      status: input.status,
      titlePrefix: input.titlePrefix.trim(),
      keepInSync: input.keepInSync,
      ladder: input.ladder ? { ...input.ladder } : (await this.savedSettings()).ladder,
    };
    // A real build reads the drawers fresh; a preview may use the 20-second copy, so previewing
    // (even on every price change) never slows the public catalogue down.
    if (!input.dryRun) this.catalogue.forget();
    const [index, all] = await Promise.all([this.catalogue.index(), this.bundles.listAll()]);
    const drawers = await this.catalogue.allDrawers(
      index.batches.map((b) => b.year),
      index.branches.filter((b) => !b.isCommon).map((b) => b.slug),
    );
    const programmes = index.branches.filter((b) => !b.isCommon);
    const byKey = new Map(all.filter((b) => b.autoDrawer).map((b) => [b.autoDrawer!, b]));
    // A hand-made bundle shown in exactly one drawer owns that drawer: no pack beside it.
    const owned = new Set(
      all
        .filter((b) => !b.autoDrawer && b.status !== 'archived' && b.offeredTo?.length === 1)
        .map((b) => `${b.offeredTo![0]!.batchYear}:${b.offeredTo![0]!.branchSlug}`),
    );
    const usedSlugs = new Set(all.map((b) => b.slug));
    const plans: (PackPlanDto & { save?: Omit<Bundle, 'id'> & { id?: string } })[] = [];

    for (const batch of index.batches) {
      for (const branch of programmes) {
        const key = `${batch.year}:${branch.slug}`;
        const existing = byKey.get(key);
        const title = `${settings.titlePrefix} · ${batch.year} ${branch.code || branch.slug.toUpperCase()}`;
        const base = {
          batchYear: batch.year,
          branchSlug: branch.slug,
          branchCode: branch.code || branch.slug.toUpperCase(),
          branchName: branch.name,
          title,
        };
        const cards = drawers.get(key) ?? [];
        const listPaise = cards.reduce((s, c) => s + fullPrice(c), 0);
        const summary = {
          courseTitles: cards.map((c) => c.title),
          courseCount: cards.length,
          listPricePaise: listPaise,
        };
        if (owned.has(key) && !existing) {
          plans.push({
            ...base,
            ...summary,
            pricePaise: 0,
            savePercent: 0,
            action: 'skip',
            note: 'A bundle you made is shown here',
          });
          continue;
        }
        if (cards.length < 2) {
          if (existing && existing.status === 'live')
            plans.push({
              ...base,
              ...summary,
              pricePaise: existing.pricePaise,
              savePercent: 0,
              action: 'retire',
              note: 'Fewer than two live courses now',
              bundleId: existing.id,
              slug: existing.slug,
              save: { ...existing, status: 'draft' },
            });
          else
            plans.push({
              ...base,
              ...summary,
              pricePaise: 0,
              savePercent: 0,
              action: 'skip',
              note: cards.length ? 'Only one live course' : 'No live courses yet',
            });
          continue;
        }
        const priced = packPrice(
          cards.length,
          listPaise,
          Math.min(...cards.map((c) => fullPrice(c))),
          settings.ladder,
        );
        const pricePaise = priced.pricePaise;
        // Told plainly when the pack can't take its ladder price (it would not be a deal).
        const lowered = priced.lowered
          ? `Lowered from ₹${priced.ladderPaise / 100} so it stays cheaper than the courses one by one`
          : undefined;
        if (pricePaise >= listPaise) {
          plans.push({
            ...base,
            ...summary,
            pricePaise,
            savePercent: 0,
            action: 'skip',
            note: 'No saving at these prices',
          });
          continue;
        }
        const savePercent = Math.round((1 - pricePaise / listPaise) * 100);
        const courseIds = cards.map((c) => c.id);
        const next = {
          title,
          description: describe(cards.map((c) => c.title)),
          batchYear: null,
          pricePaise,
          status: settings.status,
          courseIds,
          offeredTo: [{ batchYear: batch.year, branchSlug: branch.slug }],
          autoDrawer: key,
        } as const;
        if (!existing) {
          let slug = `pack-${batch.year}-${branch.slug}`;
          for (let i = 2; usedSlugs.has(slug); i++) slug = `pack-${batch.year}-${branch.slug}-${i}`;
          usedSlugs.add(slug);
          plans.push({
            ...base,
            ...summary,
            pricePaise,
            savePercent,
            action: 'create',
            ...(lowered ? { note: lowered } : {}),
            slug,
            save: { ...next, slug, courseIds: [...courseIds], offeredTo: [...next.offeredTo] },
          });
          continue;
        }
        const sameCourses =
          existing.courseIds.length === courseIds.length &&
          existing.courseIds.every((id, i) => id === courseIds[i]);
        // What would change, in words, so "22 to update" is never a mystery.
        const changes = [
          existing.pricePaise !== next.pricePaise
            ? `price ₹${existing.pricePaise / 100} → ₹${next.pricePaise / 100}`
            : '',
          sameCourses ? '' : 'courses changed',
          existing.title !== next.title ? `renamed from "${existing.title.split(' · ')[0]}"` : '',
          existing.status !== next.status ? `${existing.status} → ${next.status}` : '',
          existing.description !== next.description && sameCourses ? 'description' : '',
          existing.offeredTo?.length === 1 ? '' : 'drawer fixed',
        ].filter(Boolean);
        const same = changes.length === 0;
        plans.push({
          ...base,
          ...summary,
          pricePaise,
          savePercent,
          action: same ? 'same' : 'update',
          ...(lowered || !same
            ? { note: [lowered, same ? '' : `Will change: ${changes.join(', ')}`].filter(Boolean).join('. ') }
            : {}),
          bundleId: existing.id,
          slug: existing.slug,
          ...(same
            ? {}
            : {
                save: {
                  ...existing,
                  ...next,
                  courseIds: [...courseIds],
                  offeredTo: [...next.offeredTo],
                },
              }),
        });
      }
    }

    // Packs whose drawer no longer exists (a batch that graduated, a programme switched off).
    const seen = new Set(plans.map((p) => `${p.batchYear}:${p.branchSlug}`));
    for (const [key, b] of byKey)
      if (!seen.has(key) && b.status === 'live')
        plans.push({
          batchYear: Number(key.split(':')[0]),
          branchSlug: key.split(':')[1] ?? '',
          branchCode: (key.split(':')[1] ?? '').toUpperCase(),
          branchName: '',
          title: b.title,
          courseTitles: [],
          courseCount: 0,
          listPricePaise: 0,
          pricePaise: b.pricePaise,
          savePercent: 0,
          action: 'retire',
          note: 'Its drawer is no longer shown',
          bundleId: b.id,
          slug: b.slug,
          save: { ...b, status: 'draft' },
        });

    if (!input.dryRun) {
      for (const plan of plans) {
        if (!plan.save) continue;
        const saved = await this.bundles.save(plan.save);
        plan.bundleId = saved.id;
      }
      if (remember) await this.settings.set(SETTINGS_KEY, settings);
      // The public catalogue shows the new packs straight away.
      this.catalogue.forget();
    }

    // The real one-by-one prices of every live course, for the price list's own explanation.
    const prices = [...new Map([...drawers.values()].flat().map((c) => [c.id, fullPrice(c)])).values()];
    const coursePrices = prices.length
      ? {
          minPaise: Math.min(...prices),
          maxPaise: Math.max(...prices),
          averagePaise: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length),
        }
      : null;
    const totals = { create: 0, update: 0, same: 0, retire: 0, skip: 0 };
    for (const p of plans) totals[p.action]++;
    return {
      settings,
      plans: plans
        .map(({ save: _save, ...p }) => p)
        .sort((a, b) => b.batchYear - a.batchYear || a.branchCode.localeCompare(b.branchCode)),
      totals,
      coursePrices,
      applied: !input.dryRun,
    };
  }
}
