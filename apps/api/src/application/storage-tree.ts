import type {
  StorageDeletePreviewDto,
  StorageDeleteResultDto,
  StorageEntryDto,
  StorageTreeDto,
} from '@ss/contracts';
import type { Course, CourseFile, StoredObject } from '../domain/entities';
import type { CatalogueWriter, EntitlementRepository, ObjectStore } from '../domain/ports';
import { fail } from './errors';

/** Areas of the bucket that are never notes and never deleted from here. */
const PROTECTED = /^(pages|contributions|support|_system)\//;

async function walk(store: ObjectStore, prefix: string): Promise<StoredObject[]> {
  const out: StoredObject[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await store.listPage(prefix, cursor, 1000);
    out.push(...page.objects);
    if (page.nextCursor && (seen.has(page.nextCursor) || page.nextCursor === cursor))
      throw fail.syncFailed('R2 repeated a cursor while listing; try again.');
    if (page.nextCursor) seen.add(page.nextCursor);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return out;
}

/** A path is a folder ("…/Unit 1/") or one file ("…/Unit 1/notes.pdf"). */
const inPath = (key: string, path: string) => (path.endsWith('/') ? key.startsWith(path) : key === path);

/**
 * The notes area of R2 as a tree, with what every file belongs to, and deleting a folder or file
 * *completely*: the R2 files, their generated pages and their database rows, in that order of
 * safety. Courses emptied by a delete are removed, or archived when students bought them (their
 * sales history is kept; the space-heavy files and pages still go).
 */
export class StorageTreeService {
  constructor(
    private readonly writer: CatalogueWriter,
    private readonly entitlements: Pick<EntitlementRepository, 'listForCourse'>,
    private readonly sources: ObjectStore,
    private readonly pages: ObjectStore,
  ) {}

  private async snapshot() {
    const courses = await this.writer.listAllCourses();
    const [files, notes, pageObjects] = await Promise.all([
      this.writer.listAllFiles(courses.map((c) => c.id)),
      walk(this.sources, '').then((all) => all.filter((o) => !PROTECTED.test(o.key))),
      walk(this.pages, 'pages/'),
    ]);
    const pagesByFile = new Map<string, { objects: number; bytes: number }>();
    for (const o of pageObjects) {
      const id = /^pages\/([^/]+)\//.exec(o.key)?.[1];
      if (!id) continue;
      const g = pagesByFile.get(id) ?? { objects: 0, bytes: 0 };
      g.objects++;
      g.bytes += o.size;
      pagesByFile.set(id, g);
    }
    return { courses, files, notes, pagesByFile };
  }

  async tree(): Promise<StorageTreeDto> {
    const { courses, files, notes, pagesByFile } = await this.snapshot();
    const byKey = new Map(files.map((f) => [f.sourceKey, f]));
    const present = new Set(notes.map((o) => o.key));
    const entry = (
      key: string,
      size: number,
      f: CourseFile | undefined,
      state: StorageEntryDto['state'],
    ) => ({
      key,
      size,
      state,
      fileId: f?.id ?? null,
      courseId: f?.courseId ?? null,
      pageObjects: f ? (pagesByFile.get(f.id)?.objects ?? 0) : 0,
      pageBytes: f ? (pagesByFile.get(f.id)?.bytes ?? 0) : 0,
    });
    const entries: StorageEntryDto[] = notes.map((o) => {
      const f = byKey.get(o.key);
      return entry(o.key, o.size, f, f ? 'used' : 'unused');
    });
    for (const f of files) if (!present.has(f.sourceKey)) entries.push(entry(f.sourceKey, 0, f, 'missing'));
    entries.sort((a, b) => a.key.localeCompare(b.key));
    return {
      scannedAt: new Date().toISOString(),
      entries,
      courses: courses.map((c) => ({ id: c.id, title: c.title, status: c.status, r2Prefix: c.r2Prefix })),
      totals: {
        objects: notes.length,
        bytes: notes.reduce((t, o) => t + o.size, 0),
        pageBytes: [...pagesByFile.values()].reduce((t, g) => t + g.bytes, 0),
        unused: entries.filter((e) => e.state === 'unused').length,
        missing: entries.filter((e) => e.state === 'missing').length,
      },
    };
  }

  private clean(raw: string) {
    const path = raw
      .trim()
      .replace(/\\/g, '/')
      .replace(/\/{2,}/g, '/')
      .replace(/^\/+/, '');
    if (!path || path.split('/').some((p) => p === '..' || p === '.') || PROTECTED.test(path))
      throw fail.badRequest('That path can’t be deleted from here.');
    if (path.split('/').filter(Boolean).length < 2)
      throw fail.badRequest('Pick a folder inside a batch, not the whole top level.');
    return path;
  }

  /** Exactly what a delete would remove, so nothing is a surprise. */
  async preview(raw: string): Promise<StorageDeletePreviewDto> {
    const path = this.clean(raw);
    const plan = await this.plan(path);
    return {
      path,
      r2Objects: plan.objects.length,
      r2Bytes: plan.objects.reduce((t, o) => t + o.size, 0),
      pageObjects: plan.files.reduce((t, f) => t + (plan.pagesByFile.get(f.id)?.objects ?? 0), 0),
      pageBytes: plan.files.reduce((t, f) => t + (plan.pagesByFile.get(f.id)?.bytes ?? 0), 0),
      files: plan.files.length,
      courses: await Promise.all(
        plan.courses.map(async ({ course, whole }) => ({
          id: course.id,
          title: course.title,
          status: course.status,
          whole,
          students: (await this.entitlements.listForCourse(course.id)).filter(
            (a) => !a.revokedAt && (!a.expiresAt || a.expiresAt.getTime() > Date.now()),
          ).length,
        })),
      ),
      blocked: plan.blocked,
    };
  }

  private async plan(path: string) {
    const { courses, files, notes, pagesByFile } = await this.snapshot();
    const objects = notes.filter((o) => inPath(o.key, path));
    const doomed = files.filter((f) => inPath(f.sourceKey, path));
    const doomedIds = new Set(doomed.map((f) => f.id));
    const touched = new Map<string, Course>();
    for (const f of doomed) {
      const c = courses.find((x) => x.id === f.courseId);
      if (c) touched.set(c.id, c);
    }
    // A course whose folder is inside the path goes whole, even if it has no files yet.
    if (path.endsWith('/')) for (const c of courses) if (c.r2Prefix.startsWith(path)) touched.set(c.id, c);
    const plannedCourses = [...touched.values()].map((course) => ({
      course,
      whole: files.filter((f) => f.courseId === course.id).every((f) => doomedIds.has(f.id)),
    }));
    const busy = doomed.find((f) => f.conversionStatus === 'pending');
    const blocked = busy
      ? `Pages are being made for “${busy.name}” right now. Delete once that finishes.`
      : objects.length === 0 && doomed.length === 0
        ? 'Nothing is stored here.'
        : null;
    return { objects, files: doomed, courses: plannedCourses, pagesByFile, blocked };
  }

  async remove(raw: string): Promise<StorageDeleteResultDto> {
    const path = this.clean(raw);
    const plan = await this.plan(path);
    if (plan.blocked) throw fail.badRequest(plan.blocked);

    // 1. Generated pages, by file. 2. The uploaded files. 3. The database rows.
    let removedPageObjects = 0;
    for (const f of plan.files) {
      removedPageObjects += plan.pagesByFile.get(f.id)?.objects ?? 0;
      await this.pages.deletePrefix(`pages/${f.id}/`);
    }
    let removedObjects = 0;
    let removedBytes = 0;
    for (const o of plan.objects) {
      await this.sources.delete(o.key);
      removedObjects++;
      removedBytes += o.size;
    }
    const removedFiles = plan.files.length ? await this.writer.deleteFiles(plan.files.map((f) => f.id)) : 0;

    let deletedCourses = 0;
    let archivedCourses = 0;
    for (const { course, whole } of plan.courses) {
      if (!whole) continue;
      const outcome = await this.writer.deleteCourse(course.id);
      if (outcome === 'deleted') deletedCourses++;
      else if (outcome === 'sold') {
        await this.writer.updateCourse(course.id, { status: 'archived' });
        archivedCourses++;
      }
    }
    return {
      removedObjects,
      removedBytes,
      removedPageObjects,
      removedFiles,
      deletedCourses,
      archivedCourses,
    };
  }
}
