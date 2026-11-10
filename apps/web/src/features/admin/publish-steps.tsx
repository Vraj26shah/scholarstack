import type { AdminCourseDto, PublishCheckDto } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { useCourseSave } from './course-details';
import { type R2FileSyncProgress, pickUpChanges } from './r2-file-sync';
import { plural } from './ui';

type Step = PublishCheckDto['steps'][number];
type File = PublishCheckDto['files'][number];

const STATE: Record<File['state'], { text: string; tone: 'ok' | 'work' | 'bad' }> = {
  ready: { text: 'Ready', tone: 'ok' },
  'not-picked-up': { text: 'Not on the course yet', tone: 'work' },
  changed: { text: 'Changed in storage', tone: 'work' },
  gone: { text: 'Gone from storage', tone: 'bad' },
  'bad-source': { text: 'Can’t be read', tone: 'bad' },
  'needs-pages': { text: 'Needs pages', tone: 'work' },
  working: { text: 'Pages being made', tone: 'work' },
  failed: { text: 'Pages failed', tone: 'bad' },
  'pages-missing': { text: 'Pages missing', tone: 'bad' },
  'broken-map': { text: 'Page list wrong', tone: 'bad' },
};
const TONE = {
  ok: 'bg-teal/15 text-teal-text',
  work: 'bg-marigold/20 text-marigold-text',
  bad: 'bg-blush text-blush-text',
};

/** Files that "Make pages" should (re)make: everything not ready and not being made right now. */
const remakeable = (f: File) =>
  !!f.fileId && ['needs-pages', 'failed', 'pages-missing', 'broken-map'].includes(f.state);

/**
 * Publishing, one step at a time. Each step opens only when the one before it is done, the
 * current step carries the one button that moves it on, and Publish stays off until every step
 * is ticked. The server runs the same checklist when the course is published, so nothing can go
 * live half-made.
 */
