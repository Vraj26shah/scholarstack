import type { AdminActivityDto, AdminInsightsDto, InsightsDayDto } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { StudentActivity, activityHref, activityLabel, ago } from './student-activity';
import { Figure, Note, Panel, plural } from './ui';

type Days = AdminInsightsDto['days'];
const PERIODS: [Days, string][] = [
  ['1', 'Today'],
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
];

/** A day of the sales report joined with that day's activity. */
type DayRow = InsightsDayDto & { students: number; studentPages: number; visitorPages: number };
type Metric = 'students' | 'views' | 'signups' | 'checkouts' | 'paid';
const METRICS: [Metric, string, string][] = [
  ['students', 'Active students', 'Signed-in students who opened anything'],
  ['views', 'Course views', 'Course and bundle pages opened'],
  ['signups', 'New students', 'First sign-ins'],
  ['checkouts', 'Checkouts', 'Payment windows opened'],
  ['paid', 'Paid orders', 'Orders paid'],
];

const n = (v: number) => v.toLocaleString('en-IN');
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–');
const dayLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

const chip = (on: boolean) =>
  `h-9 rounded-full px-3.5 text-[13px] font-semibold border cursor-pointer ${
    on ? 'bg-brand text-white border-brand' : 'border-line text-ink2 hover:text-ink'
  }`;

