import {
  type InsightPeriod,
  type InsightTotalsDto,
  type OwnedMessDto,
  type OwnerInsightsDto,
  campusClock,
} from '@ss/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { type ReactNode, useMemo, useState } from 'react';
import { api, friendly } from '../../lib/api';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { SalesList } from './sales-list';
import { rupees } from './shared';

const PERIODS: [InsightPeriod, string][] = [
  ['day', 'Day'],
  ['week', 'Week'],
  ['month', 'Month'],
  ['year', 'Year'],
];
const PREV_NAME: Record<InsightPeriod, string> = {
  day: 'the day before',
  week: 'last week',
  month: 'last month',
  year: 'last year',
};
type Metric = 'revenue' | 'orders' | 'visitors';
const METRICS: [Metric, string][] = [
  ['revenue', 'Takings'],
  ['orders', 'Orders'],
  ['visitors', 'Visitors'],
];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hourName = (h: number) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;

/** "▲ 12% vs last week" (words carry the direction; colour only helps). */
function Change({ now, before, period }: { now: number; before: number; period: InsightPeriod }) {
  if (!before && !now) return <span className="text-ink2">No change</span>;
  if (!before) return <span className="text-teal-text">New this {period === 'day' ? 'day' : period}</span>;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return <span className="text-ink2">Same as {PREV_NAME[period]}</span>;
  return (
    <span className={pct > 0 ? 'text-teal-text' : 'text-blush-text'}>
      {pct > 0 ? '▲' : '▼'} {Math.abs(pct)}% vs {PREV_NAME[period]}
    </span>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0 border-t-2 border-ink pt-2.5">
      <dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink2">{label}</dt>
      <dd className="m-0 font-display text-[30px] leading-none font-extrabold tabular-nums text-ink">
        {value}
      </dd>
      {sub && <dd className="m-0 text-[13px] leading-snug">{sub}</dd>}
    </div>
  );
}

/**
 * One series as thin bars on one axis. Hover (or tap) a bar for that bucket's numbers; the hit
 * area is the whole column, not just the bar, so small bars are easy to reach on a phone.
 */
function Bars({
  data,
  metric,
  tip,
  height = 220,
}: {
  data: { label: string; value: number }[];
  metric: Metric;
  tip: (i: number) => ReactNode;
  height?: number;
}) {
  const [at, setAt] = useState<number | null>(null);
  const W = 720;
  const H = height;
  const top = 10;
  const bottom = 24;
  const left = 48;
  const max = Math.max(1, ...data.map((d) => d.value));
  // Gridlines at round numbers.
  const step = (() => {
    const raw = max / 3;
    const mag = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  })();
  const ceil = Math.max(step * Math.ceil(max / step), 1);
  const plotH = H - top - bottom;
  const colW = (W - left) / data.length;
  const barW = Math.max(3, Math.min(28, colW - 4));
  const y = (v: number) => top + plotH - (v / ceil) * plotH;
  const every = Math.ceil(data.length / 12);
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto block select-none"
        role="img"
        aria-label={`${METRICS.find(([k]) => k === metric)![1]} chart`}
        onPointerLeave={() => setAt(null)}
      >
        {Array.from({ length: Math.round(ceil / step) + 1 }, (_, i) => i * step).map((v) => (
          <g key={v}>
            <line x1={left} x2={W} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={left - 8} y={y(v) + 4} textAnchor="end" fontSize={12} fill="var(--ink2)">
              {metric === 'revenue' ? `₹${v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : v}` : v}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = left + i * colW + (colW - barW) / 2;
          const h = Math.max(0, y(0) - y(d.value));
          const r = Math.min(4, barW / 2, h);
          return (
            <g key={d.label}>
              {h > 0 && (
                <path
                  d={`M${x},${y(0)} V${y(d.value) + r} Q${x},${y(d.value)} ${x + r},${y(d.value)} H${x + barW - r} Q${x + barW},${y(d.value)} ${x + barW},${y(d.value) + r} V${y(0)} Z`}
                  fill="var(--teal)"
                  opacity={at === null || at === i ? 1 : 0.45}
                />
              )}
              {i % every === 0 && (
                <text
                  x={left + i * colW + colW / 2}
                  y={H - 6}
                  textAnchor="middle"
                  fontSize={12}
                  fill="var(--ink2)"
                >
                  {d.label}
                </text>
              )}
              {/* The whole column answers hover and taps. */}
              <rect
                x={left + i * colW}
                y={top}
                width={colW}
                height={plotH}
                fill="transparent"
                onPointerEnter={() => setAt(i)}
                onPointerDown={() => setAt(i)}
              />
            </g>
          );
        })}
      </svg>
      {at !== null && data[at] && (
        <div
          role="status"
          className="pointer-events-none absolute top-0 z-10 rounded-xl bg-ink px-3 py-2 text-[13px] leading-snug text-bg shadow-lg"
          style={{
            left: `clamp(0px, calc(${((left + (at + 0.5) * colW) / W) * 100}% - 80px), calc(100% - 170px))`,
            minWidth: 160,
          }}
        >
          <p className="m-0 font-semibold">{data[at].label}</p>
          {tip(at)}
        </div>
      )}
    </div>
  );
}

