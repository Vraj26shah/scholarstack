import type { AdminContributionDto, PipelineStep } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { Skeleton } from '../../shared/ui/feedback';
import { rewardText } from '../contribute/rewards';
import { KIND_LABEL, formatBytes } from '../contribute/rules';
import { Panel, plural } from './ui';
import {
  CONTRIBUTIONS_KEY,
  CheckList,
  DecideStep,
  FileStep,
  FinishStep,
  PagesStep,
  RewardStep,
  StepStrip,
} from './upload-pipeline';

type Filter = 'pending' | 'progress' | 'done' | 'rejected' | 'all';
const FILTERS: [Filter, string][] = [
  ['pending', 'To review'],
  ['progress', 'In progress'],
  ['done', 'Done'],
  ['rejected', 'Rejected'],
  ['all', 'All'],
];
const SERVER: Record<Filter, 'pending' | 'approved' | 'rejected' | 'all'> = {
  pending: 'pending',
  progress: 'approved',
  done: 'approved',
  rejected: 'rejected',
  all: 'all',
};

const NEXT: Record<PipelineStep, { label: string; tone: string }> = {
  decide: { label: 'Next: decide', tone: 'bg-marigold-soft text-marigold-text' },
  file: { label: 'Next: file it', tone: 'bg-marigold-soft text-marigold-text' },
  reward: { label: 'Next: reward', tone: 'bg-marigold-soft text-marigold-text' },
  pages: { label: 'Pages in progress', tone: 'bg-marigold-soft text-marigold-text' },
  finish: { label: 'Ready to finish', tone: 'bg-mist text-on-mist' },
  done: { label: 'Done', tone: 'bg-mist text-on-mist' },
  rejected: { label: 'Rejected', tone: 'bg-sunk text-ink2' },
};

