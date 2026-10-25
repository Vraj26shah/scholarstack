import type { AdminSupportQueryDto, SupportStatus } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { Thread } from '../help/thread';
import { STATUS_LABEL, TOPICS, when } from '../help/topics';
import { Panel, input } from './ui';

const KEY = ['admin', 'support'] as const;
type Filter = SupportStatus | 'all';
const TONE: Record<SupportStatus, string> = {
  open: 'bg-marigold-soft text-marigold-text',
  answered: 'bg-mist text-on-mist',
  closed: 'bg-sunk text-ink2',
};

function Query({ q }: { q: AdminSupportQueryDto }) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: KEY });
  const [open, setOpen] = useState(q.status === 'open');
  const [body, setBody] = useState('');
  const [notify, setNotify] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const reply = useMutation({
    mutationFn: (close: boolean) => api.adminReplySupport(q.id, { body, close, notify }),
    onSuccess: () => {
      setBody('');
      refresh();
    },
  });
  const status = useMutation({
    mutationFn: (s: SupportStatus) => api.adminSetSupportStatus(q.id, s),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: () => api.adminDeleteSupport(q.id), onSuccess: refresh });
  const download = useMutation({
    mutationFn: (f: { index: number; name: string }) => api.adminDownloadSupportFile(q.id, f.index, f.name),
  });
  const error = reply.error ?? status.error ?? remove.error ?? download.error;
  const last = q.messages.at(-1);
  return (
    <li className="rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)] min-w-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full text-left p-4 flex flex-col gap-1.5 hover:bg-sunk/50"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className={`rounded-md px-2 py-0.5 text-[12px] font-semibold ${TONE[q.status]}`}>
            {STATUS_LABEL[q.status]}
          </span>
          <span className="text-[12px] text-ink2">
            {TOPICS[q.topic].label} · {when(q.updatedAt)} · {q.messages.length} message
            {q.messages.length === 1 ? '' : 's'}
          </span>
        </span>
        <span className="font-semibold text-[16px] [overflow-wrap:anywhere]">{q.subject}</span>
        <span className="text-[13px] text-ink2 [overflow-wrap:anywhere]">
          {q.student.name ? `${q.student.name} · ` : ''}
          {q.student.email}
          {q.page ? ` · on ${q.page}` : ''}
        </span>
        {!open && last && <span className="text-[14px] text-ink2 line-clamp-1">{last.body}</span>}
      </button>
      {open && (
        <div className="px-4 pb-4 flex flex-col gap-4">
          <Thread messages={q.messages} me="admin" />
          {q.files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {q.files.map((f) => (
                <Button key={f.index} size="sm" variant="outline" onClick={() => download.mutate(f)}>
                  Download {f.name}
                </Button>
              ))}
            </div>
          )}
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink2">
            Your answer
            <textarea
              className={`${input} h-28 py-2.5 resize-y`}
              value={body}
              maxLength={4000}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Hi! We've fixed it — please try again and tell us if it still happens."
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-ink2">
            <input
              type="checkbox"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
              className="size-4 accent-teal"
            />
            Email {q.student.email}
          </label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => reply.mutate(false)} disabled={reply.isPending || !body.trim()}>
              {reply.isPending ? 'Sending…' : 'Send answer'}
            </Button>
            <Button
              variant="outline"
              onClick={() => reply.mutate(true)}
              disabled={reply.isPending || !body.trim()}
            >
              Send and close
            </Button>
            {q.status !== 'closed' ? (
              <Button variant="ghost" onClick={() => status.mutate('closed')} disabled={status.isPending}>
                Close without answer
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => status.mutate('open')} disabled={status.isPending}>
                Re-open
              </Button>
            )}
            {confirmDelete ? (
              <>
                <Button variant="ink" onClick={() => remove.mutate()} disabled={remove.isPending}>
                  Yes, delete
                </Button>
                <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
          </div>
          {error && <p className="m-0 text-sm text-blush-text">{friendly(error)}</p>}
        </div>
      )}
    </li>
  );
}

/** Questions and problem reports from students, answered here. */
export function SupportPanel() {
  const [filter, setFilter] = useState<Filter>('open');
  const q = useQuery({
    queryKey: [...KEY, filter],
    queryFn: () => api.adminSupport(filter),
    refetchInterval: 60_000,
  });
  const [kind, setKind] = useState<'all' | 'questions' | 'suggestions'>('all');
  const counts = q.data?.counts;
  const all = q.data?.items ?? [];
  const items = all.filter((x) =>
    kind === 'all' ? true : kind === 'suggestions' ? x.topic === 'suggestion' : x.topic !== 'suggestion',
  );
  const ideas = all.filter((x) => x.topic === 'suggestion').length;
  return (
    <Panel
      title="Questions & suggestions"
      aside={
        <Button variant="outline" onClick={() => void q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? 'Checking…' : 'Refresh'}
        </Button>
      }
    >
      <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
        {(['open', 'answered', 'closed', 'all'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`h-9 rounded-full px-3.5 text-sm font-semibold border ${filter === f ? 'bg-brand text-white border-brand' : 'border-line text-ink2'}`}
          >
            {f === 'all' ? 'All' : STATUS_LABEL[f]}
            {counts && f !== 'all' ? ` (${counts[f]})` : ''}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-[14px]" role="group" aria-label="Type">
        {(
          [
            ['all', 'Everything'],
            ['questions', `Questions (${all.length - ideas})`],
            ['suggestions', `Suggestions (${ideas})`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
            className={`font-semibold underline-offset-[6px] decoration-2 ${kind === k ? 'text-ink underline decoration-teal' : 'text-ink2 hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {q.isError && <p className="m-0 text-sm text-blush-text">{friendly(q.error)}</p>}
      {q.isSuccess && items.length === 0 && (
        <p className="m-0 text-ink2">
          {filter === 'open' ? 'No one is waiting for an answer.' : 'Nothing here.'} Students write from{' '}
          <span className="font-mono text-[13px]">/help</span>.
        </p>
      )}
      <ul className="m-0 p-0 list-none flex flex-col gap-3">
        {items.map((x) => (
          <Query key={x.id} q={x} />
        ))}
      </ul>
    </Panel>
  );
}
