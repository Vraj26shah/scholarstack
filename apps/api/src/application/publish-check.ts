import type { CourseInventoryDto, PublishCheckDto } from '@ss/contracts';
import type { Course } from '../domain/entities';

type Obj = CourseInventoryDto['objects'][number];
type FileRow = PublishCheckDto['files'][number];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const shortName = (o: Obj) => o.name.split('/').at(-1) ?? o.name;

/** Where one visible file stands, and the one thing wrong with it if anything. */
function fileRow(o: Obj): FileRow {
  const base = {
    key: o.key,
    name: shortName(o),
    unit: o.unit,
    fileId: o.fileId,
    pagesFound: o.pageAssetsFound,
    pageCount: o.pageCount,
  };
  const row = (state: FileRow['state'], problem: string | null): FileRow => ({ ...base, state, problem });
  if (o.status === 'unmapped') return row('not-picked-up', 'In the folder but not on the course yet');
  if (o.status === 'missing-in-r2') return row('gone', 'Gone from storage: upload it again or hide it');
  if (o.status === 'changed-in-r2') return row('changed', 'Changed in storage since its pages were made');
  if (o.sourceIssue) return row('bad-source', o.sourceIssue);
  if (o.conversionStatus === 'failed')
    return row('failed', o.conversionError?.replace(/^Broken source:\s*/, '') || 'Pages couldn’t be made');
  if (o.conversionStatus !== 'ready') return row(o.conversionStage ? 'working' : 'needs-pages', null);
  if (!o.pageCount) return row('needs-pages', 'No pages yet');
  if (o.pageAssetsComplete === false || o.previewPresent === false) {
    const missing = o.missingPageNumbers?.length ?? 0;
    return row(
      'pages-missing',
      missing ? `${plural(missing, 'page')} missing from storage` : 'The free-preview image is missing',
    );
  }
  if (o.pageMappingIssues?.length)
    return row('broken-map', o.pageMappingIssues[0] ?? 'Page list doesn’t match');
  return row('ready', null);
}

/**
 * The publish checklist for one course, worked out from a fresh inventory of its folder.
 *
 *   1. Storage matches the course: no registered file changed or disappeared.
 *   2. Every supported file is assigned to the course structure; unsupported extras are resolved.
 *   3. Every file is a real document (not a renamed or broken file).
 *   4. Every page of every visible file is saved in storage, with a matching page list.
 *   5. Title, price and at least one readable file.
 *
 * Hidden files, ZIPs and system files never block; they're listed so nothing is a surprise.
 */
export function publishCheck(course: Course, inv: CourseInventoryDto): PublishCheckDto {
  const files: FileRow[] = [];
  const skipped: PublishCheckDto['skipped'] = [];
  for (const o of inv.objects) {
    if (o.status === 'folder-marker') continue;
    if (o.status === 'ignored') {
      skipped.push({ name: shortName(o), why: 'System file' });
      continue;
    }
    if (o.status === 'unsupported') {
      skipped.push({ name: shortName(o), why: 'Can’t be made into pages (ZIP or other type)' });
      continue;
    }
    if (o.hidden) {
      skipped.push({ name: shortName(o), why: o.unitHidden ? 'Its unit is hidden' : 'Hidden' });
      continue;
    }
    files.push(fileRow(o));
  }
  const count = (...states: FileRow['state'][]) => files.filter((f) => states.includes(f.state)).length;

  const storageLeft = count('changed', 'gone');
  const unregistered = inv.objects.filter((object) => object.status === 'unmapped').length;
  const badLeft = count('bad-source');
  const pagesLeft = count('needs-pages', 'working', 'failed', 'pages-missing', 'broken-map');
  const working = count('working');
  const readable = count('ready');
  const priceOk = course.pricePaise >= 100 && course.pricePaise <= 1_000_000;
  const detailsLeft = [
    !course.title.trim() && 'a title',
    !priceOk && 'a price between ₹1 and ₹10,000',
    readable === 0 && 'at least one file with pages',
  ].filter(Boolean) as string[];

  const steps: PublishCheckDto['steps'] = [
    {
      key: 'storage',
      title: 'Storage matches the course',
      done: storageLeft === 0,
      detail: storageLeft
        ? `${plural(storageLeft, 'file')} in the folder ${storageLeft === 1 ? 'differs' : 'differ'} from the course. Pick up changes.`
        : 'Registered files match storage.',
    },
    {
      key: 'structure',
      title: 'Every file is added and organized',
      done: unregistered === 0,
      detail: unregistered
        ? `${plural(unregistered, 'supported file')} still need adding to a course folder`
        : 'Every supported file is assigned to a course folder.',
    },
    {
      key: 'sources',
      title: 'Every file is a real document',
      done: badLeft === 0,
      detail: badLeft
        ? `${plural(badLeft, 'file')} can't be read: re-upload ${badLeft === 1 ? 'it' : 'them'} in Folders, or hide ${badLeft === 1 ? 'it' : 'them'}.`
        : 'Every file opened and checked.',
    },
    {
      key: 'pages',
      title: 'Every page is made and saved',
      done: pagesLeft === 0,
      detail: pagesLeft
        ? `${plural(pagesLeft, 'file')} still ${pagesLeft === 1 ? 'needs' : 'need'} pages${working ? ` (${working} being made now)` : ''}.`
        : `${plural(readable, 'file')}, ${plural(
            files.reduce((t, f) => t + (f.pageCount ?? 0), 0),
            'page',
          )}, all in storage.`,
    },
    {
      key: 'details',
      title: 'Title, price and readable files',
      done: detailsLeft.length === 0,
      detail: detailsLeft.length ? `Needs ${detailsLeft.join(', ')}.` : `₹${course.pricePaise / 100}.`,
    },
  ];
  return {
    courseId: course.id,
    title: course.title,
    status: course.status,
    checkedAt: new Date().toISOString(),
    steps,
    files,
    skipped,
    ready: steps.every((s) => s.done),
  };
}

/** The first unfinished step, as one sentence for an error message. */
const STATES: Record<PublishCheckDto['steps'][number]['key'], FileRow['state'][]> = {
  storage: ['changed', 'gone'],
  structure: ['not-picked-up'],
  sources: ['bad-source'],
  pages: ['needs-pages', 'working', 'failed', 'pages-missing', 'broken-map'],
  details: [],
};

/** The first unfinished step, as one sentence for an error message, naming up to three files. */
export function firstBlocker(check: PublishCheckDto): string | null {
  const step = check.steps.find((s) => !s.done);
  if (!step) return null;
  const named = check.files.filter((f) => STATES[step.key].includes(f.state));
  const names = named
    .slice(0, 3)
    .map((f) => (f.problem ? `${f.name} (${f.problem})` : f.name))
    .join('; ');
  const more = named.length > 3 ? ` and ${named.length - 3} more` : '';
  return `${step.title}: ${step.detail}${names ? ` ${names}${more}.` : ''}`;
}
