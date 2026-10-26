import { ACCESS_MONTHS } from '@ss/contracts';
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
import { type CourseFile, accessState } from '../domain/entities';
import type { BundleRepository, CatalogueReader, EntitlementRepository, ObjectStore } from '../domain/ports';
import type { AppConfig } from './config';
import { fail } from './errors';
import { bookTitle, looksLikeTextbook } from './folders';
import { isPreviewFile, toBundleCard, toCard, toUnits } from './mappers';
import { bundlePricing } from './pricing';

const explicitlySharedCourseCodes = new Set([
  'ENG2005',
  'MAT1001',
  'MAT2001',
  'HUM1002',
  'CHY1005',
  'CSE1021',
]);

/** Browsing the catalogue: drawers (batches), tabs (branches), cards (courses), bundles and previews. */
export class CatalogueService {
  constructor(
    private readonly catalogue: CatalogueReader,
    private readonly bundles: BundleRepository,
    private readonly entitlements: EntitlementRepository,
    private readonly pages: ObjectStore,
    private readonly config: AppConfig,
  ) {}

  private statsCache: { at: number; value: NonNullable<CatalogueIndexDto['stats']> } | null = null;

  /** Totals across every live course, cached briefly: the home page asks on every visit. */
  private async stats(
    batches: { year: number }[],
    branches: { slug: string }[],
  ): Promise<NonNullable<CatalogueIndexDto['stats']>> {
    if (this.statsCache && Date.now() - this.statsCache.at < 5 * 60_000) return this.statsCache.value;
    const lists = await Promise.all(
      batches.flatMap((batch) =>
        branches.map((branch) => this.catalogue.listLiveCourses(batch.year, branch.slug)),
      ),
    );
    const courses = [...new Map(lists.flat().map((course) => [course.id, course])).values()];
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
    const [batches, branches] = await Promise.all([
      this.catalogue.listBatches(),
      this.catalogue.listBranches(),
    ]);
    const intake = this.config.currentIntakeYear;
    const stats = await this.stats(batches, branches).catch(() => undefined);
    return {
      ...(stats ? { stats } : {}),
      batches: batches
        .filter((b) => b.year <= intake && intake - b.year < 4)
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
    if (this.searchCache && Date.now() - this.searchCache.at < 30_000) return this.searchCache.courses;
    const [batches, branches] = await Promise.all([
      this.catalogue.listBatches(),
      this.catalogue.listBranches(),
    ]);
    const lists = await Promise.all(
      batches.flatMap((batch) =>
        branches.map((branch) => this.catalogue.listLiveCourses(batch.year, branch.slug)),
      ),
    );
    const courses = [...new Map(lists.flat().map((course) => [course.id, course])).values()];
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
        const programmes = branches.filter(
          (b) =>
            b.slug === course.branchSlug || (course.courseCode && b.courseCodes.includes(course.courseCode)),
        );
        const text = [
          course.title,
          course.courseCode ?? '',
          String(course.batchYear),
          `${String(course.batchYear).slice(2)} batch`,
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
      courses: courses
        .filter((c) => matches(c.text))
        .map((c) => c.card)
        .slice(0, 120),
      bundles: bundles
        .filter((b) => matches(`${b.title} ${b.description} ${b.batchYear ?? ''}`.toLowerCase()))
        .slice(0, 24),
    };
  }

  async drawer(batchYear: number, branchSlug: string): Promise<CourseCardDto[]> {
    const branches = await this.catalogue.listBranches();
    const selectedBranch = branches.find((b) => b.slug === branchSlug);
    if (!selectedBranch) throw fail.notFound('That programme');
    const common = branches.filter((b) => b.isCommon).map((b) => b.slug);
    const byBranch = await Promise.all(
      branches.map(
        async (branch) =>
          [branch.slug, await this.catalogue.listLiveCourses(batchYear, branch.slug)] as const,
      ),
    );
    const assignments = new Map<string, Set<string>>();
    for (const [slug, rows] of byBranch)
      for (const course of rows)
        assignments.set(course.id, (assignments.get(course.id) ?? new Set()).add(slug));
    const candidates = byBranch
      .filter(([slug]) => slug === branchSlug || common.includes(slug))
      .flatMap(([, rows]) => rows);
    const courses = [...new Map(candidates.map((course) => [course.id, course])).values()].filter(
      (course) => {
        const curriculumSlugs = branches
          .filter((branch) => course.courseCode !== null && branch.courseCodes.includes(course.courseCode))
          .map((branch) => branch.slug);
        if (course.courseCode && explicitlySharedCourseCodes.has(course.courseCode))
          return (assignments.get(course.id) ?? new Set<string>()).has(branchSlug);
        if (curriculumSlugs.length) return curriculumSlugs.includes(branchSlug);
        // Preserve deliberate, limited cross-listing from the admin panel. Hide
        // only orphaned imports that were accidentally assigned to every branch.
        const assigned = assignments.get(course.id) ?? new Set<string>();
        const programmeCount = branches.filter((branch) => !branch.isCommon).length;
        const sharedFirstYear =
          course.batchYear === this.config.currentIntakeYear && assigned.size === programmeCount;
        return common.some((slug) => assigned.has(slug)) || assigned.size < programmeCount || sharedFirstYear;
      },
    );
    const files = await this.catalogue.listFiles(courses.map((c) => c.id));
    const bySlug = new Map(branches.map((b) => [b.slug, b]));
    const readableCourseIds = new Set(
      files
        .filter((file) => file.conversionStatus === 'ready' && file.pageCount > 0)
        .map((file) => file.courseId),
    );
    return courses
      .filter((course) => readableCourseIds.has(course.id))
      .sort((a, b) => a.semester - b.semester || a.seq - b.seq || a.title.localeCompare(b.title))
      .map((c) => toCard(c, files, bySlug.get(branchSlug) ?? bySlug.get(c.branchSlug), branchSlug));
  }

  async course(idOrSlug: string, userId: string | null, isAdmin = false): Promise<CourseDetailDto> {
    const course = await this.catalogue.findCourse(idOrSlug);
    if (!course || (course.status !== 'live' && !isAdmin)) throw fail.notFound('That course');
    const [files, hidden, branches, owned, bundles] = await Promise.all([
      this.catalogue.listFiles([course.id]),
      this.catalogue.listHiddenFiles([course.id]),
      this.catalogue.listBranches(),
      userId
        ? this.entitlements
            .listForUser(userId)
            .then((all) => all.find((r) => r.courseId === course.id) ?? null)
        : Promise.resolve(null),
      this.liveBundleCards((b) => b.courseIds.includes(course.id)),
    ]);
    const mine = owned && accessState(owned, new Date()) === 'active' ? owned : null;
    if (!isAdmin && !files.some((file) => file.conversionStatus === 'ready' && file.pageCount > 0))
      throw fail.notFound('That course');
    const branch = branches.find((b) => b.slug === course.branchSlug);
    return {
      ...toCard(course, files, branch),
      ...(course.status !== 'live' ? { preview: true } : {}),
      description: course.description,
      branchName: branch?.name ?? course.branchSlug,
      units: toUnits(files),
      readingList: readingList(hidden),
      owned: !!mine || isAdmin,
      // Every purchase lasts ACCESS_MONTHS from the day it's bought; there is no course-wide date.
      accessUntil: null,
      termLabel: '',
      accessMonths: ACCESS_MONTHS,
      yourAccessUntil: mine?.expiresAt ? mine.expiresAt.toISOString() : null,
      bundles: bundles.filter((b) => b.courseCount > 1).sort((a, b) => b.savePercent - a.savePercent),
    };
  }

  /** Live bundles, optionally for one batch year (bundles without a year show everywhere). */
  async bundleCards(batchYear?: number): Promise<BundleCardDto[]> {
    const cards = await this.liveBundleCards(
      (b) => batchYear === undefined || b.batchYear === null || b.batchYear === batchYear,
    );
    return cards.filter((c) => c.courseCount > 1);
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
    const price = bundlePricing(
      bundle.pricePaise,
      readableCourses.map((c) => c.pricePaise),
      readableCourses.filter((c) => owned.has(c.id)).map((c) => c.pricePaise),
    );
    return {
      ...toBundleCard(bundle, readableCourses, files),
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

  private async liveBundleCards(filter: (b: { courseIds: string[]; batchYear: number | null }) => boolean) {
    const bundles = (await this.bundles.listLive()).filter(filter);
    if (bundles.length === 0) return [];
    const ids = [...new Set(bundles.flatMap((b) => b.courseIds))];
    const courses = await this.catalogue.coursesByIds(ids);
    const files = await this.catalogue.listFiles(courses.map((c) => c.id));
    const readableCourses = courses.filter((course) =>
      files.some(
        (file) => file.courseId === course.id && file.conversionStatus === 'ready' && file.pageCount > 0,
      ),
    );
    return bundles.map((b) => toBundleCard(b, readableCourses, files));
  }
}

/** Hidden books, by title only: the files themselves are never served. */
function readingList(hidden: CourseFile[]): ReadingItemDto[] {
  const seen = new Set<string>();
  const out: ReadingItemDto[] = [];
  for (const f of [...hidden].sort((a, b) => a.unitSort - b.unitSort || a.sort - b.sort)) {
    if (f.unitKind !== 'reference' && !looksLikeTextbook(f.name)) continue; // hidden for other reasons
    const title = bookTitle(f.name);
    const key = title.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title,
      unit: f.unitTitle,
      findUrl: `https://openlibrary.org/search?q=${encodeURIComponent(title)}`,
    });
  }
  return out.slice(0, 20);
}
