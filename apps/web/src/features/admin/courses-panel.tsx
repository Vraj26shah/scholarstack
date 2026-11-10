import type { AdminCourseDto } from '@ss/contracts';
import { studyYearFromSemester } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { useCourseSave } from './course-details';
import { CourseWorkspace, type WorkspaceTab } from './course-workspace';
import { Panel, StatusPill, input, plural, rupeesToPaise } from './ui';

/** One line per course: what it is, whether its files are ready, its price, and publish. */
/** "2025 BCE, BCY · 2024 BCE": every drawer the course shows in, newest batch first. */
function shownTo(c: AdminCourseDto) {
  const years = new Map<number, string[]>();
  for (const o of c.offerings)
    years.set(o.batchYear, [...(years.get(o.batchYear) ?? []), o.branchSlug.toUpperCase()]);
  return [...years.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([y, list]) => `${y} ${list.join(', ')}`)
    .join(' · ');
}

function CourseRow({
  c,
  onOpen,
  ticked,
  onTick,
}: { c: AdminCourseDto; onOpen: (tab?: WorkspaceTab) => void; ticked: boolean; onTick: () => void }) {
  const [rupees, setRupees] = useState(String(c.pricePaise / 100));
  const save = useCourseSave(c);
  const ready = c.fileCount > 0 && c.pendingFiles === 0 && c.failedFiles === 0;
  const priceOk = Number(rupees) >= 1 && Number(rupees) <= 10_000;
  const priceChanged = rupeesToPaise(rupees) !== c.pricePaise;

  return (
    <li
      className={`rounded-[18px] border bg-surface p-4 flex flex-col gap-2 ${ticked ? 'border-teal shadow-[0_0_0_1px_var(--teal)]' : 'border-line'}`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <input
          type="checkbox"
          aria-label={`Tick ${c.title}`}
          checked={ticked}
          onChange={onTick}
          className="accent-[var(--teal)] h-4 w-4 flex-none"
        />
        <button
          type="button"
          onClick={() => onOpen()}
          className="flex-[1_1_260px] min-w-0 text-left bg-transparent border-0 p-0 cursor-pointer group"
        >
          <span className="flex items-center gap-2.5">
            <StatusPill status={c.status} />
            <span className="font-semibold text-ink truncate group-hover:underline">{c.title}</span>
            {c.status === 'draft' && ready && (
              <span className="flex-none rounded-full bg-teal/15 px-2 py-0.5 text-[11px] font-semibold text-teal-text">
                Ready to publish
              </span>
            )}
          </span>
          <span className="block font-mono text-xs text-ink2 mt-1">
            {[c.courseCode, c.callNo, String(c.batchYear)].filter(Boolean).join(' · ')}
          </span>
          <span
            className={`block font-mono text-[11px] mt-1 break-words ${c.offerings.length ? 'text-ink2' : 'text-blush-text'}`}
          >
            {c.offerings.length ? `Shown to ${shownTo(c)}` : 'Not shown to any batch yet'}
          </span>
        </button>
        <div className="font-mono text-xs text-ink2 min-w-0 flex-[0_1_220px]">
          {plural(c.fileCount, 'file')} · {c.pageCount} pages
          {c.pendingFiles > 0 && (
            <div className="text-marigold-text">{plural(c.pendingFiles, 'file')} waiting for pages</div>
          )}
          {c.failedFiles > 0 && (
            <div className="text-blush-text">{plural(c.failedFiles, 'file')} with a problem</div>
          )}
          {c.hiddenFiles > 0 && <div>{plural(c.hiddenFiles, 'file')} hidden</div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5">
            <span className="text-ink2">₹</span>
            <input
              aria-label={`Price in rupees for ${c.title}`}
              className={`${input} w-20 font-mono`}
              value={rupees}
              maxLength={5}
              inputMode="numeric"
              onChange={(e) => setRupees(e.target.value.replace(/\D/g, ''))}
            />
          </label>
          {c.status === 'live' ? (
            <>
              {priceChanged && (
                <Button
                  disabled={!priceOk || save.isPending}
                  onClick={() => save.mutate({ pricePaise: rupeesToPaise(rupees), status: 'live' })}
                >
                  Save price
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => save.mutate({ status: 'draft' })}
                disabled={save.isPending}
              >
                Unpublish
              </Button>
            </>
          ) : c.status === 'draft' ? (
            <>
              {priceChanged && (
                <Button
                  variant="outline"
                  disabled={!priceOk || save.isPending}
                  onClick={() => save.mutate({ pricePaise: rupeesToPaise(rupees) })}
                >
                  Save price
                </Button>
              )}
              {/* Publishing always goes through the checklist; nothing goes live from here directly. */}
              <Button disabled={priceChanged} onClick={() => onOpen('publish')}>
                {ready ? 'Check & publish' : 'Steps to publish'}
              </Button>
            </>
          ) : null}
          <Button variant="outline" onClick={() => onOpen()}>
            Open
          </Button>
        </div>
      </div>
      {c.status === 'draft' && !ready && c.fileCount + c.pendingFiles + c.failedFiles > 0 && (
        <p className="m-0 text-[13px] text-ink2">
          Can't publish yet: {c.pendingFiles ? `${plural(c.pendingFiles, 'file')} still need pages` : ''}
          {c.pendingFiles && c.failedFiles ? ' and ' : ''}
          {c.failedFiles ? `${plural(c.failedFiles, 'file')} couldn't be made into pages` : ''}
          {!c.fileCount && !c.pendingFiles && !c.failedFiles ? 'it has no files yet' : ''}.{' '}
          <button
            type="button"
            onClick={() => onOpen('publish')}
            className="font-semibold text-teal-text bg-transparent border-0 p-0 cursor-pointer underline"
          >
            See the steps
          </button>
        </p>
      )}
      {save.isError && <p className="m-0 text-sm text-blush-text">{friendly(save.error)}</p>}
    </li>
  );
}

/** Ready to go live: has files, every one has pages, none failed. */
const isReady = (c: AdminCourseDto) => c.fileCount > 0 && c.pendingFiles === 0 && c.failedFiles === 0;
/** Something the admin has to look at: failed files, or a live course with nothing readable. */
const needsWork = (c: AdminCourseDto) =>
  c.status !== 'archived' && (c.failedFiles > 0 || (c.status === 'live' && c.fileCount === 0));

const FILTERS = [
  ['all', 'All', (c: AdminCourseDto) => c.status !== 'archived'],
  ['live', 'Live', (c: AdminCourseDto) => c.status === 'live'],
  ['draft', 'Drafts', (c: AdminCourseDto) => c.status === 'draft'],
  ['ready', 'Ready to publish', (c: AdminCourseDto) => c.status === 'draft' && isReady(c)],
  ['attention', 'Needs attention', needsWork],
  ['archived', 'Archived', (c: AdminCourseDto) => c.status === 'archived'],
] as const;
type Filter = (typeof FILTERS)[number][0];

type BulkAction = 'publish' | 'unpublish' | 'archive' | 'price';

/** Several ticked courses at once: publish the ready ones, take off sale, archive or reprice. */
function BulkBar({
  picked,
  all,
  onClear,
}: { picked: Set<string>; all: AdminCourseDto[]; onClear: () => void }) {
  const qc = useQueryClient();
  const chosen = all.filter((c) => picked.has(c.id));
  const publishable = chosen.filter((c) => c.status === 'draft' && isReady(c));
  const live = chosen.filter((c) => c.status === 'live');
  const archivable = chosen.filter((c) => c.status !== 'archived');
  const [rupees, setRupees] = useState('');
  const [progress, setProgress] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: async (action: BulkAction) => {
      const targets =
        action === 'publish'
          ? publishable
          : action === 'unpublish'
            ? live
            : action === 'archive'
              ? archivable
              : chosen;
      const failed: string[] = [];
      let done = 0;
      for (const c of targets) {
        setProgress(`${done + 1} of ${targets.length}: ${c.title}`);
        try {
          await api.adminUpdateCourse(
            c.id,
            action === 'publish'
              ? { status: 'live' }
              : action === 'unpublish'
                ? { status: 'draft' }
                : action === 'archive'
                  ? { status: 'archived' }
                  : // A live course stays on sale at its new price.
                    { pricePaise: rupeesToPaise(rupees), ...(c.status === 'live' ? { status: 'live' } : {}) },
          );
          done++;
        } catch (e) {
          failed.push(`${c.title}: ${friendly(e)}`);
        }
      }
      return { action, done, failed };
    },
    onSettled: () => {
      setProgress(null);
      for (const key of ['admin-courses', 'catalogue', 'drawer', 'bundles', 'course', 'bundle'])
        void qc.invalidateQueries({ queryKey: [key] });
    },
    onSuccess: (r) => {
      if (!r.failed.length) onClear();
    },
  });
  const priceOk = Number(rupees) >= 1 && Number(rupees) <= 10_000;
  const word: Record<BulkAction, string> = {
    publish: 'published',
    unpublish: 'taken off sale',
    archive: 'archived',
    price: 'repriced',
  };
  return (
    <div className="sticky top-2 z-10 flex flex-col gap-2 rounded-2xl bg-ink text-bg px-4 py-3 shadow-lg">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-[14px] font-semibold">{plural(chosen.length, 'course')} ticked</span>
        <Button
          size="sm"
          variant="buy"
          disabled={!publishable.length || run.isPending}
          onClick={() => run.mutate('publish')}
          title="Only courses whose pages are all ready can go live."
        >
          Publish {publishable.length ? publishable.length : ''} ready
        </Button>
        <Button
          size="sm"
          variant="mist"
          disabled={!live.length || run.isPending}
          onClick={() => run.mutate('unpublish')}
        >
          Take {live.length || ''} off sale
        </Button>
        <Button
          size="sm"
          variant="mist"
          disabled={!archivable.length || run.isPending}
          onClick={() => {
            if (
              window.confirm(
                `Archive ${plural(archivable.length, 'course')}? Students who bought them keep access.`,
              )
            )
              run.mutate('archive');
          }}
        >
          Archive
        </Button>
        <span className="flex items-center gap-1.5">
          <span className="text-[13px] opacity-80">₹</span>
          <input
            aria-label="New price in rupees for the ticked courses"
            className="h-9 w-20 rounded-full border border-white/30 bg-transparent px-3 font-mono text-sm text-bg placeholder:text-bg/50"
            value={rupees}
            placeholder="price"
            inputMode="numeric"
            maxLength={5}
            onChange={(e) => setRupees(e.target.value.replace(/\D/g, ''))}
          />
          <Button
            size="sm"
            variant="mist"
            disabled={!priceOk || run.isPending}
            onClick={() => run.mutate('price')}
          >
            Set price
          </Button>
        </span>
        <Button size="sm" variant="outline-light" onClick={onClear} disabled={run.isPending}>
          Clear
        </Button>
      </div>
      {progress && (
        <p role="status" className="m-0 text-[13px] opacity-90">
          Working on {progress}…
        </p>
      )}
      {run.data && !run.isPending && (
        <p role="status" className="m-0 text-[13px]">
          {plural(run.data.done, 'course')} {word[run.data.action]}.
          {run.data.failed.length > 0 && (
            <span className="block text-marigold">
              Not changed: {run.data.failed.slice(0, 4).join(' · ')}
              {run.data.failed.length > 4 ? ` · and ${run.data.failed.length - 4} more` : ''}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

export function CoursesPanel() {
  const [params, setParams] = useSearchParams();
  const open = params.get('course');
  const courses = useQuery({
    queryKey: ['admin-courses'],
    queryFn: api.adminCourses,
    refetchInterval: 15_000,
  });
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [year, setYear] = useState('');
  const [branch, setBranch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const go = (id: string | null, tab?: WorkspaceTab) => {
    const next = new URLSearchParams(params);
    if (id) next.set('course', id);
    else next.delete('course');
    if (id && tab) next.set('tab', tab);
    else next.delete('tab');
    setParams(next);
    window.scrollTo({ top: 0 });
  };
  if (open)
    return (
      <CourseWorkspace
        key={open}
        courseId={open}
        onBack={() => go(null)}
        initialTab={(params.get('tab') as WorkspaceTab | null) ?? 'files'}
      />
    );

  const query = search.trim().toLocaleLowerCase();
  const all = courses.data ?? [];
  const test = (f: Filter) => FILTERS.find(([k]) => k === f)![2];
  // A course can be offered to several batches and branches: filters match any of them.
  const years = [...new Set(all.flatMap((c) => [c.batchYear, ...c.offerings.map((o) => o.batchYear)]))].sort(
    (a, b) => b - a,
  );
  const branches = [
    ...new Set(all.flatMap((c) => [...c.branchSlugs, ...c.offerings.map((o) => o.branchSlug)])),
  ].sort();
  const narrowed = all
    .filter(
      (c) =>
        !year ||
        (c.offerings.length
          ? c.offerings.some((o) => String(o.batchYear) === year)
          : String(c.batchYear) === year),
    )
    .filter(
      (c) =>
        !branch ||
        (c.offerings.length
          ? c.offerings.some((o) => o.branchSlug === branch && (!year || String(o.batchYear) === year))
          : c.branchSlugs.includes(branch)),
    )
    .filter(
      (c) =>
        !query ||
        [c.title, c.courseCode ?? '', c.r2Prefix, String(c.batchYear), ...c.branchSlugs, shownTo(c)]
          .join(' ')
          .toLocaleLowerCase()
          .includes(query),
    );
  const count = (f: Filter) => narrowed.filter(test(f)).length;
  const list = narrowed
    .filter(test(filter))
    .sort(
      (a, b) =>
        Number(b.status === 'draft') - Number(a.status === 'draft') ||
        a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }),
    );
  const studyYears = new Map<number | null, AdminCourseDto[]>();
  for (const course of list) {
    const y = studyYearFromSemester(course.semester);
    studyYears.set(y, [...(studyYears.get(y) ?? []), course]);
  }
  const orderedStudyYears = [...studyYears.entries()].sort(
    ([a], [b]) => (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER),
  );
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const tickAll = (ids: string[], on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      for (const id of ids) on ? n.add(id) : n.delete(id);
      return n;
    });
  const narrowedBy = [
    year && `year ${year}`,
    branch ? branch.toUpperCase() : null,
    query && `“${search.trim()}”`,
  ].filter(Boolean);

  return (
    <Panel
      title="Courses"
      aside={
        <Button size="sm" variant="outline" onClick={() => setParams({ section: 'folders' })}>
          New course from a folder
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label="Search courses"
            className={`${input} h-10 flex-[1_1_220px] text-sm`}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search title, code, folder…"
          />
          <select
            aria-label="Batch year"
            className={`${input} h-10 w-auto text-sm`}
            value={year}
            onChange={(e) => setYear(e.target.value)}
          >
            <option value="">Every batch</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y} batch
              </option>
            ))}
          </select>
          <select
            aria-label="Branch"
            className={`${input} h-10 w-auto text-sm`}
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          >
            <option value="">Every branch</option>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b.toUpperCase()}
              </option>
            ))}
          </select>
          {narrowedBy.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setYear('');
                setBranch('');
                setSearch('');
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter courses">
          {FILTERS.map(([f, label]) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? 'brand' : 'outline'}
              onClick={() => setFilter(f)}
            >
              {label} <span className="tabular-nums opacity-70">{count(f)}</span>
            </Button>
          ))}
        </div>
      </div>
      {picked.size > 0 && <BulkBar picked={picked} all={all} onClear={() => setPicked(new Set())} />}
      {courses.isLoading ? (
        <Skeleton className="h-80" />
      ) : courses.isError && !courses.data ? (
        <ErrorState
          title="Courses didn't load."
          message={friendly(courses.error)}
          onRetry={() => courses.refetch()}
        />
      ) : list.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-line p-8 text-center text-ink2 flex flex-col items-center gap-3">
          {all.length === 0 ? (
            <>
              <span>No courses yet. Upload notes in Folders, then make the folder a course.</span>
              <Button size="sm" onClick={() => setParams({ section: 'folders' })}>
                Open Folders
              </Button>
            </>
          ) : (
            'No courses match these filters.'
          )}
        </div>
      ) : (
        <>
          <p className="m-0 font-mono text-xs text-ink2">
            {plural(list.length, 'course')}
            {narrowedBy.length ? ` · ${narrowedBy.join(' · ')}` : ''} · grouped by study year · drafts first,
            then A–Z
          </p>
          <div className="flex flex-col gap-6">
            {orderedStudyYears.map(([studyYear, group]) => {
              const firstSemester = studyYear == null ? null : studyYear * 2 - 1;
              const ids = group.map((c) => c.id);
              const allTicked = ids.every((id) => picked.has(id));
              return (
                <details
                  key={studyYear ?? 'unassigned'}
                  open
                  className="group/year"
                  aria-label={studyYear == null ? 'Study year not set' : `Study year ${studyYear}`}
                >
                  <summary className="mb-3 flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 font-display text-xl font-extrabold [&::-webkit-details-marker]:hidden">
                    <span className="inline-block transition-transform group-open/year:rotate-90 text-ink2 text-base">
                      ▸
                    </span>
                    {studyYear == null ? 'Study year not set' : `Year ${studyYear}`}
                    {firstSemester != null && (
                      <span className="font-mono text-xs font-normal text-ink2">
                        Sem {firstSemester}–{firstSemester + 1}
                      </span>
                    )}
                    <span className="font-mono text-xs font-normal text-ink2">
                      {plural(group.length, 'course')}
                    </span>
                    <label className="ml-auto flex items-center gap-1.5 font-sans text-[13px] font-normal text-ink2">
                      <input
                        type="checkbox"
                        className="accent-[var(--teal)]"
                        checked={allTicked}
                        onChange={(e) => tickAll(ids, e.target.checked)}
                        aria-label={`Tick every course in ${studyYear == null ? 'study year not set' : `year ${studyYear}`}`}
                      />
                      Tick all
                    </label>
                  </summary>
                  <ul className="m-0 p-0 list-none flex flex-col gap-2.5">
                    {group.map((c) => (
                      <CourseRow
                        key={c.id}
                        c={c}
                        ticked={picked.has(c.id)}
                        onTick={() => toggle(c.id)}
                        onOpen={(tab) => go(c.id, tab)}
                      />
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        </>
      )}
    </Panel>
  );
}
