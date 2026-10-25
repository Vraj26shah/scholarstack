import type {
  MoveCourseFolderInput,
  MoveCourseFolderResultDto,
  StorageCleanInput,
  StorageCleanResultDto,
  StorageFolderDto,
  StorageMapDto,
} from '@ss/contracts';
import type { StoredObject } from '../domain/entities';
import type { CatalogueWriter, DatabaseHousekeeping, ObjectStore } from '../domain/ports';
import { fail } from './errors';

/** What each table holds, in words, so the admin knows what a number means. */
const PURPOSE: Record<string, string> = {
  file_pages: 'One row per generated page (the page index the reader uses)',
  course_files: 'Every notes file in every course',
  course_units: 'Units/modules inside courses',
  courses: 'Courses',
  course_programmes: 'Which branches each course is listed under',
  programmes: 'Branches (CSE, BAI, …)',
  programme_subjects: 'Subjects per branch',
  subjects: 'Subject names',
  batches: 'Batch years',
  bundles: 'Bundles',
  bundle_courses: 'Courses inside each bundle',
  orders: 'Checkouts (paid, failed and started-but-unpaid)',
  order_items: 'Courses inside each checkout',
  entitlements: 'Who can read which course, and until when',
  profiles: 'Student accounts',
  devices: 'Signed-in devices (2 per student)',
  active_sessions: 'Which sign-in is live on which device',
  viewer_leases: 'Who is reading right now (one reader at a time)',
  reading_progress: 'Where each student stopped reading',
  access_logs: 'Pages read per student per day (abuse limits)',
  audit_log: 'Admin actions history',
  announcements: 'Emails sent to students',
  features: 'Toolbox tools',
  email_quota: 'Emails sent per day',
  admin_emails: 'Admin addresses',
  problem_reports: 'Problems log (browser and server errors)',
};

