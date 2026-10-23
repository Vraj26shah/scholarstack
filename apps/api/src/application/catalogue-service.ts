import {
  type BundleCardDto,
  type BundleDetailDto,
  type CatalogueIndexDto,
  type CourseCardDto,
  type CourseDetailDto,
  type ReadingItemDto,
  semesterRange,
  yearLabel,
} from '@ss/contracts';
import type { CourseFile } from '../domain/entities';
import type { BundleRepository, CatalogueReader, EntitlementRepository, ObjectStore } from '../domain/ports';
import type { AppConfig } from './config';
import { fail } from './errors';
import { bookTitle, looksLikeTextbook } from './folders';
import { isPreviewFile, toBundleCard, toCard, toUnits } from './mappers';
import { bundlePricing } from './pricing';

const explicitlySharedCourseCodes = new Set(['ENG2005', 'MAT1001', 'MAT2001', 'HUM1002', 'CHY1005', 'CSE1021']);

/** Browsing the catalogue: drawers (batches), tabs (branches), cards (courses), bundles and previews. */
export class CatalogueService {
  constructor(
    private readonly catalogue: CatalogueReader,
    private readonly bundles: BundleRepository,
    private readonly entitlements: EntitlementRepository,
    private readonly pages: ObjectStore,
    private readonly config: AppConfig,
  ) {}

  async index(): Promise<CatalogueIndexDto> {
    const [batches, branches] = await Promise.all([
      this.catalogue.listBatches(),
      this.catalogue.listBranches(),
    ]);
    const intake = this.config.currentIntakeYear;
    return {
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
  async drawer(batchYear: number, branchSlug: string): Promise<CourseCardDto[]> {
    const branches = await this.catalogue.listBranches();
    const selectedBranch = branches.find((b) => b.slug === branchSlug);
    if (!selectedBranch) throw fail.notFound('That programme');
    const common = branches.filter((b) => b.isCommon).map((b) => b.slug);
    const byBranch = await Promise.all(
      branches.map(async (branch) => [branch.slug, await this.catalogue.listLiveCourses(batchYear, branch.slug)] as const),
    );
    const assignments = new Map<string, Set<string>>();
    for (const [slug, rows] of byBranch)
      for (const course of rows) assignments.set(course.id, (assignments.get(course.id) ?? new Set()).add(slug));
    const candidates = byBranch
      .filter(([slug]) => slug === branchSlug || common.includes(slug))
      .flatMap(([, rows]) => rows);
    const courses = [...new Map(candidates.map((course) => [course.id, course])).values()].filter((course) => {
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
      const sharedFirstYear = course.batchYear === this.config.currentIntakeYear && assigned.size === programmeCount;
      return common.some((slug) => assigned.has(slug)) || assigned.size < programmeCount || sharedFirstYear;
    });
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
      userId ? this.entitlements.has(userId, course.id) : Promise.resolve(false),
      this.liveBundleCards((b) => b.courseIds.includes(course.id)),
    ]);
    if (!isAdmin && !files.some((file) => file.conversionStatus === 'ready' && file.pageCount > 0))
      throw fail.notFound('That course');
    const branch = branches.find((b) => b.slug === course.branchSlug);
    return {
      ...toCard(course, files, branch),
      description: course.description,
      branchName: branch?.name ?? course.branchSlug,
      units: toUnits(files),
      readingList: readingList(hidden),
      owned: owned || isAdmin,
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

  async bundle(idOrSlug: string, userId: string | null): Promise<BundleDetailDto> {
    const bundle = await this.bundles.find(idOrSlug);
    if (!bundle || bundle.status !== 'live') throw fail.notFound('That bundle');
    const courses = (await this.catalogue.coursesByIds(bundle.courseIds)).filter((c) => c.status === 'live');
    const [files, branches, ownedIds] = await Promise.all([
      this.catalogue.listFiles(courses.map((c) => c.id)),
      this.catalogue.listBranches(),
      userId ? this.entitlements.listCourseIds(userId) : Promise.resolve([] as string[]),
    ]);
    const readableCourses = courses.filter((course) =>
      files.some(
        (file) =>
          file.courseId === course.id && file.conversionStatus === 'ready' && file.pageCount > 0,
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
        (file) =>
          file.courseId === course.id && file.conversionStatus === 'ready' && file.pageCount > 0,
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