/** Horizontal bars with the name and number in text beside them (top dishes, outcomes). */
function Rows({ rows }: { rows: { label: string; value: number; text: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="m-0 p-0 list-none flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.label} className="flex flex-col gap-1">
          <span className="flex items-baseline justify-between gap-3 text-[14px]">
            <span className="min-w-0 truncate text-ink">{r.label}</span>
            <span className="shrink-0 tabular-nums font-semibold text-ink">{r.text}</span>
          </span>
          <span className="block h-2 rounded-full bg-sunk overflow-hidden">
            <span
              className="block h-full rounded-full bg-teal"
              style={{ width: `${Math.max(r.value ? 2 : 0, (r.value / max) * 100)}%` }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

const Section = ({ title, children, note }: { title: string; children: ReactNode; note?: string }) => (
  <section className="flex flex-col gap-3 min-w-0">
    <h3 className="m-0 border-b-2 border-ink pb-1.5 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink">
      {title}
    </h3>
    {note && <p className="m-0 text-[13px] text-ink2">{note}</p>}
    {children}
  </section>
);

const tipLines = (b: OwnerInsightsDto['series'][number], day: boolean) => (
  <>
    <p className="m-0">Takings {rupees(b.revenue)}</p>
    <p className="m-0">
      {b.orders} order{b.orders === 1 ? '' : 's'}
    </p>
    {!day && (
      <p className="m-0">
        {b.visitors} visitor{b.visitors === 1 ? '' : 's'} · {b.views} view{b.views === 1 ? '' : 's'}
      </p>
    )}
  </>
);

/**
 * The owner's Insights tab: takings, orders, visitors and customers for any day, week, month or
 * year (campus time), compared with the one before; what sells, when it's busy, who comes back.
 */
export function InsightsTab({ mess }: { mess: OwnedMessDto }) {
  const today = campusClock(new Date()).date;
  const [period, setPeriod] = useState<InsightPeriod>('day');
  const [anchor, setAnchor] = useState<string>(today);
  const [metric, setMetric] = useState<Metric>('revenue');
  const [table, setTable] = useState(false);
  const q = useQuery({
    queryKey: ['owner-insights', mess.slug, period, anchor],
    queryFn: () => api.ownerInsights(mess.slug, period, anchor),
    placeholderData: keepPreviousData,
    refetchInterval: anchor === today ? 60_000 : false,
  });
  const d = q.data;
  const dayView = period === 'day';
  const chart = useMemo(
    () =>
      (d?.series ?? []).map((b) => ({
        label: b.label,
        value: metric === 'revenue' ? b.revenue : metric === 'orders' ? b.orders : b.visitors,
      })),
    [d, metric],
  );
  const metrics = dayView ? METRICS.filter(([k]) => k !== 'visitors') : METRICS;
  const shownMetric = dayView && metric === 'visitors' ? 'revenue' : metric;

  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.isError || !d)
    return (
      <ErrorState
        title="Couldn't load your insights"
        message={friendly(q.error)}
        onRetry={() => q.refetch()}
      />
    );
  const t: InsightTotalsDto = d.totals;
  const p = d.previous;
  const peakHour = d.hours.indexOf(Math.max(...d.hours));
  const peakDay = d.weekdays.indexOf(Math.max(...d.weekdays));
  const outcomes = [
    { label: 'Accepted or delivered', value: t.confirmed, text: String(t.confirmed) },
    { label: 'Waiting for you', value: t.waiting, text: String(t.waiting) },
    { label: 'Cancelled by the student', value: t.cancelledByStudent, text: String(t.cancelledByStudent) },
    { label: 'Declined or cancelled by you', value: t.cancelledByYou, text: String(t.cancelledByYou) },
    { label: 'No answer in 10 minutes', value: t.autoCancelled, text: String(t.autoCancelled) },
  ];

  return (
    <div className={`flex flex-col gap-8 ${q.isFetching ? 'opacity-90' : ''}`}>
      {/* Period and date, in one row above everything */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div role="tablist" aria-label="Period" className="inline-flex rounded-full border border-line p-1">
          {PERIODS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={period === k}
              onClick={() => setPeriod(k)}
              className={`h-9 rounded-full px-4 text-[14px] font-semibold border-0 cursor-pointer ${period === k ? 'bg-ink text-bg' : 'bg-transparent text-ink2'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={`Previous ${period}`}
            onClick={() => setAnchor(d.prevAnchor)}
            className="press grid place-items-center w-10 h-10 rounded-full border border-line bg-transparent text-ink cursor-pointer"
          >
            ←
          </button>
          <p className="m-0 min-w-[150px] text-center text-[16px] font-bold text-ink" aria-live="polite">
            {d.label}
          </p>
          <button
            type="button"
            aria-label={`Next ${period}`}
            disabled={!d.nextAnchor}
            onClick={() => d.nextAnchor && setAnchor(d.nextAnchor)}
            className="press grid place-items-center w-10 h-10 rounded-full border border-line bg-transparent text-ink cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          >
            →
          </button>
          {anchor !== today && (
            <button
              type="button"
              onClick={() => setAnchor(today)}
              className="ml-1 h-9 rounded-full border border-line bg-transparent px-3.5 text-[13.5px] font-semibold text-ink cursor-pointer"
            >
              Today
            </button>
          )}
        </div>
      </div>

      <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-4">
        <Stat
          label="Takings"
          value={rupees(t.revenue)}
          sub={<Change now={t.revenue} before={p.revenue} period={period} />}
        />
        <Stat
          label="Orders"
          value={t.confirmed}
          sub={
            <>
              <span className="text-ink2">of {t.orders} placed · </span>
              <Change now={t.confirmed} before={p.confirmed} period={period} />
            </>
          }
        />
        <Stat
          label="Average order"
          value={rupees(t.avgOrder)}
          sub={<Change now={t.avgOrder} before={p.avgOrder} period={period} />}
        />
        <Stat
          label="Customers"
          value={t.customers}
          sub={
            <span className="text-ink2">
              {t.newCustomers} new · {t.customers - t.newCustomers} returning
            </span>
          }
        />
        <Stat
          label="Visitors"
          value={t.visitors}
          sub={
            <>
              <span className="text-ink2">{t.views} page views · </span>
              <Change now={t.visitors} before={p.visitors} period={period} />
            </>
          }
        />
        <Stat
          label="Signed-in visitors"
          value={t.signedInVisitors}
          sub={<span className="text-ink2">{t.pastCustomersVisiting} had ordered before</span>}
        />
        <Stat
          label="Visitors who ordered"
          value={t.conversion === null ? '–' : `${t.conversion}%`}
          sub={
            <span className="text-ink2">
              {t.customers} of {t.visitors} visitors
            </span>
          }
        />
        <Stat
          label="Your reply time"
          value={t.replyMinutes === null ? '–' : `${t.replyMinutes} min`}
          sub={<span className="text-ink2">middle time to accept or decline</span>}
        />
      </dl>

      <Section title={dayView ? 'Through the day' : period === 'year' ? 'Month by month' : 'Day by day'}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Chart shows"
            className="inline-flex rounded-full border border-line p-1"
          >
            {metrics.map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={shownMetric === k}
                onClick={() => setMetric(k)}
                className={`h-8 rounded-full px-3.5 text-[13.5px] font-semibold border-0 cursor-pointer ${shownMetric === k ? 'bg-ink text-bg' : 'bg-transparent text-ink2'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setTable((v) => !v)}
            className="border-0 bg-transparent p-0 text-[13.5px] font-semibold text-ink underline underline-offset-4 cursor-pointer"
          >
            {table ? 'Show the chart' : 'Show as a table'}
          </button>
        </div>
        {table ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[14px] tabular-nums border-collapse">
              <thead>
                <tr className="text-left text-ink2">
                  <th className="py-1.5 pr-4 font-semibold">
                    {dayView ? 'Hour' : period === 'year' ? 'Month' : 'Day'}
                  </th>
                  <th className="py-1.5 pr-4 font-semibold text-right">Orders</th>
                  <th className="py-1.5 pr-4 font-semibold text-right">Takings</th>
                  {!dayView && <th className="py-1.5 pr-4 font-semibold text-right">Visitors</th>}
                  {!dayView && <th className="py-1.5 font-semibold text-right">Views</th>}
                </tr>
              </thead>
              <tbody>
                {d.series.map((b) => (
                  <tr key={b.key} className="border-t border-line">
                    <td className="py-1.5 pr-4">{b.label}</td>
                    <td className="py-1.5 pr-4 text-right">{b.orders}</td>
                    <td className="py-1.5 pr-4 text-right">{rupees(b.revenue)}</td>
                    {!dayView && <td className="py-1.5 pr-4 text-right">{b.visitors}</td>}
                    {!dayView && <td className="py-1.5 text-right">{b.views}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : chart.every((c) => !c.value) ? (
          <p className="m-0 py-10 text-center text-[15px] text-ink2">
            No {shownMetric === 'revenue' ? 'takings' : shownMetric} in {d.label}.
          </p>
        ) : (
          <Bars data={chart} metric={shownMetric} tip={(i) => tipLines(d.series[i]!, dayView)} />
        )}
        {dayView && (
          <p className="m-0 text-[13px] text-ink2">
            Today's visitors so far: {t.visitors}. Visitors are counted per day, so they show in the totals
            above.
          </p>
        )}
      </Section>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section
          title="What sells"
          note={d.topDishes.length ? undefined : 'Nothing sold in this period yet.'}
        >
          <Rows
            rows={d.topDishes.map((x) => ({
              label: x.name,
              value: x.qty,
              text: `${x.qty} sold · ${rupees(x.revenue)}`,
            }))}
          />
        </Section>
        <Section
          title="Offers & combos"
          note={
            d.offers.length
              ? `They brought in ${rupees(d.offers.reduce((n, o) => n + o.revenue, 0))} and gave away ${rupees(d.offers.reduce((n, o) => n + o.discount, 0))} in discounts.`
              : 'No offers or combos used in this period. Set them up in the Offers tab.'
          }
        >
          <Rows
            rows={d.offers.map((o) => ({
              label: o.label,
              value: o.orders,
              text: `${o.orders} order${o.orders === 1 ? '' : 's'} · ${rupees(o.revenue)}${o.discount ? ` · ${rupees(o.discount)} off` : ''}`,
            }))}
          />
        </Section>
        <Section title="How orders ended">
          <Rows rows={outcomes} />
          <p className="m-0 text-[13px] text-ink2">
            {d.modes.delivery + d.modes.pickup > 0
              ? `${Math.round((d.modes.delivery / (d.modes.delivery + d.modes.pickup)) * 100)}% delivery, ${Math.round((d.modes.pickup / (d.modes.delivery + d.modes.pickup)) * 100)}% pickup.`
              : 'No orders in this period.'}
          </p>
        </Section>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {!dayView && (
          <Section
            title="Busiest hours"
            note={t.orders ? `Most orders come in around ${hourName(peakHour)}.` : undefined}
          >
            <Bars
              height={160}
              metric="orders"
              data={d.hours.map((v, h) => ({ label: hourName(h), value: v }))}
              tip={(h) => (
                <p className="m-0">
                  {d.hours[h]} order{d.hours[h] === 1 ? '' : 's'}
                </p>
              )}
            />
          </Section>
        )}
        {(period === 'month' || period === 'year') && (
          <Section
            title="Busiest days of the week"
            note={t.orders ? `${WEEKDAYS[peakDay]} is your busiest day.` : undefined}
          >
            <Bars
              height={160}
              metric="orders"
              data={d.weekdays.map((v, i) => ({ label: WEEKDAYS[i]!, value: v }))}
              tip={(i) => (
                <p className="m-0">
                  {d.weekdays[i]} order{d.weekdays[i] === 1 ? '' : 's'}
                </p>
              )}
            />
          </Section>
        )}
        <Section
          title="Top customers"
          note={d.topCustomers.length ? undefined : 'No customers in this period yet.'}
        >
          <ol className="m-0 p-0 list-none flex flex-col divide-y divide-line">
            {d.topCustomers.map((c, i) => (
              <li
                key={`${c.name}-${i}`}
                className="flex items-baseline justify-between gap-3 py-2 text-[14px]"
              >
                <span className="min-w-0 truncate text-ink">
                  <span className="tabular-nums text-ink2">{i + 1}.</span> {c.name}
                </span>
                <span className="shrink-0 tabular-nums text-ink">
                  {c.orders} order{c.orders === 1 ? '' : 's'} · <strong>{rupees(c.spent)}</strong>
                </span>
              </li>
            ))}
          </ol>
        </Section>
      </div>
      <SalesList sales={d.sales ?? []} count={d.totals.confirmed} revenue={d.totals.revenue} />
      <p className="m-0 text-[12.5px] text-ink2">
        Times are Indian time. Takings count accepted, ready and delivered orders, and orders paid first by
        UPI that were never collected. Visitors are people who opened your page (signed-out visitors are
        counted by network, once a day; your own visits are not counted). Names of people who only looked are
        never shown.
      </p>
    </div>
  );
}
