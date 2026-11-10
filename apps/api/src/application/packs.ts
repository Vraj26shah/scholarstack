import {
  type CourseCardDto,
  PACK_LADDER_RUPEES,
  type PackPlanDto,
  type PackRunBody,
  type PackRunDto,
} from '@ss/contracts';
import type { Bundle } from '../domain/entities';
import type { BundleRepository, SettingsRepository } from '../domain/ports';
import type { CatalogueService } from './catalogue-service';
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
const DEFAULTS: PackSettings = { status: 'live', titlePrefix: 'Semester pack', keepInSync: false };

/** The pack price for this many courses, always clearly under the courses bought one by one. */
export function packPricePaise(
  count: number,
  listPaise: number,
  cheapestPaise = listPaise / Math.max(1, count),
): number {
  const top = Math.max(...Object.keys(PACK_LADDER_RUPEES).map(Number));
  const ladder =
    count < 2 ? 0 : (PACK_LADDER_RUPEES[Math.min(count, top)] ?? 0) + Math.max(0, count - top) * 50;
  const rupees = ladder * 100;
  // The pack has to be the better deal twice over: clearly under the courses one by one, and each
  // course in it cheaper than the cheapest course bought on its own.
  if (rupees > 0 && rupees <= listPaise * 0.85 && rupees / count <= cheapestPaise * 0.95) return rupees;
  // Odd course prices (two ₹79 courses, say): 15% off, and at most 90% of the cheapest each.
  return charmDownPaise(Math.min(listPaise * 0.85, cheapestPaise * 0.9 * count));
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
    return { ...DEFAULTS, ...(await this.settings.get<Partial<PackSettings>>(SETTINGS_KEY, {})) };
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
    const settings: PackSettings = {
      status: input.status,
      titlePrefix: input.titlePrefix.trim(),
      keepInSync: input.keepInSync,
    };
    // Read the drawers fresh, not from the 20-second cache.
    this.catalogue.forget();
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
        const pricePaise = packPricePaise(
          cards.length,
          listPaise,
          Math.min(...cards.map((c) => fullPrice(c))),
        );
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
            slug,
            save: { ...next, slug, courseIds: [...courseIds], offeredTo: [...next.offeredTo] },
          });
          continue;
        }
        const same =
          existing.title === next.title &&
          existing.pricePaise === next.pricePaise &&
          existing.status === next.status &&
          existing.description === next.description &&
          existing.courseIds.length === courseIds.length &&
          existing.courseIds.every((id, i) => id === courseIds[i]) &&
          existing.offeredTo?.length === 1;
        plans.push({
          ...base,
          ...summary,
          pricePaise,
          savePercent,
          action: same ? 'same' : 'update',
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

    const totals = { create: 0, update: 0, same: 0, retire: 0, skip: 0 };
    for (const p of plans) totals[p.action]++;
    return {
      settings,
      plans: plans
        .map(({ save: _save, ...p }) => p)
        .sort((a, b) => b.batchYear - a.batchYear || a.branchCode.localeCompare(b.branchCode)),
      totals,
      applied: !input.dryRun,
    };
  }
}
