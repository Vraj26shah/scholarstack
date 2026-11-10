import { ACCESS_MONTHS, courseBlurb } from '@ss/contracts';
import {
  type BundleCardDto,
  type BundleDetailDto,
  type CatalogueIndexDto,
  type CatalogueSearchDto,
  type CourseCardDto,
  type CourseDetailDto,
  type ReadingItemDto,
  semesterRange,
  yearLabel,
} from '@ss/contracts';
import {
  type Branch,
  type Bundle,
  type Course,
  type CourseBook,
  type CourseFile,
  type DrawerRef,
  accessState,
  isReaderReady,
} from '../domain/entities';
import type {
  BundleRepository,
  CatalogueReader,
  ContributionRepository,
  CourseBookRepository,
  EntitlementRepository,
  ObjectStore,
} from '../domain/ports';
import type { AppConfig } from './config';
import { fail } from './errors';
import { bookTitle, looksLikeTextbook } from './folders';
import { isPreviewFile, toBundleCard, toCard, toUnits } from './mappers';
import { type Offering, inDrawer, offeringsOf, termSemester } from './offerings';
import { audienceShows } from './offers';
import type { PriceBook } from './price-book';
import { bundlePricing } from './pricing';

/** Browsing the catalogue: drawers (batches), tabs (branches), cards (courses), bundles and previews. */
/** How long a public catalogue read is reused before it is read again. */
const FRESH_MS = 20_000;

export class CatalogueService {
  constructor(
    private readonly catalogue: CatalogueReader,
    private readonly bundles: BundleRepository,
    private readonly entitlements: EntitlementRepository,
    private readonly pages: ObjectStore,
    private readonly config: AppConfig,
    private readonly books: CourseBookRepository,
    private readonly contributions: ContributionRepository,
    private readonly prices: PriceBook,
  ) {}

  private statsCache: { at: number; value: NonNullable<CatalogueIndexDto['stats']> } | null = null;
  private indexCache: { at: number; value: CatalogueIndexDto } | null = null;
  private drawerCache = new Map<string, { at: number; value: CourseCardDto[] }>();

  /**
   * Drops every cached read, so an admin's change shows at once. (Other server instances
   * catch up within FRESH_MS.)
   */
  forget() {
    this.statsCache = null;
    this.indexCache = null;
    this.searchCache = null;
    this.drawerCache.clear();
    this.bundleCache = null;
    this.prices.forget();
    // The remembered database reads underneath (see cached-catalogue.ts).
    (this.catalogue as Partial<{ forget(): void }>).forget?.();
    (this.bundles as Partial<{ forget(): void }>).forget?.();
  }

  /** Every live course with the drawers (batch × programme) it shows in, in one read. */
  private async liveOfferings(branches: Branch[]): Promise<{ course: Course; offerings: Offering[] }[]> {
    const intake = this.config.currentIntakeYear;
    return (await this.catalogue.listLiveCourseLinks()).map((l) => ({
      course: l.course,
      offerings: offeringsOf(l.course, l.branchSlugs, branches, intake),
    }));
  }

  /** Live courses offered to at least one visible batch. */
  private async liveCourses(batches: { year: number }[], branches: Branch[]) {
    const years = new Set(batches.map((b) => b.year));
    return (await this.liveOfferings(branches))
      .filter((l) => l.offerings.some((o) => years.has(o.batchYear)))
      .map((l) => l.course);
  }

  /** Totals across every live course, cached briefly: the home page asks on every visit. */
  private async stats(
    batches: { year: number }[],
    branches: Branch[],
  ): Promise<NonNullable<CatalogueIndexDto['stats']>> {
    if (this.statsCache && Date.now() - this.statsCache.at < 5 * 60_000) return this.statsCache.value;
    const courses = await this.liveCourses(batches, branches);
    const files = (await this.catalogue.listFiles(courses.map((course) => course.id))).filter(
      (file) => file.conversionStatus === 'ready' && file.pageCount > 0,
    );
    const value = {
      courses: courses.length,
      files: files.length,
      pages: files.reduce((sum, file) => sum + file.pageCount, 0),
      subjects: [...new Set(courses.map((course) => course.title))].sort().slice(0, 40),
    };
    this.statsCache = { at: Date.now(), value };
    return value;
  }

