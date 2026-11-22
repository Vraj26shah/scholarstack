import type { AdminInsightsDto, InsightsDayDto } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { Figure, Note, Panel, plural } from './ui';

type Days = AdminInsightsDto['days'];
const PERIODS: [Days, string][] = [
  ['1', 'Today'],
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
];

type Metric = 'views' | 'signups' | 'checkouts' | 'paid';
const METRICS: [Metric, string, string][] = [
  ['views', 'Page views', 'Course and bundle pages opened'],
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
function DailyChart({ daily }: { daily: InsightsDayDto[] }) {
  const [metric, setMetric] = useState<Metric>('views');
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
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="What to chart">
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

      {asTable ? (
        <div className="overflow-x-auto max-h-80">
          <table className="w-full text-[13px] tabular-nums">
            <thead className="text-ink2 text-left">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Day</th>
                <th className="py-1.5 pr-3 font-medium text-right">Views</th>
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

function Report({ data }: { data: AdminInsightsDto }) {
  const s = data.summary;
  return (
    <>
      <section
        aria-label="Totals"
        className="grid grid-cols-2 lg:grid-cols-5 gap-px overflow-hidden rounded-2xl bg-line shadow-[0_0_0_1px_var(--line)] [&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1"
      >
        <Figure
          label="New students"
          value={n(s.signups)}
          hint={`${n(s.signupsWhoBought)} of them bought (${pct(s.signupsWhoBought, s.signups)})`}
        />
        <Figure
          label="Page views"
          value={n(s.views)}
          hint={`${pct(s.signedInViews, s.views)} by signed-in students`}
          tone="teal"
        />
        <Figure
          label="Checkouts"
          value={n(s.checkouts)}
          hint={`${n(s.paidOrders)} paid (${pct(s.paidOrders, s.checkouts)})`}
          tone="teal"
        />
        <Figure
          label="Revenue"
          value={formatMoney(s.revenuePaise)}
          hint={`${plural(s.buyers, 'buyer')} · ${n(s.firstPurchases)} first-time`}
          tone="marigold"
        />
        <Figure
          label="Readers"
          value={n(s.readers)}
          hint={`${n(s.pagesRead)} pages read (last 30 days at most)`}
        />
      </section>

      <section aria-label="From looking to buying" className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="m-0 mb-2 text-[15px] font-semibold">From looking to buying</h3>
        <ol className="m-0 p-0 list-none flex flex-wrap gap-x-6 gap-y-2 text-[14px] tabular-nums">
          <li>
            <strong>{n(s.views)}</strong> page views
          </li>
          <li aria-hidden>→</li>
          <li>
            <strong>{n(s.checkouts)}</strong> checkouts{' '}
            <span className="text-ink2">({pct(s.checkouts, s.views)} of views)</span>
          </li>
          <li aria-hidden>→</li>
          <li>
            <strong>{n(s.paidOrders)}</strong> paid{' '}
            <span className="text-ink2">({pct(s.paidOrders, s.checkouts)} of checkouts)</span>
          </li>
        </ol>
        <p className="m-0 mt-2 text-[12px] text-ink2">
          Many checkouts but few paid: look at price, the payment step or a promo code. Many views but few
          checkouts: the course page isn't convincing (preview, description, price).
        </p>
      </section>

      <DailyChart daily={data.daily} />

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
                  <th className="py-1.5 pr-3 font-medium text-right">Signed in</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Checkouts</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Paid</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Revenue</th>
                  <th className="py-1.5 font-medium text-right">Views → paid</th>
                </tr>
              </thead>
              <tbody>
                {data.topItems.map((i) => (
                  <tr key={`${i.kind}:${i.id}`} className="border-t border-line">
                    <td className="py-1.5 pr-3 min-w-[200px]">
                      <Link
                        to={i.kind === 'course' ? `/c/${i.slug}` : `/b/${i.slug}`}
                        className="text-ink hover:underline"
                      >
                        {i.title}
                      </Link>
                      {i.kind === 'bundle' && <span className="ml-1.5 text-[11px] text-ink2">bundle</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-right">{n(i.views)}</td>
                    <td className="py-1.5 pr-3 text-right">{n(i.signedInViews)}</td>
                    <td className="py-1.5 pr-3 text-right">{n(i.checkouts)}</td>
                    <td className="py-1.5 pr-3 text-right">{n(i.paid)}</td>
                    <td className="py-1.5 pr-3 text-right">{formatMoney(i.revenuePaise)}</td>
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
                    <td className="py-1.5 pr-3 min-w-[200px]">
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

      <DeeperLinks />
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
        <Report data={q.data} />
      ) : null}
    </Panel>
  );
}
