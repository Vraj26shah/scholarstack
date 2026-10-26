import type {
  StorageDeletePreviewDto,
  StorageDeleteResultDto,
  StorageEntryDto,
  StorageMoveInput,
  StorageMovePlanDto,
  StorageRenameInput,
  StorageTreeDto,
} from '@ss/contracts';
import type { Course, CourseFile, StoredObject } from '../domain/entities';
import type { CatalogueWriter, EntitlementRepository, ObjectStore } from '../domain/ports';
import { fail } from './errors';
import { hiddenByDefault, parseUnit, unitKindOf, unitSortOf } from './folders';
import { safeFileName } from './uploads/file-policy';

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
      throw fail.syncFailed('Storage listing stalled; try again.');
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

  // ── Restructuring: move and rename, keeping pages ──

  /** A folder path, cleaned: "a\\b" or "/a//b" → "a/b/". */
  private folder(raw: string) {
    const f = raw
      .trim()
      .replace(/\\/g, '/')
      .replace(/\/{2,}/g, '/')
      .replace(/^\/+/, '');
    const path = f.endsWith('/') ? f : `${f}/`;
    if (path === '/' || path.split('/').some((p) => p === '..' || p === '.') || PROTECTED.test(path))
      throw fail.badRequest('That folder can’t be used.');
    return path;
  }

  /** Move files or whole folders into another folder. */
  move(input: StorageMoveInput) {
    const to = this.folder(input.toFolder);
    const pairs = (all: StoredObject[]) =>
      input.paths.flatMap((raw) => {
        const path = this.clean(raw);
        if (path.endsWith('/')) {
          const name = path.slice(0, -1).split('/').pop()!;
          return all
            .filter((o) => o.key.startsWith(path))
            .map((o) => ({ from: o.key, to: `${to}${name}/${o.key.slice(path.length)}` }));
        }
        return [{ from: path, to: `${to}${path.split('/').pop()}` }];
      });
    return this.relocate(
      pairs,
      input.dryRun,
      input.paths.map((p) => this.clean(p)),
      to,
    );
  }

  /** Rename one file (its extension is kept) or one folder, where it is. */
  rename(input: StorageRenameInput) {
    const path = this.clean(input.path);
    const isFolder = path.endsWith('/');
    const base = isFolder ? path.slice(0, -1) : path;
    const parent = base.slice(0, base.lastIndexOf('/') + 1);
    const ext = !isFolder && base.includes('.') ? base.slice(base.lastIndexOf('.')) : '';
    let name = safeFileName(input.newName);
    if (!isFolder && !/\.[a-z0-9]{2,5}$/i.test(name)) name += ext;
    if (!name || name === '.') throw fail.badRequest('Give it a name.');
    const target = isFolder ? `${parent}${name}/` : `${parent}${name}`;
    const pairs = (all: StoredObject[]) =>
      isFolder
        ? all
            .filter((o) => o.key.startsWith(path))
            .map((o) => ({ from: o.key, to: target + o.key.slice(path.length) }))
        : [{ from: path, to: target }];
    return this.relocate(pairs, input.dryRun, [path], parent);
  }

  /**
   * Plan (dry run) or carry out a list of moves. Each file: copy to its new key, point its site
   * record there (new unit, maybe another course; pages and reading history kept), then delete the
   * old copy. One file at a time, so a failure leaves every file either fully moved or untouched.
   */
  private async relocate(
    build: (all: StoredObject[]) => { from: string; to: string }[],
    dryRun: boolean,
    sources: string[],
    toFolder: string,
  ): Promise<StorageMovePlanDto> {
    const { courses, files, notes } = await this.snapshot();
    const pairs = build(notes).filter((p) => p.from !== p.to);
    const present = new Set(notes.map((o) => o.key));
    const byKey = new Map(files.map((f) => [f.sourceKey, f]));
    const byPrefix = [...courses].sort((a, b) => b.r2Prefix.length - a.r2Prefix.length);
    const courseOf = (key: string) => byPrefix.find((c) => c.r2Prefix && key.startsWith(c.r2Prefix)) ?? null;

    let blocked: string | null = null;
    const ownFolder = courses.find((c) => sources.some((s) => s.endsWith('/') && c.r2Prefix.startsWith(s)));
    if (ownFolder)
      blocked = `That includes the whole folder of “${ownFolder.title}”. Use “Move or rename a course's folder” for that.`;
    else if (sources.some((s) => s.endsWith('/') && toFolder.startsWith(s)))
      blocked = 'A folder can’t go inside itself.';
    else if (pairs.length === 0) blocked = 'Nothing to move.';
    else if (pairs.length > 300) blocked = 'More than 300 files at once. Move smaller folders.';
    const moves = pairs.map((p) => {
      const f = byKey.get(p.from);
      const from = f ? courses.find((c) => c.id === f.courseId) : null;
      const to = courseOf(p.to);
      return {
        ...p,
        f,
        toCourse: to,
        file: f ? { name: f.name, fromCourse: from?.title ?? '', toCourse: to?.title ?? '' } : null,
      };
    });
    if (!blocked) {
      const missing = moves.find((m) => !present.has(m.from));
      const clash = moves.find((m) => present.has(m.to));
      const homeless = moves.find((m) => m.f && !m.toCourse);
      const busy = moves.find((m) => m.f?.conversionStatus === 'pending');
      const twice = moves.find((m, i) => moves.findIndex((x) => x.to === m.to) !== i);
      blocked = missing
        ? `“${missing.from}” isn't in storage any more. Refresh and try again.`
        : clash
          ? `“${clash.to}” already exists. Pick another name or folder.`
          : twice
            ? `Two files would both become “${twice.to}”.`
            : homeless
              ? `“${homeless.f!.name}” is on the site, so it has to stay inside a course's folder.`
              : busy
                ? `Pages are being made for “${busy.f!.name}” right now. Move it once that finishes.`
                : null;
    }
    const plan: StorageMovePlanDto = {
      moves: moves.map(({ from, to, file }) => ({ from, to, file })),
      blocked,
    };
    if (dryRun || blocked) {
      if (!dryRun && blocked) throw fail.badRequest(blocked);
      return plan;
    }

    let moved = 0;
    let movedFiles = 0;
    let leftovers = 0;
    const touched = new Set<string>();
    for (const m of moves) {
      const copy = await this.sources.copy(m.from, m.to);
      if (m.f && m.toCourse) {
        const inner = m.to.slice(m.toCourse.r2Prefix.length).split('/');
        const loose = inner.length === 1;
        const unit = loose ? { key: 'notes', title: 'Notes' } : parseUnit(inner[0]!);
        const kind = loose ? 'notes' : unitKindOf(inner[0]!);
        await this.writer.relocateFile(m.f.id, {
          courseId: m.toCourse.id,
          unitKey: unit.key,
          unitTitle: unit.title,
          unitKind: kind,
          unitSort: unitSortOf(kind, unit.key),
          unitHidden: hiddenByDefault(kind),
          sourceKey: m.to,
          sourceEtag: copy.etag,
          name: inner.slice(1).join(' / ') || inner[0]!,
        });
        touched.add(m.f.courseId);
        movedFiles++;
      }
      await this.sources.delete(m.from).catch(() => leftovers++);
      moved++;
    }
    // A live course that lost its last readable file comes off sale.
    let coursesUnpublished = 0;
    if (touched.size) {
      const after = await this.writer.listAllFiles([...touched]);
      for (const id of touched) {
        const course = courses.find((c) => c.id === id);
        const readable = after.some(
          (f) =>
            f.courseId === id &&
            !f.hidden &&
            !f.unitHidden &&
            f.conversionStatus === 'ready' &&
            f.pageCount > 0,
        );
        if (course?.status === 'live' && !readable) {
          await this.writer.updateCourse(id, { status: 'draft' });
          coursesUnpublished++;
        }
      }
    }
    return { ...plan, done: { moved, files: movedFiles, leftovers, coursesUnpublished } };
  }
}
