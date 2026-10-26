import type { StorageCompareDto } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { api, friendly } from '../../lib/api';
import { buttonClass } from '../../shared/ui/button';
import { Check } from '../../shared/ui/icons';
import { CourseCompareRow, type CourseDiff, Health, diffCount, fileName } from './compare-parts';
import { FILTERS, FileRow, type Filter } from './progress-parts';
import { type R2FileSyncProgress, type R2FileSyncTask, syncR2Files } from './r2-file-sync';
import { type Scope, ScopePicker, scopeLabel } from './scope-picker';
import { plural } from './ui';
import { Glossary, Notice, ProgressBar, Stat } from './workflow-ui';

const SCOPE_KEY = 'ss-admin-r2-scope';

const scrollTo = (ref: React.RefObject<HTMLElement | null>) =>
  ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

function loadScope(): Scope {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SCOPE_KEY) ?? '[]');
    return Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function Stage({
  n,
  title,
  what,
  done,
  locked,
  children,
  innerRef,
}: {
  n: number;
  title: string;
  what: ReactNode;
  done?: string | null;
  locked?: string | null;
  children: ReactNode;
  innerRef?: React.Ref<HTMLElement>;
}) {
  return (
    <section
      ref={innerRef}
      aria-labelledby={`stage-${n}`}
      className={`scroll-mt-6 rounded-2xl border-[1.5px] bg-surface p-5 sm:p-6 ${done ? 'border-teal/50' : 'border-line'}`}
    >
      <header className="flex gap-4">
        <span
          aria-hidden
          className={`grid size-10 shrink-0 place-items-center rounded-full font-display text-base font-extrabold ${
            done ? 'bg-mist text-on-mist' : 'bg-brand text-white'
          }`}
        >
          {done ? <Check size={17} /> : n}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 id={`stage-${n}`} className="m-0 font-display text-[22px] font-extrabold tracking-[-0.03em]">
              {title}
            </h3>
            {done && <span className="text-[13px] font-semibold text-teal-text">{done}</span>}
          </div>
          <div className="m-0 max-w-[72ch] text-[14px] leading-relaxed text-ink2">{what}</div>
        </div>
      </header>
      <div className="mt-5">{locked ? <p className="m-0 text-sm text-ink2">{locked}</p> : children}</div>
    </section>
  );
}

