import type { ConversionBoardState } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import {
  ConversionBar as Bar,
  CAN_CANCEL,
  CAN_PAUSE,
  CAN_RESUME,
  CAN_START,
  CONVERSION_LABEL as LABEL,
  type ConversionRow as Row,
  CONVERSION_TONE as TONE,
  conversionProgress,
  conversionLine as line,
} from './conversion-state';
import { type R2FileSyncProgress, pickUpChanges } from './r2-file-sync';
import { Note, Panel, plural } from './ui';

const KEY = ['admin-conversion-board'] as const;

const FILTERS: Array<{ key: 'all' | ConversionBoardState; label: string }> = [
  { key: 'all', label: 'Everything' },
  { key: 'working', label: 'Working' },
  { key: 'queued', label: 'Queued' },
  { key: 'paused', label: 'Paused' },
  { key: 'stalled', label: 'Stuck' },
  { key: 'failed', label: 'Failed' },
  { key: 'waiting', label: 'Needs pages' },
];

/**
 * Every page-making job across the whole site, in one place: what's working, what's waiting,
 * what's stuck, and a way to start, pause, resume or cancel any of it — alone or in bulk. This is
 * the same data the per-course "Check & publish" step shows, just for everything at once.
 */
export function PageJobsPanel() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const syncIssues = (
    location.state as { contributionSyncIssues?: Array<{ key: string; message: string }> } | null
  )?.contributionSyncIssues;
  const scopes = params.getAll('scope');
  const uploadId = params.get('upload');
  const queryScopes = scopes.length ? scopes : [''];
  const [filter, setFilter] = useState<'all' | ConversionBoardState>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [syncProgress, setSyncProgress] = useState<R2FileSyncProgress | null>(null);

  const board = useQuery({
    queryKey: [...KEY, queryScopes],
    queryFn: () => api.adminConversionsFor(queryScopes),
    refetchInterval: (q) =>
      q.state.data?.files.some((f) => f.state === 'working' || f.state === 'queued') ? 5_000 : 20_000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  const sync = useMutation({
    mutationFn: () => pickUpChanges(queryScopes, setSyncProgress),
    onSuccess: (result) => {
      if (result.outcomes.every((outcome) => outcome.status !== 'failed' && outcome.status !== 'review'))
        navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    },
    onSettled: () => {
      setSyncProgress(null);
      void refresh();
      void qc.invalidateQueries({ queryKey: ['admin-today'] });
      void qc.invalidateQueries({ queryKey: ['admin-overview'] });
    },
  });
  const start = useMutation({
    mutationFn: (rows: Row[]) =>
      Promise.all(
        [...new Set(rows.map((r) => r.courseId))].map((courseId) =>
          api.adminConvert({
            courseId,
            fileIds: rows.filter((r) => r.courseId === courseId).map((r) => r.fileId),
            include: 'both',
          }),
        ),
      ),
    onSettled: refresh,
  });
  const pause = useMutation({
    mutationFn: (fileIds: string[]) => api.adminPauseConversion(fileIds),
    onSettled: refresh,
  });
  const resume = useMutation({
    mutationFn: (fileIds: string[]) => api.adminResumeConversion(fileIds),
    onSettled: refresh,
  });
  const cancel = useMutation({
    mutationFn: (fileIds: string[]) => api.adminCancelConversion(fileIds),
    onSettled: refresh,
  });
  const busy = start.isPending || pause.isPending || resume.isPending || cancel.isPending;
  const error = start.error ?? pause.error ?? resume.error ?? cancel.error;

  const allRows = board.data?.files ?? [];
  const offSiteCount = allRows.filter((row) => row.offSite).length;
  const rows = scopes.length > 0 ? allRows.filter((row) => !row.offSite) : allRows;
  const shown = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => r.state === filter)),
    [rows, filter],
  );
  const selected = shown.filter((r) => picked.has(r.fileId));

  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setPicked((s) => (shown.every((r) => s.has(r.fileId)) ? new Set() : new Set(shown.map((r) => r.fileId))));

  if (board.isPending) return <Skeleton className="h-96" />;
  if (board.isError)
    return (
      <ErrorState
        title="Couldn't load page jobs."
        message={friendly(board.error)}
        onRetry={() => board.refetch()}
      />
    );
  const d = board.data!;
  const allReady =
    (!syncIssues?.length && rows.length > 0 && rows.every((row) => row.state === 'ready')) ||
    (scopes.length > 0 && rows.length === 0 && offSiteCount > 0 && !syncIssues?.length);
  const followup = uploadId
    ? `/admin?${new URLSearchParams({ section: 'contributions', filter: 'progress', upload: uploadId })}`
    : null;

  return (
    <Panel
      title="Page jobs"
      aside={
        <Button variant="outline" size="sm" disabled={sync.isPending} onClick={() => sync.mutate()}>
          {sync.isPending
            ? syncProgress
              ? `Checking storage… ${syncProgress.completed} of ${syncProgress.total}`
              : 'Checking storage…'
            : 'Check storage for changes'}
        </Button>
      }
    >
      {syncIssues && syncIssues.length > 0 && (
        <div
          className="rounded-xl border border-blush-text/30 bg-blush/40 p-3 text-[13px] text-blush-text"
          role="alert"
        >
          <p className="m-0 font-semibold">Some files still need to be added.</p>
          <ul className="m-0 mt-1 list-disc pl-5">
            {syncIssues.map((issue) => (
              <li key={issue.key} className="break-all">
                {issue.key}: {issue.message}
              </li>
            ))}
          </ul>
          <p className="m-0 mt-2">Use “Check storage for changes” to retry after fixing the source.</p>
        </div>
      )}
      {scopes.length > 0 && (
        <p className="m-0 text-[13px] text-ink2">
          Showing files from this upload that are included on the student site.
        </p>
      )}
      <Note>Manage page jobs: start, pause, resume or cancel them.</Note>
      <p className="m-0 text-[13px] text-ink2" aria-live="polite">
        {d.totals.working} of 2 slots in use · {d.totals.queued} waiting.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {(['working', 'queued', 'paused', 'stalled', 'failed', 'waiting'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(filter === k ? 'all' : k)}
            className={`rounded-2xl border px-3.5 py-3 text-left transition ${
              filter === k ? 'border-teal bg-teal/5' : 'border-line bg-surface hover:border-ink2'
            }`}
          >
            <p className="m-0 text-[22px] font-extrabold tabular-nums leading-none">{d.totals[k]}</p>
            <p className="m-0 mt-1 text-[12px] font-semibold text-ink2">{LABEL[k]}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`h-8 px-3 rounded-full text-[13px] font-semibold ${
              filter === f.key ? 'bg-ink text-bg' : 'bg-sunk text-ink2 hover:text-ink'
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-[13px] text-ink2">
          checked {new Date(d.checkedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </span>
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface px-3.5 py-2.5">
          <span className="text-[14px] font-semibold">{plural(selected.length, 'job')} picked</span>
          <Button
            size="sm"
            disabled={busy || !selected.some((r) => CAN_START.includes(r.state))}
            onClick={() => start.mutate(selected.filter((r) => CAN_START.includes(r.state)))}
          >
            Start
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !selected.some((r) => CAN_PAUSE.includes(r.state))}
            onClick={() =>
              pause.mutate(selected.filter((r) => CAN_PAUSE.includes(r.state)).map((r) => r.fileId))
            }
          >
            Pause
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !selected.some((r) => CAN_RESUME.includes(r.state))}
            onClick={() =>
              resume.mutate(selected.filter((r) => CAN_RESUME.includes(r.state)).map((r) => r.fileId))
            }
          >
            Resume
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !selected.some((r) => CAN_CANCEL.includes(r.state))}
            onClick={() =>
              cancel.mutate(selected.filter((r) => CAN_CANCEL.includes(r.state)).map((r) => r.fileId))
            }
          >
            Delete job
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setPicked(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {error && (
        <p className="m-0 text-sm text-blush-text" role="alert">
          {friendly(error)}
        </p>
      )}

      {followup && (
        <section
          aria-live="polite"
          className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${allReady ? 'border-teal/40 bg-teal/5' : 'border-line bg-surface'}`}
        >
          <p className="m-0 text-[14px] text-ink2">
            {allReady
              ? rows.length
                ? `All ${plural(rows.length, 'file')} now have readable pages. Continue the upload review.`
                : `${plural(offSiteCount, 'file')} kept off the student site; no pages are needed for them.`
              : 'When every file here is ready, return to the upload to continue its review.'}
          </p>
          <Link
            to={followup}
            className="inline-flex min-h-10 items-center rounded-full border border-line px-4 text-[14px] font-semibold text-ink hover:border-teal hover:text-teal-text"
          >
            {allReady ? 'Continue upload review' : 'Back to upload'}
          </Link>
        </section>
      )}

      {shown.length === 0 ? (
        <p className="m-0 text-ink2 text-[14px]">Nothing here right now.</p>
      ) : (
        <ul className="m-0 p-0 list-none rounded-2xl border border-line bg-surface divide-y divide-line max-h-[65vh] overflow-y-auto">
          <li className="px-4 py-2 flex items-center gap-3 bg-sunk/50 text-[12px] font-semibold text-ink2">
            <input
              type="checkbox"
              checked={shown.length > 0 && shown.every((r) => picked.has(r.fileId))}
              onChange={toggleAll}
              aria-label="Pick all shown"
            />
            <span>
              {plural(shown.length, 'job')} shown{shown.length !== rows.length ? ` of ${rows.length}` : ''}
            </span>
          </li>
          {shown.map((r) => {
            const progress = conversionProgress(r);
            return (
              <li key={r.fileId} className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <input
                  type="checkbox"
                  checked={picked.has(r.fileId)}
                  onChange={() => toggle(r.fileId)}
                  aria-label={`Pick ${r.name}`}
                />
                <span className="flex-[1_1_260px] min-w-0">
                  <span className="block truncate text-[14px] font-medium" title={r.name}>
                    {r.name}
                  </span>
                  <span className="block truncate text-[12px] text-ink2">
                    {r.courseTitle} · {r.unit}
                    {r.offSite ? ' · off-site' : ''}
                  </span>
                </span>
                <span className="flex-[1_1_180px] min-w-[140px]">
                  <span
                    className={`inline-flex h-6 px-2.5 rounded-md text-[12px] font-semibold items-center ${TONE[r.state]}`}
                  >
                    {LABEL[r.state]}
                  </span>
                  <span className="block mt-1 text-[12px] text-ink2 truncate">{line(r)}</span>
                  {(r.state === 'working' || r.state === 'queued') && (
                    <span className="block mt-1">
                      <Bar value={progress} />
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {CAN_START.includes(r.state) && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => start.mutate([r])}>
                      Start
                    </Button>
                  )}
                  {CAN_PAUSE.includes(r.state) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => pause.mutate([r.fileId])}
                    >
                      Pause
                    </Button>
                  )}
                  {CAN_RESUME.includes(r.state) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => resume.mutate([r.fileId])}
                    >
                      Resume
                    </Button>
                  )}
                  {CAN_CANCEL.includes(r.state) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => cancel.mutate([r.fileId])}
                    >
                      Delete job
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