/** For the step an upload is on: what to do now, and what happens once it's done. */
const GUIDE: Partial<Record<PipelineStep, { now: string; after: string }>> = {
  decide: {
    now: 'Download the files and read them. Accept if they are original and useful, or reject with a reason.',
    after: "Accepted uploads go to filing. The student isn't emailed yet; they hear once with the reward.",
  },
  file: {
    now: 'Choose the course and module these notes belong in (or make a new one), check the files, then File.',
    after:
      'The files are copied into the course and their pages start being made. Page jobs opens to show progress.',
  },
  pages: {
    now: 'Pages are being made for the filed files. Nothing to do unless one fails; then start it again from here.',
    after: 'Choose what the student earns.',
  },
  reward: {
    now: 'Choose what the student earns: a free course, cash, a royalty on sales, or nothing.',
    after: 'The student gets one email saying their notes were accepted, with the reward.',
  },
  finish: {
    now: 'Everything is filed and rewarded. Publish the course if it is a draft, then mark this done.',
    after: 'The upload moves to Done; students can read the notes in the course.',
  },
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

/** One finished step, in a line, with a way to change it. */
function Summary({
  label,
  children,
  onChange,
}: { label: string; children: ReactNode; onChange?: () => void }) {
  return (
    <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-[14px]">
      <span className="text-[12px] font-semibold text-teal-text">✓ {label}</span>
      <span className="text-ink [overflow-wrap:anywhere]">{children}</span>
      {onChange && (
        <button
          type="button"
          onClick={onChange}
          className="text-[13px] font-semibold text-teal-text underline underline-offset-4"
        >
          Change
        </button>
      )}
    </p>
  );
}

function Row({ c, ticked, onTick }: { c: AdminContributionDto; ticked: boolean; onTick: () => void }) {
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [refile, setRefile] = useState(false);
  const [rereward, setRereward] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: CONTRIBUTIONS_KEY });
  const remove = useMutation({ mutationFn: () => api.adminDeleteContribution(c.id), onSuccess: refresh });
  const block = useMutation({
    mutationFn: () => api.adminBlockContributor(c.contributor.id, !c.contributor.blocked),
    onSuccess: refresh,
  });
  const step = c.pipeline.step;
  const filed = c.pipeline.filed;
  const rewarded = c.reward && c.reward.type !== 'none';
  const pageStates = filed?.files.map((file) => file.status) ?? [];
  const next =
    step === 'pages'
      ? {
          ...NEXT.pages,
          label: pageStates.includes('failed')
            ? 'Pages failed'
            : pageStates.includes('stalled')
              ? 'Page job stuck'
              : pageStates.includes('paused')
                ? 'Pages paused'
                : pageStates.includes('queued')
                  ? 'Pages queued'
                  : pageStates.includes('working')
                    ? 'Making pages'
                    : 'Needs pages',
        }
      : NEXT[step];
  const error = remove.error ?? block.error;

  const now: Record<PipelineStep, ReactNode> = {
    decide: <DecideStep c={c} />,
    file: <FileStep c={c} />,
    reward: <RewardStep c={c} />,
    pages: <PagesStep c={c} />,
    finish: <FinishStep c={c} />,
    done: null,
    rejected: null,
  };

  return (
    <li
      id={`upload-${c.id}`}
      className={`rounded-2xl bg-card p-4 sm:p-5 flex flex-col gap-4 min-w-0 ${ticked ? 'shadow-[0_0_0_2px_var(--teal)]' : 'shadow-[0_0_0_1px_var(--line)]'}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="checkbox"
          aria-label={`Tick “${c.title}”`}
          checked={ticked}
          onChange={onTick}
          className="accent-[var(--teal)] h-4 w-4"
        />
        <span className={`rounded-md px-2 py-0.5 text-[12px] font-semibold ${next.tone}`}>{next.label}</span>
        <span className="text-[12px] text-ink2">
          {KIND_LABEL[c.kind]} · {when(c.createdAt)} · {formatBytes(c.totalBytes)}
        </span>
      </div>
      <div className="flex flex-col gap-1 min-w-0">
        <p className="m-0 font-semibold text-[17px] [overflow-wrap:anywhere]">{c.title}</p>
        {c.courseHint && <p className="m-0 text-[14px] text-ink2">For: {c.courseHint}</p>}
        {c.description && (
          <p className="m-0 text-[14px] text-ink2 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {c.description}
          </p>
        )}
        <p className="m-0 text-[13px] text-ink2 [overflow-wrap:anywhere]">
          From <strong className="text-ink">{c.contributor.name ?? c.contributor.email}</strong>
          {c.contributor.name ? ` · ${c.contributor.email}` : ''} ·{' '}
          {c.contributor.approvedBefore
            ? `${plural(c.contributor.approvedBefore, 'upload')} accepted so far`
            : 'first upload'}
          {c.contributor.blocked && (
            <span className="ml-1 font-semibold text-blush-text">· blocked from sharing</span>
          )}
        </p>
      </div>

      <StepStrip step={step} />
      <CheckList c={c} />

      {(filed || rewarded) && (
        <div className="flex flex-col gap-1.5">
          {filed && step !== 'file' && (
            <Summary label="Filed" onChange={step === 'done' ? undefined : () => setRefile((v) => !v)}>
              {filed.courseTitle} › {filed.folder || 'whole subject'} · {plural(filed.files.length, 'file')}
            </Summary>
          )}
          {refile && <FileStep c={c} again />}
          {rewarded && step !== 'reward' && (
            <Summary label="Reward" onChange={() => setRereward((v) => !v)}>
              {rewardText(c.reward, c.rewardPaidAt)}
            </Summary>
          )}
          {rereward && <RewardStep c={c} />}
          {(step === 'done' || step === 'finish') && <PagesStep c={c} />}
        </div>
      )}

      {now[step] && (
        <section
          aria-label={next.label}
          className="rounded-xl border-[1.5px] border-marigold/60 bg-surface p-4 flex flex-col gap-3"
        >
          {GUIDE[step] && (
            <div className="flex flex-col gap-1 rounded-lg bg-marigold-soft/40 px-3 py-2 text-[13px]">
              <p className="m-0">
                <strong>Now:</strong> {GUIDE[step]!.now}
              </p>
              <p className="m-0 text-ink2">
                <strong className="text-ink">Then:</strong> {GUIDE[step]!.after}
              </p>
            </div>
          )}
          {now[step]}
        </section>
      )}
      {step === 'done' && <FinishStep c={c} />}
      {step === 'rejected' && c.reviewNote && (
        <p className="m-0 text-[14px] text-ink2">Reason given: “{c.reviewNote}”</p>
      )}

      <div className="flex flex-wrap gap-2 border-t border-dashed border-line pt-3">
        <Button size="sm" variant="ghost" onClick={() => block.mutate()} disabled={block.isPending}>
          {c.contributor.blocked ? 'Allow sharing again' : 'Block this student from sharing'}
        </Button>
        {confirmDelete ? (
          <>
            <Button size="sm" variant="ink" onClick={() => remove.mutate()} disabled={remove.isPending}>
              {remove.isPending ? 'Deleting…' : 'Yes, delete the upload'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
            Delete upload
          </Button>
        )}
      </div>
      {error && <p className="m-0 text-sm text-blush-text">{friendly(error)}</p>}
    </li>
  );
}

/** Students' uploads, each walked through: check, decide, file, reward, pages, done. */
/** Delete every ticked upload at once (each with its files); a pile of spam goes in one go. */
function UploadsBulkBar({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [at, setAt] = useState(0);
  const run = useMutation({
    mutationFn: async () => {
      const failed: string[] = [];
      let done = 0;
      for (const id of ids) {
        setAt(done + failed.length + 1);
        try {
          await api.adminDeleteContribution(id);
          done++;
        } catch (e) {
          failed.push(friendly(e));
        }
      }
      return { done, failed };
    },
    onSuccess: (r) => {
      setConfirm(false);
      if (!r.failed.length) onDone();
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: CONTRIBUTIONS_KEY });
      void qc.invalidateQueries({ queryKey: ['admin-today'] });
    },
  });
  return (
    <div className="sticky top-2 z-10 flex flex-col gap-2 rounded-2xl bg-ink text-bg px-4 py-3 shadow-lg">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-[14px] font-semibold">
          {ids.length} upload{ids.length === 1 ? '' : 's'} ticked
        </span>
        {confirm ? (
          <>
            <span className="text-[13px]">Delete them and their files for good?</span>
            <Button size="sm" variant="buy" onClick={() => run.mutate()} disabled={run.isPending}>
              {run.isPending ? `Deleting ${at} of ${ids.length}…` : `Yes, delete ${ids.length}`}
            </Button>
            <Button
              size="sm"
              variant="outline-light"
              onClick={() => setConfirm(false)}
              disabled={run.isPending}
            >
              Keep them
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="mist" onClick={() => setConfirm(true)}>
              Delete…
            </Button>
            <Button size="sm" variant="outline-light" onClick={onDone}>
              Clear
            </Button>
          </>
        )}
      </div>
      {run.data && run.data.failed.length > 0 && (
        <p className="m-0 text-[13px] text-marigold">
          {run.data.done} deleted; {run.data.failed.length} couldn't be: {run.data.failed[0]}
        </p>
      )}
    </div>
  );
}

export function ContributionsPanel() {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [params] = useSearchParams();
  const uploadId = params.get('upload');
  const didScroll = useRef(false);
  const [filter, setFilter] = useState<Filter>(() =>
    params.get('filter') === 'progress' || uploadId ? 'progress' : 'pending',
  );
  const q = useQuery({
    queryKey: [...CONTRIBUTIONS_KEY, SERVER[filter]],
    queryFn: () => api.adminContributions(SERVER[filter]),
    // While pages are being made, check every few seconds.
    refetchInterval: (query) =>
      query.state.data?.items.some((c) => c.pipeline.step === 'pages') ? 8_000 : 60_000,
    staleTime: 30_000,
    // A filter change keeps the list on screen until the new one arrives (no empty flash).
    placeholderData: (previous) => previous,
  });
  // Have the Questions tab ready too, so switching inside Inbox is instant.
  useEffect(() => {
    void qc.prefetchQuery({
      queryKey: ['admin', 'support', 'open'],
      queryFn: () => api.adminSupport('open'),
      staleTime: 30_000,
    });
  }, [qc]);
  const toggle = useMutation({
    mutationFn: (open: boolean) => api.adminSetContributionsOpen(open),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CONTRIBUTIONS_KEY }),
  });
  const open = q.data?.open ?? true;
  const items = (q.data?.items ?? []).filter((c) =>
    filter === 'progress'
      ? c.pipeline.step !== 'done'
      : filter === 'done'
        ? c.pipeline.step === 'done'
        : true,
  );
  const shownPicked = items.filter((x) => picked.has(x.id)).map((x) => x.id);
  useEffect(() => {
    if (
      !uploadId ||
      filter !== 'progress' ||
      didScroll.current ||
      !q.data?.items.some((c) => c.id === uploadId)
    )
      return;
    window.setTimeout(
      () => document.getElementById(`upload-${uploadId}`)?.scrollIntoView({ behavior: 'smooth' }),
      0,
    );
    didScroll.current = true;
  }, [filter, q.data, uploadId]);
  return (
    <Panel
      title="Uploads"
      aside={
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-sm font-semibold ${open ? 'text-teal-text' : 'text-marigold-text'}`}>
            {open ? 'Students can share' : 'Sharing is paused'}
          </span>
          <Button
            variant="outline"
            onClick={() => toggle.mutate(!open)}
            disabled={toggle.isPending || !q.data}
          >
            {open ? 'Pause sharing' : 'Open sharing'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
        {FILTERS.map(([f, label]) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`h-9 rounded-full px-3.5 text-sm font-semibold border ${filter === f ? 'bg-brand text-white border-brand' : 'border-line text-ink2'}`}
          >
            {label}
            {filter === f && q.data ? ` (${items.length})` : ''}
          </button>
        ))}
      </div>
      {q.isError && !q.data && <p className="m-0 text-sm text-blush-text">{friendly(q.error)}</p>}
      {q.isPending && <Skeleton className="h-40 rounded-2xl" />}
      {items.length > 1 && (
        <label className="flex items-center gap-2 text-[14px] text-ink2 self-start">
          <input
            type="checkbox"
            className="accent-[var(--teal)] h-4 w-4"
            checked={items.every((x) => picked.has(x.id))}
            onChange={(e) => setPicked(e.target.checked ? new Set(items.map((x) => x.id)) : new Set())}
          />
          Tick all {items.length} shown
        </label>
      )}
      {shownPicked.length > 0 && <UploadsBulkBar ids={shownPicked} onDone={() => setPicked(new Set())} />}
      {toggle.isError && <p className="m-0 text-sm text-blush-text">{friendly(toggle.error)}</p>}
      {q.isSuccess && items.length === 0 && (
        <p className="m-0 rounded-2xl bg-card p-5 text-ink2 shadow-[0_0_0_1px_var(--line)]">
          {filter === 'pending' ? 'Nothing waiting for review.' : 'Nothing here.'} Students share from{' '}
          <span className="font-mono text-[13px]">/contribute</span>.
        </p>
      )}
      <ul className="m-0 p-0 list-none flex flex-col gap-3">
        {items.map((c) => (
          <Row
            key={c.id}
            c={c}
            ticked={picked.has(c.id)}
            onTick={() =>
              setPicked((s) => {
                const n = new Set(s);
                n.has(c.id) ? n.delete(c.id) : n.add(c.id);
                return n;
              })
            }
          />
        ))}
      </ul>
    </Panel>
  );
}