export function PublishSteps({
  c,
  openTab,
}: { c: AdminCourseDto; openTab: (tab: 'details' | 'files') => void }) {
  const qc = useQueryClient();
  const key = ['admin-publish-check', c.id];
  const check = useQuery({
    queryKey: key,
    queryFn: () => api.adminPublishCheck(c.id),
    // While pages are being made, follow along.
    refetchInterval: (q) => (q.state.data?.files.some((f) => f.state === 'working') ? 6_000 : false),
  });
  const save = useCourseSave(c, () => void qc.invalidateQueries({ queryKey: key }));
  const refresh = () =>
    Promise.all(
      [key, ['admin-inventory', c.id], ['admin-courses'], ['admin-today']].map((k) =>
        qc.invalidateQueries({ queryKey: k }),
      ),
    );
  const [progress, setProgress] = useState<R2FileSyncProgress | null>(null);
  const pickUp = useMutation({
    mutationFn: () => pickUpChanges([c.r2Prefix], setProgress),
    onSettled: refresh,
  });
  const make = useMutation({
    mutationFn: (fileIds: string[]) => api.adminConvert({ courseId: c.id, include: 'both', fileIds }),
    onSettled: refresh,
  });
  const hide = useMutation({
    mutationFn: (fileId: string) => api.adminSetFileHidden(fileId, true),
    onSettled: refresh,
  });
  const error = pickUp.error ?? make.error ?? hide.error ?? save.error;

  if (check.isPending) return <Skeleton className="h-96" />;
  if (check.isError && !check.data)
    return (
      <ErrorState
        title="The check didn't finish."
        message={friendly(check.error)}
        onRetry={() => check.refetch()}
      />
    );
  const d = check.data;
  const current = d.steps.findIndex((s) => !s.done);
  const toMake = d.files.filter(remakeable);
  const bad = d.files.filter((f) => f.state === 'bad-source');

  const action = (s: Step) => {
    if (s.key === 'storage')
      return (
        <Button size="sm" onClick={() => pickUp.mutate()} disabled={pickUp.isPending}>
          {pickUp.isPending
            ? progress
              ? `Checking ${progress.completed} of ${progress.total}…`
              : 'Checking storage…'
            : 'Pick up changes'}
        </Button>
      );
    if (s.key === 'sources')
      return (
        <a
          href={`/admin?section=folders&folder=${encodeURIComponent(c.r2Prefix)}`}
          className="inline-flex h-9 items-center rounded-full border border-line px-3.5 text-[14px] font-semibold text-ink no-underline"
        >
          Open the folder
        </a>
      );
    if (s.key === 'structure')
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => openTab('files')}>
            Review files
          </Button>
          <Link
            to={`/admin?section=folders&folder=${encodeURIComponent(c.r2Prefix)}`}
            className="inline-flex h-9 items-center rounded-full border border-line px-3.5 text-[14px] font-semibold text-ink no-underline hover:border-teal hover:text-teal-text"
          >
            Arrange folders
          </Link>
        </div>
      );
    if (s.key === 'pages')
      return toMake.length ? (
        <Button size="sm" onClick={() => make.mutate(toMake.map((f) => f.fileId!))} disabled={make.isPending}>
          {make.isPending ? 'Starting…' : `Make pages for ${plural(toMake.length, 'file')}`}
        </Button>
      ) : (
        <span className="text-[13px] text-ink2">Being made now. This updates by itself.</span>
      );
    return (
      <Button size="sm" variant="outline" onClick={() => openTab('details')}>
        Open details
      </Button>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="m-0 text-[14px] text-ink2">
        Finish each step in order. Publish turns on when all are ticked.
      </p>

      <ol className="m-0 p-0 list-none flex flex-col gap-2.5" aria-label="Steps to publish">
        {d.steps.map((s, i) => {
          const state = s.done ? 'done' : i === current ? 'now' : 'later';
          return (
            <li
              key={s.key}
              aria-current={state === 'now' ? 'step' : undefined}
              className={`rounded-2xl border px-4 py-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 ${
                state === 'now'
                  ? 'border-teal bg-surface shadow-[0_0_0_3px_rgba(25,149,173,0.12)]'
                  : 'border-line bg-surface'
              } ${state === 'later' ? 'opacity-60' : ''}`}
            >
              <span
                aria-hidden="true"
                className={`size-8 shrink-0 rounded-full inline-flex items-center justify-center text-[14px] font-bold tabular-nums ${
                  state === 'done'
                    ? 'bg-teal text-white'
                    : state === 'now'
                      ? 'bg-ink text-bg'
                      : 'bg-sunk text-ink2'
                }`}
              >
                {state === 'done' ? '✓' : i + 1}
              </span>
              <div className="flex-[1_1_240px] min-w-0">
                <p className="m-0 font-semibold text-[15px]">{s.title}</p>
                <p className={`m-0 text-[13px] ${state === 'done' ? 'text-ink2' : 'text-ink'}`}>
                  {state === 'later' ? `Opens after step ${current + 1}.` : s.detail}
                </p>
              </div>
              {state === 'now' && action(s)}
            </li>
          );
        })}
        <li
          className={`rounded-2xl border px-4 py-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 ${
            d.ready ? 'border-teal bg-teal/5' : 'border-line bg-surface opacity-60'
          }`}
        >
          <span
            aria-hidden="true"
            className={`size-8 shrink-0 rounded-full inline-flex items-center justify-center text-[14px] font-bold ${
              c.status === 'live' ? 'bg-teal text-white' : d.ready ? 'bg-ink text-bg' : 'bg-sunk text-ink2'
            }`}
          >
            {c.status === 'live' ? '✓' : d.steps.length + 1}
          </span>
          <div className="flex-[1_1_240px] min-w-0">
            <p className="m-0 font-semibold text-[15px]">
              {c.status === 'live' ? 'Live on the site' : 'Publish'}
            </p>
            <p className="m-0 text-[13px] text-ink2">
              {c.status === 'live'
                ? d.ready
                  ? 'Students can buy and read it.'
                  : 'Live, but a step above is open again. Fix it so students don’t meet a problem.'
                : d.ready
                  ? 'Everything is checked. Publishing puts it on sale now.'
                  : 'Opens when every step above is ticked.'}
            </p>
          </div>
          {c.status === 'live' ? (
            <Button
              variant="outline"
              size="sm"
              disabled={save.isPending}
              onClick={() => save.mutate({ status: 'draft' })}
            >
              Unpublish
            </Button>
          ) : c.status === 'draft' ? (
            <Button
              size="sm"
              disabled={!d.ready || save.isPending}
              onClick={() => save.mutate({ status: 'live' })}
            >
              {save.isPending ? 'Publishing…' : 'Publish'}
            </Button>
          ) : null}
        </li>
      </ol>

      {error && (
        <p className="m-0 text-sm text-blush-text" role="alert">
          {friendly(error)}
        </p>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h3 className="m-0 text-[16px] font-semibold">Every file students would see</h3>
          <span className="text-[13px] text-ink2">
            {d.files.filter((f) => f.state === 'ready').length} of {d.files.length} ready · checked{' '}
            {new Date(d.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            disabled={check.isFetching}
            onClick={() => check.refetch()}
          >
            {check.isFetching ? 'Checking…' : 'Check again'}
          </Button>
        </div>
        {d.files.length === 0 ? (
          <p className="m-0 text-ink2 text-[14px]">
            No files yet. Put some in the course folder, then pick them up.
          </p>
        ) : (
          <ul className="m-0 p-0 list-none rounded-2xl border border-line bg-surface divide-y divide-line max-h-[60vh] overflow-y-auto">
            {d.files.map((f) => {
              const st = STATE[f.state];
              return (
                <li key={f.key} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="flex-[1_1_220px] min-w-0">
                    <span className="block truncate text-[14px] font-medium" title={f.key}>
                      {f.name}
                    </span>
                    <span className="block text-[12px] text-ink2">
                      {f.unit ?? 'Not in a unit'}
                      {f.pageCount ? ` · ${f.pagesFound ?? 0} of ${plural(f.pageCount, 'page')} saved` : ''}
                    </span>
                    {f.problem && <span className="block text-[12px] text-blush-text">{f.problem}</span>}
                  </span>
                  <span
                    className={`h-6 px-2.5 rounded-md text-[12px] font-semibold inline-flex items-center ${TONE[st.tone]}`}
                  >
                    {st.text}
                  </span>
                  {remakeable(f) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={make.isPending}
                      onClick={() => make.mutate([f.fileId!])}
                    >
                      Make pages
                    </Button>
                  )}
                  {(f.state === 'bad-source' || f.state === 'gone') && f.fileId && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={hide.isPending}
                      onClick={() => hide.mutate(f.fileId!)}
                    >
                      Hide
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {bad.length > 0 && (
          <p className="m-0 text-[12px] text-ink2">
            Hiding a file takes it off the course without deleting it, so the course can go live without it.
          </p>
        )}
        {d.skipped.length > 0 && (
          <details className="text-[13px] text-ink2">
            <summary className="cursor-pointer font-semibold">
              {plural(d.skipped.length, 'file')} left out of the check
            </summary>
            <ul className="mt-2 mb-0 pl-5">
              {d.skipped.map((s) => (
                <li key={`${s.name}-${s.why}`}>
                  {s.name} · {s.why}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