  async index(): Promise<CatalogueIndexDto> {
    if (this.indexCache && Date.now() - this.indexCache.at < FRESH_MS) return this.indexCache.value;
    const value = await this.buildIndex();
    this.indexCache = { at: Date.now(), value };
    return value;
  }

  private async buildIndex(): Promise<CatalogueIndexDto> {
    const [batches, branches] = await Promise.all([
      this.catalogue.listBatches(),
      this.catalogue.listBranches(),
    ]);
    const intake = this.config.currentIntakeYear;
    const stats = await this.stats(batches, branches).catch(() => undefined);
    return {
      ...(stats ? { stats } : {}),
      batches: batches
        .filter((b) => b.year <= intake && intake - b.year < 5)
        .sort((a, b) => b.year - a.year)
        .map((b) => ({
          year: b.year,
          label: yearLabel(b.year, intake),
          semesters: semesterRange(b.year, intake),
        })),
      branches: branches
        .sort((a, b) => a.sort - b.sort)
        .map((b) => ({
          slug: b.slug,
          name: b.name,
          code: b.code,
          isCommon: b.isCommon,
          shortName: b.shortName,
          tagline: b.tagline,
          description: b.description,
          courseCodes: b.courseCodes,
        })),
    };
  }

  /** Courses in one drawer + tab. Courses filed under the shared ("All branches") branch show in every tab. */
  private searchCache: { at: number; courses: { card: CourseCardDto; text: string }[] } | null = null;

  /** Every live, readable course once, with the words it can be found by. Cached briefly. */
  private async searchable() {
    if (this.searchCache && Date.now() - this.searchCache.at < FRESH_MS) return this.searchCache.courses;
    const [batches, branches] = await Promise.all([
      this.catalogue.listBatches(),
      this.catalogue.listBranches(),
    ]);
    const years = new Set(batches.map((b) => b.year));
    const live = (await this.liveOfferings(branches)).filter((l) =>
      l.offerings.some((o) => years.has(o.batchYear)),
    );
    const courses = live.map((l) => l.course);
    const offeringsById = new Map(live.map((l) => [l.course.id, l.offerings]));
    const files = await this.catalogue.listFiles(courses.map((course) => course.id));
    const readable = new Set(
      files
        .filter((file) => file.conversionStatus === 'ready' && file.pageCount > 0)
        .map((file) => file.courseId),
    );
    const bySlug = new Map(branches.map((b) => [b.slug, b]));
    const out = courses
      .filter((course) => readable.has(course.id))
      .sort((a, b) => b.batchYear - a.batchYear || a.semester - b.semester || a.title.localeCompare(b.title))
      .map((course) => {
        const branch = bySlug.get(course.branchSlug);
        // Found by every batch and programme it is offered to, not only where it was filed.
        const offerings = (offeringsById.get(course.id) ?? []).filter((o) => years.has(o.batchYear));
        const programmes = branches.filter(
          (b) =>
            b.slug === course.branchSlug ||
            offerings.some((o) => o.branchSlug === b.slug) ||
            (course.courseCode && b.courseCodes.includes(course.courseCode)),
        );
        const text = [
          course.title,
          course.courseCode ?? '',
          ...[...new Set([course.batchYear, ...offerings.map((o) => o.batchYear)])].flatMap((y) => [
            String(y),
            `${String(y).slice(2)} batch`,
          ]),
          `s${course.semester} sem ${course.semester} semester ${course.semester}`,
          ...programmes.flatMap((b) => [b.name, b.code, b.shortName]),
          course.description,
        ]
          .join(' ')
          .toLowerCase();
        return { card: toCard(course, files, branch), text };
      });
    this.searchCache = { at: Date.now(), courses: out };
    return out;
  }

  /** Search the whole live catalogue: every word typed must appear (title, code, sem, year, programme). */
  async search(query: string): Promise<CatalogueSearchDto> {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
    const matches = (text: string) => words.every((w) => text.includes(w));
    const [courses, bundles] = await Promise.all([this.searchable(), this.bundleCards()]);
    return {
      query,
      courses: await this.prices.priceCards(
        courses
          .filter((c) => matches(c.text))
          .map((c) => c.card)
          .slice(0, 120),
      ),
      bundles: bundles
        .filter((b) => matches(`${b.title} ${b.description} ${b.batchYear ?? ''}`.toLowerCase()))
        // A drawer pack shows up when the search names its batch or programme ("2025 bce pack"),
        // not as dozens of near-identical packs for a plain "pack" or "diwali".
        .filter((b) => !b.forDrawer || b.forDrawer.split(':').some((part) => words.includes(part)))
        .slice(0, 24),
    };
  }

