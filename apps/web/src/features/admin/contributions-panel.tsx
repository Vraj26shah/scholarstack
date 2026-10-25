import type { AdminContributionDto } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { rewardText } from '../contribute/rewards';
import { KIND_LABEL, formatBytes } from '../contribute/rules';
import { CONTRIBUTIONS_KEY, CopyToFolder, ReviewForm } from './contribution-review';
import { Panel, plural } from './ui';

type Filter = 'pending' | 'approved' | 'rejected' | 'all';
const FILTERS: [Filter, string][] = [
  ['pending', 'To review'],
  ['approved', 'Accepted'],
  ['rejected', 'Rejected'],
  ['all', 'All'],
];
const TONE = {
  pending: 'bg-marigold-soft text-marigold-text',
  approved: 'bg-mist text-on-mist',
  rejected: 'bg-sunk text-ink2',
} as const;

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

function Row({ c }: { c: AdminContributionDto }) {
  const qc = useQueryClient();
  const [reviewing, setReviewing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: CONTRIBUTIONS_KEY });
  const download = useMutation({
    mutationFn: (f: { index: number; name: string }) => api.adminDownloadContribution(c.id, f.index, f.name),
  });
  const remove = useMutation({ mutationFn: () => api.adminDeleteContribution(c.id), onSuccess: refresh });
  const block = useMutation({
    mutationFn: () => api.adminBlockContributor(c.contributor.id, !c.contributor.blocked),
    onSuccess: refresh,
  });
  const reward = rewardText(c.reward);
  const error = download.error ?? remove.error ?? block.error;
  return (
    <li className="rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)] p-4 sm:p-5 flex flex-col gap-3 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-md px-2 py-0.5 text-[12px] font-semibold ${TONE[c.status]}`}>
          {c.status === 'pending' ? 'To review' : c.status === 'approved' ? 'Accepted' : 'Rejected'}
        </span>
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
      </div>
      <p className="m-0 text-[13px] text-ink2 [overflow-wrap:anywhere]">
        From <strong className="text-ink">{c.contributor.name ?? c.contributor.email}</strong>
        {c.contributor.name ? ` · ${c.contributor.email}` : ''} ·{' '}
        {c.contributor.approvedBefore
          ? `${plural(c.contributor.approvedBefore, 'earlier contribution')} accepted`
          : 'first-time contributor'}
        {c.contributor.blocked && (
          <span className="ml-1 font-semibold text-blush-text">· sharing blocked</span>
        )}
      </p>

      <ul className="m-0 p-0 list-none flex flex-col divide-y divide-line rounded-xl shadow-[0_0_0_1px_var(--line)]">
        {c.files.map((f) => (
          <li key={f.index} className="flex items-center gap-3 px-3 py-2 min-w-0">
            <span className="flex-1 min-w-0 truncate text-[14px]" title={f.name}>
              {f.name}
            </span>
            <span className="flex-none font-mono text-[12px] text-ink2">{formatBytes(f.size)}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => download.mutate(f)}
              disabled={download.isPending}
              aria-label={`Download ${f.name}`}
            >
              Download
            </Button>
          </li>
        ))}
      </ul>

      {c.status !== 'pending' && (
        <p className="m-0 text-[13px] text-ink2">
          {c.reviewedBy ? `Reviewed by ${c.reviewedBy}` : 'Reviewed'}
          {c.reviewedAt ? ` · ${when(c.reviewedAt)}` : ''}
          {reward ? ` · ${reward}` : ''}
          {c.reviewNote ? ` · “${c.reviewNote}”` : ''}
        </p>
      )}

      {reviewing ? (
        <ReviewForm c={c} onDone={() => setReviewing(false)} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setReviewing(true)}>
            {c.status === 'pending' ? 'Review' : 'Change decision'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => block.mutate()} disabled={block.isPending}>
            {c.contributor.blocked ? 'Allow sharing again' : 'Block this student from sharing'}
          </Button>
          {confirmDelete ? (
            <>
              <Button size="sm" variant="ink" onClick={() => remove.mutate()} disabled={remove.isPending}>
                {remove.isPending ? 'Deleting…' : 'Yes, delete files'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          )}
        </div>
      )}
      {c.status === 'approved' && !reviewing && <CopyToFolder c={c} />}
      {error && <p className="m-0 text-sm text-blush-text">{friendly(error)}</p>}
    </li>
  );
}

/** Notes, slides and papers students sent in: review, reward, and add the good ones to courses. */
export function ContributionsPanel() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('pending');
  const q = useQuery({
    queryKey: [...CONTRIBUTIONS_KEY, filter],
    queryFn: () => api.adminContributions(filter),
    refetchInterval: 60_000,
  });
  const toggle = useMutation({
    mutationFn: (open: boolean) => api.adminSetContributionsOpen(open),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CONTRIBUTIONS_KEY }),
  });
  const open = q.data?.open ?? true;
  const items = q.data?.items ?? [];
  return (
    <Panel
      title="Contributions"
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
          {filter === 'pending' ? 'Nothing waiting for review.' : 'Nothing here yet.'} Students share from{' '}
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
