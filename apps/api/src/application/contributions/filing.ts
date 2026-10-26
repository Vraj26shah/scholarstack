import type { FileContributionInput, FilePlanDto, SyncResultDto } from '@ss/contracts';
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
import { safeFileName } from '../uploads/file-policy';
import { entryVerdict, inspectFile } from './inspect';
import { ZIP_LIMITS, type ZipEntry, listZip, unzipEntry } from './zip';

const CONTENT_TYPE: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pps: 'application/vnd.ms-powerpoint',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  odp: 'application/vnd.oasis.opendocument.presentation',
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
  status: 'new' | 'exists' | 'skipped';
  reason?: string;
  leftOut?: boolean;
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
    private readonly syncFolder: (courseId: string, prefix: string) => Promise<SyncResultDto>,
    private readonly clock: Clock,
  ) {}

  async file(id: string, input: FileContributionInput): Promise<FilePlanDto> {
    const c = await this.repo.find(id);
    if (!c) throw fail.notFound('That upload');
    if (!input.dryRun && c.status !== 'approved')
      throw fail.badRequest('Accept the upload before filing it.');
    const course = await this.courses.findCourse(input.courseId);
    if (!course) throw fail.notFound('That course');
    if (course.status === 'archived') throw fail.badRequest('That course is archived. Pick another one.');
    const folder = `${cleanUnit(input.unit)}/`;
    const base = `${course.r2Prefix}${folder}`;

    const [allFiles, existing] = await Promise.all([
      this.catalogue.listAllFiles([course.id]),
      // The whole course folder: a file may be sent to any unit, not only the default one.
      this.store
        .list(course.r2Prefix)
        .then((list) => new Set(list.map((o) => o.key))),
    ]);
    const units = [
      ...new Set(
        allFiles
          .map((f) => f.sourceKey.slice(course.r2Prefix.length).split('/'))
          .filter((parts) => parts.length > 1)
          .map((parts) => parts[0]!),
      ),
    ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const { steps, bytesByKey, checks } = await this.plan(c, folder);
    // The admin's choices for single files: another unit, a new name, or leave it out.
    const choice = new Map(input.files.map((f) => [f.from, f]));
    for (const s of steps) {
      const pick = choice.get(s.from);
      if (!pick || s.status === 'skipped') continue;
      if (pick.skip) {
        s.status = 'skipped';
        s.reason = 'left out by you';
        s.leftOut = true;
        continue;
      }
      let inner = s.to.slice(folder.length);
      if (pick.name) {
        const ext = inner.includes('.') ? inner.slice(inner.lastIndexOf('.')) : '';
        const wanted = safeFileName(pick.name);
        const named = /\.[a-z0-9]{2,5}$/i.test(wanted) ? wanted : `${wanted}${ext}`;
        inner = inner.includes('/') ? `${inner.slice(0, inner.lastIndexOf('/') + 1)}${named}` : named;
      }
      s.to = `${pick.unit ? `${cleanUnit(pick.unit)}/` : folder}${inner}`;
    }
    const taken = new Set<string>();
    for (const s of steps) {
      if (s.status === 'skipped') continue;
      // Two files with one name: keep both, numbered.
      let to = s.to;
      for (let n = 2; taken.has(to); n++) to = s.to.replace(/(\.[^./]+)?$/, ` (${n})$1`);
      taken.add(to);
      s.to = to;
      s.status = existing.has(`${course.r2Prefix}${to}`) ? 'exists' : 'new';
      if (s.status === 'exists') s.reason = 'already there; left as it is';
    }
    if (checks) await this.repo.setFileChecks(c.id, checks);

    const dto = (queued?: number): FilePlanDto => ({
      course: { id: course.id, title: course.title, status: course.status },
      folder,
      units,
      files: steps.map(({ from, to, status, reason, leftOut }) => ({
        from,
        to,
        status,
        ...(reason ? { reason } : {}),
        ...(leftOut ? { leftOut } : {}),
      })),
      ...(queued === undefined ? {} : { queued }),
    });
    if (input.dryRun) return dto();

    const written: string[] = [];
    for (const s of steps.filter((x) => x.status === 'new' && x.source)) {
      const key = `${course.r2Prefix}${s.to}`;
      if (s.source!.entry) {
        const archive = bytesByKey.get(s.source!.key)!;
        await this.store.save(key, await unzipEntry(archive, s.source!.entry), typeOf(s.to));
      } else {
        await this.store.copy(s.source!.key, key);
      }
      written.push(key);
    }
    const before = c.filed?.courseId === course.id ? c.filed.keys : [];
    const keys = [...new Set([...before, ...written])];
    if (keys.length === 0)
      throw fail.badRequest('Nothing to file: every file is already there or can’t become pages.');
    // Register every unit folder that got files, so all of them get pages.
    const folders = [...new Set(written.map((k) => k.slice(0, k.indexOf('/', course.r2Prefix.length) + 1)))];
    let queued = 0;
    for (const f of folders.length ? folders : [base])
      queued += (await this.syncFolder(course.id, f)).conversionQueued;
    await this.repo.setFiled(c.id, { courseId: course.id, folder, keys, at: this.clock.now() });
    return dto(queued);
  }

  /** What each uploaded file (and each file inside an archive) becomes, before any write. */
  private async plan(c: Contribution, folder: string) {
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
            steps.push({ from, to: '', status: 'skipped', reason: verdict.reason });
            continue;
          }
          const inner = e.path.slice(root.length).split('/').map(safeFileName).join('/');
          steps.push({ from, to: `${folder}${inner}`, status: 'new', source: { key: f.key, entry: e } });
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
