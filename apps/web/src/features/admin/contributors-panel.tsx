import type { ContributorStatsDto } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { formatRupees } from '../../lib/format';
import { Spinner } from '../../shared/ui/feedback';
import { Panel, input, plural } from './ui';

const day = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';

const rate = (r: ContributorStatsDto) => {
  const decided = r.accepted + r.rejected;
  return decided ? `${Math.round((r.accepted / decided) * 100)}%` : '—';
};

/** Every contributor, most useful first: what they sent, what's live, what it sold, what they're owed. */
export function ContributorsPanel() {
  const q = useQuery({ queryKey: ['admin-contributors'], queryFn: api.adminContributors });
  const [find, setFind] = useState('');
  const rows = (q.data ?? []).filter((r) =>
    `${r.name ?? ''} ${r.email}`.toLowerCase().includes(find.trim().toLowerCase()),
  );
  const total = (q.data ?? []).reduce(
    (t, r) => ({
      pages: t.pages + r.pagesLive,
      earned: t.earned + r.earnedPaise,
      owed: t.owed + r.owedPaise,
    }),
    { pages: 0, earned: 0, owed: 0 },
  );
  return (
    <Panel
      title="Contributors"
      aside={
        <input
          type="search"
          aria-label="Find a contributor"
          className={`${input} w-full sm:w-64`}
          placeholder="Name or email"
          value={find}
          onChange={(e) => setFind(e.target.value)}
        />
      }
    >
      {q.isLoading && <Spinner label="Loading contributors" />}
      {q.isError && <p className="m-0 text-sm text-blush-text">{friendly(q.error)}</p>}
      {q.data && (
        <p className="m-0 text-[14px] text-ink2">
          {plural(q.data.length, 'contributor')} · <strong className="text-ink">{total.pages}</strong> pages
          of theirs students can read · {formatRupees(total.earned)} earned · {formatRupees(total.owed)} still
          to pay.
        </p>
      )}
      {q.data && rows.length === 0 && (
        <p className="m-0 rounded-2xl bg-card p-5 text-ink2 shadow-[0_0_0_1px_var(--line)]">
          {q.data.length ? 'Nobody matches.' : 'Nobody has shared notes yet.'}
        </p>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-2xl shadow-[0_0_0_1px_var(--line)]">
          <table className="w-full min-w-[860px] border-collapse text-[14px]">
            <thead className="bg-sunk text-left text-[12px] text-ink2">
              <tr>
                <th className="px-3 py-2 font-semibold">Contributor</th>
                <th className="px-3 py-2 font-semibold">Uploads</th>
                <th className="px-3 py-2 font-semibold">Accepted</th>
                <th className="px-3 py-2 font-semibold">Live</th>
                <th className="px-3 py-2 font-semibold">Royalty sales</th>
                <th className="px-3 py-2 font-semibold text-right">Earned</th>
                <th className="px-3 py-2 font-semibold text-right">Paid</th>
                <th className="px-3 py-2 font-semibold text-right">Owed</th>
                <th className="px-3 py-2 font-semibold">Last upload</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.userId} className="border-t border-line bg-card align-top">
                  <td className="px-3 py-2.5">
                    <div className="font-semibold text-ink">
                      {i === 0 && !find && r.earnedPaise > 0 && (
                        <span className="mr-1.5 rounded bg-marigold px-1.5 py-0.5 text-[11px] text-on-marigold">
                          TOP
                        </span>
                      )}
                      {r.name ?? r.email.split('@')[0]}
                    </div>
                    <div className="text-[12px] text-ink2">{r.email}</div>
                    {r.blocked && (
                      <div className="text-[12px] font-semibold text-blush-text">blocked from sharing</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {r.uploads}
                    {r.waiting > 0 && (
                      <div className="text-[12px] text-marigold-text">{r.waiting} waiting</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {r.accepted} <span className="text-[12px] text-ink2">({rate(r)})</span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {r.filesLive ? `${plural(r.filesLive, 'file')} · ${r.pagesLive} pp` : '—'}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {r.royaltyCourses ? `${r.royaltySales} on ${plural(r.royaltyCourses, 'course')}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatRupees(r.earnedPaise)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatRupees(r.paidPaise)}</td>
                  <td
                    className={`px-3 py-2.5 text-right tabular-nums ${r.owedPaise ? 'font-semibold text-marigold-text' : ''}`}
                  >
                    {formatRupees(r.owedPaise)}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{day(r.lastUploadAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="m-0 text-[13px] text-ink2">
        Earned is royalties plus cash rewards. Pay what's owed in <strong>Earnings</strong>; the yearly bonus
        goes to whoever tops this list.
      </p>
    </Panel>
  );
}