  async drawer(batchYear: number, branchSlug: string): Promise<CourseCardDto[]> {
    const key = `${batchYear}:${branchSlug}`;
    const hit = this.drawerCache.get(key);
    // The cards are cached at their own price; today's offers go on every time.
    if (hit && Date.now() - hit.at < FRESH_MS) return this.prices.priceCards(hit.value);
    const value = await this.buildDrawer(batchYear, branchSlug);
    if (this.drawerCache.size > 200) this.drawerCache.clear();
    this.drawerCache.set(key, { at: Date.now(), value });
    return this.prices.priceCards(value);
  }

  private async buildDrawer(batchYear: number, branchSlug: string): Promise<CourseCardDto[]> {
    const branches = await this.catalogue.listBranches();
    if (!branches.some((b) => b.slug === branchSlug)) throw fail.notFound('That programme');
    const common = branches.filter((b) => b.isCommon).map((b) => b.slug);
    const offered = (await this.liveOfferings(branches)).filter((l) =>
      inDrawer(l.offerings, batchYear, branchSlug, common),
    );
    const files = await this.catalogue.listFiles(offered.map((l) => l.course.id));
    return this.composeDrawer({ branches, offered, files }, batchYear, branchSlug);
  }

  /**
   * Every drawer (batch × programme) at once, from one read of courses and files: the pack builder
   * looks at all of them, and a Worker may only make so many database calls per request.
   */
  async allDrawers(batchYears: number[], branchSlugs: string[]): Promise<Map<string, CourseCardDto[]>> {
    const branches = await this.catalogue.listBranches();
    const offered = await this.liveOfferings(branches);
    const files = await this.catalogue.listFiles(offered.map((l) => l.course.id));
    const out = new Map<string, CourseCardDto[]>();
    for (const year of batchYears)
      for (const slug of branchSlugs)
        if (branches.some((b) => b.slug === slug))
          out.set(
            `${year}:${slug}`,
            await this.prices.priceCards(this.composeDrawer({ branches, offered, files }, year, slug)),
          );
    return out;
  }

  private composeDrawer(
    src: { branches: Branch[]; offered: { course: Course; offerings: Offering[] }[]; files: CourseFile[] },
    batchYear: number,
    branchSlug: string,
  ): CourseCardDto[] {
    const { branches, files } = src;
    const selectedBranch = branches.find((b) => b.slug === branchSlug);
    const common = branches.filter((b) => b.isCommon).map((b) => b.slug);
    const intake = this.config.currentIntakeYear;
    const offered = src.offered.filter((l) => inDrawer(l.offerings, batchYear, branchSlug, common));
    const pagesOf = new Map<string, number>();
    for (const f of files)
      if (f.conversionStatus === 'ready' && f.pageCount > 0)
        pagesOf.set(f.courseId, (pagesOf.get(f.courseId) ?? 0) + f.pageCount);
    // One card per subject: when two courses with the same code reach this drawer (say, notes filed
    // for 2023 and again for 2025), keep the one picked for it by hand, then the one filed for this
    // batch, then the fuller one.
    const rank = (l: (typeof offered)[number]) => {
      const o = l.offerings.find((x) => x.batchYear === batchYear && x.branchSlug === branchSlug);
      return (o?.source === 'admin' ? 4 : 0) + (l.course.batchYear === batchYear ? 2 : 0) + (o ? 1 : 0);
    };
    const bySubject = new Map<string, (typeof offered)[number]>();
    for (const l of offered) {
      if (!pagesOf.has(l.course.id)) continue;
      const key = l.course.courseCode?.toUpperCase() ?? `id:${l.course.id}`;
      const kept = bySubject.get(key);
      if (
        !kept ||
        rank(l) > rank(kept) ||
        (rank(l) === rank(kept) && (pagesOf.get(l.course.id) ?? 0) > (pagesOf.get(kept.course.id) ?? 0))
      )
        bySubject.set(key, l);
    }
    // Shown as this batch's course: its year, and its semester when it was filed for another batch.
    const shown = [...bySubject.values()].map(({ course }) =>
      course.batchYear === batchYear
        ? course
        : { ...course, batchYear, semester: termSemester(intake, batchYear) },
    );
    return shown
      .sort((a, b) => a.semester - b.semester || a.seq - b.seq || a.title.localeCompare(b.title))
      .map((c) => toCard(c, files, selectedBranch, branchSlug));
  }