/** One measure per day as thin bars, with the value on hover or focus, and a table view. */
function DailyChart({ daily }: { daily: DayRow[] }) {
  const [metric, setMetric] = useState<Metric>('students');
  const [asTable, setAsTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [, label, blurb] = METRICS.find(([m]) => m === metric)!;
  const values = daily.map((d) => d[metric]);
  const max = Math.max(1, ...values);
  const total = values.reduce((s, v) => s + v, 0);
  const shown = hover !== null ? daily[hover] : null;

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div>
          <h3 className="m-0 text-[15px] font-semibold">
            {label} per day <span className="text-ink2 font-normal">· {n(total)} in all</span>
          </h3>
          <p className="m-0 text-[12px] text-ink2">{blurb}. Days are IST.</p>
        </div>
        <div
          className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1 max-w-full sm:flex-wrap"
          role="radiogroup"
          aria-label="What to chart"
        >
          {METRICS.map(([m, text]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={metric === m}
              onClick={() => setMetric(m)}
              className={chip(metric === m)}
            >
              {text}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={asTable}
            onClick={() => setAsTable(!asTable)}
            className={chip(asTable)}
          >
            Table
          </button>
        </div>
      </div>

      {!asTable && total === 0 ? (
        <p className="m-0 py-10 text-center text-sm text-ink2">
          No {label.toLowerCase()} in this period yet. The chart fills in as students use the site.
        </p>
      ) : asTable ? (
        <div className="overflow-x-auto max-h-80">
          <table className="w-full text-[13px] tabular-nums">
            <thead className="text-ink2 text-left">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Day</th>
                <th className="py-1.5 pr-3 font-medium text-right">Active students</th>
                <th className="py-1.5 pr-3 font-medium text-right">Pages: students / visitors</th>
                <th className="py-1.5 pr-3 font-medium text-right">Course views</th>
                <th className="py-1.5 pr-3 font-medium text-right">New students</th>
                <th className="py-1.5 pr-3 font-medium text-right">Checkouts</th>
                <th className="py-1.5 pr-3 font-medium text-right">Paid</th>
                <th className="py-1.5 font-medium text-right">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {[...daily].reverse().map((d) => (
                <tr key={d.day} className="border-t border-line">
                  <td className="py-1.5 pr-3">{dayLabel(d.day)}</td>
                  <td className="py-1.5 pr-3 text-right">{n(d.students)}</td>
                  <td className="py-1.5 pr-3 text-right">
                    {n(d.studentPages)} / {n(d.visitorPages)}
                  </td>
                  <td className="py-1.5 pr-3 text-right">{n(d.views)}</td>
                  <td className="py-1.5 pr-3 text-right">{n(d.signups)}</td>
                  <td className="py-1.5 pr-3 text-right">{n(d.checkouts)}</td>
                  <td className="py-1.5 pr-3 text-right">{n(d.paid)}</td>
                  <td className="py-1.5 text-right">{formatMoney(d.revenuePaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <p className="m-0 h-5 text-[12px] text-ink2 tabular-nums" aria-live="polite">
            {shown ? (
              <>
                <strong className="text-ink">{dayLabel(shown.day)}</strong> · {n(shown[metric])}{' '}
                {label.toLowerCase()}
              </>
            ) : (
              <>Peak: {n(max === 1 && total === 0 ? 0 : max)} in a day</>
            )}
          </p>
          <div
            className="flex items-end h-40 gap-[2px] border-b border-line"
            role="img"
            aria-label={`${label} per day, ${n(total)} in all. Use the Table button for every value.`}
            onMouseLeave={() => setHover(null)}
          >
            {daily.map((d, i) => (
              <div
                key={d.day}
                className="flex-1 h-full flex items-end justify-center min-w-0"
                onMouseEnter={() => setHover(i)}
              >
                <div
                  className="w-full max-w-6 rounded-t-[4px] transition-[height] duration-200"
                  style={{
                    height: d[metric] > 0 ? `max(2px, ${(d[metric] / max) * 100}%)` : 0,
                    background: 'var(--teal)',
                    opacity: hover === null || hover === i ? 1 : 0.45,
                  }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[11px] text-ink2 font-mono pt-1">
            <span>{daily[0] ? dayLabel(daily[0].day) : ''}</span>
            <span>{daily.at(-1) ? dayLabel(daily.at(-1)!.day) : ''}</span>
          </div>
        </div>
      )}
    </section>
  );
}

type View = 'overview' | 'pages' | 'students' | 'sales' | 'health';
const VIEWS: [View, string][] = [
  ['overview', 'Overview'],
  ['pages', 'Pages & tools'],
  ['students', 'Students'],
  ['sales', 'Sales'],
  ['health', 'Errors & speed'],
];
const VIEW_KEY = 'ss_insights_view';
const savedView = (): View => {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return VIEWS.some(([k]) => k === v) ? (v as View) : 'overview';
  } catch {
    return 'overview';
  }
};

/** The few sentences an admin would want read out: what happened, and what to look at. */
function Glance({ data, activity }: { data: AdminInsightsDto; activity?: AdminActivityDto }) {
  const s = data.summary;
  const a = activity?.summary;
  const topPage = activity?.pages[0];
  const topCourse = data.topItems[0];
  const unpaid = s.checkouts - s.paidOrders;
  const lines = [
    a && a.activeStudents > 0
      ? `${plural(a.activeStudents, 'student')} signed in and used the site${
          topPage
            ? `; the most opened page was ${activityLabel(topPage.target)} (${n(topPage.hits)} times)`
            : ''
        }.`
      : null,
    a && a.visitorPages > 0
      ? `Visitors who weren't signed in opened ${plural(a.visitorPages, 'page')}.`
      : null,
    s.signups > 0
      ? `${plural(s.signups, 'new student')} joined; ${n(s.signupsWhoBought)} of them bought something (${pct(s.signupsWhoBought, s.signups)}).`
      : null,
    topCourse
      ? `Most viewed: ${topCourse.title} (${plural(topCourse.views, 'view')}, ${n(topCourse.paid)} paid).`
      : null,
    s.checkouts > 0
      ? `${plural(s.checkouts, 'checkout')} started, ${n(s.paidOrders)} paid (${pct(s.paidOrders, s.checkouts)})${
          unpaid > 0
            ? `: ${n(unpaid)} didn't finish paying, so look at the price, the payment step or the promo codes`
            : ''
        }.`
      : null,
    s.revenuePaise > 0
      ? `${formatMoney(s.revenuePaise)} came in from ${plural(s.buyers, 'buyer')} (${n(s.firstPurchases)} buying for the first time).`
      : null,
  ].filter(Boolean) as string[];
  return (
    <section aria-label="At a glance" className="rounded-2xl bg-sunk p-4 flex flex-col gap-2">
      <h3 className="m-0 text-[15px] font-semibold">At a glance</h3>
      {lines.length === 0 ? (
        <p className="m-0 text-sm text-ink2">
          Nothing recorded in this period yet. These numbers fill in as students use the site.
        </p>
      ) : (
        <ul className="m-0 pl-5 flex flex-col gap-1 text-[14px] leading-relaxed">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Report({ data, activity }: { data: AdminInsightsDto; activity: ActivityState }) {
  const [view, setView] = useState<View>(savedView);
  const choose = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // private window: the tab just isn't remembered
    }
  };
  const s = data.summary;
  const a = activity.data?.summary;
  const byDay = new Map(activity.data?.daily.map((d) => [d.day, d]));
  const daily: DayRow[] = data.daily.map((d) => ({
    ...d,
    students: byDay.get(d.day)?.students ?? 0,
    studentPages: byDay.get(d.day)?.studentPages ?? 0,
    visitorPages: byDay.get(d.day)?.visitorPages ?? 0,
  }));
  return (
    <>
      <div
        role="tablist"
        aria-label="Insights views"
        className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1 border-b border-line"
      >
        {VIEWS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={view === k}
            onClick={() => choose(k)}
            className={`flex-none h-10 px-3.5 text-[14px] font-semibold border-0 border-b-2 -mb-px bg-transparent cursor-pointer whitespace-nowrap ${
              view === k ? 'border-teal text-ink' : 'border-transparent text-ink2 hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'overview' && (
        <>
          <Glance data={data} activity={activity.data} />
          <section
            aria-label="Totals"
            className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-px overflow-hidden rounded-2xl bg-line shadow-[0_0_0_1px_var(--line)]"
          >
            <Figure
              label="Active students"
              value={a ? n(a.activeStudents) : '…'}
              hint="Signed in and opened something"
              tone="teal"
            />
            <Figure
              label="New students"
              value={n(s.signups)}
              hint={`${n(s.signupsWhoBought)} bought (${pct(s.signupsWhoBought, s.signups)})`}
            />
            <Figure
              label="Visitor pages"
              value={a ? n(a.visitorPages) : '…'}
              hint="Opened without signing in"
            />
            <Figure
              label="Course views"
              value={n(s.views)}
              hint={`${pct(s.signedInViews, s.views)} by signed-in students`}
            />
            <Figure
              label="Paid orders"
              value={n(s.paidOrders)}
              hint={`of ${plural(s.checkouts, 'checkout')} (${pct(s.paidOrders, s.checkouts)})`}
              tone="teal"
            />
            <Figure
              label="Revenue"
              value={formatMoney(s.revenuePaise)}
              hint={`${plural(s.buyers, 'buyer')} · ${n(s.firstPurchases)} first-time`}
              tone="marigold"
            />
          </section>
          {activity.isError && (
            <ErrorState
              title="Student activity didn't load."
              message={friendly(activity.error)}
              onRetry={() => activity.refetch()}
            />
          )}
          <DailyChart daily={daily} />
          <section
            aria-label="From looking to buying"
            className="rounded-2xl border border-line bg-surface p-4"
          >
            <h3 className="m-0 mb-2 text-[15px] font-semibold">From looking to buying</h3>
            <ol className="m-0 p-0 list-none grid grid-cols-3 gap-2 text-center tabular-nums">
              {[
                ['Course views', s.views, ''],
                ['Checkouts', s.checkouts, `${pct(s.checkouts, s.views)} of views`],
                ['Paid', s.paidOrders, `${pct(s.paidOrders, s.checkouts)} of checkouts`],
              ].map(([label, value, note]) => (
                <li key={label as string} className="rounded-xl bg-sunk px-2 py-3 flex flex-col gap-0.5">
                  <span className="font-display font-extrabold text-[26px] leading-none">
                    {n(value as number)}
                  </span>
                  <span className="text-[13px] font-semibold">{label as string}</span>
                  <span className="text-[12px] text-ink2 min-h-4">{note as string}</span>
                </li>
              ))}
            </ol>
            <p className="m-0 mt-3 text-[12px] text-ink2">
              Many views but few checkouts: the course page isn't convincing yet (preview, description,
              price). Many checkouts but few paid: look at the price, the payment step or a promo code.
            </p>
          </section>
          <p className="m-0 text-[12px] text-ink2">
            Readers: {n(s.readers)} students read {plural(s.pagesRead, 'page')} of bought files (last 30 days
            at most). Days are IST.
          </p>
        </>
      )}

      {view === 'pages' && <ActivityTables activity={activity} part="pages" />}
      {view === 'students' && <ActivityTables activity={activity} part="students" />}

      {view === 'sales' && (
        <>
          <section aria-label="Most viewed" className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="m-0 mb-2 text-[15px] font-semibold">Most viewed courses and bundles</h3>
            {data.topItems.length === 0 ? (
              <p className="m-0 text-sm text-ink2">No page views in this period yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px] tabular-nums">
                  <thead className="text-ink2 text-left">
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">Course or bundle</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Views</th>
                      <th className="py-1.5 pr-3 font-medium text-right hidden sm:table-cell">Signed in</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Checkouts</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Paid</th>
                      <th className="py-1.5 pr-3 font-medium text-right hidden sm:table-cell">Revenue</th>
                      <th className="py-1.5 font-medium text-right">Views → paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topItems.map((i) => (
                      <tr key={`${i.kind}:${i.id}`} className="border-t border-line">
                        <td className="py-1.5 pr-3 min-w-[140px] sm:min-w-[200px]">
                          <Link
                            to={i.kind === 'course' ? `/c/${i.slug}` : `/b/${i.slug}`}
                            className="text-ink hover:underline"
                          >
                            {i.title}
                          </Link>
                          {i.kind === 'bundle' && (
                            <span className="ml-1.5 text-[11px] text-ink2">bundle</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 text-right">{n(i.views)}</td>
                        <td className="py-1.5 pr-3 text-right hidden sm:table-cell">{n(i.signedInViews)}</td>
                        <td className="py-1.5 pr-3 text-right">{n(i.checkouts)}</td>
                        <td className="py-1.5 pr-3 text-right">{n(i.paid)}</td>
                        <td className="py-1.5 pr-3 text-right hidden sm:table-cell">
                          {formatMoney(i.revenuePaise)}
                        </td>
                        <td className="py-1.5 text-right">{pct(i.paid, i.views)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-label="Most read" className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="m-0 mb-2 text-[15px] font-semibold">Most read after buying</h3>
            {data.topReading.length === 0 ? (
              <p className="m-0 text-sm text-ink2">Nobody read a bought file in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px] tabular-nums">
                  <thead className="text-ink2 text-left">
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">Course</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Readers</th>
                      <th className="py-1.5 font-medium text-right">Pages read</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topReading.map((r) => (
                      <tr key={r.courseId} className="border-t border-line">
                        <td className="py-1.5 pr-3 min-w-[140px] sm:min-w-[200px]">
                          <Link to={`/c/${r.slug}`} className="text-ink hover:underline">
                            {r.title}
                          </Link>
                        </td>
                        <td className="py-1.5 pr-3 text-right">{n(r.readers)}</td>
                        <td className="py-1.5 text-right">{n(r.pages)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {view === 'health' && <DeeperLinks />}
    </>
  );
}

type ActivityState = {
  data?: AdminActivityDto;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
};

/** Which pages and tools are used, what students do, and who was active (newest first). */
function ActivityTables({ activity, part }: { activity: ActivityState; part: 'pages' | 'students' }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (activity.isLoading) return <Skeleton className="h-40 rounded-2xl" />;
  const a = activity.data;
  if (!a)
    return (
      <ErrorState
        title="Student activity didn't load."
        message={friendly(activity.error)}
        onRetry={() => activity.refetch()}
      />
    );
  return (
    <>
      {part === 'pages' && (
        <>
          <section aria-label="Pages and tools" className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="m-0 text-[15px] font-semibold">Pages and tools</h3>
            <p className="m-0 mb-2 text-[12px] text-ink2">
              Every page, including each tool under /tools (new tools show up here by themselves).
            </p>
            {a.pages.length === 0 ? (
              <p className="m-0 text-sm text-ink2">Nothing opened in this period yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px] tabular-nums">
                  <thead className="text-ink2 text-left">
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">Page</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Opened</th>
                      <th className="py-1.5 pr-3 font-medium text-right hidden sm:table-cell">By students</th>
                      <th className="py-1.5 pr-3 font-medium text-right hidden sm:table-cell">By visitors</th>
                      <th className="py-1.5 font-medium text-right">Different students</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.pages.map((p) => {
                      const href = activityHref(p.target);
                      return (
                        <tr key={p.target} className="border-t border-line">
                          <td className="py-1.5 pr-3 min-w-[140px] sm:min-w-[200px]">
                            {href ? (
                              <Link to={href} className="text-ink hover:underline">
                                {activityLabel(p.target)}
                              </Link>
                            ) : (
                              activityLabel(p.target)
                            )}
                          </td>
                          <td className="py-1.5 pr-3 text-right">{n(p.hits)}</td>
                          <td className="py-1.5 pr-3 text-right hidden sm:table-cell">{n(p.studentHits)}</td>
                          <td className="py-1.5 pr-3 text-right hidden sm:table-cell">{n(p.visitorHits)}</td>
                          <td className="py-1.5 text-right">{n(p.students)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-label="What students do" className="rounded-2xl border border-line bg-surface p-4">
            <h3 className="m-0 mb-2 text-[15px] font-semibold">What students do</h3>
            {a.actions.length === 0 ? (
              <p className="m-0 text-sm text-ink2">No peeks, checkouts or files opened in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px] tabular-nums">
                  <thead className="text-ink2 text-left">
                    <tr>
                      <th className="py-1.5 pr-3 font-medium">Action</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Times</th>
                      <th className="py-1.5 pr-3 font-medium text-right hidden sm:table-cell">By visitors</th>
                      <th className="py-1.5 font-medium text-right">Different students</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.actions.map((x) => (
                      <tr key={x.target} className="border-t border-line">
                        <td className="py-1.5 pr-3 min-w-[140px] sm:min-w-[200px]">
                          {activityLabel(x.target)}
                        </td>
                        <td className="py-1.5 pr-3 text-right">{n(x.hits)}</td>
                        <td className="py-1.5 pr-3 text-right hidden sm:table-cell">{n(x.visitorHits)}</td>
                        <td className="py-1.5 text-right">{n(x.students)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      {part === 'students' && (
        <section aria-label="Active students" className="rounded-2xl border border-line bg-surface p-4">
          <h3 className="m-0 text-[15px] font-semibold">Active students</h3>
          <p className="m-0 mb-2 text-[12px] text-ink2">
            Most recently active first. Open one to see what they opened, day by day.
          </p>
          {a.students.length === 0 ? (
            <p className="m-0 text-sm text-ink2">No signed-in student opened anything in this period.</p>
          ) : (
            <ul className="m-0 p-0 list-none divide-y divide-line">
              {a.students.map((s) => (
                <li key={s.userId}>
                  <button
                    type="button"
                    aria-expanded={openId === s.userId}
                    onClick={() => setOpenId(openId === s.userId ? null : s.userId)}
                    className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-left bg-transparent border-0 cursor-pointer"
                  >
                    <span className="flex-[1_1_220px] min-w-0">
                      <span className="block font-semibold text-ink truncate">
                        {s.fullName ?? s.email.split('@')[0]}
                      </span>
                      <span className="block font-mono text-[12px] text-ink2 truncate">{s.email}</span>
                    </span>
                    <span className="text-[13px] text-ink2 tabular-nums">
                      {ago(s.lastAt)} · {plural(s.days, 'day')} · {n(s.hits)} opened
                    </span>
                    {s.topPage && (
                      <span className="text-[13px] text-ink2 truncate max-w-[260px]">
                        mostly {activityLabel(s.topPage)}
                      </span>
                    )}
                  </button>
                  {openId === s.userId && (
                    <div className="rounded-xl border border-line mb-2 pt-2">
                      <StudentActivity userId={s.userId} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

const SENTRY = 'https://scholars-stack.sentry.io';
const SENTRY_PROJECT = '4512431443476480';

/** Where the rest lives: Sentry for errors and speed, Google Analytics for traffic and sources. */
function DeeperLinks() {
  const links: [string, string, string][] = [
    [
      'Errors students hit',
      `${SENTRY}/issues/?project=${SENTRY_PROJECT}&environment=production&statsPeriod=14d`,
      'Sentry › Issues: each crash or failed request, how many students it hit, and the exact line.',
    ],
    [
      'Page speed (RUM)',
      `${SENTRY}/insights/frontend/web-vitals/?project=${SENTRY_PROJECT}&environment=production`,
      'Sentry › Insights › Web Vitals: how fast pages load and respond on real phones and laptops.',
    ],
    [
      'Session replays',
      `${SENTRY}/replays/?project=${SENTRY_PROJECT}&environment=production`,
      'Sentry › Replays: a text-masked recording of 1 in 10 laptop visits, to see where people get stuck.',
    ],
    [
      'Traffic and sources',
      'https://analytics.google.com/analytics/web/',
      'Google Analytics › Reports › Acquisition: where visitors come from (Google, WhatsApp, Instagram). Realtime shows who is on the site now.',
    ],
    [
      'Pages and buying steps',
      'https://analytics.google.com/analytics/web/',
      'Google Analytics › Reports › Engagement › Events: view_item, peek_open, begin_checkout, purchase, read_open.',
    ],
  ];
  return (
    <section aria-label="More analytics" className="rounded-2xl border border-line bg-surface p-4">
      <h3 className="m-0 mb-1 text-[15px] font-semibold">More detail elsewhere</h3>
      <Note className="mb-3">
        This screen comes from our own database. Errors and speed are in Sentry, and visitor sources are in
        Google Analytics. Sign in with the account that owns each one.
      </Note>
      <ul className="m-0 p-0 list-none grid gap-2 sm:grid-cols-2">
        {links.map(([title, href, what]) => (
          <li key={title} className="rounded-xl border border-line p-3">
            <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-teal-text">
              {title} ↗
            </a>
            <p className="m-0 mt-1 text-[13px] text-ink2">{what}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function InsightsPanel() {
  const [days, setDays] = useState<Days>('30');
  const q = useQuery({ queryKey: ['admin-insights', days], queryFn: () => api.adminInsights(days) });
  const activity = useQuery({
    queryKey: ['admin-activity', days],
    queryFn: () => api.adminActivity(days),
  });
  return (
    <Panel
      title="Insights"
      aside={
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Period">
          {PERIODS.map(([d, label]) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={days === d}
              onClick={() => setDays(d)}
              className={chip(days === d)}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      {q.isLoading ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : q.isError && !q.data ? (
        <ErrorState title="Insights didn't load." message={friendly(q.error)} onRetry={() => q.refetch()} />
      ) : q.data ? (
        <Report data={q.data} activity={activity} />
      ) : null}
    </Panel>
  );
}
