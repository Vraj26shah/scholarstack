import type { AdminContributionDto, PipelineStep } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
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
  pages: { label: 'Making pages', tone: 'bg-marigold-soft text-marigold-text' },
  finish: { label: 'Ready to finish', tone: 'bg-mist text-on-mist' },
  done: { label: 'Done', tone: 'bg-mist text-on-mist' },
  rejected: { label: 'Rejected', tone: 'bg-sunk text-ink2' },
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
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-teal-text">✓ {label}</span>
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

function Row({ c }: { c: AdminContributionDto }) {
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
  const next = NEXT[step];
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
    <li className="rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)] p-4 sm:p-5 flex flex-col gap-4 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
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
              {filed.courseTitle} › {filed.folder} · {plural(filed.files.length, 'file')}
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
          className="rounded-xl border-[1.5px] border-marigold/60 bg-surface p-4 flex flex-col gap-2"
        >
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
export function ContributionsPanel() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('pending');
  const q = useQuery({
    queryKey: [...CONTRIBUTIONS_KEY, SERVER[filter]],
    queryFn: () => api.adminContributions(SERVER[filter]),
    // While pages are being made, check every few seconds.
    refetchInterval: (query) =>
      query.state.data?.items.some((c) => c.pipeline.step === 'pages') ? 8_000 : 60_000,
  });
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
      {q.isError && <p className="m-0 text-sm text-blush-text">{friendly(q.error)}</p>}
      {toggle.isError && <p className="m-0 text-sm text-blush-text">{friendly(toggle.error)}</p>}
      {q.isSuccess && items.length === 0 && (
        <p className="m-0 rounded-2xl bg-card p-5 text-ink2 shadow-[0_0_0_1px_var(--line)]">
          {filter === 'pending' ? 'Nothing waiting for review.' : 'Nothing here.'} Students share from{' '}
          <span className="font-mono text-[13px]">/contribute</span>.
        </p>
      )}
      <ul className="m-0 p-0 list-none flex flex-col gap-3">
        {items.map((c) => (
          <Row key={c.id} c={c} />
        ))}
      </ul>
    </Panel>
  );
}