  async course(idOrSlug: string, userId: string | null, isAdmin = false): Promise<CourseDetailDto> {
    const course = await this.catalogue.findCourse(idOrSlug);
    if (!course || (course.status !== 'live' && !isAdmin)) throw fail.notFound('That course');
    const [files, hidden, branches, owned, bundles, books, attributions, today] = await Promise.all([
      this.catalogue.listFiles([course.id]),
      this.catalogue.listHiddenFiles([course.id]),
      this.catalogue.listBranches(),
      userId
        ? this.entitlements
            .listForUser(userId)
            .then((all) => all.find((r) => r.courseId === course.id) ?? null)
        : Promise.resolve(null),
      this.liveBundleCards((x) => x.bundle.courseIds.includes(course.id)),
      this.books.list(course.id).catch(() => [] as CourseBook[]),
      this.contributions.attributionsForCourse(course.id),
      this.prices.coursePrice(course),
    ]);
    const mine = owned && accessState(owned, new Date()) === 'active' ? owned : null;
    if (!isAdmin && !files.some((file) => file.conversionStatus === 'ready' && file.pageCount > 0))
      throw fail.notFound('That course');
    const branch = branches.find((b) => b.slug === course.branchSlug);
    const creditBySource = new Map(attributions.map((credit) => [credit.sourceKey, credit]));
    const sourceKeyByFileId = new Map(files.map((file) => [file.id, file.sourceKey]));
    // A course can have more than one current contributor. Credit the title when the current
    // course-root filings collectively cover every current file, even if no single upload does.
    const wholeCourseCredits = files.map((file) => creditBySource.get(file.sourceKey));
    const wholeCourseContributors =
      wholeCourseCredits.length > 0 &&
      wholeCourseCredits.every((credit) => credit?.wholeCourse && credit.contributorName)
        ? [...new Set(wholeCourseCredits.map((credit) => credit!.contributorName!))].sort((a, b) =>
            a.localeCompare(b),
          )
        : [];
    const units = toUnits(files).map((unit) => {
      const unitFiles = files.filter((file) => file.unitKey === unit.key && isReaderReady(file));
      const credited = unitFiles.map((file) => creditBySource.get(file.sourceKey)?.contributorName ?? null);
      const unitContributors =
        credited.length > 0 && credited.every((name): name is string => !!name)
          ? [...new Set(credited)].sort((a, b) => a.localeCompare(b))
          : [];
      return {
        ...unit,
        ...(!wholeCourseContributors.length && unitContributors.length
          ? { contributors: unitContributors }
          : {}),
        files: unit.files.map((file) => {
          if (wholeCourseContributors.length || unitContributors.length) return file;
          const contributorName = creditBySource.get(sourceKeyByFileId.get(file.id) ?? '')?.contributorName;
          return contributorName ? { ...file, contributors: [contributorName] } : file;
        }),
      };
    });
    return {
      ...toCard(course, files, branch),
      pricePaise: today.pricePaise,
      ...(today.offer ? { offer: today.offer } : {}),
      ...(course.status !== 'live' ? { preview: true } : {}),
      // The admin's description, or the syllabus line for this course so no page is left bare.
      description: course.description?.trim() || courseBlurb(course.courseCode, course.title),
      branchName: branch?.name ?? course.branchSlug,
      wholeCourseContributors,
      units,
      readingList: books.length ? books.map(bookItem) : readingList(hidden),
      owned: !!mine || isAdmin,
      // Every purchase lasts ACCESS_MONTHS from the day it's bought; there is no course-wide date.
      accessUntil: null,
      termLabel: '',
      accessMonths: ACCESS_MONTHS,
      yourAccessUntil: mine?.expiresAt ? mine.expiresAt.toISOString() : null,
      bundles: bundles.filter((b) => b.courseCount > 1).sort((a, b) => b.savePercent - a.savePercent),
    };
  }