export function SyncFlow({ onGoImport }: { onGoImport: () => void }) {
  const qc = useQueryClient();
  const tree = useQuery({ queryKey: ['admin-import-tree'], queryFn: api.adminImportTree });
  const health = useQuery({ queryKey: ['admin-sync-health'], queryFn: api.adminSyncHealth });
  const [scope, setScopeState] = useState<Scope>(loadScope);
  const [compare, setCompare] = useState<StorageCompareDto | null>(null);
  const [progress, setProgress] = useState<R2FileSyncProgress | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [convertMsg, setConvertMsg] = useState<{ tone: 'good' | 'bad' | 'info'; text: string } | null>(null);
  const stage2 = useRef<HTMLElement>(null);
  const stage3 = useRef<HTMLElement>(null);
  const root = tree.data?.root ?? '';
  const busy = !!progress && progress.completed < progress.total;

  const setScope = (next: Scope) => {
    setScopeState(next);
    setCompare(null);
    setApplied(null);
    setProgress(null);
    setConvertMsg(null);
    try {
      sessionStorage.setItem(SCOPE_KEY, JSON.stringify(next));
    } catch {
      /* private window: selection just isn't remembered */
    }
  };

  const runCompare = useMutation({
    mutationFn: () => api.adminCompareScopes(scope),
    onSuccess: (data) => {
      setCompare(data);
      void qc.setQueryData(['admin-storage-compare'], data);
    },
  });

  const board = useQuery({
    queryKey: ['admin-conversions', 'scope', scope],
    queryFn: () => api.adminConversionsFor(scope),
    enabled: scope.length > 0,
    refetchInterval: (query) => {
      const t = query.state.data?.totals;
      return t && t.working + t.queued > 0 ? 1500 : 8000;
    },
  });

  const convert = useMutation({
    mutationFn: (include: 'waiting' | 'failed' | 'both') => api.adminConvertSelection(scope, include),
    onSuccess: (result) => {
      setConvertMsg(
        result.queued
          ? {
              tone: 'good',
              text: `${plural(result.queued, 'file')} sent to the page maker. The bars below update by themselves, so you can leave this page.${
                result.skipped.length ? ` Skipped: ${result.skipped.join(' ')}` : ''
              }`,
            }
          : {
              tone: 'info',
              text:
                result.skipped.join(' ') ||
                'Nothing to do: every file in this selection already has its pages.',
            },
      );
      void qc.invalidateQueries({ queryKey: ['admin-conversions'] });
      void qc.invalidateQueries({ queryKey: ['admin-overview'] });
    },
    onError: (error) => setConvertMsg({ tone: 'bad', text: friendly(error) }),
  });

  const retryOne = useMutation({
    mutationFn: (sourceKey: string) => api.adminConvertSelection([sourceKey], 'both'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-conversions'] }),
    onError: (error) => setConvertMsg({ tone: 'bad', text: friendly(error) }),
  });

  // Jump the admin to the next stage once the previous one produced a result.
  useEffect(() => {
    if (compare) scrollTo(stage2);
  }, [compare]);

  const applyR2 = async (courses: CourseDiff[]) => {
    const tasks: R2FileSyncTask[] = courses.flatMap((course) =>
      [...course.newInR2, ...course.changedInR2, ...course.missingFromR2].map((key) => ({
        courseId: course.courseId,
        courseTitle: course.title,
        key,
      })),
    );
    if (!tasks.length) return;
    setApplied(null);
    try {
      const { summary, outcomes } = await syncR2Files(tasks, setProgress);
      const failed = outcomes.filter((o) => o.status === 'failed').length;
      const queued = summary.conversionQueued
        ? ` ${plural(summary.conversionQueued, 'file')} went straight to the page maker (step 3).`
        : '';
      setApplied(
        `Done: ${summary.filesAdded} added, ${summary.filesChanged} updated, ${summary.filesRetired} taken off sale.${queued}${
          failed ? ` ${failed} could not be updated (see below).` : ''
        }`,
      );
      setCompare(await api.adminCompareScopes(scope));
    } catch (error) {
      setApplied(friendly(error));
    } finally {
      for (const key of ['admin-overview', 'admin-conversions', 'admin-courses', 'admin-import-tree']) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
    }
  };

  const changed = compare?.courses.filter((course) => diffCount(course) > 0) ?? [];
  const inSync = !!compare && changed.length === 0 && compare.courses.every((c) => !c.error);
  const failedOutcomes =
    progress?.outcomes.filter((o) => o.status === 'failed' || o.status === 'review') ?? [];
  const rows = board.data?.files ?? [];
  const shown = rows.filter(FILTERS.find((f) => f.key === filter)!.match);
  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, rows.filter(f.match).length])) as Record<
    Filter,
    number
  >;
  const t = board.data?.totals;
  const working = (t?.working ?? 0) + (t?.queued ?? 0);
  const problems = (t?.failed ?? 0) + (t?.stalled ?? 0);
  const allPagesDone = !!t && rows.length > 0 && working === 0 && problems === 0 && (t.waiting ?? 0) === 0;
  const scopeSummary =
    scope.length === 0
      ? ''
      : scope.includes('')
        ? 'everything in storage'
        : scope.length === 1
          ? `“${scopeLabel(scope[0]!, root)}”`
          : `${scope.length} items`;

  return (
    <div className="flex flex-col gap-6">
      <p className="m-0 max-w-[78ch] text-[15px] leading-relaxed text-ink2">
        Three steps, only for what you pick: <strong className="text-ink">choose</strong> folders or files,{' '}
        <strong className="text-ink">compare</strong> them with the website, then{' '}
        <strong className="text-ink">make pages</strong>. Publishing is separate, in Courses.
      </p>

      <Health health={health.data} />
      {health.isError && <Notice tone="bad">{friendly(health.error)}</Notice>}

      <Stage
        n={1}
        title="Choose what to check in storage"
        what="Pick everything, or open folders and tick only the folders or files you care about. A ticked folder includes everything inside it."
        done={scope.length ? `Chosen: ${scopeSummary}` : null}
      >
        {tree.isLoading && <Notice>Reading the folders in storage…</Notice>}
        {tree.isError && <Notice tone="bad">{friendly(tree.error)}</Notice>}
        {tree.data && <ScopePicker tree={tree.data} scope={scope} onChange={setScope} />}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className={buttonClass('brand')}
            disabled={!scope.length || runCompare.isPending}
            onClick={() => runCompare.mutate()}
          >
            {runCompare.isPending ? 'Comparing…' : 'Next: compare with the website'}
          </button>
        </div>
      </Stage>

      <Stage
        innerRef={stage2}
        n={2}
        title="Compare with the website"
        what="See what is new, changed or gone in storage compared with the website. Then copy storage's version across. Original files in storage are never touched; a file gone from storage is only taken off sale."
        done={inSync ? 'Website matches storage for this selection' : null}
        locked={scope.length ? null : 'Choose something in step 1 first.'}
      >
        {!compare && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-sm text-ink2">Ready to compare {scopeSummary}.</p>
            <button
              type="button"
              className={buttonClass('brand')}
              disabled={runCompare.isPending}
              onClick={() => runCompare.mutate()}
            >
              {runCompare.isPending ? 'Comparing…' : 'Compare now'}
            </button>
          </div>
        )}
        {runCompare.isError && <Notice tone="bad">{friendly(runCompare.error)}</Notice>}
        {compare && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat
                label="New in storage"
                value={compare.totals.newInR2}
                tone={compare.totals.newInR2 ? 'warn' : 'plain'}
              />
              <Stat
                label="Changed in storage"
                value={compare.totals.changedInR2}
                tone={compare.totals.changedInR2 ? 'warn' : 'plain'}
              />
              <Stat
                label="Gone from storage"
                value={compare.totals.missingFromR2}
                tone={compare.totals.missingFromR2 ? 'bad' : 'plain'}
              />
              <Stat
                label="Not in any course"
                value={compare.unassigned?.count ?? 0}
                tone={compare.unassigned?.count ? 'warn' : 'plain'}
                hint={compare.unassigned?.count ? 'Import them first' : undefined}
              />
            </div>

            {(compare.unassigned?.count ?? 0) > 0 && (
              <div className="flex flex-col gap-3 rounded-xl border-[1.5px] border-marigold bg-marigold-soft/40 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="m-0">
                    <strong>{plural(compare.unassigned!.count, 'file')}</strong> in your selection{' '}
                    {compare.unassigned!.count === 1 ? "doesn't" : "don't"} belong to a course yet, so the
                    website can't show {compare.unassigned!.count === 1 ? 'it' : 'them'}. Turn the folder into
                    a course first.
                  </p>
                  <ul className="m-0 mt-2 max-h-52 list-none overflow-y-auto rounded-lg bg-surface/70 p-2 font-mono text-xs text-ink2">
                    {compare.unassigned!.keys.map((key) => (
                      <li key={key} className="break-all py-0.5">
                        {key.slice(root.length)}
                      </li>
                    ))}
                  </ul>
                </div>
                <button
                  type="button"
                  className={buttonClass('outline', 'md', 'shrink-0')}
                  onClick={onGoImport}
                >
                  Go to Import courses
                </button>
              </div>
            )}

            {changed.length > 0 ? (
              <div className="flex flex-col gap-3 rounded-xl border-[1.5px] border-brand/40 bg-sunk p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="m-0 text-sm">
                  <strong>{plural(changed.length, 'course')}</strong>{' '}
                  {changed.length === 1 ? 'differs' : 'differ'} from storage in this selection. Pressing the
                  button copies storage's version to the website, one file at a time. Those courses pause
                  sales until new pages are made.
                </p>
                <button
                  type="button"
                  className={buttonClass('brand', 'md', 'shrink-0')}
                  disabled={busy}
                  onClick={() => applyR2(changed)}
                >
                  Make website match storage
                </button>
              </div>
            ) : compare.courses.length > 0 ? (
              <Notice tone="good">The website already matches storage for everything you chose.</Notice>
            ) : null}

            {progress && (
              <div
                className="flex flex-col gap-2 rounded-xl border-[1.5px] border-line p-4"
                aria-live="polite"
              >
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold">
                    {busy
                      ? `Updating ${progress.completed + 1} of ${progress.total}`
                      : `Updated ${progress.total} files`}
                  </span>
                  <span className="text-ink2">
                    {Math.round((progress.completed / Math.max(1, progress.total)) * 100)}%
                  </span>
                </div>
                <ProgressBar
                  label="Copying storage changes to the website"
                  value={Math.round((progress.completed / Math.max(1, progress.total)) * 100)}
                />
                {progress.currentKey && (
                  <p className="m-0 truncate font-mono text-xs text-ink2">{fileName(progress.currentKey)}</p>
                )}
              </div>
            )}
            {applied && <Notice tone="good">{applied}</Notice>}
            {failedOutcomes.length > 0 && !busy && (
              <Notice tone="bad">
                <ul className="m-0 list-disc pl-5">
                  {failedOutcomes.map((o) => (
                    <li key={o.key}>
                      <span className="font-mono">{fileName(o.key)}</span>: {o.message ?? 'needs a look'}
                    </li>
                  ))}
                </ul>
              </Notice>
            )}

            {compare.courses.length > 0 && (
              <ul className="m-0 max-h-[460px] list-none overflow-auto rounded-xl border-[1.5px] border-line p-0">
                {compare.courses.map((course) => (
                  <CourseCompareRow
                    key={course.courseId}
                    course={course}
                    busy={busy}
                    onFix={(c) => applyR2([c])}
                  />
                ))}
              </ul>
            )}

            <div className="flex flex-wrap justify-between gap-2">
              <button
                type="button"
                className={buttonClass('ghost')}
                disabled={runCompare.isPending || busy}
                onClick={() => runCompare.mutate()}
              >
                {runCompare.isPending ? 'Comparing…' : 'Compare again'}
              </button>
              <button type="button" className={buttonClass('ink')} onClick={() => scrollTo(stage3)}>
                Next: make pages
              </button>
            </div>
          </div>
        )}
      </Stage>

      <Stage
        innerRef={stage3}
        n={3}
        title="Make the readable pages"
        what="Students never get the original file. They read protected page images. Press the button to make pages for the files you chose. Each file shows its own progress bar, and big PDFs are done a few pages at a time."
        done={allPagesDone ? 'Every file here has its pages' : null}
        locked={scope.length ? null : 'Choose something in step 1 first.'}
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat
              label="Working now"
              value={working}
              tone={working ? 'warn' : 'plain'}
              hint={working ? 'Updating live' : undefined}
            />
            <Stat label="Not started" value={t?.waiting ?? 0} tone={t?.waiting ? 'warn' : 'plain'} />
            <Stat label="Problems" value={problems} tone={problems ? 'bad' : 'plain'} />
            <Stat label="Done" value={t?.ready ?? 0} tone="good" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-sm text-ink2">
              For {scopeSummary || 'your selection'}. Files kept off the site (like textbooks) are skipped.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonClass('brand')}
                disabled={convert.isPending}
                onClick={() => {
                  setConvertMsg(null);
                  convert.mutate('waiting');
                }}
              >
                {convert.isPending ? 'Sending…' : 'Make pages'}
              </button>
              <button
                type="button"
                className={buttonClass('outline')}
                disabled={convert.isPending || problems === 0}
                onClick={() => {
                  setConvertMsg(null);
                  convert.mutate('failed');
                }}
              >
                Retry problems
              </button>
            </div>
          </div>
          {convertMsg && <Notice tone={convertMsg.tone}>{convertMsg.text}</Notice>}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Filter files" className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.key}
                  onClick={() => setFilter(f.key)}
                  className={`h-9 rounded-full px-3.5 text-[13px] font-semibold transition ${
                    filter === f.key ? 'bg-ink text-bg' : 'bg-sunk text-ink2 hover:text-ink'
                  }`}
                >
                  {f.label} <span className="opacity-70">{counts[f.key]}</span>
                </button>
              ))}
            </div>
            <span className="flex items-center gap-2 text-xs text-ink2" aria-live="polite">
              {working > 0 && <span className="size-2 animate-pulse rounded-full bg-marigold" aria-hidden />}
              {board.data ? `Updated ${new Date(board.data.checkedAt).toLocaleTimeString()}` : ''}
            </span>
          </div>
          {board.isError && <Notice tone="bad">{friendly(board.error)}</Notice>}
          <ul className="m-0 max-h-[560px] list-none overflow-auto rounded-xl border-[1.5px] border-line p-0">
            {shown.map((row) => (
              <FileRow
                key={row.fileId}
                row={row}
                retrying={retryOne.isPending}
                onRetry={(r) => retryOne.mutate(r.sourceKey)}
              />
            ))}
            {shown.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-ink2">
                {board.isLoading
                  ? 'Loading…'
                  : rows.length === 0
                    ? 'No course files in this selection yet. If step 2 found files not in a course, import them first.'
                    : 'No files match this filter.'}
              </li>
            )}
          </ul>
          {working > 0 && (
            <p className="m-0 text-xs text-ink2">
              On the live site the page maker starts within about 5 minutes, then these bars move as it works.
            </p>
          )}
        </div>
      </Stage>

      <Glossary />
    </div>
  );
}
