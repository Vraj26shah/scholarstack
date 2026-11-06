import type {
  MoveCourseFolderInput,
  MoveCourseFolderResultDto,
  StorageCleanInput,
  StorageCleanResultDto,
  StorageFolderDto,
  StorageMapDto,
  StorageUnusedDto,
  UnusedGroupDto,
  UnusedGroupKey,
} from '@ss/contracts';
import type { CatalogueWriter, DatabaseHousekeeping, ObjectStore } from '../domain/ports';
import { fail } from './errors';
import { StorageIndex, walk } from './storage-index';

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
    /** Which upload and help-desk files the site still points at. */
    private readonly owners?: {
      uploads(): Promise<{ all: Set<string>; finished: Set<string> }>;
      support(): Promise<Set<string>>;
    },
    private readonly index: StorageIndex = new StorageIndex(sources, pages, 0),
  ) {}

  /**
   * Every stored object nothing uses, by kind. Folders not imported yet are listed apart: they are
   * waiting, not unused, and are never deleted from here.
   */
  async unused(): Promise<StorageUnusedDto> {
    const scan = await this.scanUnused();
    return {
      scannedAt: new Date().toISOString(),
      groups: scan.groups.map((g) => ({
        ...g,
        items: [...g.items].sort((a, b) => b.bytes - a.bytes),
      })),
      notImported: scan.notImported,
    };
  }

  private async scanUnused(fresh = false) {
    const { courses, files } = await this.catalogue();
    const referenced = new Set(files.map((f) => f.sourceKey));
    const liveFileIds = new Set(files.filter((f) => !f.sourceMissingAt).map((f) => f.id));
    const [notes, pageStats, uploads, support, owned] = await Promise.all([
      this.index.notes(fresh),
      this.index.pageStats(fresh),
      this.index.area('contributions/', fresh),
      this.index.area('support/', fresh),
      Promise.all([
        this.owners?.uploads() ?? Promise.resolve(null),
        this.owners?.support() ?? Promise.resolve(null),
      ]),
    ]);
    const [uploadKeys, supportKeys] = owned;
    const byPrefix = [...courses].sort((a, b) => b.r2Prefix.length - a.r2Prefix.length);
    const group = (key: UnusedGroupKey): UnusedGroupDto => ({ key, objects: 0, bytes: 0, items: [] });
    const groups = {
      pages: group('pages'),
      leftovers: group('leftovers'),
      'uploads-orphan': group('uploads-orphan'),
      'uploads-finished': group('uploads-finished'),
      'support-orphan': group('support-orphan'),
      'courses-off-sale': group('courses-off-sale'),
      'missing-files': group('missing-files'),
    };
    const add = (g: UnusedGroupDto, key: string, bytes: number) => {
      g.objects++;
      g.bytes += bytes;
      g.items.push({ key, bytes });
    };
    const waiting = new Map<string, { folder: string; objects: number; bytes: number }>();
    const depth = this.importRoot.split('/').filter(Boolean).length + 2;
    for (const o of notes) {
      // Empty-folder markers ("…/") are the admin's folders, not leftovers.
      if (referenced.has(o.key) || o.key.endsWith('/')) continue;
      if (byPrefix.some((c) => c.r2Prefix && o.key.startsWith(c.r2Prefix)))
        add(groups.leftovers, o.key, o.size);
      else {
        const folder = `${o.key.split('/').slice(0, depth).join('/')}/`;
        const w = waiting.get(folder) ?? { folder, objects: 0, bytes: 0 };
        w.objects++;
        w.bytes += o.size;
        waiting.set(folder, w);
      }
    }
    for (const [id, g] of pageStats)
      if (id !== '(loose)' && !liveFileIds.has(id)) add(groups.pages, `pages/${id}/`, g.bytes);
    // Without the owners lists nothing in these areas is called unused (better safe than sorry).
    if (uploadKeys)
      for (const o of uploads) {
        if (!uploadKeys.all.has(o.key)) add(groups['uploads-orphan'], o.key, o.size);
        else if (uploadKeys.finished.has(o.key)) add(groups['uploads-finished'], o.key, o.size);
      }
    if (supportKeys)
      for (const o of support) if (!supportKeys.has(o.key)) add(groups['support-orphan'], o.key, o.size);
    // Supabase side: courses nobody can buy (draft or archived) and file records with no note.
    const courseById = new Map(courses.map((c) => [c.id, c]));
    for (const c of courses) {
      if (c.status === 'live') continue;
      const own = files.filter((f) => f.courseId === c.id);
      const pageBytes = own.reduce((t, f) => t + (pageStats.get(f.id)?.bytes ?? 0), 0);
      const noteBytes = own.reduce((t, f) => t + (f.sourceMissingAt ? 0 : f.sizeBytes), 0);
      const g = groups['courses-off-sale'];
      g.objects++;
      g.bytes += noteBytes + pageBytes;
      g.rows = (g.rows ?? 0) + 1 + own.length;
      g.items.push({
        key: `course:${c.id}`,
        bytes: noteBytes + pageBytes,
        label: c.title,
        note: `${c.status === 'draft' ? 'Draft' : 'Archived'} · ${c.batchYear} batch · ${own.length} file${own.length === 1 ? '' : 's'}`,
        rows: 1 + own.length,
      });
    }
    for (const f of files) {
      if (!f.sourceMissingAt) continue;
      const c = courseById.get(f.courseId);
      const pageBytes = pageStats.get(f.id)?.bytes ?? 0;
      const g = groups['missing-files'];
      g.objects++;
      g.bytes += pageBytes;
      g.rows = (g.rows ?? 0) + 1;
      g.items.push({
        key: `file:${f.id}`,
        bytes: pageBytes,
        label: f.name,
        note: `${c?.title ?? 'No course'} › ${f.unitTitle} · note missing from storage`,
        rows: 1,
      });
    }
    return {
      groups: Object.values(groups),
      notImported: [...waiting.values()].sort((a, b) => a.folder.localeCompare(b.folder)),
    };
  }

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
      throw fail.badRequest('The new folder already has files. Pick an empty folder.');
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
    const [notes, pageFolders, tables, abandonedOrders] = await Promise.all([
      this.index.notes(),
      this.index.pageStats(),
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
      unusedPageFolders,
      database: tables.map((t) => ({ ...t, purpose: PURPOSE[t.table] ?? '' })),
      abandonedOrders,
    };
  }

  /**
   * Delete a course nobody can buy, for good: its rows (units, files, page index), its pages, and
   * notes no other course uses. Refused for live courses and for any course someone bought.
   */
  private async dropCourse(courseId: string): Promise<StorageCleanResultDto | 'sold'> {
    const { courses, files } = await this.catalogue();
    const course = courses.find((c) => c.id === courseId);
    if (!course) throw fail.badRequest('That course is already gone. Scan again.');
    if (course.status === 'live') throw fail.badRequest('That course is live now, so it was kept.');
    const own = files.filter((f) => f.courseId === courseId);
    const outcome = await this.writer.deleteCourse(courseId);
    if (outcome === 'sold') return 'sold';
    let removedObjects = 0;
    let removedBytes = 0;
    for (const f of own) {
      const tiles = await walk(this.pages, `pages/${f.id}/`);
      if (tiles.length) await this.pages.deletePrefix(`pages/${f.id}/`);
      removedObjects += tiles.length;
      removedBytes += tiles.reduce((t, o) => t + o.size, 0);
    }
    const stillUsed = new Set(files.filter((f) => f.courseId !== courseId).map((f) => f.sourceKey));
    for (const f of own) {
      if (stillUsed.has(f.sourceKey) || f.sourceMissingAt) continue;
      stillUsed.add(f.sourceKey);
      await this.sources.delete(f.sourceKey);
      removedObjects++;
      removedBytes += f.sizeBytes;
    }
    return { removedObjects, removedBytes, removedRows: 1 + own.length };
  }

  /** Remove file records whose note is gone from storage, with their pages. */
  private async dropMissingFiles(fileIds: string[]): Promise<StorageCleanResultDto> {
    const { files } = await this.catalogue();
    const ids = fileIds.filter((id) => files.some((f) => f.id === id && f.sourceMissingAt));
    if (!ids.length) throw fail.badRequest('Those files are back in storage or already removed. Scan again.');
    let removedObjects = 0;
    let removedBytes = 0;
    for (const id of ids) {
      const tiles = await walk(this.pages, `pages/${id}/`);
      if (tiles.length) await this.pages.deletePrefix(`pages/${id}/`);
      removedObjects += tiles.length;
      removedBytes += tiles.reduce((t, o) => t + o.size, 0);
    }
    const removedRows = await this.writer.deleteFiles(ids);
    return { removedObjects, removedBytes, removedRows };
  }

  async clean(input: StorageCleanInput): Promise<StorageCleanResultDto> {
    if (input.what === 'unused-object' && input.group === 'courses-off-sale') {
      const r = await this.dropCourse(input.key.replace(/^course:/, ''));
      if (r === 'sold')
        throw fail.badRequest(
          'Students bought or were given this course, so it is kept as part of your sales history.',
        );
      return r;
    }
    if (input.what === 'unused-object' && input.group === 'missing-files')
      return this.dropMissingFiles([input.key.replace(/^file:/, '')]);
    if (input.what === 'unused' && input.group === 'courses-off-sale') {
      const total = { removedObjects: 0, removedBytes: 0, removedRows: 0 };
      const { courses } = await this.catalogue();
      for (const c of courses) {
        if (c.status === 'live') continue;
        const r = await this.dropCourse(c.id);
        if (r === 'sold') continue;
        total.removedObjects += r.removedObjects;
        total.removedBytes += r.removedBytes;
        total.removedRows += r.removedRows;
      }
      return total;
    }
    if (input.what === 'unused' && input.group === 'missing-files') {
      const { files } = await this.catalogue();
      const ids = files.filter((f) => f.sourceMissingAt).map((f) => f.id);
      if (!ids.length) return { removedObjects: 0, removedBytes: 0, removedRows: 0 };
      return this.dropMissingFiles(ids);
    }
    if (input.what === 'unused-object') {
      const scan = await this.scanUnused(true);
      const item = scan.groups.find((g) => g.key === input.group)?.items.find((i) => i.key === input.key);
      if (!item) throw fail.badRequest('That object is no longer unused. Scan storage again.');
      if (input.group === 'pages') {
        if (!/^pages\/[^/]+\/$/.test(input.key))
          throw fail.badRequest('That generated-page folder cannot be deleted individually.');
        const fileId = input.key.slice('pages/'.length, -1);
        const { files } = await this.catalogue();
        if (files.some((file) => file.id === fileId && !file.sourceMissingAt))
          throw fail.badRequest('That page folder belongs to a current file and was kept.');
        const objects = await walk(this.pages, input.key);
        if (objects.length === 0)
          throw fail.badRequest('That page folder is already empty. Scan storage again.');
        await this.pages.deletePrefix(input.key);
        return {
          removedObjects: objects.length,
          removedBytes: objects.reduce((total, object) => total + object.size, 0),
          removedRows: 0,
        };
      }
      await this.sources.delete(item.key);
      return { removedObjects: 1, removedBytes: item.bytes, removedRows: 0 };
    }
    if (input.what === 'unused') {
      // Worked out again now, so anything put back in use since the report is never removed.
      const g = (await this.scanUnused(true)).groups.find((x) => x.key === input.group)!;
      let removedObjects = 0;
      let removedBytes = 0;
      for (const item of g.items) {
        if (input.prefix && !item.key.startsWith(input.prefix)) continue;
        await this.sources.delete(item.key);
        removedObjects++;
        removedBytes += item.bytes;
      }
      return { removedObjects, removedBytes, removedRows: 0 };
    }
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