  /**
   * Live bundles: all of them, the ones a batch sees, or the ones one drawer (batch × programme)
   * sees. Where a bundle shows is set per bundle (see `bundleAudience`), not by one batch year.
   */
  async bundleCards(batchYear?: number, branchSlug?: string): Promise<BundleCardDto[]> {
    const cards = await this.liveBundleCards(
      (x) => batchYear === undefined || audienceShows(x.audience, batchYear, branchSlug),
    );
    // The fullest bundle first: in a drawer that is its pack, "everything for this term".
    return cards
      .filter((c) => c.courseCount > 1)
      .sort((a, b) => b.courseCount - a.courseCount || b.savePercent - a.savePercent);
  }

  async bundle(idOrSlug: string, userId: string | null, isAdmin = false): Promise<BundleDetailDto> {
    const bundle = await this.bundles.find(idOrSlug);
    // Admins can look at a draft bundle (and its draft courses) before publishing it.
    if (!bundle || (bundle.status !== 'live' && !isAdmin)) throw fail.notFound('That bundle');
    const courses = (await this.catalogue.coursesByIds(bundle.courseIds)).filter(
      (c) => c.status === 'live' || (isAdmin && c.status === 'draft'),
    );
    const [files, branches, ownedIds] = await Promise.all([
      this.catalogue.listFiles(courses.map((c) => c.id)),
      this.catalogue.listBranches(),
      userId ? this.entitlements.listCourseIds(userId) : Promise.resolve([] as string[]),
    ]);
    const readableCourses = courses.filter((course) =>
      files.some(
        (file) => file.courseId === course.id && file.conversionStatus === 'ready' && file.pageCount > 0,
      ),
    );
    if (readableCourses.length === 0) throw fail.notFound('That bundle');
    const owned = new Set(ownedIds);
    const today = await this.prices.bundlePrice(bundle, readableCourses);
    const todayOf = (c: Course) => today.coursePrices.get(c.id)?.pricePaise ?? c.pricePaise;
    const price = bundlePricing(
      today.pricePaise,
      readableCourses.map((c) => c.pricePaise),
      readableCourses.filter((c) => owned.has(c.id)).map((c) => c.pricePaise),
      readableCourses.filter((c) => !owned.has(c.id)).reduce((s, c) => s + todayOf(c), 0),
    );
    return {
      ...toBundleCard(bundle, readableCourses, files, false, today),
      ...(bundle.status !== 'live' || readableCourses.some((c) => c.status !== 'live')
        ? { preview: true }
        : {}),
      courses: readableCourses
        .sort((a, b) => a.semester - b.semester || a.title.localeCompare(b.title))
        .map((c) => ({
          ...toCard(
            c,
            files,
            branches.find((b) => b.slug === c.branchSlug),
          ),
          pricePaise: todayOf(c),
          ...(today.coursePrices.get(c.id)?.offer ? { offer: today.coursePrices.get(c.id)!.offer } : {}),
          owned: owned.has(c.id),
        })),
      yourPricePaise: price.payablePaise,
      ownedCount: courses.filter((c) => owned.has(c.id)).length,
    };
  }

  /** Public first-page preview of a unit. Only each unit's preview file is ever served. */
  async preview(
    fileId: string,
  ): Promise<{ body: ReadableStream | ArrayBuffer | Uint8Array; contentType: string }> {
    const file = await this.catalogue.findFile(fileId);
    if (!file?.previewKey) throw fail.notFound('That preview');
    const course = await this.catalogue.findCourse(file.courseId);
    if (!course || course.status !== 'live') throw fail.notFound('That preview');
    const siblings = await this.catalogue.listFiles([course.id]);
    if (!isPreviewFile(file, siblings)) throw fail.notFound('That preview');
    const obj = await this.pages.get(file.previewKey);
    if (!obj) throw fail.notFound('That preview');
    return obj;
  }

  private bundleCache: { at: number; value: LiveBundle[] } | null = null;

