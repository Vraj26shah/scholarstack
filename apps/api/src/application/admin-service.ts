import type {
  AdminBundleDto,
  AdminCourseDto,
  AdminSyncHealthDto,
  AdminUnitDto,
  ConversionProgressReport,
  ConversionReport,
  CourseInventoryDto,
  ImportCourseInput,
  ImportFolderDto,
  ImportObjectDto,
  ImportTreeDto,
  StorageAuditDto,
  StorageInventoryPageDto,
  SyncResultDto,
} from '@ss/contracts';
import { BROKEN_SOURCE, extractCourseCode } from '@ss/contracts';
import {
  type Bundle,
  type Course,
  type CourseFile,
  type StoredObject,
  isReaderReady,
  isVisible,
} from '../domain/entities';
import type {
  BundleRepository,
  CatalogueReader,
  CatalogueWriter,
  ConversionQueue,
  ObjectStore,
} from '../domain/ports';
import type { AppConfig } from './config';
import { recordConversion } from './conversion';
import { fail } from './errors';
import {
  formatOf,
  guessBatchYear,
  guessSemester,
  hiddenByDefault,
  isJunkFile,
  looksLikeTextbook,
  naturalCompare,
  parseCourseFolder,
  parseUnit,
  slugify,
  unitKindOf,
  unitSortOf,
} from './folders';
import { toBundleCard, toCard, unitLabel } from './mappers';
import { suggestBundlePrice } from './pricing';

export { parseUnit } from './folders';

interface Node {
  prefix: string;
  name: string;
  depth: number;
  fileCount: number;
  supportedCount: number;
  ignoredCount: number;
  sizeBytes: number;
  children: Map<string, Node>;
  looseFiles: number;
  looseObjects: ImportObjectDto[];
}

const SOURCE_PREFIX_BYTES = 1024;
const SOURCE_CHECK_CONCURRENCY = 8;

/** Read only a bounded prefix; an R2 source can be a large textbook. */
async function readBodyPrefix(body: ReadableStream | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body.subarray(0, SOURCE_PREFIX_BYTES);
  if (body instanceof ArrayBuffer)
    return new Uint8Array(body, 0, Math.min(body.byteLength, SOURCE_PREFIX_BYTES));

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < SOURCE_PREFIX_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value?.length) break;
      const chunk = value.subarray(0, SOURCE_PREFIX_BYTES - total);
      chunks.push(chunk);
      total += chunk.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const prefix = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    prefix.set(chunk, offset);
    offset += chunk.length;
  }
  return prefix;
}

function sourceIssueFromPrefix(prefix: Uint8Array, fileName: string, sizeBytes: number): string | null {
  if (sizeBytes <= 0 || prefix.length === 0) return `${BROKEN_SOURCE} the R2 source is empty.`;
  const head = new TextDecoder('latin1').decode(prefix);
  if (/^\s*<(?:!doctype\s+html|html|head)\b/i.test(head) || /accounts\.google\.com/i.test(head)) {
    return `${BROKEN_SOURCE} this file is an HTML or Google sign-in page saved with a document extension. Download the original from Drive and replace the R2 source.`;
  }

  const extension = fileName.includes('.') ? `.${fileName.split('.').at(-1)!.toLowerCase()}` : '';
  const isZip = prefix[0] === 0x50 && prefix[1] === 0x4b;
  const isOle =
    prefix.length >= 8 &&
    [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((byte, index) => prefix[index] === byte);

  if (extension === '.pdf' && !head.includes('%PDF-')) {
    return `${BROKEN_SOURCE} the file is named PDF but its contents do not have a PDF signature. Re-export it and replace the R2 source.`;
  }
  if (
    ['.pptx', '.ppsx', '.docx', '.odp', '.odt', '.ppt', '.pps', '.doc'].includes(extension) &&
    !isZip &&
    !isOle
  ) {
    return `${BROKEN_SOURCE} the file is named as an Office document but its contents are not a ZIP or Office binary document. Replace the R2 source.`;
  }
  if (
    ['.jpg', '.jpeg'].includes(extension) &&
    !(prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff)
  ) {
    return `${BROKEN_SOURCE} the file is named JPEG but its contents do not have a JPEG signature. Replace the R2 source.`;
  }
  if (
    extension === '.png' &&
    ![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => prefix[index] === byte)
  ) {
    return `${BROKEN_SOURCE} the file is named PNG but its contents do not have a PNG signature. Replace the R2 source.`;
  }
  return null;
}

function unsupportedSourceIssue(fileName: string): string {
  const extension = fileName.includes('.') ? `.${fileName.split('.').pop()!.toLowerCase()}` : 'no extension';
  if (extension === '.zip') {
    return `${BROKEN_SOURCE} this ZIP is an archive, not a document the reader can convert. Extract it on your computer, upload the supported documents inside it (PDF, PowerPoint, or Word) into this course's R2 folder while keeping their subfolders, then rescan. Keep the ZIP offline after confirming the extracted files are present.`;
  }
  return `${BROKEN_SOURCE} the current R2 object has an unsupported file type (${extension}). Replace it with a supported document or keep it offline.`;
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]!);
      }
    }),
  );
  return results;
}

function pageManifestIssues(file: CourseFile, pages: Array<{ pageNo: number; imageKey: string }>): string[] {
  const issues: string[] = [];
  const ready = file.conversionStatus === 'ready';
  const expectedCount = ready ? file.pageCount : 0;
  if (pages.length !== expectedCount) {
    issues.push(`Supabase maps ${pages.length} pages; expected ${expectedCount} for this conversion state.`);
  }
  if (ready && expectedCount < 1) issues.push('Supabase marks this conversion ready without a page count.');

  const pageNumbers = new Set<number>();
  for (const page of pages) {
    if (!Number.isInteger(page.pageNo) || page.pageNo < 1) {
      issues.push(`Supabase contains invalid page number ${page.pageNo}.`);
      continue;
    }
    if (pageNumbers.has(page.pageNo)) issues.push(`Supabase maps page ${page.pageNo} more than once.`);
    pageNumbers.add(page.pageNo);
    const expectedKey = `pages/${file.id}/${page.pageNo}.webp`;
    if (page.imageKey !== expectedKey) {
      issues.push(`Supabase page ${page.pageNo} points to ${page.imageKey}; expected ${expectedKey}.`);
    }
    if (page.pageNo > expectedCount) {
      issues.push(`Supabase maps page ${page.pageNo}, beyond the expected ${expectedCount} pages.`);
    }
  }
  if (ready) {
    for (let pageNo = 1; pageNo <= expectedCount; pageNo++) {
      if (!pageNumbers.has(pageNo)) issues.push(`Supabase page map is missing page ${pageNo}.`);
    }
    const expectedPreview = `pages/${file.id}/preview.webp`;
    if (file.previewKey !== expectedPreview) {
      issues.push(
        `Supabase preview points to ${file.previewKey ?? 'no object'}; expected ${expectedPreview}.`,
      );
    }
  } else if (file.previewKey) {
    issues.push(`Supabase has a preview key while conversion is ${file.conversionStatus}.`);
  }
  return issues.slice(0, 20);
}

const emptyResult = (): SyncResultDto => ({
  coursesCreated: 0,
  filesAdded: 0,
  filesChanged: 0,
  filesRetired: 0,
  pageObjectsRemoved: 0,
  conversionQueued: 0,
  skipped: [],
});

const MAX_INLINE_SOURCE_FILES = 5;

function addSyncResult(target: SyncResultDto, next: SyncResultDto): void {
  target.coursesCreated += next.coursesCreated;
  target.filesAdded += next.filesAdded;
  target.filesChanged += next.filesChanged;
  target.filesRetired += next.filesRetired;
  target.pageObjectsRemoved += next.pageObjectsRemoved;
  target.conversionQueued += next.conversionQueued;
  target.skipped.push(...next.skipped);
}

const activeConversionStages = new Set([
  'queued',
  'downloading_source',
  'validating_source',
  'rendering_pages',
  'clearing_previous_pages',
  'writing_preview',
  'writing_pages',
  'verifying_r2',
  'saving_manifest',
]);

/** A callback that stopped updating is eligible for an explicit course rescan after 15 minutes. */
function isConversionInFlight(file: CourseFile, now = Date.now()): boolean {
  if (!file.conversionStage || !activeConversionStages.has(file.conversionStage)) return false;
  const updatedAt = file.conversionUpdatedAt ? Date.parse(file.conversionUpdatedAt) : 0;
  return Number.isFinite(updatedAt) && now - updatedAt < 15 * 60_000;
}

const explicitlySharedCourseCodes = new Set([
  'ENG2005',
  'MAT1001',
  'MAT2001',
  'HUM1002',
  'CHY1005',
  'CSE1021',
]);

/**
 * Librarian tools. The admin browses the import folder in R2 (e.g. drive-imports/23 Batch/…),
 * picks which folders become courses, files them under a batch, branch and semester, and
 * publishes when the pages are ready. Sub-folders of a course become its units.
 */
export class AdminService {
  constructor(
    private readonly reader: CatalogueReader,
    private readonly writer: CatalogueWriter,
    private readonly bundles: BundleRepository,
    private readonly sources: ObjectStore,
    private readonly pages: ObjectStore,
    private readonly queue: ConversionQueue,
    private readonly config: AppConfig,
  ) {}

