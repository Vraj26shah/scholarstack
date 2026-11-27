import type { AdminActivityDto } from '@ss/contracts';
import { useState } from 'react';
import { shareLink } from '../../lib/campaign';
import { Button } from '../../shared/ui/button';
import { Skeleton } from '../../shared/ui/feedback';
import { placeName, sourceName, sourceRows, sourceTotals } from './insights-derive';
import { plural } from './ui';

const n = (v: number) => v.toLocaleString('en-IN');
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–');
const card = 'rounded-2xl border border-line bg-surface p-4 sm:p-5 flex flex-col gap-3';
const field =
  'h-11 w-full rounded-xl border border-line bg-bg px-3 text-[15px] text-ink focus:outline-none focus:border-ink2';

/** Pages worth linking to from a post, with what the post would be about. */
const PAGES: [string, string][] = [
  ['/', 'Home page (notes + tools)'],
  ['/tools/timetable', 'Timetable maker + class reminders'],
  ['/tools/attendance', 'Attendance calculator'],
  ['/tools/cgpa', 'CGPA calculator'],
  ['/get-app', 'Get the app'],
  ['/contribute', 'Contribute & earn'],
];
const SOURCES: [string, string][] = [
  ['whatsapp', 'WhatsApp'],
  ['instagram', 'Instagram'],
  ['poster', 'Poster (QR code)'],
  ['telegram', 'Telegram'],
  ['linkedin', 'LinkedIn'],
];

/**
 * Admin › Insights › Where people come from. Every link shared with a tag (made below) is counted
 * when someone lands from it and again if they sign in, so the admin can see which WhatsApp group,
 * Instagram post or poster actually brings students, and post more where it works.
 */
export function SourcesView({
  activity,
}: {
  activity: { data?: AdminActivityDto; isLoading: boolean };
}) {
  if (activity.isLoading) return <Skeleton className="h-40 rounded-2xl" />;
  const rows = sourceRows(activity.data);
  const totals = sourceTotals(rows);
  return (
    <>
      <LinkMaker />
      <section aria-label="By source" className={card}>
        <div className="flex flex-col gap-0.5">
          <h3 className="m-0 text-[18px] font-bold text-ink">Where people come from</h3>
          <p className="m-0 text-[14px] leading-relaxed text-ink2 max-w-[720px]">
            Only links made with the box above are counted here. "Signed in" means they came from that link
            and signed in on the same phone within 30 days: that's the number that matters.
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="m-0 text-sm text-ink2">
            No tagged links were opened in this period yet. Make one above and use it in your next post.
          </p>
        ) : (
          <>
            <ul className="m-0 p-0 list-none grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {totals.map((t) => (
                <li key={t.source} className="rounded-xl bg-sunk/60 px-4 py-3">
                  <span className="block text-[14px] font-semibold text-ink">{sourceName(t.source)}</span>
                  <span className="block font-display text-[24px] font-extrabold leading-tight tabular-nums text-ink">
                    {n(t.signedIn)} <span className="text-[14px] font-semibold text-ink2">signed in</span>
                  </span>
                  <span className="block text-[13px] tabular-nums text-ink2">
                    from {plural(t.arrived, 'visit')} ({pct(t.signedIn, t.arrived)}) ·{' '}
                    {plural(t.links, 'link')}
                  </span>
                </li>
              ))}
            </ul>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px] tabular-nums">
                <thead className="text-ink2 text-left">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Link (source · group or post)</th>
                    <th className="py-1.5 pr-3 font-medium text-right">Visits</th>
                    <th className="py-1.5 pr-3 font-medium text-right">Signed in</th>
                    <th className="py-1.5 pr-3 font-medium text-right">Visits → sign-in</th>
                    <th className="py-1.5 font-medium hidden sm:table-cell">Landed on</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.source}/${r.campaign ?? '-'}`} className="border-t border-line">
                      <td className="py-1.5 pr-3">
                        <strong className="text-ink">{sourceName(r.source)}</strong>
                        {r.campaign ? ` · ${r.campaign}` : ' · (no group named)'}
                      </td>
                      <td className="py-1.5 pr-3 text-right">{n(r.arrived)}</td>
                      <td className="py-1.5 pr-3 text-right font-semibold text-ink">{n(r.signedIn)}</td>
                      <td className="py-1.5 pr-3 text-right">{pct(r.signedIn, r.arrived)}</td>
                      <td className="py-1.5 hidden sm:table-cell text-ink2">
                        {r.topPage ? placeName(r.topPage) : '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="m-0 text-[12px] text-ink2">
          Counting started on 28 Nov 2026. Google Analytics › Reports › Acquisition › Traffic acquisition
          shows the same links by "Session source / campaign", for visits only.
        </p>
      </section>
    </>
  );
}

/** Make a tagged link for one group, post or poster, and copy it. */
function LinkMaker() {
  const [page, setPage] = useState('/tools/timetable');
  const [source, setSource] = useState('whatsapp');
  const [group, setGroup] = useState('');
  const [copied, setCopied] = useState(false);
  const link = shareLink(location.origin, page, source, group);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section aria-label="Make a link to share" className={card}>
      <div className="flex flex-col gap-0.5">
        <h3 className="m-0 text-[18px] font-bold text-ink">Make a link to share</h3>
        <p className="m-0 text-[14px] leading-relaxed text-ink2 max-w-[720px]">
          Use a different link for each group, post or poster (e.g. "ece-25", "block-7", "insta-reel-1"). Then
          the table below shows which one brought students.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink2">
          Page
          <select value={page} onChange={(e) => setPage(e.target.value)} className={field}>
            {PAGES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink2">
          Shared on
          <select value={source} onChange={(e) => setSource(e.target.value)} className={field}>
            {SOURCES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink2">
          Group, post or poster name
          <input
            value={group}
            onChange={(e) => setGroup(e.target.value)}
            placeholder="ece-25"
            maxLength={60}
            className={field}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <code className="flex-1 min-w-[240px] break-all rounded-xl bg-sunk/60 px-3 py-2.5 text-[13px] text-ink">
          {link}
        </code>
        <Button variant="brand" onClick={copy}>
          {copied ? 'Copied' : 'Copy link'}
        </Button>
      </div>
    </section>
  );
}
