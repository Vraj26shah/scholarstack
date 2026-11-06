import type { AdminSupportQueryDto, SupportStatus } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { Skeleton } from '../../shared/ui/feedback';
import { Thread } from '../help/thread';
import { STATUS_LABEL, TOPICS, when } from '../help/topics';
import { Panel, input } from './ui';
import { CONTRIBUTIONS_KEY } from './upload-pipeline';

const KEY = ['admin', 'support'] as const;
type Filter = SupportStatus | 'all';
const TONE: Record<SupportStatus, string> = {
  open: 'bg-marigold-soft text-marigold-text',
  answered: 'bg-mist text-on-mist',
  closed: 'bg-sunk text-ink2',
};

/** Answers to the questions students ask most, in the site's voice. The admin edits before sending. */
const READY_REPLIES = [
  {
    label: 'Paid, but the course isn’t on the shelf',
    text: 'Hi! Your payment went through and the course is on your shelf. Check My shelf; if it’s missing, sign out and back in, then reply here.',
  },
  {
    label: 'Can’t open on a new phone or laptop',
    text: 'Hi! You can read on two devices. In Account → Devices, remove an old one, then sign in on the new device.',
  },
  {
    label: 'A page or file looks wrong',
    text: 'Thanks for flagging this. We fixed the file. Please check again and send the page number if it still looks wrong.',
  },
  {
    label: 'Asking for a refund',
    text: 'Your refund is on its way to the original payment method. It can take 5–7 working days. The course is off your shelf.',
  },
  {
    label: 'Suggestion: thank you',
    text: 'Thanks! We’ve noted your idea and will let you know when it’s available.',
  },
  {
    label: 'Notes for a subject we don’t have yet',
    text: 'We don’t have notes for that subject yet. You or a senior can share original notes on Contribute & earn and earn from each sale.',
  },
];

function Query({ q, ticked, onTick }: { q: AdminSupportQueryDto; ticked: boolean; onTick: () => void }) {
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
    <li
      className={`rounded-2xl bg-card min-w-0 overflow-hidden ${ticked ? 'shadow-[0_0_0_2px_var(--teal)]' : 'shadow-[0_0_0_1px_var(--line)]'}`}
    >
      <div className="flex items-start">
        <input
          type="checkbox"
          aria-label={`Tick “${q.subject}”`}
          checked={ticked}
          onChange={onTick}
          className="accent-[var(--teal)] mt-[18px] ml-4 h-4 w-4 flex-none"
        />
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex-1 min-w-0 text-left p-4 flex flex-col gap-1.5 hover:bg-sunk/50"
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
      </div>
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
            Start from a ready reply (then edit it)
            <select
              className={`${input} h-10 font-normal`}
              value=""
              onChange={(e) => {
                const r = READY_REPLIES.find((x) => x.label === e.target.value);
                if (r) setBody(r.text);
              }}
            >
              <option value="">Choose one…</option>
              {READY_REPLIES.map((r) => (
                <option key={r.label} value={r.label}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
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
/** Everything ticked at once: close, re-open or delete (for a pile-up of spam or old questions). */
function BulkBar({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const run = useMutation({
    mutationFn: (action: 'delete' | 'close' | 'open') => api.adminSupportBulk(ids, action),
    onSuccess: (r) => {
      setConfirm(false);
      if (!r.failed.length) onDone();
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ['admin-today'] });
    },
  });
  return (
    <div className="sticky top-2 z-10 flex flex-col gap-2 rounded-2xl bg-ink text-bg px-4 py-3 shadow-lg">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-[14px] font-semibold">
          {ids.length} question{ids.length === 1 ? '' : 's'} ticked
        </span>
        {confirm ? (
          <>
            <span className="text-[13px]">Delete them for good, with their attachments?</span>
            <Button size="sm" variant="buy" onClick={() => run.mutate('delete')} disabled={run.isPending}>
              {run.isPending ? 'Deleting…' : `Yes, delete ${ids.length}`}
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
            <Button size="sm" variant="mist" onClick={() => run.mutate('close')} disabled={run.isPending}>
              Close
            </Button>
            <Button size="sm" variant="mist" onClick={() => run.mutate('open')} disabled={run.isPending}>
              Re-open
            </Button>
            <Button size="sm" variant="mist" onClick={() => setConfirm(true)} disabled={run.isPending}>
              Delete…
            </Button>
            <Button size="sm" variant="outline-light" onClick={onDone} disabled={run.isPending}>
              Clear
            </Button>
          </>
        )}
      </div>
      {run.isError && <p className="m-0 text-[13px] text-marigold">{friendly(run.error)}</p>}
      {run.data && run.data.failed.length > 0 && (
        <p className="m-0 text-[13px] text-marigold">
          {run.data.done} done; {run.data.failed.length} couldn't be changed. Try again.
        </p>
      )}
    </div>
  );
}

export function SupportPanel() {
  const [filter, setFilter] = useState<Filter>('open');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const q = useQuery({
    queryKey: [...KEY, filter],
    queryFn: () => api.adminSupport(filter),
    refetchInterval: 60_000,
    staleTime: 30_000,
    // Switching Open/Answered/Closed keeps the list on screen until the new one arrives, so the
    // panel never empties and jumps.
    placeholderData: (previous) => previous,
  });
  // Have the other Inbox tab's list ready, so switching to it shows straight away.
  const qc = useQueryClient();
  useEffect(() => {
    void qc.prefetchQuery({
      queryKey: [...CONTRIBUTIONS_KEY, 'pending'],
      queryFn: () => api.adminContributions('pending'),
      staleTime: 30_000,
    });
  }, [qc]);
  const [kind, setKind] = useState<'all' | 'questions' | 'suggestions'>('all');
  const counts = q.data?.counts;
  const all = q.data?.items ?? [];
  const items = all.filter((x) =>
    kind === 'all' ? true : kind === 'suggestions' ? x.topic === 'suggestion' : x.topic !== 'suggestion',
  );
  const ideas = all.filter((x) => x.topic === 'suggestion').length;
  // Only what is on screen can be acted on (a filter change never deletes hidden ones).
  const shownPicked = items.filter((x) => picked.has(x.id)).map((x) => x.id);
  return (
    <Panel
      title="Questions"
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
      {shownPicked.length > 0 && <BulkBar ids={shownPicked} onDone={() => setPicked(new Set())} />}
      {q.isSuccess && items.length === 0 && (
        <p className="m-0 text-ink2">
          {filter === 'open' ? 'No one is waiting for an answer.' : 'Nothing here.'} Students write from{' '}
          <span className="font-mono text-[13px]">/help</span>.
        </p>
      )}
      <ul className="m-0 p-0 list-none flex flex-col gap-3">
        {items.map((x) => (
          <Query
            key={x.id}
            q={x}
            ticked={picked.has(x.id)}
            onTick={() =>
              setPicked((s) => {
                const n = new Set(s);
                n.has(x.id) ? n.delete(x.id) : n.add(x.id);
                return n;
              })
            }
          />
        ))}
      </ul>
    </Panel>
  );
}