  /** Independent live checks; a healthy R2 scan cannot hide a Supabase or queue failure. */
  async syncHealth(): Promise<AdminSyncHealthDto> {
    const checkedAt = new Date().toISOString();
    const [r2Result, databaseResult, conversionResult] = await Promise.allSettled([
      this.sources.listPage('', undefined, 1),
      (async () => {
        const courses = await this.writer.listAllCourses();
        const files = await this.writer.listAllFiles(courses.map((course) => course.id));
        return { courses: courses.length, fileRecords: files.length };
      })(),
      this.queue.health?.() ??
        Promise.resolve({
          status: 'ready' as const,
          provider: 'current runtime',
          message: 'The configured conversion adapter is available.',
          queuedJobs: null,
          deadLetterJobs: null,
        }),
    ]);
    const errorMessage = (reason: unknown) => {
      const message = reason instanceof Error ? reason.message : 'The connection check failed.';
      return message
        .replace(/(?:sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9._-]{24,})/g, '[redacted]')
        .slice(0, 240);
    };
    return {
      checkedAt,
      r2:
        r2Result.status === 'fulfilled'
          ? {
              status: 'connected',
              message: 'R2 object listing is reachable; the scan reads every page in the selected scope.',
              sampleObjects: r2Result.value.objects.length,
            }
          : { status: 'error', message: errorMessage(r2Result.reason), sampleObjects: null },
      supabase:
        databaseResult.status === 'fulfilled'
          ? {
              status: 'connected',
              message: 'Course and source-file records are readable.',
              ...databaseResult.value,
            }
          : {
              status: 'error',
              message: errorMessage(databaseResult.reason),
              courses: null,
              fileRecords: null,
            },
      conversion:
        conversionResult.status === 'fulfilled'
          ? conversionResult.value
          : {
              status: 'error',
              provider: 'conversion queue',
              message: errorMessage(conversionResult.reason),
              queuedJobs: null,
              deadLetterJobs: null,
            },
    };
  }

  // ── Courses ──

  async listCourses(): Promise<AdminCourseDto[]> {
    const [courses, branches] = await Promise.all([this.writer.listAllCourses(), this.reader.listBranches()]);
    const [allFiles, assignments] = await Promise.all([
      this.writer.listAllFiles(courses.map((c) => c.id)),
      this.writer.listCourseBranchSlugs(courses.map((c) => c.id)),
    ]);
    const curriculumByCode = new Map<string, string[]>();
    for (const branch of branches)
      for (const code of branch.courseCodes)
        curriculumByCode.set(code, [...(curriculumByCode.get(code) ?? []), branch.slug]);
    const programmeCount = branches.filter((branch) => !branch.isCommon).length;
    const files = allFiles.filter(isReaderReady);
    return courses
      .sort((a, b) => b.batchYear - a.batchYear || a.semester - b.semester || a.title.localeCompare(b.title))
      .map((c) => {
        const own = allFiles.filter((f) => f.courseId === c.id);
        const readable = own.filter(isReaderReady);
        return {
          ...toCard(
            c,
            files,
            branches.find((b) => b.slug === c.branchSlug),
          ),
          status: c.status,
          // Prefer curriculum-defined assignments. Keep deliberate admin
          // cross-listing for unmapped courses, but hide legacy all-branch fallbacks.
          branchSlugs:
            (c.courseCode ? curriculumByCode.get(c.courseCode) : undefined) ??
            (c.courseCode && explicitlySharedCourseCodes.has(c.courseCode)
              ? (assignments.get(c.id) ?? [])
              : (assignments.get(c.id)?.length ?? 0) >= programmeCount
                ? []
                : (assignments.get(c.id) ?? [])),
          description: c.description,
          r2Prefix: c.r2Prefix,
          // Card counts and the Publish button describe files eligible for the reader.
          // Hidden textbooks/reference material remain visible in the full R2 audit instead.
          pendingFiles: own.filter((f) => isVisible(f) && f.conversionStatus === 'pending').length,
          failedFiles: own.filter((f) => isVisible(f) && f.conversionStatus === 'failed').length,
          previewCount: readable.filter((f) => f.previewKey).length,
          unitCount: new Set(readable.map((f) => f.unitKey)).size,
          hiddenUnits: new Set(
            allFiles.filter((f) => f.courseId === c.id && f.unitHidden).map((f) => f.unitKey),
          ).size,
          hiddenFiles: allFiles.filter((f) => f.courseId === c.id && !isVisible(f)).length,
        };
      });
  }

  async updateCourse(
    courseId: string,
    patch: Partial<
      Pick<
        Course,
        'title' | 'description' | 'batchYear' | 'branchSlug' | 'semester' | 'pricePaise' | 'status'
      > & {
        branchSlugs?: string[];
      }
    >,
  ): Promise<void> {
    const current = await this.reader.findCourse(courseId);
    if (!current) throw fail.notFound('That course');
    const branchSlugs = patch.branchSlugs ?? (patch.branchSlug ? [patch.branchSlug] : undefined);
    if (branchSlugs) await Promise.all(branchSlugs.map((slug) => this.assertBranch(slug)));
    if (patch.batchYear !== undefined) await this.writer.ensureBatch(patch.batchYear);
    if (patch.status === 'live') await this.assertCoursePublishable(courseId);
    const { branchSlugs: _branchSlugs, ...coursePatch } = patch;
    if (branchSlugs?.length) coursePatch.branchSlug = branchSlugs[0]!;
    const editsPublishedCourse =
      current.status === 'live' &&
      patch.status !== 'live' &&
      [
        'title',
        'courseCode',
        'description',
        'batchYear',
        'branchSlug',
        'branchSlugs',
        'semester',
        'pricePaise',
      ].some((key) => key in patch);
    if (editsPublishedCourse) coursePatch.status = 'draft';
    if (coursePatch.status === 'draft' || coursePatch.status === 'archived') {
      await this.unpublishBundlesContaining(courseId);
    }
    const course = await this.writer.updateCourse(courseId, coursePatch);
    if (branchSlugs) await this.writer.setCourseBranches(courseId, branchSlugs);
  }

  async publish(courseId: string, pricePaise: number): Promise<void> {
    await this.updateCourse(courseId, { pricePaise, status: 'live' });
  }

  // ── Import from R2 ──

  /** The folder tree under the import root, with what each folder would become. */
  async browse(): Promise<ImportTreeDto> {
    const root = this.config.importRoot;
    const [objects, courses, branches, allBundles] = await Promise.all([
      this.sources.list(root),
      this.writer.listAllCourses(),
      this.reader.listBranches(),
      this.bundles.listAll(),
    ]);
    const assignments = await this.writer.listCourseBranchSlugs(courses.map((course) => course.id));
    const draftBundleByCourse = new Map<string, string>();
    for (const bundle of allBundles) {
      if (bundle.status !== 'draft') continue;
      for (const courseId of bundle.courseIds) {
        if (!draftBundleByCourse.has(courseId)) draftBundleByCourse.set(courseId, bundle.id);
      }
    }
    const byPrefix = new Map(courses.map((c) => [c.r2Prefix, c]));
    const top: Node = this.node(root, '', 0);
    let totalFiles = 0;

    for (const obj of objects) {
      if (obj.key.endsWith('/')) {
        let node = top;
        let prefix = root;
        const folders = obj.key.slice(root.length).split('/').filter(Boolean);
        for (const [depth, seg] of folders.entries()) {
          prefix = `${prefix}${seg}/`;
          let next = node.children.get(seg);
          if (!next) {
            next = this.node(prefix, seg, depth);
            node.children.set(seg, next);
          }
          node = next;
        }
        continue;
      }
      const parts = obj.key.slice(root.length).split('/');
      const fileName = parts.pop()!;
      if (!fileName) continue;
      totalFiles++;
      const junk = isJunkFile(fileName);
      const supported = !junk && (await this.sourceFormat(obj.key, fileName)) !== null;
      let node = top;
      let prefix = root;
      for (const [depth, seg] of parts.entries()) {
        prefix = `${prefix}${seg}/`;
        let next = node.children.get(seg);
        if (!next) {
          next = this.node(prefix, seg, depth + 1);
          node.children.set(seg, next);
        }
        node = next;
        node.fileCount++;
        node.sizeBytes += obj.size;
        if (supported) node.supportedCount++;
        if (junk) node.ignoredCount++;
      }
      node.looseFiles++;
      node.looseObjects.push({
        key: obj.key,
        name: fileName,
        sizeBytes: obj.size,
        classification: junk ? 'ignored' : supported ? 'supported' : 'unsupported',
      });
    }

    const toDto = (n: Node, ancestors: string[]): ImportFolderDto => {
      const segs = [...ancestors, n.name];
      const course = byPrefix.get(n.prefix);
      return {
        prefix: n.prefix,
        name: n.name,
        depth: n.depth,
        fileCount: n.fileCount,
        supportedCount: n.supportedCount,
        ignoredCount: n.ignoredCount,
        sizeBytes: n.sizeBytes,
        childNames: [...n.children.keys()].sort(naturalCompare),
        looseFiles: n.looseFiles,
        looseObjects: n.looseObjects.sort((a, b) => naturalCompare(a.name, b.name)),
        course: course
          ? {
              id: course.id,
              title: course.title,
              courseCode: course.courseCode,
              description: course.description,
              batchYear: course.batchYear,
              branchSlugs: assignments.get(course.id) ?? [course.branchSlug],
              semester: course.semester,
              pricePaise: course.pricePaise,
              bundleId: draftBundleByCourse.get(course.id) ?? null,
              status: course.status,
            }
          : null,
        suggested: {
          title: parseCourseFolder(n.name).title,
          batchYear: guessBatchYear(segs),
          semester: guessSemester(segs),
          courseCode: parseCourseFolder(n.name).code ?? extractCourseCode(n.name),
          branchSlugs: branches
            .filter((branch) => branch.courseCodes.includes(parseCourseFolder(n.name).code ?? ''))
            .map((branch) => branch.slug),
        },
        children: [...n.children.values()]
          .sort((a, b) => naturalCompare(a.name, b.name))
          .map((c) => toDto(c, segs)),
      };
    };

    const fingerprint = objects
      .map((obj) => `${obj.key}\0${obj.etag}`)
      .sort(naturalCompare)
      .join('\n');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
    const changeToken = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');

    return {
      root,
      rootFiles: top.looseObjects.sort((a, b) => naturalCompare(a.name, b.name)),
      totalFiles,
      changeToken,
      folders: [...top.children.values()]
        .sort((a, b) => naturalCompare(a.name, b.name))
        .map((n) => toDto(n, [])),
    };
  }

  /** Creates (or updates) a draft course for each chosen folder and queues its files for conversion. */
  async importFolders(inputs: ImportCourseInput[]): Promise<SyncResultDto> {
    const result = emptyResult();
    const conversionJobs: { fileId: string; sourceKey: string }[] = [];
    const selectedCourseIds: string[] = [];
    const existing = await this.writer.listAllCourses();
    const bundles = new Map((await this.bundles.listAll()).map((bundle) => [bundle.id, bundle]));
    const slugs = new Set(existing.map((c) => c.slug));
    for (const input of inputs) {
      const prefix = input.prefix.endsWith('/') ? input.prefix : `${input.prefix}/`;
      if (!prefix.startsWith(this.config.importRoot) || prefix.includes('..')) {
        throw fail.badRequest(`Pick a folder inside ${this.config.importRoot}`);
      }
      const branchSlugs = [...new Set(input.branchSlugs)];
      if (!branchSlugs.length) throw fail.badRequest('Choose at least one programme.');
      await Promise.all(branchSlugs.map((slug) => this.assertBranch(slug)));
      await this.writer.ensureBatch(input.batchYear);
      const targetBundle = input.bundleId ? bundles.get(input.bundleId) : undefined;
      if (input.bundleId && !targetBundle) throw fail.badRequest('Choose an existing bundle.');
      if (targetBundle && targetBundle.status !== 'draft') {
        throw fail.badRequest('Only draft bundles can receive imported courses.');
      }
      if (targetBundle?.batchYear != null && targetBundle.batchYear !== input.batchYear) {
        throw fail.badRequest('The course year must match the selected bundle year.');
      }

      const known = existing.find((c) => c.r2Prefix === prefix);
      let course: Course;
      if (known) {
        course = (await this.writer.updateCourse(known.id, {
          title: input.title,
          courseCode: input.courseCode || null,
          description: input.description,
          batchYear: input.batchYear,
          branchSlug: branchSlugs[0]!,
          semester: input.semester,
          pricePaise: input.pricePaise,
        }))!;
      } else {
        let slug = slugify(`${input.title}-${input.batchYear}-${branchSlugs[0]}`);
        for (let i = 2; slugs.has(slug); i++)
          slug = slugify(`${input.title}-${input.batchYear}-${branchSlugs[0]}-${i}`);
        slugs.add(slug);
        const seq =
          existing.filter((c) => c.batchYear === input.batchYear && c.branchSlug === branchSlugs[0]).length +
          1;
        const created = await this.writer.upsertCourseByPrefix({
          slug,
          title: input.title,
          courseCode: input.courseCode || null,
          description: input.description,
          batchYear: input.batchYear,
          branchSlug: branchSlugs[0]!,
          semester: input.semester,
          seq,
          r2Prefix: prefix,
          pricePaise: input.pricePaise,
        });
        course = created.course;
        existing.push(course);
        if (created.created) result.coursesCreated++;
      }
      await this.writer.setCourseBranches(course.id, branchSlugs);
      selectedCourseIds.push(course.id);
      if (targetBundle && !targetBundle.courseIds.includes(course.id)) {
        const updatedBundle = await this.bundles.save({
          ...targetBundle,
          courseIds: [...targetBundle.courseIds, course.id],
        });
        bundles.set(updatedBundle.id, updatedBundle);
      }
      await this.scanCourse(course, result, conversionJobs);
    }
    const scheduled = new Set(conversionJobs.map((job) => job.fileId));
    for (const file of selectedCourseIds.length ? await this.writer.listAllFiles(selectedCourseIds) : []) {
      if (
        isVisible(file) &&
        file.conversionStatus === 'pending' &&
        !isConversionInFlight(file) &&
        !scheduled.has(file.id)
      ) {
        conversionJobs.push({ fileId: file.id, sourceKey: file.sourceKey });
        scheduled.add(file.id);
      }
    }
    await this.enqueueConversions(conversionJobs);
    result.conversionQueued = conversionJobs.length;
    return result;
  }

  /** Looks for new or changed files in every imported course. */
  async rescan(): Promise<SyncResultDto> {
    const result = emptyResult();
    const conversionJobs: { fileId: string; sourceKey: string }[] = [];
    const courses = (await this.writer.listAllCourses()).filter((course) => course.status !== 'archived');
    // Read every selected course prefix to completion before mutating the catalogue.
    const snapshots = await Promise.all(courses.map((course) => this.sources.list(course.r2Prefix)));
    for (const [index, course] of courses.entries()) {
      await this.scanCourse(course, result, conversionJobs, snapshots[index]);
      await this.queueCourseRepairs(course, conversionJobs);
    }
    await this.enqueueConversions(conversionJobs);
    result.conversionQueued = conversionJobs.length;
    return result;
  }

  /** Reconcile only the selected bucket/import-root/course/folder source scope. */
  async syncStorageScope(prefix: string): Promise<SyncResultDto> {
    if (prefix === '') {
      // Bucket-wide source reconciliation is driven as one Worker request per file
      // by the admin UI. This bounded operation only sweeps orphaned generated pages.
      const result = emptyResult();
      result.pageObjectsRemoved = await this.cleanOrphanPageObjects();
      return result;
    }
    if (
      !prefix.startsWith(this.config.importRoot) ||
      !prefix.endsWith('/') ||
      prefix.split('/').some((part) => part === '.' || part === '..')
    ) {
      throw fail.badRequest('Choose the bucket, configured import root, or a folder inside it.');
    }

    const courses = (await this.writer.listAllCourses()).filter((course) => course.status !== 'archived');
    const exactCourse = courses.find((course) => course.r2Prefix === prefix);
    if (exactCourse) return this.rescanCourse(exactCourse.id);

    const parentCourse = courses
      .filter((course) => prefix.startsWith(course.r2Prefix))
      .sort((a, b) => b.r2Prefix.length - a.r2Prefix.length)[0];
    if (parentCourse) return this.rescanFolder(parentCourse.id, prefix);

    const selected = courses.filter((course) => course.r2Prefix.startsWith(prefix));
    if (!selected.length) {
      const result = emptyResult();
      result.skipped.push(`No imported course folders are mapped under ${prefix}.`);
      return result;
    }

    // A failed R2 read must not partially reconcile a multi-course scope.
    const snapshots = await Promise.all(selected.map((course) => this.sources.list(course.r2Prefix)));
    this.assertInlineSyncSize(snapshots.flat(), `the selected import scope (${prefix})`);
    const result = emptyResult();
    for (const [index, course] of selected.entries()) {
      const courseResult = await this.syncSelectedObjects(course, snapshots[index]!, course.r2Prefix);
      addSyncResult(result, courseResult);
    }
    return result;
  }

  async rescanCourse(courseId: string): Promise<SyncResultDto> {
    const course = await this.reader.findCourse(courseId);
    if (!course) throw fail.notFound('That course');
    const snapshot = await this.sources.list(course.r2Prefix);
    this.assertInlineSyncSize(snapshot, `course ${course.title}`);
    return this.syncSelectedObjects(course, snapshot, course.r2Prefix);
  }

  /** Verify each visible file's page objects in bounded chunks and queue only repairs. */
  private async queueCourseRepairs(
    course: Course,
    conversionJobs: { fileId: string; sourceKey: string }[],
  ): Promise<void> {
    const files = await this.writer.listAllFiles([course.id]);
    const scheduled = new Set(conversionJobs.map((job) => job.fileId));
    const repairs: { fileId: string; sourceKey: string }[] = [];
    const visibleFiles = files.filter(isVisible);
    for (let offset = 0; offset < visibleFiles.length; offset += 25) {
      const chunk = visibleFiles.slice(offset, offset + 25);
      const checks = await Promise.all(
        chunk.map(async (file) => ({
          file,
          needsRepair:
            (file.conversionStatus === 'pending' && !isConversionInFlight(file)) ||
            (file.conversionStatus === 'ready' && !(await this.pageAssetsComplete(file))),
        })),
      );
      for (const { file, needsRepair } of checks) {
        if (needsRepair && !scheduled.has(file.id)) {
          repairs.push({ fileId: file.id, sourceKey: file.sourceKey });
          scheduled.add(file.id);
        }
      }
    }
    if (!repairs.length) return;
    if (course.status === 'live') {
      await this.unpublishBundlesContaining(course.id);
      await this.writer.updateCourse(course.id, { status: 'draft' });
    }
    conversionJobs.push(...repairs);
  }

  /** Reconcile exactly one R2 source object, then queue only that object's conversion. */
  async rescanFile(courseId: string, sourceKey: string): Promise<SyncResultDto> {
    const course = await this.reader.findCourse(courseId);
    if (!course) throw fail.notFound('That course');
    if (
      !sourceKey.startsWith(course.r2Prefix) ||
      sourceKey.endsWith('/') ||
      sourceKey.split('/').some((part) => part === '.' || part === '..')
    ) {
      throw fail.badRequest('Choose one file inside this course folder.');
    }
    const object = (await this.sources.list(sourceKey)).find((candidate) => candidate.key === sourceKey);
    // Reconcile a missing exact key as well as a present object. This lets the admin
    // take stale catalogue entries offline without touching similarly named siblings.
    return this.syncSelectedObjects(course, object ? [object] : [], sourceKey);
  }

  /** Reconcile one selected R2 folder and its descendants; unrelated course files are untouched. */
  async rescanFolder(courseId: string, prefix: string): Promise<SyncResultDto> {
    const course = await this.reader.findCourse(courseId);
    if (!course) throw fail.notFound('That course');
    if (
      !prefix.startsWith(course.r2Prefix) ||
      !prefix.endsWith('/') ||
      prefix.split('/').some((part) => part === '.' || part === '..')
    ) {
      throw fail.badRequest('Choose a folder inside this course folder.');
    }
    const objects = await this.sources.list(prefix);
    this.assertInlineSyncSize(objects, `folder ${prefix}`);
    return this.syncSelectedObjects(course, objects, prefix);
  }

  private assertInlineSyncSize(objects: StoredObject[], scope: string): void {
    const sourceCount = objects.filter((object) => !object.key.endsWith('/')).length;
    if (sourceCount > MAX_INLINE_SOURCE_FILES) {
      throw fail.notReady(
        `${scope} contains ${sourceCount} files. Use the Admin per-file sync so every file gets its own bounded Worker request.`,
      );
    }
  }

  private async syncSelectedObjects(
    course: Course,
    stored: StoredObject[],
    reconcilePrefix?: string,
  ): Promise<SyncResultDto> {
    const result = emptyResult();
    const conversionJobs: { fileId: string; sourceKey: string }[] = [];
    const existingFiles = await this.writer.listAllFiles([course.id]);
    const existingBySource = new Map(existingFiles.map((file) => [file.sourceKey, file]));
    const presentKeys = new Set<string>();
    const brokenBefore = new Set(
      existingFiles
        .filter((file) => file.hidden && file.conversionError?.startsWith(BROKEN_SOURCE))
        .map((file) => file.sourceKey),
    );
    let sourceChanged = false;
    let pageAssetsNeedRepair = false;

    for (const [sort, object] of stored
      .filter((item) => !item.key.endsWith('/'))
      .sort((a, b) => naturalCompare(a.key, b.key))
      .entries()) {
      const parts = object.key.slice(course.r2Prefix.length).split('/');
      const fileName = parts.at(-1) ?? '';
      if (!fileName || isJunkFile(fileName)) continue;
      presentKeys.add(object.key);
      const format = await this.sourceFormat(object.key, fileName);
      if (!format) {
        const previous = existingBySource.get(object.key);
        if (previous && !previous.sourceMissingAt) {
          await this.markBrokenSource(course.id, previous.id, unsupportedSourceIssue(fileName), result);
        }
        const extension = fileName.includes('.') ? `.${fileName.split('.').pop()}` : 'no extension';
        result.skipped.push(`${object.key} (unsupported file type ${extension})`);
        continue;
      }
      const sourceIssue = await this.sourceIntegrityIssue(object.key, fileName, object.size, object.etag);
      const loose = parts.length === 1;
      const unit = loose ? { key: 'notes', title: 'Notes' } : parseUnit(parts[0]!);
      const unitKind = loose ? 'notes' : unitKindOf(parts[0]!);
      const previous = existingBySource.get(object.key);
      const metadataChanged =
        !previous ||
        previous.sourceEtag !== object.etag ||
        previous.sizeBytes !== object.size ||
        previous.unitKey !== unit.key ||
        previous.sourceMissingAt !== null;
      const previousUnit = existingFiles.find((candidate) => candidate.unitKey === unit.key);
      const willBeVisible = previous
        ? isVisible(previous) ||
          (brokenBefore.has(object.key) &&
            metadataChanged &&
            !previous.unitHidden &&
            !looksLikeTextbook(fileName))
        : !(previousUnit?.unitHidden ?? hiddenByDefault(unitKind)) && !looksLikeTextbook(fileName);
      if (willBeVisible && (metadataChanged || sourceIssue)) await this.takeCourseOffline(course.id);
      if (previous && metadataChanged) {
        result.pageObjectsRemoved += await this.clearGeneratedPages(previous.id);
      }
      const { file, change } = await this.writer.upsertFileBySourceKey({
        courseId: course.id,
        unitKey: unit.key,
        unitTitle: unit.title,
        unitKind,
        unitSort: unitSortOf(unitKind, unit.key),
        unitHiddenIfNew: hiddenByDefault(unitKind),
        hiddenIfNew: looksLikeTextbook(fileName),
        name: parts.slice(1).join(' / ') || fileName,
        format,
        sizeBytes: object.size,
        sourceKey: object.key,
        sourceEtag: object.etag,
        sort,
      });
      if (change === 'added') result.filesAdded++;
      if (change === 'changed') result.filesChanged++;
      let current = file;
      if (change === 'changed' && brokenBefore.has(object.key)) {
        await this.writer.setFileHidden(file.id, false);
        current = { ...file, hidden: false };
      }
      if (sourceIssue) {
        sourceChanged = true;
        await this.markBrokenSource(course.id, current.id, sourceIssue, result);
        result.skipped.push(`${object.key} (${sourceIssue})`);
        continue;
      }
      if (change === 'same') {
        if (isVisible(file) && file.conversionStatus === 'pending' && !isConversionInFlight(file)) {
          conversionJobs.push({ fileId: file.id, sourceKey: file.sourceKey });
        } else if (
          isVisible(file) &&
          file.conversionStatus === 'ready' &&
          !(await this.pageAssetsComplete(file))
        ) {
          pageAssetsNeedRepair = true;
          conversionJobs.push({ fileId: file.id, sourceKey: file.sourceKey });
        }
        continue;
      }
      sourceChanged = true;
      if (isVisible(current)) {
        conversionJobs.push({ fileId: current.id, sourceKey: current.sourceKey });
      } else {
        result.skipped.push(
          `${object.key} (kept off the site: ${current.unitHidden ? 'reference folder' : 'looks like a textbook'})`,
        );
      }
    }

    let retiredVisibleSource = false;
    if (reconcilePrefix) {
      const exactKey = !reconcilePrefix.endsWith('/');
      const withinScope = existingFiles.filter((file) =>
        exactKey ? file.sourceKey === reconcilePrefix : file.sourceKey.startsWith(reconcilePrefix),
      );
      const missingFiles = withinScope.filter((file) => !presentKeys.has(file.sourceKey));
      if (missingFiles.some((file) => !file.sourceMissingAt && isVisible(file))) {
        await this.takeCourseOffline(course.id);
      }
      retiredVisibleSource = await this.retireMissingSources(missingFiles, result);
    }

    if (course.status === 'live' && (sourceChanged || pageAssetsNeedRepair || retiredVisibleSource)) {
      await this.takeCourseOffline(course.id);
    }
    // A stale live catalogue row can outlive all of its reader-ready files.
    // Reconcile even an unchanged scope so an empty course cannot stay for sale.
    await this.unpublishIfEmpty(course.id);
    await this.enqueueConversions(conversionJobs);
    result.conversionQueued = conversionJobs.length;
    return result;
  }

  /** Recognize a PDF saved without an extension by its bytes, never by its folder name. */
  private async sourceFormat(key: string, fileName: string) {
    const named = formatOf(fileName);
    if (named || fileName.includes('.')) return named;
    const object = await this.sources.get(key);
    if (!object) return null;
    const bytes = await readBodyPrefix(object.body);
    return new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-' ? 'pdf' : null;
  }

  /** Validate byte signatures without buffering a full source file. */
  private async sourceIntegrityIssue(
    key: string,
    fileName: string,
    sizeBytes: number,
    etag: string,
  ): Promise<string | null> {
    if (sizeBytes <= 0) return `${BROKEN_SOURCE} the R2 source is empty.`;
    const source = await this.sources.get(key);
    if (!source)
      throw new Error(`R2 source ${key} disappeared during this inventory scan. Recheck the scope.`);
    if (
      (source.etag !== undefined && source.etag !== etag) ||
      (source.size !== undefined && source.size !== sizeBytes)
    ) {
      throw new Error(
        `R2 source ${key} changed while this inventory scan was reading it. Recheck the scope.`,
      );
    }
    return sourceIssueFromPrefix(await readBodyPrefix(source.body), fileName, sizeBytes);
  }

  /** Remove derived output and its Supabase manifest before the bad source can be shown again. */
  private async markBrokenSource(
    courseId: string,
    fileId: string,
    issue: string,
    result?: SyncResultDto,
  ): Promise<void> {
    const file = await this.writer.findAnyFile(fileId);
    if (file && isVisible(file)) await this.takeCourseOffline(courseId);
    const removed = await this.clearGeneratedPages(fileId);
    if (result) result.pageObjectsRemoved += removed;
    if (!(await this.writer.setFileHidden(fileId, true))) throw fail.notFound('That file');
    await recordConversion(this.writer, {
      fileId,
      status: 'failed',
      error: issue,
      errorStage: 'validating_source',
      pages: [],
    });
  }

  /** Kept for the old "Sync" button and scripts: same as rescan. */
  sync(): Promise<SyncResultDto> {
    return this.rescan();
  }

  private async scanCourse(
    course: Course,
    result: SyncResultDto,
    conversionJobs: { fileId: string; sourceKey: string }[],
    snapshot?: StoredObject[],
  ): Promise<void> {
    const objects = (snapshot ?? (await this.sources.list(course.r2Prefix)))
      .filter((o) => !o.key.endsWith('/'))
      .sort((a, b) => naturalCompare(a.key, b.key));
    const jobs: { fileId: string; sourceKey: string }[] = [];
    let visibleSourceChanged = false;
    // Files hidden only because their R2 copy was broken come back when a new copy is uploaded.
    const existingFiles = await this.writer.listAllFiles([course.id]);
    const existingBySource = new Map(existingFiles.map((file) => [file.sourceKey, file]));
    const brokenBefore = new Set(
      existingFiles
        .filter((f) => f.hidden && f.conversionError?.startsWith(BROKEN_SOURCE))
        .map((f) => f.sourceKey),
    );
    for (const [i, obj] of objects.entries()) {
      const parts = obj.key.slice(course.r2Prefix.length).split('/');
      const fileName = parts[parts.length - 1]!;
      if (isJunkFile(fileName)) continue;
      const format = await this.sourceFormat(obj.key, fileName);
      if (!format) {
        const previous = existingBySource.get(obj.key);
        if (previous && !previous.sourceMissingAt) {
          await this.markBrokenSource(course.id, previous.id, unsupportedSourceIssue(fileName), result);
        }
        const ext = fileName.includes('.') ? `.${fileName.split('.').pop()}` : 'no extension';
        result.skipped.push(`${obj.key} (unsupported file type ${ext})`);
        continue;
      }
      const sourceIssue = await this.sourceIntegrityIssue(obj.key, fileName, obj.size, obj.etag);
      const loose = parts.length === 1;
      const unit = loose ? { key: 'notes', title: 'Notes' } : parseUnit(parts[0]!);
      const unitKind = loose ? 'notes' : unitKindOf(parts[0]!);
      const previous = existingBySource.get(obj.key);
      const metadataChanged =
        !previous ||
        previous.sourceEtag !== obj.etag ||
        previous.sizeBytes !== obj.size ||
        previous.unitKey !== unit.key ||
        previous.sourceMissingAt !== null;
      const previousUnit = existingFiles.find((candidate) => candidate.unitKey === unit.key);
      const willBeVisible = previous
        ? isVisible(previous) ||
          (brokenBefore.has(obj.key) &&
            metadataChanged &&
            !previous.unitHidden &&
            !looksLikeTextbook(fileName))
        : !(previousUnit?.unitHidden ?? hiddenByDefault(unitKind)) && !looksLikeTextbook(fileName);
      if (willBeVisible && (metadataChanged || sourceIssue)) await this.takeCourseOffline(course.id);
      if (previous && metadataChanged) {
        result.pageObjectsRemoved += await this.clearGeneratedPages(previous.id);
      }
      const { file, change } = await this.writer.upsertFileBySourceKey({
        courseId: course.id,
        unitKey: unit.key,
        unitTitle: unit.title,
        unitKind,
        unitSort: unitSortOf(unitKind, unit.key),
        unitHiddenIfNew: hiddenByDefault(unitKind),
        hiddenIfNew: looksLikeTextbook(fileName),
        name: parts.slice(1).join(' / ') || fileName,
        format,
        sizeBytes: obj.size,
        sourceKey: obj.key,
        sourceEtag: obj.etag,
        sort: i,
      });
      if (change === 'added') result.filesAdded++;
      if (change === 'changed') result.filesChanged++;
      let current = file;
      if (change === 'changed' && brokenBefore.has(obj.key)) {
        await this.writer.setFileHidden(file.id, false);
        current = { ...file, hidden: false };
      }
      if (sourceIssue) {
        visibleSourceChanged = true;
        await this.markBrokenSource(course.id, current.id, sourceIssue, result);
        result.skipped.push(`${obj.key} (${sourceIssue})`);
        continue;
      }
      if (change === 'same') continue;
      if (isVisible(current)) {
        visibleSourceChanged = true;
        jobs.push({ fileId: file.id, sourceKey: file.sourceKey });
      } else {
        result.skipped.push(
          `${obj.key} (kept off the site: ${current.unitHidden ? 'reference folder' : 'looks like a textbook'})`,
        );
      }
    }
    // A published course whose visible files changed goes back to draft until converted.
    const r2Keys = new Set(
      objects
        .filter(
          (o) =>
            !o.key.endsWith('/') && !isJunkFile(o.key.slice(course.r2Prefix.length).split('/').pop() ?? ''),
        )
        .map((o) => o.key),
    );
    const allPresentKeys = new Set(objects.map((object) => object.key));
    const missingFiles = existingFiles.filter((file) => !allPresentKeys.has(file.sourceKey));
    if (missingFiles.some((file) => !file.sourceMissingAt && isVisible(file))) {
      await this.takeCourseOffline(course.id);
    }
    const retiredVisibleSource = await this.retireMissingSources(missingFiles, result);
    const reconciledFiles = await this.writer.listAllFiles([course.id]);
    const catalogueKeys = new Set(
      reconciledFiles
        .filter((file) => !file.sourceMissingAt && !isJunkFile(file.sourceKey.split('/').at(-1) ?? ''))
        .map((file) => file.sourceKey),
    );
    const inventoryChanged =
      r2Keys.size !== catalogueKeys.size || [...r2Keys].some((key) => !catalogueKeys.has(key));
    if (course.status === 'live' && (visibleSourceChanged || inventoryChanged || retiredVisibleSource)) {
      await this.takeCourseOffline(course.id);
    }
    // Legacy live courses may have every file hidden after broken-source checks.
    // Keep their catalogue status consistent even when the R2 keys are unchanged.
    await this.unpublishIfEmpty(course.id);
    conversionJobs.push(...jobs);
  }

  /**
   * Retire absent sources only after the caller has completed an entire R2 list for its scope.
   * Keep Supabase rows for audit/history, take them offline, and remove only derived page assets.
   */
  private async retireMissingSources(files: CourseFile[], result: SyncResultDto): Promise<boolean> {
    let retiredVisible = false;
    for (const file of files) {
      if (!file.sourceMissingAt && isVisible(file)) retiredVisible = true;
      if (!file.sourceMissingAt) {
        if (!(await this.writer.markFileSourceMissing(file.id))) throw fail.notFound('That file');
        result.filesRetired++;
      }
      result.pageObjectsRemoved += await this.clearGeneratedPages(file.id);
    }
    return retiredVisible;
  }

  private async clearGeneratedPages(fileId: string): Promise<number> {
    if (!/^[A-Za-z0-9_-]+$/.test(fileId)) {
      throw fail.syncFailed('Could not safely identify this file’s generated page folder.');
    }
    const prefix = `pages/${fileId}/`;
    const existing = await this.pages.list(prefix);
    await this.pages.deletePrefix(prefix);
    return existing.length;
  }

  /** Remove public catalogue access before changing visible source or page metadata. */
  private async takeCourseOffline(courseId: string): Promise<void> {
    const course = await this.reader.findCourse(courseId);
    if (course?.status !== 'live') return;
    await this.unpublishBundlesContaining(courseId);
    await this.writer.updateCourse(courseId, { status: 'draft' });
  }

  /** Remove page objects with no catalogue owner, and malformed/out-of-range output keys. */
  private async cleanOrphanPageObjects(): Promise<number> {
    const courses = await this.writer.listAllCourses();
    const files = await this.writer.listAllFiles(courses.map((course) => course.id));
    const filesById = new Map(files.map((file) => [file.id, file]));
    let removed = 0;
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    do {
      const page = await this.pages.listPage('pages/', cursor, 500);
      const deleteKeys: string[] = [];
      for (const object of page.objects) {
        const match = /^pages\/([^/]+)\/(.+)$/.exec(object.key);
        const file = match ? filesById.get(match[1]!) : undefined;
        if (!file || file.sourceMissingAt) {
          deleteKeys.push(object.key);
          continue;
        }
        // A pending conversion may be writing to this prefix now; inspect it after it settles.
        if (file.conversionStatus === 'pending') continue;
        const expectedPage = /^pages\/[^/]+\/(\d+)\.webp$/.exec(object.key);
        const pageNo = Number(expectedPage?.[1]);
        const belongsToReadyFile =
          file.conversionStatus === 'ready' &&
          (object.key === file.previewKey ||
            (!!expectedPage && Number.isInteger(pageNo) && pageNo >= 1 && pageNo <= file.pageCount));
        if (!belongsToReadyFile) deleteKeys.push(object.key);
      }
      for (const key of deleteKeys) await this.pages.delete(key);
      removed += deleteKeys.length;
      if (page.nextCursor && (seenCursors.has(page.nextCursor) || page.nextCursor === cursor)) {
        throw fail.syncFailed('R2 repeated a cursor during page-object cleanup; retry the bucket sync.');
      }
      if (page.nextCursor) seenCursors.add(page.nextCursor);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return removed;
  }

  /** A course cannot go live until every declared page and preview exists in page storage. */
  private async pageAssetState(file: CourseFile) {
    if (file.conversionStatus !== 'ready' || file.pageCount < 1 || !file.previewKey) {
      return {
        complete: false,
        found: 0,
        missingPageNumbers: Array.from({ length: Math.max(0, file.pageCount) }, (_, i) => i + 1),
        previewPresent: false,
        orphanPageObjects: [],
      };
    }
    const objects = await this.pages.list(`pages/${file.id}/`);
    const objectsByKey = new Map(objects.map((object) => [object.key, object]));
    const missingPageNumbers = Array.from({ length: file.pageCount }, (_, i) => i + 1).filter((pageNo) => {
      const page = objectsByKey.get(`pages/${file.id}/${pageNo}.webp`);
      return !page || page.size <= 0;
    });
    const preview = objectsByKey.get(file.previewKey);
    const previewPresent = !!preview && preview.size > 0;
    const orphanPageObjects = objects
      .filter((object) => {
        if (object.key === file.previewKey) return false;
        const prefix = `pages/${file.id}/`;
        if (!object.key.startsWith(prefix) || !object.key.endsWith('.webp') || object.size <= 0) return true;
        const pageNo = Number(object.key.slice(prefix.length, -'.webp'.length));
        return !Number.isInteger(pageNo) || pageNo < 1 || pageNo > file.pageCount;
      })
      .map((object) => object.key);
    return {
      complete: previewPresent && missingPageNumbers.length === 0,
      found: file.pageCount - missingPageNumbers.length,
      missingPageNumbers,
      previewPresent,
      orphanPageObjects,
    };
  }

  private async pageAssetsComplete(file: CourseFile): Promise<boolean> {
    return (await this.incompletePageAssets([file])).size === 0;
  }

  private async hasCompletePageAssets(files: CourseFile[]): Promise<boolean> {
    return (await this.incompletePageAssets(files)).size === 0;
  }

  private async incompletePageAssets(files: CourseFile[]): Promise<Set<string>> {
    if (files.length === 0) return new Set();
    const [manifests, assetStates] = await Promise.all([
      this.writer.listPageManifests(files.map((file) => file.id)),
      mapConcurrent(files, 8, (file) => this.pageAssetState(file)),
    ]);
    return new Set(
      files
        .filter(
          (file, index) =>
            !assetStates[index]?.complete ||
            pageManifestIssues(file, manifests.get(file.id) ?? []).length > 0,
        )
        .map((file) => file.id),
    );
  }

  private async assertCoursePublishable(courseId: string): Promise<void> {
    const files = (await this.writer.listAllFiles([courseId])).filter(isVisible);
    if (files.length === 0)
      throw fail.notReady('A course needs at least one visible file before publishing.');
    const inventory = await this.inventory(courseId);
    const sourceComplete =
      inventory.totals.changed === 0 &&
      inventory.totals.unmapped === 0 &&
      inventory.totals.unsupported === 0 &&
      inventory.totals.invalidSources === 0 &&
      inventory.totals.pageMappingsInvalid === 0 &&
      // Missing rows already retired by a completed scan remain in the audit,
      // but no longer block publication once public access has been removed.
      !inventory.objects.some((object) => object.status === 'missing-in-r2' && !object.hidden);
    if (!sourceComplete) {
      throw fail.notReady(
        'R2 contains unimported, unsupported, changed, invalid, or missing files. Review the storage audit and sync the course before publishing.',
      );
    }
    if (!(await this.hasCompletePageAssets(files))) {
      throw fail.notReady(
        'Every visible file needs complete R2 pages and a matching Supabase page map before publishing.',
      );
    }
  }

  private async enqueueConversions(jobs: { fileId: string; sourceKey: string }[]): Promise<void> {
    if (jobs.length === 0) return;
    const queueId = crypto.randomUUID();
    const queuedJobs = jobs.map((job, index) => ({
      ...job,
      queueId,
      queuePosition: index + 1,
      queueTotal: jobs.length,
    }));
    try {
      for (let offset = 0; offset < queuedJobs.length; offset += 25) {
        await Promise.all(
          queuedJobs.slice(offset, offset + 25).map((job) =>
            this.writer.updateConversionProgress({
              fileId: job.fileId,
              queueId,
              queuePosition: job.queuePosition,
              queueTotal: job.queueTotal,
              stage: 'queued',
              current: 0,
              total: 0,
            }),
          ),
        );
      }
      await this.queue.enqueue(queuedJobs);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The converter could not be started.';
      await Promise.allSettled(
        queuedJobs.map((job) =>
          this.writer.updateConversionProgress({
            fileId: job.fileId,
            queueId,
            queuePosition: job.queuePosition,
            queueTotal: job.queueTotal,
            stage: 'failed',
            current: 0,
            total: 0,
            error: `Converter dispatch failed: ${message}`,
            errorStage: 'dispatch',
          }),
        ),
      );
      throw fail.syncFailed(message);
    }
  }

  // ── Units and files: what is kept off the site ──

  async listUnits(courseId: string): Promise<AdminUnitDto[]> {
    const course = await this.reader.findCourse(courseId);
    if (!course) throw fail.notFound('That course');
    const files = (await this.writer.listAllFiles([course.id])).sort(
      (a, b) => a.unitSort - b.unitSort || naturalCompare(a.unitKey, b.unitKey) || a.sort - b.sort,
    );
    const units = new Map<string, AdminUnitDto>();
    for (const f of files) {
      const unit =
        units.get(f.unitKey) ??
        units
          .set(f.unitKey, {
            key: f.unitKey,
            label: unitLabel(f.unitKey),
            title: f.unitTitle,
            kind: f.unitKind,
            hidden: f.unitHidden,
            files: [],
          })
          .get(f.unitKey)!;
      unit.files.push({
        id: f.id,
        sourceKey: f.sourceKey,
        name: f.name,
        format: f.format,
        sizeBytes: f.sizeBytes,
        pageCount: f.pageCount,
        status: f.conversionStatus,
        error: f.conversionError,
        hidden: f.hidden,
      });
    }
    return [...units.values()];
  }

  /** Reconcile the live R2 prefix against every catalogue row, including hidden and failed files. */
  async inventory(courseId: string): Promise<CourseInventoryDto> {
    const course = await this.reader.findCourse(courseId);
    if (!course) throw fail.notFound('That course');
    const [stored, records] = await Promise.all([
      this.sources.list(course.r2Prefix),
      this.writer.listAllFiles([course.id]),
    ]);
    const objects = stored.sort((a, b) => naturalCompare(a.key, b.key));
    const sourceIssues = new Map<string, string>();
    const sourceFormats = new Map<string, Awaited<ReturnType<typeof this.sourceFormat>>>();
    const sourceFiles = objects.filter(
      (object) => !object.key.endsWith('/') && !isJunkFile(object.key.split('/').at(-1) ?? ''),
    );
    for (let offset = 0; offset < sourceFiles.length; offset += SOURCE_CHECK_CONCURRENCY) {
      const page = sourceFiles.slice(offset, offset + SOURCE_CHECK_CONCURRENCY);
      await Promise.all(
        page.map(async (object) => {
          const name = object.key.split('/').at(-1) ?? object.key;
          const format = await this.sourceFormat(object.key, name);
          sourceFormats.set(object.key, format);
          if (!format) {
            sourceIssues.set(object.key, unsupportedSourceIssue(name));
            return;
          }
          const issue = await this.sourceIntegrityIssue(object.key, name, object.size, object.etag);
          if (issue) sourceIssues.set(object.key, issue);
        }),
      );
    }
    const recordsByKey = new Map(records.map((file) => [file.sourceKey, file]));
    const pageManifests = await this.writer.listPageManifests(records.map((file) => file.id));
    const pageMappingIssuesByFile = new Map(
      records.map((file) => [file.id, pageManifestIssues(file, pageManifests.get(file.id) ?? [])]),
    );
    const foundKeys = new Set<string>();
    const pageAssetsByFile = new Map<string, Awaited<ReturnType<typeof this.pageAssetState>>>();
    const filesToAudit = records.filter((file) => file.conversionStatus === 'ready');
    for (let offset = 0; offset < filesToAudit.length; offset += 12) {
      await Promise.all(
        filesToAudit.slice(offset, offset + 12).map(async (file) => {
          pageAssetsByFile.set(file.id, await this.pageAssetState(file));
        }),
      );
    }
    const entries: CourseInventoryDto['objects'] = [];
    const folderStats = new Map<
      string,
      {
        explicitMarker: boolean;
        fileCount: number;
        registeredCount: number;
        unmappedCount: number;
        unsupportedCount: number;
        missingCount: number;
      }
    >();
    const ensureFolder = (path: string) => {
      let stats = folderStats.get(path);
      if (!stats) {
        stats = {
          explicitMarker: false,
          fileCount: 0,
          registeredCount: 0,
          unmappedCount: 0,
          unsupportedCount: 0,
          missingCount: 0,
        };
        folderStats.set(path, stats);
      }
      return stats;
    };
    const parentFolders = (relativeKey: string) => {
      const parts = relativeKey.split('/').filter(Boolean);
      const parents: string[] = [];
      for (let i = 1; i < parts.length; i++) parents.push(`${parts.slice(0, i).join('/')}/`);
      return parents;
    };

    let registered = 0;
    let changed = 0;
    let unmapped = 0;
    let unsupported = 0;
    let ignored = 0;
    for (const object of objects) {
      const relative = object.key.slice(course.r2Prefix.length);
      if (object.key.endsWith('/')) {
        for (const path of parentFolders(relative)) ensureFolder(path);
        ensureFolder(relative).explicitMarker = true;
        entries.push({
          key: object.key,
          name: relative,
          sizeBytes: object.size,
          status: 'folder-marker',
          fileId: null,
          unitKey: null,
          unit: null,
          conversionStatus: null,
          conversionError: null,
          conversionErrorStage: null,
          conversionStage: null,
          conversionProgressCurrent: 0,
          conversionProgressTotal: 0,
          conversionQueueId: null,
          conversionQueuePosition: 0,
          conversionQueueTotal: 0,
          conversionUpdatedAt: null,
          pageCount: null,
          pageAssetsComplete: null,
          pageAssetsFound: null,
          missingPageNumbers: null,
          previewPresent: null,
          sourceIssue: null,
          hidden: false,
          fileHidden: false,
          unitHidden: false,
          orphanPageObjects: [],
        });
        continue;
      }
      const name = relative.split('/').pop() ?? relative;
      const parents = parentFolders(relative);
      for (const path of parents) ensureFolder(path).fileCount++;
      const file = recordsByKey.get(object.key);
      if (file) {
        foundKeys.add(object.key);
        const sourceChanged = file.sourceEtag !== object.etag || file.sizeBytes !== object.size;
        const ignoredSource = isJunkFile(name);
        const unsupportedSource = !ignoredSource && sourceFormats.get(object.key) == null;
        const status = ignoredSource
          ? 'ignored'
          : unsupportedSource
            ? 'unsupported'
            : sourceChanged
              ? 'changed-in-r2'
              : 'registered';
        if (sourceChanged) changed++;
        if (ignoredSource) ignored++;
        else if (unsupportedSource) unsupported++;
        else if (!sourceChanged) registered++;
        if (!ignoredSource && !unsupportedSource) {
          for (const path of parents) ensureFolder(path).registeredCount++;
        }
        entries.push({
          key: object.key,
          name: relative,
          sizeBytes: object.size,
          status,
          fileId: file.id,
          unitKey: file.unitKey,
          unit: file.unitTitle,
          conversionStatus: file.conversionStatus,
          conversionError: file.conversionError,
          conversionErrorStage: file.conversionErrorStage ?? null,
          conversionStage: file.conversionStage ?? null,
          conversionProgressCurrent: file.conversionProgressCurrent ?? 0,
          conversionProgressTotal: file.conversionProgressTotal ?? 0,
          conversionQueueId: file.conversionQueueId ?? null,
          conversionQueuePosition: file.conversionQueuePosition ?? 0,
          conversionQueueTotal: file.conversionQueueTotal ?? 0,
          conversionUpdatedAt: file.conversionUpdatedAt ?? null,
          pageCount: file.pageCount,
          pageAssetsComplete: pageAssetsByFile.get(file.id)?.complete ?? null,
          pageAssetsFound: pageAssetsByFile.get(file.id)?.found ?? null,
          missingPageNumbers: pageAssetsByFile.get(file.id)?.missingPageNumbers ?? null,
          previewPresent: pageAssetsByFile.get(file.id)?.previewPresent ?? null,
          sourceIssue:
            sourceIssues.get(object.key) ??
            (unsupportedSource
              ? `Unsupported R2 file type: ${name.includes('.') ? `.${name.split('.').pop()}` : 'no extension'}.`
              : null),
          pageMappingIssues: pageMappingIssuesByFile.get(file.id) ?? [],
          fileHidden: file.hidden,
          hidden: file.hidden || file.unitHidden,
          unitHidden: file.unitHidden,
          orphanPageObjects: pageAssetsByFile.get(file.id)?.orphanPageObjects ?? [],
        });
        continue;
      }
      const format = isJunkFile(name) ? null : sourceFormats.get(object.key);
      const status = isJunkFile(name) ? 'ignored' : format ? 'unmapped' : 'unsupported';
      if (status === 'ignored') ignored++;
      if (status === 'unmapped') {
        unmapped++;
        for (const path of parents) ensureFolder(path).unmappedCount++;
      }
      if (status === 'unsupported') {
        unsupported++;
        for (const path of parents) ensureFolder(path).unsupportedCount++;
      }
      entries.push({
        key: object.key,
        name: relative,
        sizeBytes: object.size,
        status,
        fileId: null,
        unitKey: null,
        unit: null,
        conversionStatus: null,
        conversionError: null,
        conversionErrorStage: null,
        conversionStage: null,
        conversionProgressCurrent: 0,
        conversionProgressTotal: 0,
        conversionQueueId: null,
        conversionQueuePosition: 0,
        conversionQueueTotal: 0,
        conversionUpdatedAt: null,
        pageCount: null,
        pageAssetsComplete: null,
        pageAssetsFound: null,
        missingPageNumbers: null,
        previewPresent: null,
        sourceIssue: sourceIssues.get(object.key) ?? null,
        pageMappingIssues: [],
        hidden: false,
        fileHidden: false,
        unitHidden: false,
        orphanPageObjects: [],
      });
    }

    const missing = records.filter((file) => !foundKeys.has(file.sourceKey));
    for (const file of missing) {
      const relative = file.sourceKey.startsWith(course.r2Prefix)
        ? file.sourceKey.slice(course.r2Prefix.length)
        : file.sourceKey;
      for (const path of parentFolders(relative)) ensureFolder(path).missingCount++;
      entries.push({
        key: file.sourceKey,
        name: relative,
        sizeBytes: file.sizeBytes,
        status: 'missing-in-r2',
        fileId: file.id,
        unitKey: file.unitKey,
        unit: file.unitTitle,
        conversionStatus: file.conversionStatus,
        conversionError: file.conversionError,
        conversionErrorStage: file.conversionErrorStage ?? null,
        conversionStage: file.conversionStage ?? null,
        conversionProgressCurrent: file.conversionProgressCurrent ?? 0,
        conversionProgressTotal: file.conversionProgressTotal ?? 0,
        conversionQueueId: file.conversionQueueId ?? null,
        conversionQueuePosition: file.conversionQueuePosition ?? 0,
        conversionQueueTotal: file.conversionQueueTotal ?? 0,
        conversionUpdatedAt: file.conversionUpdatedAt ?? null,
        pageCount: file.pageCount,
        pageAssetsComplete: pageAssetsByFile.get(file.id)?.complete ?? null,
        pageAssetsFound: pageAssetsByFile.get(file.id)?.found ?? null,
        missingPageNumbers: pageAssetsByFile.get(file.id)?.missingPageNumbers ?? null,
        previewPresent: pageAssetsByFile.get(file.id)?.previewPresent ?? null,
        sourceIssue: null,
        pageMappingIssues: pageMappingIssuesByFile.get(file.id) ?? [],
        fileHidden: file.hidden,
        hidden: file.hidden || file.unitHidden,
        unitHidden: file.unitHidden,
        orphanPageObjects: pageAssetsByFile.get(file.id)?.orphanPageObjects ?? [],
      });
    }
    const folders = [...folderStats.entries()]
      .map(([path, value]) => ({ ...value, path, empty: value.fileCount === 0 }))
      .sort((a, b) => naturalCompare(a.path, b.path));
    const visibleRecords = records.filter(isVisible);
    const ready = visibleRecords.filter((file) => file.conversionStatus === 'ready').length;
    const pageAssetsMissing = visibleRecords.filter((file) => {
      const state = pageAssetsByFile.get(file.id);
      return file.conversionStatus === 'ready' && state && !state.complete;
    }).length;
    const pending = visibleRecords.filter((file) => file.conversionStatus === 'pending').length;
    const failed = visibleRecords.filter((file) => file.conversionStatus === 'failed').length;
    const invalidSources = sourceIssues.size;
    const pageMappingsInvalid = [...pageMappingIssuesByFile.values()].filter(
      (issues) => issues.length > 0,
    ).length;
    return {
      courseId,
      prefix: course.r2Prefix,
      checkedAt: new Date().toISOString(),
      complete:
        changed === 0 &&
        unmapped === 0 &&
        unsupported === 0 &&
        missing.length === 0 &&
        pageAssetsMissing === 0 &&
        invalidSources === 0 &&
        pageMappingsInvalid === 0,
      totals: {
        objects: objects.length,
        files: objects.filter((object) => !object.key.endsWith('/')).length,
        folders: folders.length,
        registered,
        changed,
        unmapped,
        unsupported,
        ignored,
        missingInR2: missing.length,
        pending,
        failed,
        ready,
        pageAssetsMissing,
        invalidSources,
        pageMappingsInvalid,
      },
      folders,
      objects: entries,
    };
  }

  /** Bounded, admin-only walk of one exact R2 prefix. Records are sent once on page one. */
  async storageInventoryPage(cursor?: string, prefix = ''): Promise<StorageInventoryPageDto> {
    // A course/folder scan checks generated output by walking pages/<file-id>/ one file at a
    // time. Those prefixes are already scoped to one immutable file ID, so avoid querying the
    // entire catalogue again for every generated-page cursor request.
    const isolatedPagePrefix = /^pages\/[^/]+\/$/.test(prefix);
    const [page, initial] = await Promise.all([
      this.sources.listPage(prefix, cursor, 500),
      cursor || isolatedPagePrefix
        ? Promise.resolve(undefined)
        : (async () => {
            const courses = await this.writer.listAllCourses();
            const needsAllRecords = prefix === '' || prefix === 'pages/';
            const scopedCourses = needsAllRecords
              ? courses
              : courses.filter(
                  (course) => course.r2Prefix.startsWith(prefix) || prefix.startsWith(course.r2Prefix),
                );
            const files = await this.writer.listAllFiles(scopedCourses.map((course) => course.id));
            const scopedFiles = files.filter((file) => needsAllRecords || file.sourceKey.startsWith(prefix));
            const manifests = await this.writer.listPageManifests(scopedFiles.map((file) => file.id));
            const mappingIssuesByFile = new Map(
              scopedFiles.map((file) => [file.id, pageManifestIssues(file, manifests.get(file.id) ?? [])]),
            );
            const coursesById = new Map(courses.map((course) => [course.id, course]));
            const records = scopedFiles.flatMap((file) => {
              const course = coursesById.get(file.courseId);
              if (!course) return [];
              return [
                {
                  fileId: file.id,
                  sourceKey: file.sourceKey,
                  sourceEtag: file.sourceEtag,
                  sizeBytes: file.sizeBytes,
                  courseId: course.id,
                  courseTitle: course.title,
                  courseSlug: course.slug,
                  coursePrefix: course.r2Prefix,
                  unitKey: file.unitKey,
                  unit: file.unitTitle,
                  conversionStatus: file.conversionStatus,
                  conversionError: file.conversionError,
                  conversionErrorStage: file.conversionErrorStage ?? null,
                  conversionStage: file.conversionStage ?? null,
                  conversionProgressCurrent: file.conversionProgressCurrent ?? 0,
                  conversionProgressTotal: file.conversionProgressTotal ?? 0,
                  conversionQueueId: file.conversionQueueId ?? null,
                  conversionQueuePosition: file.conversionQueuePosition ?? 0,
                  conversionQueueTotal: file.conversionQueueTotal ?? 0,
                  conversionUpdatedAt: file.conversionUpdatedAt ?? null,
                  pageCount: file.pageCount,
                  previewKey: file.previewKey,
                  hidden: file.hidden || file.unitHidden,
                  fileHidden: file.hidden,
                  unitHidden: file.unitHidden,
                  pageMappingIssues: mappingIssuesByFile.get(file.id) ?? [],
                },
              ];
            });
            return {
              records,
              courses: courses.map((course) => ({
                id: course.id,
                title: course.title,
                slug: course.slug,
                prefix: course.r2Prefix,
              })),
            };
          })(),
    ]);
    const objects = await mapConcurrent(page.objects, SOURCE_CHECK_CONCURRENCY, async (object) => {
      const kind = object.key.startsWith('_system/')
        ? ('system' as const)
        : object.key.startsWith('pages/')
          ? ('page' as const)
          : object.key.endsWith('/')
            ? ('folder' as const)
            : ('source' as const);
      const name = object.key.split('/').filter(Boolean).at(-1) ?? object.key;
      const format =
        kind === 'source' && !isJunkFile(name) ? await this.sourceFormat(object.key, name) : null;
      const sourceIssue = format
        ? await this.sourceIntegrityIssue(object.key, name, object.size, object.etag)
        : kind === 'source' && !isJunkFile(name)
          ? unsupportedSourceIssue(name)
          : null;
      const unregisteredStatus =
        kind !== 'source'
          ? null
          : isJunkFile(name)
            ? ('ignored' as const)
            : format
              ? ('unimported' as const)
              : ('unsupported' as const);
      return {
        key: object.key,
        sizeBytes: object.size,
        etag: object.etag,
        kind,
        unregisteredStatus,
        sourceIssue,
      };
    });
    return {
      checkedAt: new Date().toISOString(),
      scopePrefix: prefix,
      importRoot: this.config.importRoot,
      objects,
      nextCursor: page.nextCursor,
      complete: page.nextCursor === null,
      ...(initial ?? {}),
    };
  }

  /** Reconcile all imported source files, catalogue rows and converted page objects in one read-only pass. */
  async storageAudit(): Promise<StorageAuditDto> {
    const courses = await this.writer.listAllCourses();
    const [records, listedBucketObjects, pageObjects] = await Promise.all([
      this.writer.listAllFiles(courses.map((course) => course.id)),
      this.sources.list(''),
      this.pages.list('pages/'),
    ]);
    const bucketObjects = listedBucketObjects.filter((object) => !object.key.startsWith('_system/'));
    const sources = bucketObjects.filter((object) => object.key.startsWith(this.config.importRoot));
    const outsideImportRootObjects = bucketObjects
      .filter((object) => !object.key.startsWith(this.config.importRoot) && !object.key.startsWith('pages/'))
      .map((object) => object.key)
      .sort(naturalCompare);
    const courseById = new Map(courses.map((course) => [course.id, course]));
    const courseForKey = (key: string) =>
      courses
        .filter((course) => key.startsWith(course.r2Prefix))
        .sort((a, b) => b.r2Prefix.length - a.r2Prefix.length)[0];
    const recordsByKey = new Map(records.map((file) => [file.sourceKey, file]));
    const foundKeys = new Set<string>();
    const pageKeysByFile = new Map<string, Set<string>>();
    for (const object of pageObjects) {
      const match = /^pages\/([^/]+)\//.exec(object.key);
      const fileId = match?.[1];
      if (!fileId) continue;
      const keys = pageKeysByFile.get(fileId) ?? new Set<string>();
      keys.add(object.key);
      pageKeysByFile.set(fileId, keys);
    }

    const folders = new Map<string, { explicitMarker: boolean; files: number; inImportRoot: boolean }>();
    const ensureFolder = (path: string, inImportRoot: boolean) => {
      const folder = folders.get(path) ?? { explicitMarker: false, files: 0, inImportRoot };
      folders.set(path, folder);
      return folder;
    };
    const files: StorageAuditDto['files'] = [];
    let registered = 0;
    let changed = 0;
    let unimported = 0;
    let unsupported = 0;
    let ignored = 0;
    let pageAssetsExpected = 0;
    let pageAssetsFound = 0;
    let pending = 0;
    let failed = 0;
    let ready = 0;

    for (const object of sources.sort((a, b) => naturalCompare(a.key, b.key))) {
      const relative = object.key.startsWith(this.config.importRoot)
        ? object.key.slice(this.config.importRoot.length)
        : object.key;
      const parts = relative.split('/').filter(Boolean);
      const isFolder = object.key.endsWith('/');
      const folderParts = isFolder ? parts : parts.slice(0, -1);
      for (let i = 1; i <= folderParts.length; i++)
        ensureFolder(`${this.config.importRoot}${folderParts.slice(0, i).join('/')}/`, true);
      if (isFolder) {
        ensureFolder(`${this.config.importRoot}${parts.join('/')}/`, true).explicitMarker = true;
        continue;
      }
      for (let i = 1; i <= folderParts.length; i++)
        ensureFolder(`${this.config.importRoot}${folderParts.slice(0, i).join('/')}/`, true).files++;

      const name = parts.at(-1) ?? relative;
      const record = recordsByKey.get(object.key);
      const course = record ? courseById.get(record.courseId) : courseForKey(object.key);
      let status: StorageAuditDto['files'][number]['status'];
      if (record) {
        foundKeys.add(object.key);
        const changedInR2 = record.sourceEtag !== object.etag || record.sizeBytes !== object.size;
        status = changedInR2 ? 'changed' : 'registered';
        if (changedInR2) changed++;
        else registered++;
      } else if (isJunkFile(name)) {
        status = 'ignored';
        ignored++;
      } else if (await this.sourceFormat(object.key, name)) {
        status = 'unimported';
        unimported++;
      } else {
        status = 'unsupported';
        unsupported++;
      }

      const assetKeys = record ? (pageKeysByFile.get(record.id) ?? new Set<string>()) : new Set<string>();
      const expected = record?.pageCount ?? 0;
      const missingPageNumbers = record
        ? Array.from({ length: expected }, (_, i) => i + 1).filter(
            (page) => !assetKeys.has(`pages/${record.id}/${page}.webp`),
          )
        : [];
      const foundPages = record
        ? [...assetKeys].filter((key) => {
            const match = new RegExp(`^pages/${record.id}/(\\d+)\\.webp$`).exec(key);
            return !!match && (!expected || Number(match[1]) <= expected);
          }).length
        : 0;
      const previewPresent = !!record?.previewKey && assetKeys.has(record.previewKey);
      if (record) {
        pageAssetsExpected += expected;
        pageAssetsFound += foundPages;
        if (isVisible(record)) {
          if (record.conversionStatus === 'pending') pending++;
          if (record.conversionStatus === 'failed') failed++;
          if (record.conversionStatus === 'ready') ready++;
        }
      }
      files.push({
        key: object.key,
        name: relative,
        sizeBytes: object.size,
        courseId: course?.id ?? null,
        courseTitle: course?.title ?? null,
        courseSlug: course?.slug ?? null,
        fileId: record?.id ?? null,
        unitKey: record?.unitKey ?? null,
        unit: record?.unitTitle ?? null,
        conversionStatus: record?.conversionStatus ?? null,
        conversionError: record?.conversionError ?? null,
        conversionErrorStage: record?.conversionErrorStage ?? null,
        conversionStage: record?.conversionStage ?? null,
        conversionProgressCurrent: record?.conversionProgressCurrent ?? 0,
        conversionProgressTotal: record?.conversionProgressTotal ?? 0,
        conversionQueueId: record?.conversionQueueId ?? null,
        conversionQueuePosition: record?.conversionQueuePosition ?? 0,
        conversionQueueTotal: record?.conversionQueueTotal ?? 0,
        conversionUpdatedAt: record?.conversionUpdatedAt ?? null,
        pageCount: record?.pageCount ?? null,
        pageAssetsFound: foundPages,
        pageAssetsExpected: expected,
        missingPageNumbers,
        previewPresent,
        status,
        inImportRoot: true,
        hidden: record ? record.hidden || record.unitHidden : false,
        fileHidden: record?.hidden ?? false,
        unitHidden: record?.unitHidden ?? false,
      });
    }

    for (const object of bucketObjects
      .filter((item) => !item.key.startsWith(this.config.importRoot) && !item.key.startsWith('pages/'))
      .sort((a, b) => naturalCompare(a.key, b.key))) {
      const relative = object.key;
      const parts = relative.split('/').filter(Boolean);
      const isFolder = object.key.endsWith('/');
      const folderParts = isFolder ? parts : parts.slice(0, -1);
      for (let i = 1; i <= folderParts.length; i++)
        ensureFolder(`${folderParts.slice(0, i).join('/')}/`, false);
      if (isFolder) {
        ensureFolder(`${parts.join('/')}/`, false).explicitMarker = true;
        continue;
      }
      for (let i = 1; i <= folderParts.length; i++)
        ensureFolder(`${folderParts.slice(0, i).join('/')}/`, false).files++;

      const name = parts.at(-1) ?? relative;
      const record = recordsByKey.get(object.key);
      const course = record ? courseById.get(record.courseId) : courseForKey(object.key);
      let status: StorageAuditDto['files'][number]['status'];
      if (record) {
        foundKeys.add(object.key);
        const sourceChanged = record.sourceEtag !== object.etag || record.sizeBytes !== object.size;
        status = sourceChanged ? 'changed' : 'registered';
        if (sourceChanged) changed++;
        else registered++;
      } else if (isJunkFile(name)) {
        status = 'ignored';
        ignored++;
      } else if (await this.sourceFormat(object.key, name)) {
        status = 'unimported';
        unimported++;
      } else {
        status = 'unsupported';
        unsupported++;
      }

      const assetKeys = record ? (pageKeysByFile.get(record.id) ?? new Set<string>()) : new Set<string>();
      const expected = record?.pageCount ?? 0;
      const missingPageNumbers = record
        ? Array.from({ length: expected }, (_, i) => i + 1).filter(
            (page) => !assetKeys.has(`pages/${record.id}/${page}.webp`),
          )
        : [];
      const foundPages = record
        ? [...assetKeys].filter((key) => {
            const match = new RegExp(`^pages/${record.id}/(\\d+)\\.webp$`).exec(key);
            return !!match && (!expected || Number(match[1]) <= expected);
          }).length
        : 0;
      const previewPresent = !!record?.previewKey && assetKeys.has(record.previewKey);
      if (record) {
        pageAssetsExpected += expected;
        pageAssetsFound += foundPages;
        if (record.conversionStatus === 'pending') pending++;
        if (record.conversionStatus === 'failed') failed++;
        if (record.conversionStatus === 'ready') ready++;
      }
      files.push({
        key: object.key,
        name: relative,
        sizeBytes: object.size,
        courseId: course?.id ?? null,
        courseTitle: course?.title ?? null,
        courseSlug: course?.slug ?? null,
        fileId: record?.id ?? null,
        unitKey: record?.unitKey ?? null,
        unit: record?.unitTitle ?? null,
        conversionStatus: record?.conversionStatus ?? null,
        conversionError: record?.conversionError ?? null,
        conversionErrorStage: record?.conversionErrorStage ?? null,
        conversionStage: record?.conversionStage ?? null,
        conversionProgressCurrent: record?.conversionProgressCurrent ?? 0,
        conversionProgressTotal: record?.conversionProgressTotal ?? 0,
        conversionQueueId: record?.conversionQueueId ?? null,
        conversionQueuePosition: record?.conversionQueuePosition ?? 0,
        conversionQueueTotal: record?.conversionQueueTotal ?? 0,
        conversionUpdatedAt: record?.conversionUpdatedAt ?? null,
        pageCount: record?.pageCount ?? null,
        pageAssetsFound: foundPages,
        pageAssetsExpected: expected,
        missingPageNumbers,
        previewPresent,
        status,
        inImportRoot: false,
        hidden: record ? record.hidden || record.unitHidden : false,
        fileHidden: record?.hidden ?? false,
        unitHidden: record?.unitHidden ?? false,
      });
    }

    for (const record of records) {
      if (foundKeys.has(record.sourceKey)) continue;
      const course = courseById.get(record.courseId);
      const assetKeys = pageKeysByFile.get(record.id) ?? new Set<string>();
      const expected = record.pageCount;
      const missingPageNumbers = Array.from({ length: expected }, (_, i) => i + 1).filter(
        (page) => !assetKeys.has(`pages/${record.id}/${page}.webp`),
      );
      const foundPages = [...assetKeys].filter((key) => {
        const match = new RegExp(`^pages/${record.id}/(\\d+)\\.webp$`).exec(key);
        return !!match && (!expected || Number(match[1]) <= expected);
      }).length;
      pageAssetsExpected += expected;
      pageAssetsFound += foundPages;
      if (record.conversionStatus === 'pending') pending++;
      if (record.conversionStatus === 'failed') failed++;
      if (record.conversionStatus === 'ready') ready++;
      files.push({
        key: record.sourceKey,
        name: record.sourceKey.startsWith(course?.r2Prefix ?? '')
          ? record.sourceKey.slice(course?.r2Prefix.length ?? 0)
          : record.sourceKey,
        sizeBytes: record.sizeBytes,
        courseId: course?.id ?? null,
        courseTitle: course?.title ?? null,
        courseSlug: course?.slug ?? null,
        fileId: record.id,
        unitKey: record.unitKey,
        unit: record.unitTitle,
        conversionStatus: record.conversionStatus,
        conversionError: record.conversionError,
        conversionErrorStage: record.conversionErrorStage ?? null,
        conversionStage: record.conversionStage ?? null,
        conversionProgressCurrent: record.conversionProgressCurrent ?? 0,
        conversionProgressTotal: record.conversionProgressTotal ?? 0,
        conversionQueueId: record.conversionQueueId ?? null,
        conversionQueuePosition: record.conversionQueuePosition ?? 0,
        conversionQueueTotal: record.conversionQueueTotal ?? 0,
        conversionUpdatedAt: record.conversionUpdatedAt ?? null,
        pageCount: record.pageCount,
        pageAssetsFound: foundPages,
        pageAssetsExpected: expected,
        missingPageNumbers,
        previewPresent: !!record.previewKey && assetKeys.has(record.previewKey),
        status: 'missing-source',
        inImportRoot: record.sourceKey.startsWith(this.config.importRoot),
        hidden: record.hidden || record.unitHidden,
        fileHidden: record.hidden,
        unitHidden: record.unitHidden,
      });
    }

    const knownFileIds = new Set(records.map((record) => record.id));
    const recordsById = new Map(records.map((record) => [record.id, record]));
    const orphanPageObjects = pageObjects
      .filter((object) => {
        const match = /^pages\/([^/]+)\/(.+)$/.exec(object.key);
        const fileId = match?.[1];
        if (!fileId || !knownFileIds.has(fileId)) return true;
        const record = recordsById.get(fileId);
        if (!record) return true;
        const pageMatch = new RegExp(`^pages/${fileId}/(\\d+)\\.webp$`).exec(object.key);
        return object.key !== record.previewKey && !(pageMatch && Number(pageMatch[1]) <= record.pageCount);
      })
      .map((object) => object.key);
    const foldersList = [...folders.entries()]
      .map(([path, values]) => ({ path, ...values }))
      .sort((a, b) => naturalCompare(a.path, b.path));
    const missingPreviews = files.filter(
      (file) => !file.hidden && file.conversionStatus === 'ready' && !file.previewPresent,
    ).length;
    return {
      checkedAt: new Date().toISOString(),
      importRoot: this.config.importRoot,
      totals: {
        sourceObjects: sources.length,
        bucketObjects: bucketObjects.length,
        outsideImportRoot: outsideImportRootObjects.length,
        sourceFiles: sources.filter((object) => !object.key.endsWith('/')).length,
        folders: foldersList.length,
        registered,
        changed,
        unimported,
        unsupported,
        ignored,
        missingSource: files.filter((file) => file.status === 'missing-source').length,
        databaseFiles: records.length,
        pending,
        failed,
        ready,
        pageAssetsExpected,
        pageAssetsFound,
        missingPageAssets: files.reduce(
          (total, file) => total + (file.hidden ? 0 : file.missingPageNumbers.length),
          0,
        ),
        missingPreviews,
        orphanPageObjects: orphanPageObjects.length,
      },
      folders: foldersList,
      files: files.sort((a, b) => naturalCompare(a.key, b.key)),
      orphanPageObjects,
      outsideImportRootObjects,
    };
  }

  /** A bounded storage audit for one course; page objects are read only below that course's file IDs. */
  async storageAuditCourse(courseId: string): Promise<StorageAuditDto> {
    const course = await this.reader.findCourse(courseId);
    if (!course) throw fail.notFound('That course');
    const inventory = await this.inventory(course.id);
    const files: StorageAuditDto['files'] = inventory.objects
      .filter((object) => object.status !== 'folder-marker')
      .map((object) => {
        const status: StorageAuditDto['files'][number]['status'] =
          object.status === 'changed-in-r2'
            ? 'changed'
            : object.status === 'unmapped'
              ? 'unimported'
              : object.status === 'missing-in-r2'
                ? 'missing-source'
                : object.status === 'registered'
                  ? 'registered'
                  : object.status === 'unsupported'
                    ? 'unsupported'
                    : 'ignored';
        return {
          key: object.key,
          name: object.name,
          sizeBytes: object.sizeBytes,
          courseId: course.id,
          courseTitle: course.title,
          courseSlug: course.slug,
          fileId: object.fileId,
          unitKey: object.unitKey,
          unit: object.unit,
          conversionStatus: object.conversionStatus,
          conversionError: object.conversionError,
          conversionErrorStage: object.conversionErrorStage,
          conversionStage: object.conversionStage,
          conversionProgressCurrent: object.conversionProgressCurrent,
          conversionProgressTotal: object.conversionProgressTotal,
          conversionQueueId: object.conversionQueueId,
          conversionQueuePosition: object.conversionQueuePosition,
          conversionQueueTotal: object.conversionQueueTotal,
          conversionUpdatedAt: object.conversionUpdatedAt,
          pageCount: object.pageCount,
          pageAssetsFound: object.pageAssetsFound ?? 0,
          pageAssetsExpected: object.pageCount ?? 0,
          missingPageNumbers: object.missingPageNumbers ?? [],
          previewPresent: object.previewPresent ?? false,
          sourceIssue: object.sourceIssue ?? null,
          pageMappingIssues: object.pageMappingIssues ?? [],
          status,
          inImportRoot: object.key.startsWith(this.config.importRoot),
          hidden: object.hidden,
          fileHidden: object.fileHidden ?? (object.hidden && !object.unitHidden),
          unitHidden: object.unitHidden,
        };
      });
    const orphanPageObjects = inventory.objects.flatMap((object) => object.orphanPageObjects ?? []);
    const pageAssetsExpected = files.reduce((total, file) => total + file.pageAssetsExpected, 0);
    const pageAssetsFound = files.reduce((total, file) => total + file.pageAssetsFound, 0);
    const missingPageAssets = files.reduce(
      (total, file) => total + (file.hidden ? 0 : file.missingPageNumbers.length),
      0,
    );
    const missingPreviews = files.filter(
      (file) => !file.hidden && file.conversionStatus === 'ready' && !file.previewPresent,
    ).length;
    const pageObjectCount = inventory.objects.reduce(
      (total, object) =>
        total +
        (object.pageAssetsFound ?? 0) +
        (object.previewPresent ? 1 : 0) +
        (object.orphanPageObjects?.length ?? 0),
      0,
    );

    return {
      checkedAt: inventory.checkedAt,
      importRoot: course.r2Prefix,
      totals: {
        sourceObjects: inventory.totals.objects,
        bucketObjects: inventory.totals.objects + pageObjectCount,
        outsideImportRoot: 0,
        sourceFiles: inventory.totals.files,
        folders: inventory.totals.folders,
        registered: inventory.totals.registered,
        changed: inventory.totals.changed,
        unimported: inventory.totals.unmapped,
        unsupported: inventory.totals.unsupported,
        ignored: inventory.totals.ignored,
        missingSource: inventory.totals.missingInR2,
        databaseFiles: new Set(files.map((file) => file.fileId).filter(Boolean)).size,
        pending: inventory.totals.pending,
        failed: inventory.totals.failed,
        ready: inventory.totals.ready,
        pageAssetsExpected,
        pageAssetsFound,
        missingPageAssets,
        missingPreviews,
        orphanPageObjects: orphanPageObjects.length,
        invalidSources: inventory.totals.invalidSources,
        invalidPageMappings: inventory.totals.pageMappingsInvalid,
      },
      folders: inventory.folders.map((folder) => ({
        path: `${course.r2Prefix}${folder.path}`,
        explicitMarker: folder.explicitMarker,
        files: folder.fileCount,
        inImportRoot: course.r2Prefix.startsWith(this.config.importRoot),
      })),
      files,
      orphanPageObjects,
      outsideImportRootObjects: [],
    };
  }

  async setUnitHidden(courseId: string, unitKey: string, hidden: boolean): Promise<AdminUnitDto[]> {
    if (!hidden) {
      const becomingVisible = (await this.writer.listAllFiles([courseId])).filter(
        (file) => file.unitKey === unitKey && !file.hidden,
      );
      const incomplete = becomingVisible.filter((file) => file.conversionStatus !== 'ready');
      const needsRepair = await this.incompletePageAssets(
        becomingVisible.filter((file) => file.conversionStatus === 'ready'),
      );
      if (incomplete.length || needsRepair.size) await this.takeCourseOffline(courseId);
    }
    if (!(await this.writer.setUnitHidden(courseId, unitKey, hidden))) throw fail.notFound('That unit');
    if (hidden) await this.unpublishIfEmpty(courseId);
    else await this.afterShowing(courseId, (f) => f.unitKey === unitKey);
    return this.listUnits(courseId);
  }

  async setFileHidden(fileId: string, hidden: boolean): Promise<AdminUnitDto[]> {
    const file = await this.writer.findAnyFile(fileId);
    if (!file) throw fail.notFound('That file');
    if (!hidden && file.sourceMissingAt) {
      throw fail.notReady(
        'This source is missing from R2. Sync its folder after restoring the file, then approve it here.',
      );
    }
    if (!hidden && !file.unitHidden && file.conversionStatus !== 'ready') {
      await this.takeCourseOffline(file.courseId);
    } else if (!hidden && !file.unitHidden && !(await this.pageAssetsComplete(file))) {
      await this.takeCourseOffline(file.courseId);
    }
    await this.writer.setFileHidden(fileId, hidden);
    if (hidden) await this.unpublishIfEmpty(file.courseId);
    else await this.afterShowing(file.courseId, (f) => f.id === fileId);
    return this.listUnits(file.courseId);
  }

  /** Explicitly retry a failed conversion after verifying the source object is still intact. */
  async retryConversion(fileId: string): Promise<{ ok: true; queued: number }> {
    const file = await this.writer.findAnyFile(fileId);
    if (!file) throw fail.notFound('That file');
    if (file.sourceMissingAt) {
      throw fail.notReady(
        'This source is missing from R2. Restore it and sync its folder before retrying conversion.',
      );
    }
    const failedConversion = file.conversionStatus === 'failed';
    const pageRepair = file.conversionStatus === 'ready' && !(await this.pageAssetsComplete(file));
    if (!failedConversion && !pageRepair) {
      throw fail.notReady('This file has no failed or missing conversion pages to repair.');
    }
    const [source, listed] = await Promise.all([
      this.sources.get(file.sourceKey),
      this.sources.list(file.sourceKey),
    ]);
    if (!source) throw fail.notFound('The R2 source file');
    const metadata = listed.find((object) => object.key === file.sourceKey);
    if (!metadata || metadata.etag !== file.sourceEtag || metadata.size !== file.sizeBytes) {
      throw fail.badRequest(
        'The R2 source has changed. Sync the course first so the catalogue uses the latest copy.',
      );
    }
    const sourceIssue = sourceIssueFromPrefix(
      await readBodyPrefix(source.body),
      file.sourceKey.split('/').at(-1) ?? file.name,
      file.sizeBytes,
    );
    if (sourceIssue) {
      await this.markBrokenSource(file.courseId, file.id, sourceIssue);
      throw fail.badRequest(sourceIssue);
    }
    if (failedConversion && !(await this.writer.markConversionPending(file.id))) {
      throw fail.notFound('That file');
    }
    if (pageRepair) {
      const course = await this.reader.findCourse(file.courseId);
      if (course?.status === 'live' && isVisible(file)) {
        await this.unpublishBundlesContaining(file.courseId);
        await this.writer.updateCourse(file.courseId, { status: 'draft' });
      }
    }
    await this.enqueueConversions([{ fileId: file.id, sourceKey: file.sourceKey }]);
    return { ok: true, queued: 1 };
  }

  /** Don't leave an empty course live after its last public file is hidden or rejected. */
  private async unpublishIfEmpty(courseId: string): Promise<void> {
    const files = (await this.writer.listAllFiles([courseId])).filter(isReaderReady);
    if (files.length > 0) return;
    const course = await this.reader.findCourse(courseId);
    if (course?.status !== 'live') return;
    await this.unpublishBundlesContaining(courseId);
    await this.writer.updateCourse(courseId, { status: 'draft' });
  }

  /** Files that just became visible get converted; a live course waits for them as a draft. */
  private async afterShowing(courseId: string, which: (f: CourseFile) => boolean): Promise<void> {
    const shown = (await this.writer.listAllFiles([courseId])).filter((f) => which(f) && isVisible(f));
    const readyFiles = shown.filter((file) => file.conversionStatus === 'ready');
    const incomplete = await this.incompletePageAssets(readyFiles);
    const todo = shown.filter((file) => file.conversionStatus !== 'ready' || incomplete.has(file.id));
    if (todo.length === 0) return;
    const course = await this.reader.findCourse(courseId);
    if (course?.status === 'live') {
      await this.unpublishBundlesContaining(courseId);
      await this.writer.updateCourse(courseId, { status: 'draft' });
    }
    await this.enqueueConversions(todo.map((f) => ({ fileId: f.id, sourceKey: f.sourceKey })));
  }

  // ── Bundles ──

  async listBundles(): Promise<AdminBundleDto[]> {
    const bundles = await this.bundles.listAll();
    const ids = [...new Set(bundles.flatMap((b) => b.courseIds))];
    const courses = await this.reader.coursesByIds(ids);
    const files = await this.reader.listFiles(ids);
    return bundles.map((b) => ({
      ...toBundleCard(b, courses, files, true),
      status: b.status,
      courseIds: b.courseIds,
    }));
  }

  async saveBundle(input: Omit<Bundle, 'id' | 'slug'> & { id?: string }): Promise<AdminBundleDto> {
    const courses = await this.reader.coursesByIds(input.courseIds);
    if (courses.length !== new Set(input.courseIds).size)
      throw fail.badRequest('A chosen course no longer exists.');
    if (input.status === 'live' && courses.some((course) => course.status !== 'live'))
      throw fail.badRequest('Publish every course in this bundle before publishing the bundle.');
    if (input.status === 'live') {
      for (const course of courses) await this.assertCoursePublishable(course.id);
    }
    if (input.batchYear !== null) await this.writer.ensureBatch(input.batchYear);
    const all = await this.bundles.listAll();
    const current = input.id ? all.find((b) => b.id === input.id) : undefined;
    if (input.id && !current) throw fail.notFound('That bundle');
    let slug = current?.slug ?? slugify(input.title);
    for (let i = 2; !current && all.some((b) => b.slug === slug); i++) slug = slugify(`${input.title}-${i}`);
    const activeCourses = courses.filter((course) => course.status !== 'archived');
    if (activeCourses.length < 2) throw fail.badRequest('A bundle needs at least two active courses.');
    const listPaise = activeCourses
      .filter((course) => course.status !== 'archived')
      .reduce((s, c) => s + c.pricePaise, 0);
    if (input.pricePaise >= listPaise)
      throw fail.badRequest('A bundle should cost less than its courses together.');
    const saved = await this.bundles.save({ ...input, slug });
    const files = await this.reader.listFiles(saved.courseIds);
    return { ...toBundleCard(saved, courses, files, true), status: saved.status, courseIds: saved.courseIds };
  }

  /** Price the admin form starts from for a set of courses. */
  async suggestPrice(courseIds: string[]): Promise<number> {
    const courses = await this.reader.coursesByIds(courseIds);
    return suggestBundlePrice(courses.map((c) => c.pricePaise));
  }

  // ── Converter callback ──

  async applyConversion(report: ConversionReport): Promise<void> {
    const file = await this.writer.findAnyFile(report.fileId);
    if (!file) throw fail.notFound('That file');
    if (file.sourceMissingAt) {
      // A converter may finish after the source was removed. Its output is derived data,
      // so remove that exact file's page folder and ignore the late Supabase callback.
      await this.pages.deletePrefix(`pages/${file.id}/`);
      return;
    }
    // A late callback from an older retry must never replace the newest queue's result.
    if (report.queueId && file.conversionQueueId && report.queueId !== file.conversionQueueId) return;
    let verifiedReport = report;
    if (report.status === 'ready') {
      const [source, sourceObjects, pageObjects] = await Promise.all([
        this.sources.get(file.sourceKey),
        this.sources.list(file.sourceKey),
        this.pages.list(`pages/${file.id}/`),
      ]);
      const sourceIssue = source
        ? sourceIssueFromPrefix(
            await readBodyPrefix(source.body),
            file.sourceKey.split('/').at(-1) ?? file.name,
            file.sizeBytes,
          )
        : null;
      if (!source) {
        verifiedReport = {
          fileId: report.fileId,
          queueId: report.queueId,
          queuePosition: report.queuePosition,
          queueTotal: report.queueTotal,
          status: 'failed',
          error: `${BROKEN_SOURCE} the original file is missing from R2. Re-upload it before publishing.`,
          errorStage: 'downloading_source',
          pages: [],
        };
      } else if (sourceIssue) {
        verifiedReport = {
          fileId: report.fileId,
          queueId: report.queueId,
          queuePosition: report.queuePosition,
          queueTotal: report.queueTotal,
          status: 'failed',
          error: sourceIssue,
          errorStage: 'validating_source',
          pages: [],
        };
      } else if (
        !sourceObjects.some(
          (object) =>
            object.key === file.sourceKey &&
            object.etag === file.sourceEtag &&
            object.size === file.sizeBytes,
        )
      ) {
        verifiedReport = {
          fileId: report.fileId,
          queueId: report.queueId,
          queuePosition: report.queuePosition,
          queueTotal: report.queueTotal,
          status: 'failed',
          error:
            'The R2 source changed while it was converting. Sync the course again to convert the latest copy.',
          errorStage: 'downloading_source',
          pages: [],
        };
      } else {
        const orderedPageNumbers = report.pages.map((page) => page.pageNo).sort((a, b) => a - b);
        const hasValidPageManifest =
          orderedPageNumbers.length > 0 &&
          orderedPageNumbers.every((pageNo, index) => pageNo === index + 1) &&
          report.pages.every((page) => page.imageKey === `pages/${file.id}/${page.pageNo}.webp`) &&
          report.previewKey === `pages/${file.id}/preview.webp`;
        if (!hasValidPageManifest) {
          verifiedReport = {
            fileId: report.fileId,
            queueId: report.queueId,
            queuePosition: report.queuePosition,
            queueTotal: report.queueTotal,
            status: 'failed',
            error:
              'The converter returned an invalid page map. Expected sequential page numbers and canonical R2 page keys.',
            errorStage: 'saving_manifest',
            pages: [],
          };
        }
        const existing = new Set(pageObjects.map((object) => object.key));
        const missing = [
          ...report.pages.filter((page) => !existing.has(page.imageKey)).map((page) => page.pageNo),
          ...(report.previewKey && !existing.has(report.previewKey) ? ['preview'] : []),
        ];
        const empty = pageObjects
          .filter(
            (object) =>
              object.size <= 0 &&
              (report.pages.some((page) => page.imageKey === object.key) || object.key === report.previewKey),
          )
          .map((object) => object.key);
        if (verifiedReport.status === 'ready' && (missing.length || empty.length)) {
          verifiedReport = {
            fileId: report.fileId,
            queueId: report.queueId,
            queuePosition: report.queuePosition,
            queueTotal: report.queueTotal,
            status: 'failed',
            error: `R2 verification failed; missing ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ` and ${missing.length - 20} more` : ''}${empty.length ? `${missing.length ? '; ' : ''}empty ${empty.slice(0, 20).join(', ')}${empty.length > 20 ? ` and ${empty.length - 20} more` : ''}` : ''}.`,
            errorStage: 'verifying_r2',
            pages: [],
          };
        }
      }
    }
    await recordConversion(this.writer, verifiedReport);
    if (verifiedReport.status === 'failed') await this.pages.deletePrefix(`pages/${file.id}/`);
    if (verifiedReport.status === 'failed' && verifiedReport.error?.startsWith(BROKEN_SOURCE)) {
      await this.unpublishIfEmpty(file.courseId);
    }
  }

  async recordConversionProgress(progress: ConversionProgressReport): Promise<void> {
    const file = await this.writer.findAnyFile(progress.fileId);
    if (!file) throw fail.notFound('That file');
    if (file.sourceMissingAt) return;
    // Ignore callbacks from a superseded queue after an admin retries a stalled job.
    if (file.conversionQueueId && progress.queueId !== file.conversionQueueId) return;
    await this.writer.updateConversionProgress(progress);
  }

  private node(prefix: string, name: string, depth: number): Node {
    return {
      prefix,
      name,
      depth,
      fileCount: 0,
      supportedCount: 0,
      ignoredCount: 0,
      sizeBytes: 0,
      children: new Map(),
      looseFiles: 0,
      looseObjects: [],
    };
  }

  private async assertBranch(slug: string) {
    const branches = await this.reader.listBranches();
    if (!branches.some((b) => b.slug === slug)) throw fail.badRequest('Unknown branch.');
  }

  private async unpublishBundlesContaining(courseId: string): Promise<void> {
    for (const bundle of await this.bundles.listAll()) {
      if (bundle.status === 'live' && bundle.courseIds.includes(courseId)) {
        await this.bundles.save({ ...bundle, status: 'draft' });
      }
    }
  }
}