  /** Every live bundle with its readable courses and drawers, built once and reused briefly. */
  private async allLiveBundles(): Promise<LiveBundle[]> {
    if (this.bundleCache && Date.now() - this.bundleCache.at < FRESH_MS) return this.bundleCache.value;
    const bundles = await this.bundles.listLive();
    let value: LiveBundle[] = [];
    if (bundles.length) {
      const ids = [...new Set(bundles.flatMap((b) => b.courseIds))];
      const courses = await this.catalogue.coursesByIds(ids);
      const files = await this.catalogue.listFiles(courses.map((c) => c.id));
      const readableCourses = courses.filter(
        (course) =>
          course.status === 'live' &&
          files.some(
            (file) => file.courseId === course.id && file.conversionStatus === 'ready' && file.pageCount > 0,
          ),
      );
      value = await Promise.all(
        bundles.map(async (bundle) => ({
          bundle,
          courses: readableCourses.filter((c) => bundle.courseIds.includes(c.id)),
          audience: await this.prices.audience(bundle),
          files,
        })),
      );
    }
    this.bundleCache = { at: Date.now(), value };
    return value;
  }

  /** Live bundle cards at today's price (offers are checked on every call). */
  private async liveBundleCards(filter: (b: LiveBundle) => boolean) {
    return Promise.all(
      (await this.allLiveBundles()).filter(filter).map(async (x) => {
        const today = await this.prices.bundlePrice(x.bundle, x.courses, x.audience);
        return toBundleCard(x.bundle, x.courses, x.files, false, today);
      }),
    );
  }
}

interface LiveBundle {
  bundle: Bundle;
  courses: Course[];
  audience: DrawerRef[];
  files: CourseFile[];
}

/** The site a link goes to, for its label: "https://www.amazon.in/x" → "amazon.in". */
export function linkHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** A book the admin added: its own name, author and link, plus the usual places to find it. */
function bookItem(b: CourseBook): ReadingItemDto {
  return {
    title: b.title,
    unit: b.author,
    findUrl: b.url,
    linkLabel: linkHost(b.url),
    links: bookLinks(`${b.title} ${b.author}`.trim()),
  };
}

/**
 * What to search a book by: its name and author without edition, year, publisher or file noise
 * ("Java How to Program Early Objects-10th ed Deitel Deitel" → "Java How to Program Early Objects Deitel").
 */
export function bookQuery(title: string): string {
  const words = title
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b\d+(st|nd|rd|th)?\s*(ed|edn|edition|e)\b\.?/gi, ' ')
    .replace(
      /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|edition|ed|international|global|indian|reprint|pdf|ebook)\b\.?/gi,
      ' ',
    )
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/[-–_,:;|]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  // "Deitel Deitel" → "Deitel"
  const out: string[] = [];
  for (const w of words) if (out.at(-1)?.toLowerCase() !== w.toLowerCase()) out.push(w);
  return out.join(' ').trim() || title;
}

/** Legal places to get a book. Borrowing is free on Open Library for many titles. */
export function bookLinks(title: string): { label: string; url: string }[] {
  const q = encodeURIComponent(bookQuery(title));
  return [
    { label: 'Borrow free', url: `https://openlibrary.org/search?q=${q}` },
    { label: 'Look inside', url: `https://www.google.com/search?tbm=bks&q=${q}` },
    { label: 'Buy', url: `https://www.amazon.in/s?k=${q}&i=stripbooks` },
  ];
}

/** Hidden books, by title only: the files themselves are never served. */
export function readingBookCandidates(
  hidden: CourseFile[],
): { title: string; unit: string; sourceKeys: string[] }[] {
  const byTitle = new Map<string, { title: string; unit: string; sourceKeys: string[] }>();
  for (const f of [...hidden].sort((a, b) => a.unitSort - b.unitSort || a.sort - b.sort)) {
    if (f.unitKind !== 'reference' && !looksLikeTextbook(f.name)) continue; // hidden for other reasons
    const title = bookTitle(f.name);
    const key = title.toLowerCase().replace(/[^a-z0-9]/g, '');
    const found = byTitle.get(key);
    if (found) found.sourceKeys.push(f.sourceKey);
    else byTitle.set(key, { title, unit: f.unitTitle, sourceKeys: [f.sourceKey] });
  }
  return [...byTitle.values()].slice(0, 20);
}

export function readingList(hidden: CourseFile[]): ReadingItemDto[] {
  return readingBookCandidates(hidden).map(({ title, unit }) => {
    const links = bookLinks(title);
    return { title, unit, findUrl: links[0]!.url, links };
  });
}
