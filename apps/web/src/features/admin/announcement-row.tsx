import type { AnnouncementDto } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { Skeleton } from '../../shared/ui/feedback';
import { StatusPill, U, input, plural } from './ui';

const day = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

/** Everyone it went to (and when), then everyone still waiting. */
function Recipients({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['admin', 'deliveries', id], queryFn: () => api.adminDeliveries(id) });
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<'all' | 'sent' | 'waiting'>('all');
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data?.recipients ?? []).filter(
      (r) =>
        (show === 'all' || (show === 'sent' ? !!r.sentAt : !r.sentAt)) &&
        (!s || r.email.toLowerCase().includes(s) || r.name?.toLowerCase().includes(s)),
    );
  }, [q.data, search, show]);
  if (q.isError) return <p className="m-0 text-sm text-blush-text">{friendly(q.error)}</p>;
  if (!q.data) return <Skeleton className="h-24 rounded-xl" />;
  const d = q.data;
  return (
    <div className="flex flex-col gap-3 w-full">
      {d.byBatch.length > 0 && (
        <div className="overflow-x-auto rounded-xl shadow-[0_0_0_1px_var(--line)]">
          <table className="w-full min-w-[360px] border-collapse text-[13.5px]">
            <thead className="bg-sunk text-left text-[12px] text-ink2">
              <tr>
                <th className="px-3 py-2 font-semibold">Batch</th>
                <th className="px-3 py-2 font-semibold text-right">Got it</th>
                <th className="px-3 py-2 font-semibold text-right">Still to send</th>
              </tr>
            </thead>
            <tbody>
              {d.byBatch.map((b) => (
                <tr key={b.batch} className="border-t border-line">
                  <td className="px-3 py-2 font-semibold">
                    {b.batch === 'Other' ? 'Other emails' : `${b.batch} batch`}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-teal-text">{b.sent}</td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${b.waiting ? 'text-marigold-text font-semibold' : 'text-ink2'}`}
                  >
                    {b.waiting}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-4 text-[14px]">
        {(
          [
            ['all', `Everyone (${d.sent + d.waiting})`],
            ['sent', `Got it (${d.sent})`],
            ['waiting', `Waiting (${d.waiting})`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={show === k}
            onClick={() => setShow(k)}
            className={`font-semibold decoration-2 underline-offset-[6px] ${show === k ? 'text-ink underline decoration-teal' : 'text-ink2 hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
        <input
          className={`${input} h-9 ml-auto w-full sm:w-64`}
          placeholder="Find a student"
          aria-label="Find a student"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <ul className="m-0 p-0 list-none max-h-72 overflow-y-auto divide-y divide-line rounded-xl shadow-[0_0_0_1px_var(--line)]">
        {rows.slice(0, 500).map((r) => (
          <li key={r.email} className="flex items-center justify-between gap-3 px-3 py-2 text-[13.5px]">
            <span className="min-w-0 truncate">
              {r.name ? <strong className="font-semibold">{r.name} · </strong> : null}
              {r.email}
            </span>
            <span
              className={`flex-none font-mono text-[12px] ${r.sentAt ? 'text-teal-text' : 'text-marigold-text'}`}
            >
              {r.sentAt ? `sent ${when(r.sentAt)}` : d.finishesOn ? `by ${day(d.finishesOn)}` : 'waiting'}
            </span>
          </li>
        ))}
        {rows.length === 0 && <li className="px-3 py-3 text-sm text-ink2">No one here.</li>}
      </ul>
      {rows.length > 500 && (
        <p className="m-0 text-[12px] text-ink2">Showing 500 of {rows.length}; search to find someone.</p>
      )}
    </div>
  );
}

export function AnnouncementRow({
  a,
  onOpen,
  onSend,
}: {
  a: AnnouncementDto;
  onOpen: () => void;
  onSend: () => void;
}) {
  const [showing, setShowing] = useState(false);
  const total = a.sent + a.waiting;
  return (
    <li className="rounded-[18px] bg-card shadow-[0_0_0_1px_var(--line)] p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill status={a.status} />
        <span className="flex-[1_1_240px] min-w-0">
          <span className="block font-semibold truncate">{a.subject}</span>
          <span className="block text-[12px] text-ink2">
            {a.course ? `To students who have ${a.course.title}` : 'To everyone who opted in'}
          </span>
          <span className="block text-[13px] text-ink2">
            {a.status === 'draft' ? (
              `Draft · ${new Date(a.createdAt).toLocaleDateString('en-IN')}`
            ) : (
              <>
                <U>
                  {a.sent} of {total}
                </U>{' '}
                got it
                {a.waiting > 0 && a.finishesOn ? (
                  <>
                    {' '}
                    · the other {a.waiting} by <U>{day(a.finishesOn)}</U>
                  </>
                ) : a.waiting > 0 ? (
                  ` · ${plural(a.waiting, 'student')} opted in since`
                ) : a.sentAt ? (
                  ` · finished ${when(a.sentAt)}`
                ) : null}
              </>
            )}
          </span>
          {a.error && <span className="block text-xs text-blush-text">{a.error}</span>}
        </span>
        {a.status !== 'draft' && total > 0 && (
          <span className="w-36 h-2 rounded-full bg-sunk overflow-hidden" aria-hidden="true">
            <span
              className="block h-2 bg-teal transition-all"
              style={{ width: `${(a.sent / total) * 100}%` }}
            />
          </span>
        )}
        {a.status === 'draft' && (
          <Button variant="outline" onClick={onOpen}>
            Open
          </Button>
        )}
        {a.status === 'failed' && (
          <Button variant="outline" onClick={onSend}>
            Resume
          </Button>
        )}
        {a.status === 'sent' && a.waiting > 0 && (
          <Button variant="outline" onClick={onSend}>
            Send to {plural(a.waiting, 'new student')}
          </Button>
        )}
        {a.status !== 'draft' && (
          <Button variant="ghost" size="sm" onClick={() => setShowing(!showing)} aria-expanded={showing}>
            {showing ? 'Hide' : 'Sent and to go'}
          </Button>
        )}
      </div>
      {showing && <Recipients id={a.id} />}
    </li>
  );
}
