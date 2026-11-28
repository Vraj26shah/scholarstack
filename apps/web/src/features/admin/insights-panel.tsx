import type { AdminActivityDto, AdminInsightsDto, InsightsDayDto } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { ComebackView } from './comeback-view';
import {
  DROP_ADVICE,
  VERDICT,
  actionTotal,
  biggestDrop,
  funnel,
  signIn,
  stuckRows,
  toolRows,
} from './insights-derive';
import { SourcesView } from './sources-view';
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

type View = 'overview' | 'sources' | 'tools' | 'stuck' | 'buying' | 'students' | 'pages' | 'health';
const VIEWS: [View, string][] = [
  ['overview', 'Summary'],
  ['sources', 'Where people come from'],
  ['tools', 'Tools'],
  ['stuck', 'Where people get stuck'],
  ['buying', 'Buying'],
  ['students', 'Students'],
  ['pages', 'All pages'],
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

const card = 'rounded-2xl border border-line bg-surface p-4 sm:p-5 flex flex-col gap-3';
const linkBtn =
  'self-start bg-transparent border-0 p-0 cursor-pointer text-[14px] font-semibold text-teal-text underline underline-offset-4 decoration-line hover:decoration-teal';

function SectionHead({ title, lead }: { title: string; lead?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h3 className="m-0 text-[18px] font-bold text-ink">{title}</h3>
      {lead && <p className="m-0 text-[14px] leading-relaxed text-ink2 max-w-[720px]">{lead}</p>}
    </div>
  );
}

/** A bar out of 100%: the filled part in a colour, the rest as a track. The value is always written next to it. */
function Bar({ share, tone = 'teal' }: { share: number; tone?: 'teal' | 'marigold' | 'blush' }) {
  const bg = tone === 'teal' ? 'var(--teal)' : tone === 'marigold' ? 'var(--marigold)' : 'var(--blush)';
  return (
    <span aria-hidden="true" className="block h-2.5 w-full rounded-full bg-sunk overflow-hidden">
      <span
        className="block h-full rounded-full"
        style={{ width: `${Math.max(share > 0 ? 2 : 0, Math.min(100, share * 100))}%`, background: bg }}
      />
    </span>
  );
}

/** The four numbers anyone asks first, each with a line saying what it means. */
function Headline({ data, activity }: { data: AdminInsightsDto; activity?: AdminActivityDto }) {
  const s = data.summary;
  const a = activity?.summary;
  return (
    <section
      aria-label="Totals"
      className="grid grid-cols-2 lg:grid-cols-4 gap-px overflow-hidden rounded-2xl bg-line shadow-[0_0_0_1px_var(--line)]"
    >
      <Figure
        label="Students active"
        value={a ? n(a.activeStudents) : '…'}
        hint={a ? `signed in and opened something · plus ${plural(a.visitorPages, 'visitor page')}` : ''}
        tone="teal"
      />
      <Figure
        label="New students"
        value={n(s.signups)}
        hint={
          s.signups
            ? `${n(s.signupsWhoBought)} of them bought (${pct(s.signupsWhoBought, s.signups)})`
            : 'first sign-ins'
        }
      />
      <Figure
        label="Orders paid"
        value={n(s.paidOrders)}
        hint={
          s.checkouts
            ? `${pct(s.paidOrders, s.checkouts)} of people who started paying`
            : 'nobody started paying yet'
        }
      />
      <Figure
        label="Money in"
        value={formatMoney(s.revenuePaise)}
        hint={`${plural(s.buyers, 'buyer')} · ${n(s.firstPurchases)} first-time`}
        tone="marigold"
      />
    </section>
  );
}

/** The few things most worth a look right now, in plain sentences, each opening its tab. */
function NeedsAttention({
  data,
  activity,
  go,
}: { data: AdminInsightsDto; activity?: AdminActivityDto; go: (v: View) => void }) {
  const items: { key: string; text: string; tone: 'blush' | 'marigold'; view: View }[] = [];
  for (const r of stuckRows(activity).slice(0, 2))
    items.push({
      key: `stuck-${r.signal}-${r.page}`,
      tone: r.signal === 'stuck_crash' || r.signal === 'stuck_error' ? 'blush' : 'marigold',
      text: `${r.place}: people ${r.what} ${r.times === 1 ? 'once' : `${n(r.times)} times`}.`,
      view: 'stuck',
    });
  const steps = funnel(data, activity);
  const drop = biggestDrop(steps);
  if (drop !== null) {
    const before = steps[drop - 1]!;
    const after = steps[drop]!;
    items.push({
      key: 'drop',
      tone: 'marigold',
      text: `Biggest drop on the way to buying: ${n(before.value)} ${before.label.toLowerCase()}, only ${n(after.value)} ${after.label.toLowerCase()} (${pct(after.value, before.value)}).`,
      view: 'buying',
    });
  }
  const poor = toolRows(activity).find((t) => t.verdict === 'poor');
  if (poor)
    items.push({
      key: 'tool',
      tone: 'marigold',
      text: `${poor.name}: opened ${n(poor.opened)} times but used only ${n(poor.used)} (${pct(poor.used, poor.opened)}). Most people leave without trying it.`,
      view: 'tools',
    });
  return (
    <section aria-label="Needs a look" className={card}>
      <SectionHead title="Needs a look" />
      {!activity ? (
        <Skeleton className="h-16 rounded-xl" />
      ) : items.length === 0 ? (
        <p className="m-0 text-[15px] text-ink">
          <span className="font-semibold text-teal-text">All clear.</span> Nobody got stuck in this period,
          and no step loses an unusual share of people.
        </p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col divide-y divide-line">
          {items.slice(0, 4).map((it) => (
            <li key={it.key} className="py-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span
                aria-hidden="true"
                className={`w-2 h-2 rounded-full ${it.tone === 'blush' ? 'bg-blush' : 'bg-marigold'}`}
              />
              <span className="flex-[1_1_300px] text-[15px] leading-snug text-ink">{it.text}</span>
              <button type="button" onClick={() => go(it.view)} className={linkBtn}>
                See why
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Course page → preview → payment → paid, as shrinking bars, with the biggest drop called out. */
function Funnel({
  data,
  activity,
  compact,
}: { data: AdminInsightsDto; activity?: AdminActivityDto; compact?: boolean }) {
  const steps = funnel(data, activity);
  const top = Math.max(1, steps[0]!.value);
  const drop = biggestDrop(steps);
  const sign = signIn(activity);
  return (
    <section aria-label="From looking to buying" className={card}>
      <SectionHead
        title="From looking to buying"
        lead="Each bar is how many got that far. The percentage is how many from the step before kept going."
      />
      <ol className="m-0 p-0 list-none flex flex-col gap-3">
        {steps.map((st, i) => {
          const prev = steps[i - 1];
          const worst = i === drop;
          return (
            <li key={st.label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 items-baseline">
              <span className="text-[15px] font-semibold text-ink">
                {st.label}
                {!compact && <span className="ml-2 text-[13px] font-normal text-ink2">{st.hint}</span>}
              </span>
              <span className="font-display text-[22px] font-extrabold tabular-nums text-ink leading-none">
                {n(st.value)}
              </span>
              <span className="col-span-2">
                <Bar share={st.value / top} tone={worst ? 'marigold' : 'teal'} />
              </span>
              {prev && (
                <span
                  className={`col-span-2 text-[13px] ${worst ? 'font-semibold text-marigold-text' : 'text-ink2'}`}
                >
                  {prev.value ? `${pct(st.value, prev.value)} kept going` : 'nobody reached the step before'}
                  {worst && ' · biggest drop'}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {drop !== null && DROP_ADVICE[steps[drop]!.label] && (
        <p className="m-0 border-l-4 border-marigold pl-3 text-[14px] leading-relaxed text-ink">
          <strong>What to try:</strong> {DROP_ADVICE[steps[drop]!.label]}
        </p>
      )}
      {!compact && sign.sent > 0 && (
        <p className="m-0 text-[14px] text-ink2">
          <strong className="text-ink">Signing in:</strong> {plural(sign.sent, 'sign-in link')} emailed,{' '}
          {plural(sign.signedIn, 'sign-in')} completed (Google sign-ins included).{' '}
          {sign.signedIn < sign.sent * 0.6 &&
            'Many links are never used: students may not find the email (spam folder, college inbox).'}
        </p>
      )}
    </section>
  );
}

/** Each tool: opened vs. actually used, as a bar, with a plain verdict. */
function ToolsView({ activity, limit }: { activity: ActivityState; limit?: number }) {
  if (activity.isLoading) return <Skeleton className="h-40 rounded-2xl" />;
  const rows = toolRows(activity.data);
  const shown = limit ? rows.slice(0, limit) : rows;
  const orders = actionTotal(activity.data, 'mess_order_placed');
  const reminders = actionTotal(activity.data, 'reminders_on');
  return (
    <section aria-label="Tools" className={card}>
      <SectionHead
        title={limit ? 'Tools people use' : 'Which tools get used'}
        lead={
          limit
            ? undefined
            : '"Opened" is a visit to the tool. "Used" means they tapped or typed something inside it, not just looked and left.'
        }
      />
      {shown.length === 0 ? (
        <p className="m-0 text-sm text-ink2">No tool was opened in this period.</p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col gap-4">
          {shown.map((t) => (
            <li key={t.key} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                <Link to={`/tools/${t.key}`} className="text-[16px] font-bold text-ink hover:underline">
                  {t.name}
                </Link>
                <span className="text-[13px] tabular-nums text-ink2">
                  <strong className="text-ink">{n(t.opened)}</strong> opened ·{' '}
                  <strong className="text-ink">{n(t.used)}</strong> used ({pct(t.used, t.opened)}) ·{' '}
                  {plural(t.students, 'student')}
                </span>
              </div>
              <Bar
                share={t.opened ? t.used / t.opened : 0}
                tone={t.verdict === 'poor' ? 'blush' : t.verdict === 'mixed' ? 'marigold' : 'teal'}
              />
              {!limit && (
                <span
                  className={`text-[13px] ${t.verdict === 'poor' ? 'text-blush-text font-semibold' : t.verdict === 'mixed' ? 'text-marigold-text' : 'text-ink2'}`}
                >
                  {VERDICT[t.verdict]}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {!limit && (orders > 0 || reminders > 0) && (
        <p className="m-0 text-[14px] text-ink2">
          Inside the tools: {plural(orders, 'food order')} placed from the Mess menu, and reminders turned on{' '}
          {plural(reminders, 'time')}.
        </p>
      )}
      {!limit && rows.length > 0 && (
        <p className="m-0 text-[12px] text-ink2">
          Counting "used" started on 24 Nov 2026, so periods before that show fewer uses than really happened.
        </p>
      )}
    </section>
  );
}

const SIGNAL_HELP: [string, string][] = [
  ['Error screen', 'A "couldn’t load" message appeared instead of the page’s content.'],
  ['Crash', 'The page broke and showed "This page tripped".'],
  ['Angry tapping', '4+ quick taps on the same spot that does nothing: it looked clickable.'],
  ['Form error', 'They pressed send and were told something was wrong or missing.'],
  ['Closed payment', 'The Razorpay window opened and was closed without paying.'],
];

/** Where students hit a wall: errors, crashes, angry tapping, form errors, closed payments. */
function StuckView({ activity }: { activity: ActivityState }) {
  if (activity.isLoading) return <Skeleton className="h-40 rounded-2xl" />;
  const rows = stuckRows(activity.data);
  return (
    <>
      <section aria-label="Where people get stuck" className={card}>
        <SectionHead
          title="Where people get stuck"
          lead="Each line is a page and what went wrong there, worst first. Each problem is counted once per visit, so one student tapping ten times counts once."
        />
        {rows.length === 0 ? (
          <p className="m-0 text-[15px] text-ink">
            <span className="font-semibold text-teal-text">Nobody got stuck in this period.</span> No error
            screens, crashes, angry tapping, form errors or closed payment windows.
          </p>
        ) : (
          <ol className="m-0 p-0 list-none flex flex-col divide-y divide-line">
            {rows.map((r) => (
              <li
                key={`${r.signal}:${r.page}`}
                className="py-3 grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3"
              >
                <span
                  className={`font-display text-[26px] font-extrabold leading-none tabular-nums ${r.signal === 'stuck_crash' || r.signal === 'stuck_error' ? 'text-blush-text' : 'text-marigold-text'}`}
                >
                  {n(r.times)}
                  <span className="block mt-1 font-sans text-[11px] font-semibold uppercase tracking-wide text-ink2">
                    {r.times === 1 ? 'time' : 'times'}
                  </span>
                </span>
                <div className="flex flex-col gap-1 min-w-0">
                  <p className="m-0 text-[15px] leading-snug text-ink">
                    <strong>{r.place}</strong>: people {r.what}.
                  </p>
                  <p className="m-0 text-[13px] text-ink2">
                    {r.students > 0
                      ? `${plural(r.students, 'signed-in student')} affected`
                      : 'Visitors who weren’t signed in'}
                    {r.page && activityHref(r.page) && (
                      <>
                        {' · '}
                        <Link to={r.page} className="font-semibold text-ink underline underline-offset-2">
                          Open the page
                        </Link>
                      </>
                    )}
                  </p>
                  <details>
                    <summary className="cursor-pointer text-[13px] font-semibold text-teal-text">
                      What to do
                    </summary>
                    <p className="m-0 mt-1 text-[14px] leading-relaxed text-ink2">{r.fix}</p>
                  </details>
                </div>
              </li>
            ))}
          </ol>
        )}
        <p className="m-0 text-[13px] text-ink2">
          The exact error messages are in{' '}
          <Link to="/admin?section=problems" className="font-semibold text-ink underline underline-offset-2">
            Storage › Problems
          </Link>
          . Counting started on 24 Nov 2026.
        </p>
      </section>
      <section aria-label="What we watch for" className={card}>
        <SectionHead title="What we watch for" />
        <dl className="m-0 grid gap-x-6 gap-y-2 sm:grid-cols-2 text-[14px]">
          {SIGNAL_HELP.map(([t, d]) => (
            <div key={t}>
              <dt className="font-semibold text-ink">{t}</dt>
              <dd className="m-0 text-ink2">{d}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
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
  const byDay = new Map(activity.data?.daily.map((d) => [d.day, d]));
  const daily: DayRow[] = data.daily.map((d) => ({
    ...d,
    students: byDay.get(d.day)?.students ?? 0,
    studentPages: byDay.get(d.day)?.studentPages ?? 0,
    visitorPages: byDay.get(d.day)?.visitorPages ?? 0,
  }));
  const stuckCount = stuckRows(activity.data).reduce((t, r) => t + r.times, 0);
  return (
    <>
      <div
        role="tablist"
        aria-label="Insights views"
        className="flex gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-1 px-1 pb-1 border-b border-line"
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
            {k === 'stuck' && stuckCount > 0 && (
              <span className="ml-1.5 rounded-full bg-marigold-soft px-1.5 py-0.5 text-[11px] text-marigold-text tabular-nums">
                {n(stuckCount)}
              </span>
            )}
          </button>
        ))}
      </div>

      {activity.isError && (
        <ErrorState
          title="Student activity didn't load."
          message={friendly(activity.error)}
          onRetry={() => activity.refetch()}
        />
      )}

      {view === 'overview' && (
        <>
          <Headline data={data} activity={activity.data} />
          <NeedsAttention data={data} activity={activity.data} go={choose} />
          <div className="grid gap-5 lg:grid-cols-2 items-start">
            <Funnel data={data} activity={activity.data} compact />
            <ToolsView activity={activity} limit={5} />
          </div>
          <DailyChart daily={daily} />
          <p className="m-0 text-[12px] text-ink2">
            Readers: {n(s.readers)} students read {plural(s.pagesRead, 'page')} of bought files (last 30 days
            at most). Days are IST. Admins are never counted.
          </p>
        </>
      )}

      {view === 'sources' && <SourcesView activity={activity} />}
      {view === 'tools' && <ToolsView activity={activity} />}
      {view === 'stuck' && <StuckView activity={activity} />}
      {view === 'pages' && <ActivityTables activity={activity} part="pages" />}
      {view === 'students' && (
        <>
          <ComebackView activity={activity.data} />
          <ActivityTables activity={activity} part="students" />
        </>
      )}

      {view === 'buying' && (
        <>
          <Funnel data={data} activity={activity.data} />
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
