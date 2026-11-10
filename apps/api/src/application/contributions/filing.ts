import type { ContributionCourseInput, FileContributionInput, FilePlanDto } from '@ss/contracts';
import { zipLayout } from '@ss/contracts';
import type { Contribution } from '../../domain/entities';
import type {
  CatalogueReader,
  CatalogueWriter,
  Clock,
  ContributionRepository,
  ObjectStore,
  UploadStore,
} from '../../domain/ports';
import { fail } from '../errors';
import { slugify } from '../folders';
import { safeFileName } from '../uploads/file-policy';
import { entryVerdict, inspectFile } from './inspect';
import { ZIP_LIMITS, type ZipEntry, listZip, unzipEntry } from './zip';

const CONTENT_TYPE: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  ppt: 'application/vnd.ms-powerpoint',
  pps: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain; charset=utf-8',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};
const typeOf = (name: string) =>
  CONTENT_TYPE[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

export async function toBytes(body: ReadableStream | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

/** A unit folder name that is ours: one clean path segment, e.g. "Unit 2 - SQL". */
export function cleanUnit(unit: string): string {
  const clean = unit
    .replace(/[\\/]+/g, ' ')
    .replace(/[^\w .()&,'-]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, 80);
  if (!clean) throw fail.badRequest('Give the unit folder a name, e.g. "Unit 2 - SQL".');
  return clean;
}

/** If every file in an archive sits in one top folder, that folder adds nothing: drop it. */
function commonRoot(paths: string[]): string {
  const first = paths[0]?.split('/') ?? [];
  if (first.length < 2) return '';
  const root = `${first[0]}/`;
  return paths.every((p) => p.startsWith(root)) ? root : '';
}

interface Step {
  from: string;
  to: string;
  status: 'new' | 'exists' | 'replace' | 'skipped';
  reason?: string;
  leftOut?: boolean;
  replace?: boolean;
  /** Keep an archive path relative to the course, so its folders become units. */
  keepPath?: boolean;
  /** An unsupported but bounded archive entry can be included under a supported extension. */
  canRename?: boolean;
  /** How to write it: copy the upload, or unpack this entry of it. */
  source?: { key: string; entry?: ZipEntry };
}

/**
 * Turns a student's upload into our layout: <course folder>/<unit>/<file>, unpacking archives,
 * leaving out what can't become pages, never overwriting. A dry run only shows the plan; a real run
 * writes the files and registers them, so their pages start being made at once.
 */
export class ContributionFilingService {
  constructor(
    private readonly repo: ContributionRepository,
    private readonly store: ObjectStore & UploadStore,
    private readonly courses: CatalogueReader,
    private readonly catalogue: CatalogueWriter,
    private readonly clock: Clock,
    private readonly importRoot = 'drive-imports/',
    private readonly currentIntakeYear = new Date().getFullYear(),
  ) {}

  /** Create an unpublished course in the configured import root for an accepted contribution. */
  async createCourse(id: string, input: ContributionCourseInput): Promise<{ id: string; title: string }> {
    const contribution = await this.repo.find(id);
    if (!contribution) throw fail.notFound('That upload');
    if (contribution.status !== 'approved')
      throw fail.badRequest('Accept the upload before creating a course.');

    const branches = await this.courses.listBranches();
    const selected = [...new Set(input.branchSlugs)];
    const branchBySlug = new Map(
      branches.filter((branch) => branch.isActive).map((branch) => [branch.slug, branch]),
    );
    const branch = selected[0] ? branchBySlug.get(selected[0]) : undefined;
    if (!branch || selected.some((slug) => !branchBySlug.has(slug)))
      throw fail.badRequest('Choose active branches for the new course.');

    await this.catalogue.ensureBatch(input.batchYear);
    const existing = await this.catalogue.listAllCourses();
    const baseSlug = slugify(`${input.title}-${input.batchYear}-${branch.slug}`);
    let slug = baseSlug;
    for (let n = 2; existing.some((course) => course.slug === slug); n++) slug = `${baseSlug}-${n}`;

    const root = this.importRoot.replace(/^\/+/, '').replace(/\/+$/, '');
    if (!root || root.split('/').some((part) => part === '..'))
      throw fail.badRequest('The course storage root is not configured safely.');
    const baseFolder = safeFileName(`${input.title}${input.courseCode ? ` (${input.courseCode})` : ''}`);
    const suffix = crypto.randomUUID().slice(0, 8);
    const r2Prefix = `${root}/${input.batchYear} Batch/${baseFolder} - ${suffix}/`;
    const seq =
      existing.filter((course) => course.batchYear === input.batchYear && course.branchSlug === branch.slug)
        .length + 1;
    const created = await this.catalogue.upsertCourseByPrefix({
      slug,
      title: input.title,
      courseCode: input.courseCode || null,
      description: input.description ?? '',
      batchYear: input.batchYear,
      branchSlug: branch.slug,
      semester:
        input.semester ?? Math.max(1, Math.min(5, this.currentIntakeYear - input.batchYear + 1)) * 2 - 1,
      seq,
      r2Prefix,
      pricePaise: input.pricePaise,
    });
    await this.catalogue.setCourseBranches(created.course.id, selected);
    return { id: created.course.id, title: created.course.title };
  }

  async file(id: string, input: FileContributionInput): Promise<FilePlanDto> {
    const c = await this.repo.find(id);
    if (!c) throw fail.notFound('That upload');
    if (!input.dryRun && c.status !== 'approved')
      throw fail.badRequest('Accept the upload before filing it.');
    const course = await this.courses.findCourse(input.courseId);
    if (!course) throw fail.notFound('That course');
    if (course.status === 'archived') throw fail.badRequest('That course is archived. Pick another one.');

    const [allFiles, courseObjects] = await Promise.all([
      this.catalogue.listAllFiles([course.id]),
      // The whole course folder: a file may be sent to any unit, not only the default one.
      this.store
        .list(course.r2Prefix)
        .then((list) => list),
    ]);
    const existing = new Set(courseObjects.map((object) => object.key));
    const units = [
      ...new Set(
        allFiles
          .map((f) => f.sourceKey.slice(course.r2Prefix.length).split('/'))
          .filter((parts) => parts.length > 1)
          .map((parts) => parts[0]!),
      ),
    ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    // A whole-subject ZIP keeps its own unit folders; the unit asked for is only for loose files.
    const whole = await this.isWholeSubject(c);
    const preserveFolders = input.preserveFolders || whole;
    if (input.replaceFolder && preserveFolders)
      throw fail.badRequest(
        'Turn off “Keep folders inside each ZIP” before replacing one destination folder.',
      );
    if (!preserveFolders && !input.unit.trim())
      throw fail.badRequest('Give the unit folder a name, e.g. "Unit 2 - SQL".');
    const folder = `${cleanUnit(input.unit.trim() || 'Notes')}/`;
    const { steps, bytesByKey, checks } = await this.plan(c, folder, preserveFolders);
    // The admin's choices for single files: another unit, a new name, or leave it out.
    const choice = new Map(input.files.map((f) => [f.from, f]));
    for (const s of steps) {
      const pick = choice.get(s.from);
      if (!pick) continue;
      if (pick.skip) {
        s.status = 'skipped';
        s.reason = 'left out by you';
        s.leftOut = true;
        continue;
      }
      if (s.status === 'skipped') {
        if (!s.source || !pick.name || !entryVerdict(pick.name).ok) continue;
        s.status = 'new';
        s.reason = undefined;
        s.leftOut = undefined;
      }
      let inner = s.keepPath ? s.to : s.to.slice(folder.length);
      // Sent to another unit: a whole-subject file keeps only its name there.
      if (s.keepPath && pick.unit) inner = inner.split('/').pop()!;
      if (pick.name) {
        const ext = inner.includes('.') ? inner.slice(inner.lastIndexOf('.')) : '';
        const wanted = safeFileName(pick.name);
        const named = /\.[a-z0-9]{2,5}$/i.test(wanted) ? wanted : `${wanted}${ext}`;
        inner = inner.includes('/') ? `${inner.slice(0, inner.lastIndexOf('/') + 1)}${named}` : named;
      }
      s.to = `${pick.unit ? `${cleanUnit(pick.unit)}/` : s.keepPath ? '' : folder}${inner}`;
      s.replace = !!pick.replace;
    }
    const taken = new Set<string>();
    for (const s of steps) {
      if (s.status === 'skipped') continue;
      // Two files with one name: keep both, numbered.
      let to = s.to;
      for (let n = 2; taken.has(to); n++) to = s.to.replace(/(\.[^./]+)?$/, ` (${n})$1`);
      taken.add(to);
      s.to = to;
      const exists = existing.has(`${course.r2Prefix}${to}`);
      s.status = exists ? (s.replace ? 'replace' : 'exists') : 'new';
      if (s.status === 'exists') s.reason = 'already there; left as it is';
      if (s.status === 'replace') s.reason = 'will replace the existing file';
    }
    const replacementPrefix = input.replaceFolder ? `${course.r2Prefix}${folder}` : null;
    const replacementTargets = replacementPrefix
      ? new Set(
          steps
            .filter((step) => step.status !== 'skipped' && step.to.startsWith(folder))
            .map((step) => `${course.r2Prefix}${step.to}`),
        )
      : new Set<string>();
    if (replacementPrefix && replacementTargets.size === 0)
      throw fail.badRequest('At least one usable upload file must stay in the folder you are replacing.');
    const folderRemoved = replacementPrefix
      ? courseObjects
          .filter((object) => object.key.startsWith(replacementPrefix) && !replacementTargets.has(object.key))
          .map((object) => object.key)
      : [];
    const folderOverwritten = replacementPrefix
      ? courseObjects
          .filter((object) => object.key.startsWith(replacementPrefix) && replacementTargets.has(object.key))
          .map((object) => object.key)
      : [];
    if (replacementPrefix) {
      for (const step of steps) {
        if (step.status === 'skipped' || !step.to.startsWith(folder)) continue;
        if (replacementTargets.has(`${course.r2Prefix}${step.to}`)) step.replace = true;
        const exists = existing.has(`${course.r2Prefix}${step.to}`);
        step.status = exists ? 'replace' : 'new';
        if (exists) step.reason = 'will be replaced with the destination folder';
      }
    }
    if (checks) await this.repo.setFileChecks(c.id, checks);

    const dto = (queued?: number): FilePlanDto => ({
      course: { id: course.id, title: course.title, status: course.status },
      folder: whole ? '' : folder,
      units,
      ...(whole ? { wholeSubject: true } : {}),
      ...(preserveFolders ? { preservedFolders: true } : {}),
      ...(replacementPrefix
        ? {
            folderReplacement: {
              folder: folder.replace(/\/$/, ''),
              removed: folderRemoved.map((key) => key.slice(replacementPrefix.length)),
              overwritten: folderOverwritten.map((key) => key.slice(replacementPrefix.length)),
            },
          }
        : {}),
      files: steps.map(({ from, to, status, reason, leftOut, canRename }) => ({
        from,
        to,
        status,
        ...(reason ? { reason } : {}),
        ...(leftOut ? { leftOut } : {}),
        ...(canRename ? { canRename } : {}),
      })),
      ...(queued === undefined ? {} : { queued }),
    });
    if (input.dryRun) return dto();

    const written: string[] = [];
    for (const s of steps.filter((x) => (x.status === 'new' || x.status === 'replace') && x.source)) {
      const key = `${course.r2Prefix}${s.to}`;
      if (s.source!.entry) {
        const archive = bytesByKey.get(s.source!.key)!;
        await this.store.save(key, await unzipEntry(archive, s.source!.entry), typeOf(s.to));
      } else {
        await this.store.copy(s.source!.key, key);
      }
      written.push(key);
    }
    if (replacementPrefix) {
      for (const key of folderRemoved) await this.store.delete(key);
    }
    const before = c.filed?.courseId === course.id ? c.filed.keys : [];
    const removedSet = new Set(folderRemoved);
    const keys = [...new Set([...before.filter((key) => !removedSet.has(key)), ...written])];
    if (keys.length === 0)
      throw fail.badRequest('Nothing to file: every file is already there or can’t become pages.');
    await this.repo.setFiled(c.id, {
      courseId: course.id,
      folder: whole ? '' : folder,
      keys,
      at: this.clock.now(),
    });
    // The admin browser registers each written key with a separate bounded Worker request.
    // A folder-wide sync here can silently leave large ZIPs half registered when a unit has
    // more files than the inline Worker limit.
    return dto();
  }

  /** One ZIP laid out as a whole subject (a syllabus and unit folders): see zipLayout. */
  private async isWholeSubject(c: Contribution): Promise<boolean> {
    if (c.files.length !== 1 || !/\.zip$/i.test(c.files[0]!.name)) return false;
    const obj = await this.store.get(c.files[0]!.key);
    if (!obj) return false;
    try {
      return zipLayout(listZip(await toBytes(obj.body)).map((e) => e.path)).wholeSubject;
    } catch {
      return false;
    }
  }

  /** What each uploaded file (and each file inside an archive) becomes, before any write. */
  private async plan(c: Contribution, folder: string, preserveFolders = false) {
    const steps: Step[] = [];
    const bytesByKey = new Map<string, Uint8Array>();
    let checksChanged = false;
    const checks = [...c.files];
    for (const [i, f] of c.files.entries()) {
      // A checked, non-archive file is copied as it is: no need to download it to plan.
      if (f.check && f.check.format !== 'zip') {
        if (f.check.ok)
          steps.push({
            from: f.name,
            to: `${folder}${safeFileName(f.name)}`,
            status: 'new',
            source: { key: f.key },
          });
        else
          steps.push({
            from: f.name,
            to: '',
            status: 'skipped',
            reason: f.check.problem ?? 'can’t become pages',
          });
        continue;
      }
      const obj = await this.store.get(f.key);
      if (!obj) {
        steps.push({ from: f.name, to: '', status: 'skipped', reason: 'the upload is gone from storage' });
        continue;
      }
      const bytes = await toBytes(obj.body);
      const check = f.check ?? inspectFile(f.name, bytes);
      if (!f.check) {
        checks[i] = { ...f, check };
        checksChanged = true;
      }
      if (check.format === 'zip') {
        bytesByKey.set(f.key, bytes);
        let entries: ZipEntry[] = [];
        try {
          entries = listZip(bytes);
        } catch (e) {
          steps.push({ from: f.name, to: '', status: 'skipped', reason: (e as Error).message });
          continue;
        }
        const keep = entries.filter((e) => !entryVerdict(e.path).junk);
        const root = commonRoot(keep.map((e) => e.path));
        for (const e of keep) {
          const verdict =
            e.size > ZIP_LIMITS.entryBytes
              ? { ok: false, reason: 'over 40 MB; ask for it on its own' }
              : entryVerdict(e.path);
          const from = `${f.name} › ${e.path}`;
          if (!verdict.ok) {
            const inner = e.path.slice(root.length).split('/').map(safeFileName).join('/');
            const keepPath = preserveFolders && inner.includes('/');
            const salvageable = e.size <= ZIP_LIMITS.entryBytes && !/\.(zip|rar|7z)$/i.test(e.path);
            steps.push({
              from,
              to: keepPath ? inner : `${folder}${inner}`,
              status: 'skipped',
              reason: verdict.reason,
              ...(keepPath ? { keepPath: true } : {}),
              ...(salvageable ? { source: { key: f.key, entry: e }, canRename: true } : {}),
            });
            continue;
          }
          const inner = e.path.slice(root.length).split('/').map(safeFileName).join('/');
          // Keep nested archive folders as course units when requested; loose files use the chosen unit.
          const own = preserveFolders && inner.includes('/');
          steps.push({
            from,
            to: own ? inner : `${folder}${inner}`,
            status: 'new',
            source: { key: f.key, entry: e },
            ...(own ? { keepPath: true } : {}),
          });
        }
        continue;
      }
      if (!check.ok) {
        steps.push({
          from: f.name,
          to: '',
          status: 'skipped',
          reason: check.problem ?? 'can’t become pages',
        });
        continue;
      }
      steps.push({
        from: f.name,
        to: `${folder}${safeFileName(f.name)}`,
        status: 'new',
        source: { key: f.key },
      });
    }
    return { steps, bytesByKey, checks: checksChanged ? checks : null };
  }
}