async function walk(
  store: ObjectStore,
  prefix: string,
  keep: (o: StoredObject) => boolean,
): Promise<StoredObject[]> {
  const out: StoredObject[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await store.listPage(prefix, cursor, 1000);
    for (const o of page.objects) if (keep(o)) out.push(o);
    if (page.nextCursor && (seen.has(page.nextCursor) || page.nextCursor === cursor))
      throw fail.syncFailed('R2 repeated a cursor while mapping storage; try again.');
    if (page.nextCursor) seen.add(page.nextCursor);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return out;
}

const folderOf = (key: string) => key.slice(0, key.lastIndexOf('/') + 1) || '(bucket root)';

/**
 * Everything the site stores, mapped to what uses it: uploaded notes in R2 by folder and course,
 * generated pages by file, and every database table. Clean-up only ever removes things nothing
 * points at, re-checked at the moment of deleting.
 */
export class StorageMapService {
  constructor(
    private readonly writer: CatalogueWriter,
    private readonly sources: ObjectStore,
    private readonly pages: ObjectStore,
    private readonly db: DatabaseHousekeeping,
    private readonly cleanOrphanPages: () => Promise<number>,
    private readonly importRoot = 'drive-imports/',
  ) {}

  /** "23 Batch\\DBMS" or "/drive-imports//23 Batch/DBMS" → "drive-imports/23 Batch/DBMS/". */
  normaliseFolder(raw: string): string {
    let f = raw
      .trim()
      .replace(/\\/g, '/')
      .replace(/\/{2,}/g, '/')
      .replace(/^\/+/, '');
    if (!f.endsWith('/')) f += '/';
    if (!f.startsWith(this.importRoot)) f = this.importRoot + f;
    return f;
  }

  /**
   * Move (or rename) a course's folder in R2. Copies every object to the new folder, points the
   * course and its files there in one database step, then deletes the old copies. Generated
   * pages are filed by file id, so nothing is re-made, the course stays live, and students'
   * access and reading progress are untouched. Refused while any file of the course is being
   * converted, or when the new folder already has files or belongs to another course.
   */
  async moveCourseFolder(input: MoveCourseFolderInput): Promise<MoveCourseFolderResultDto> {
    const to = this.normaliseFolder(input.newFolder);
    if (to.split('/').some((part) => part === '..' || part === '.') || to.startsWith('pages/'))
      throw fail.badRequest('That folder name is not allowed.');
    const { courses, files } = await this.catalogue();
    const course = courses.find((c) => c.id === input.courseId);
    if (!course) throw fail.notFound('That course');
    const from = course.r2Prefix;
    if (to === from) throw fail.badRequest('That is already the course’s folder.');
    if (to.startsWith(from)) throw fail.badRequest('The new folder can’t be inside the current one.');
    const clash = courses.find(
      (c) => c.id !== course.id && (c.r2Prefix.startsWith(to) || to.startsWith(c.r2Prefix)),
    );
    if (clash)
      throw fail.badRequest(`That folder overlaps the folder of “${clash.title}”. Pick another name.`);
    const own = files.filter((f) => f.courseId === course.id);
    if (own.some((f) => f.conversionStatus === 'pending'))
      throw fail.badRequest('Pages are being made for this course right now. Move it once they finish.');
    const target = await this.sources.listPage(to, undefined, 1);
    if (target.objects.length)
      throw fail.badRequest('The new folder already has files in R2. Pick an empty folder.');
    const objects = await walk(this.sources, from, () => true);
    if (objects.length > 250)
      throw fail.badRequest(
        'This folder has more than 250 files. Move its sub-folders one course at a time.',
      );

    // 1. Copy everything. If any copy fails, remove the copies and stop: nothing has changed.
    const copied = new Map<string, { etag: string; size: number }>();
    try {
      for (const o of objects)
        copied.set(o.key, await this.sources.copy(o.key, to + o.key.slice(from.length)));
    } catch (error) {
      for (const key of copied.keys()) await this.sources.delete(to + key.slice(from.length)).catch(() => {});
      throw fail.syncFailed(`Could not copy the files, so nothing was moved: ${(error as Error).message}`);
    }
    // 2. Point the course and its files at the new folder, all at once.
    const moves = own
      .filter((f) => f.sourceKey.startsWith(from))
      .map((f) => ({
        fileId: f.id,
        sourceKey: to + f.sourceKey.slice(from.length),
        sourceEtag: copied.get(f.sourceKey)?.etag ?? f.sourceEtag,
      }));
    try {
      await this.writer.moveCourseSource(course.id, to, moves);
    } catch (error) {
      for (const key of copied.keys()) await this.sources.delete(to + key.slice(from.length)).catch(() => {});
      throw fail.syncFailed(`Could not update the course, so nothing was moved: ${(error as Error).message}`);
    }
    // 3. Remove the old copies. Anything left shows as unused in the storage map.
    let leftovers = 0;
    for (const o of objects) await this.sources.delete(o.key).catch(() => leftovers++);
    return { from, to, movedObjects: objects.length, movedFiles: moves.length, leftovers };
  }

  private async catalogue() {
    const courses = await this.writer.listAllCourses();
    const files = await this.writer.listAllFiles(courses.map((c) => c.id));
    return { courses, files };
  }

  async map(): Promise<StorageMapDto> {
    const { courses, files } = await this.catalogue();
    const referenced = new Set(files.map((f) => f.sourceKey));
    const liveFileIds = new Set(files.filter((f) => !f.sourceMissingAt).map((f) => f.id));
    const [notes, pageObjects, tables, abandonedOrders] = await Promise.all([
      walk(this.sources, '', (o) => !/^(pages|contributions|support|_system)\//.test(o.key)),
      walk(this.pages, 'pages/', () => true),
      this.db.tables().catch(() => []),
      this.db.countAbandonedOrders(30).catch(() => 0),
    ]);

    const byFolder = new Map<string, StorageFolderDto>();
    const coursesByPrefix = [...courses].sort((a, b) => b.r2Prefix.length - a.r2Prefix.length);
    for (const o of notes) {
      const folder = folderOf(o.key);
      let row = byFolder.get(folder);
      if (!row) {
        const course = coursesByPrefix.find((c) => c.r2Prefix && folder.startsWith(c.r2Prefix));
        row = {
          folder,
          course: course ? { id: course.id, title: course.title, status: course.status } : null,
          objects: 0,
          bytes: 0,
          unusedObjects: 0,
          unusedBytes: 0,
        };
        byFolder.set(folder, row);
      }
      row.objects++;
      row.bytes += o.size;
      if (!referenced.has(o.key)) {
        row.unusedObjects++;
        row.unusedBytes += o.size;
      }
    }
    const folders = [...byFolder.values()].sort((a, b) => a.folder.localeCompare(b.folder));

    const pageFolders = new Map<string, { objects: number; bytes: number }>();
    for (const o of pageObjects) {
      const id = /^pages\/([^/]+)\//.exec(o.key)?.[1] ?? '(loose)';
      const g = pageFolders.get(id) ?? { objects: 0, bytes: 0 };
      g.objects++;
      g.bytes += o.size;
      pageFolders.set(id, g);
    }
    const unusedPageFolders = [...pageFolders.entries()]
      .filter(([id]) => !liveFileIds.has(id))
      .map(([id, g]) => ({ folder: `pages/${id}/`, ...g }))
      .sort((a, b) => b.bytes - a.bytes);

    const sum = (xs: { objects: number; bytes: number }[]) =>
      xs.reduce((t, x) => ({ objects: t.objects + x.objects, bytes: t.bytes + x.bytes }), {
        objects: 0,
        bytes: 0,
      });
    const notesTotal = sum(folders);
    const pagesTotal = sum([...pageFolders.values()]);
    const unusedPages = sum(unusedPageFolders);
    return {
      scannedAt: new Date().toISOString(),
      r2: {
        notes: {
          ...notesTotal,
          unusedObjects: folders.reduce((t, f) => t + f.unusedObjects, 0),
          unusedBytes: folders.reduce((t, f) => t + f.unusedBytes, 0),
        },
        pages: {
          files: pageFolders.size,
          ...pagesTotal,
          unusedObjects: unusedPages.objects,
          unusedBytes: unusedPages.bytes,
        },
      },
      folders,
      unusedPageFolders: unusedPageFolders.slice(0, 300),
      database: tables.map((t) => ({ ...t, purpose: PURPOSE[t.table] ?? '' })),
      abandonedOrders,
    };
  }

  async clean(input: StorageCleanInput): Promise<StorageCleanResultDto> {
    if (input.what === 'orders') {
      return {
        removedObjects: 0,
        removedBytes: 0,
        removedRows: await this.db.cleanAbandonedOrders(input.olderThanDays),
      };
    }
    if (input.what === 'pages') {
      return { removedObjects: await this.cleanOrphanPages(), removedBytes: 0, removedRows: 0 };
    }
    // Uploaded notes: delete only the exact files in the chosen folders that no course file uses.
    // Checked again now, so something attached since the map was drawn is never removed.
    const { files } = await this.catalogue();
    const referenced = new Set(files.map((f) => f.sourceKey));
    let removedObjects = 0;
    let removedBytes = 0;
    for (const folder of new Set(input.folders)) {
      if (/^(pages|contributions|support|_system)\//.test(folder) || folder === '(bucket root)') continue;
      const inFolder = await walk(this.sources, folder, (o) => folderOf(o.key) === folder);
      for (const o of inFolder) {
        if (referenced.has(o.key)) continue;
        await this.sources.delete(o.key);
        removedObjects++;
        removedBytes += o.size;
      }
    }
    return { removedObjects, removedBytes, removedRows: 0 };
  }
}
