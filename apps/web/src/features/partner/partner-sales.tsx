import type { InsightPeriod, OwnedMessDto, OwnerInsightsDto } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/api';
import { Skeleton } from '../../shared/ui/feedback';
import { SalesList } from '../restaurant/sales-list';
import { rupees } from '../restaurant/shared';
import { type TextKey, useT } from './i18n';

const PERIODS: [InsightPeriod, TextKey][] = [
  ['day', 'today'],
  ['week', 'week'],
  ['month', 'month'],
  ['year', 'year'],
];
const WEEKDAYS = {
  hi: ['सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि', 'रवि'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
};

export interface DishRow {
  name: string;
  qty: number;
  revenue: number;
  /** Sold in the period before (for the up/down arrow). */
  before: number;
}

/** Every dish's sales now vs the period before, best first; and menu dishes that barely sold. */
export function dishReport(
  now: OwnerInsightsDto['topDishes'],
  before: OwnerInsightsDto['topDishes'],
  menu: string[],
): { dishes: DishRow[]; slow: string[] } {
  const prev = new Map(before.map((d) => [d.name, d.qty]));
  const dishes = now
    .map((d) => ({ name: d.name, qty: d.qty, revenue: d.revenue, before: prev.get(d.name) ?? 0 }))
    .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);
  const sold = new Map(dishes.map((d) => [d.name, d.qty]));
  const top = dishes[0]?.qty ?? 0;
  // "Slow": on the menu, and sold nothing, or under a tenth of the best seller.
  const slow = top
    ? [...new Set(menu)].filter((name) => (sold.get(name) ?? 0) <= Math.max(0, Math.floor(top / 10)))
    : [];
  return { dishes, slow };
}

function Change({ now, before }: { now: number; before: number }) {
  const { t } = useT();
  if (!before && !now) return null;
  if (!before) return <span className="text-[13px] font-bold text-[#1f8a4c]">NEW</span>;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return <span className="text-[13px] font-semibold text-ink2">=</span>;
  return (
    <span className={`text-[13px] font-bold tabular-nums ${pct > 0 ? 'text-[#1f8a4c]' : 'text-blush-text'}`}>
      {pct > 0 ? '▲' : '▼'} {Math.abs(pct)}% {pct > 0 ? t('up') : t('down')}
    </span>
  );
}

export function PartnerSales({ mess }: { mess: OwnedMessDto }) {
  const { t, lang } = useT();
  const [period, setPeriod] = useState<InsightPeriod>('day');
  const q = useQuery({
    queryKey: ['owner-insights', mess.slug, period],
    queryFn: () => api.ownerInsights(mess.slug, period),
    refetchInterval: 60_000,
  });
  // The period before, for each dish's up/down arrow.
  const prevQ = useQuery({
    queryKey: ['owner-insights', mess.slug, period, q.data?.prevAnchor],
    queryFn: () => api.ownerInsights(mess.slug, period, q.data!.prevAnchor),
    enabled: !!q.data?.prevAnchor,
  });
  const menuQ = useQuery({ queryKey: ['owner-mess', mess.slug], queryFn: () => api.ownerMess(mess.slug) });

  const d = q.data;
  const menu = (menuQ.data?.order ?? []).flatMap((s) => s.items.filter((i) => !i.tiffin).map((i) => i.name));
  const report = d ? dishReport(d.topDishes, prevQ.data?.topDishes ?? [], menu) : null;
  const best = report?.dishes[0];
  const peakHour = d ? d.hours.indexOf(Math.max(...d.hours)) : -1;
  const peakDay = d ? d.weekdays.indexOf(Math.max(...d.weekdays)) : -1;
  const hourText = (h: number) => {
    const fmt = (x: number) => `${((x + 11) % 12) + 1}${x < 12 ? 'am' : 'pm'}`;
    return `${fmt(h)} – ${fmt((h + 1) % 24)}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" className="grid grid-cols-4 gap-1 rounded-2xl bg-sunk p-1">
        {PERIODS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={period === k}
            onClick={() => setPeriod(k)}
            className={`min-h-12 rounded-xl text-[15px] font-bold ${period === k ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--line)]' : 'text-ink2'}`}
          >
            {t(label)}
          </button>
        ))}
      </div>

      {!d ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-36 rounded-3xl" />
          <Skeleton className="h-56 rounded-3xl" />
        </div>
      ) : (
        <>
          <div className="rounded-3xl bg-brand text-white p-5 flex flex-col gap-4">
            <p className="m-0 font-mono text-[13px] text-on-brand2">{d.label}</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="m-0 text-[14px] text-on-brand2">{t('earned')}</p>
                <p className="m-0 font-display font-extrabold text-[34px] leading-none tabular-nums">
                  {rupees(d.totals.revenue)}
                </p>
                <Delta now={d.totals.revenue} before={d.previous.revenue} />
              </div>
              <div>
                <p className="m-0 text-[14px] text-on-brand2">{t('orders')}</p>
                <p className="m-0 font-display font-extrabold text-[34px] leading-none tabular-nums">
                  {d.totals.confirmed}
                </p>
                <Delta now={d.totals.confirmed} before={d.previous.confirmed} />
              </div>
            </div>
            <p className="m-0 border-t border-dashed border-white/20 pt-3 text-[15px]">
              <span className="font-bold tabular-nums">{d.totals.visitors}</span> {t('visitors')}
            </p>
          </div>

          {report && report.dishes.length > 0 ? (
            <>
              {best && (
                <section className="flex flex-col gap-1">
                  <h2 className="m-0 text-[15px] font-extrabold uppercase tracking-[0.08em] text-ink2">
                    {t('best')}
                  </h2>
                  <p className="m-0 text-[24px] font-extrabold leading-tight">{best.name}</p>
                  <p className="m-0 text-[16px] text-ink2 tabular-nums">
                    {best.qty} {t('sold')} · {rupees(best.revenue)}
                  </p>
                </section>
              )}

              <section className="flex flex-col gap-3">
                <h2 className="m-0 text-[15px] font-extrabold uppercase tracking-[0.08em] text-ink2">
                  {t('dishes')}
                </h2>
                <ul className="m-0 p-0 list-none flex flex-col">
                  {report.dishes.map((x) => (
                    <li
                      key={x.name}
                      className="flex flex-col gap-1.5 py-3 border-b border-line last:border-b-0"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[18px] font-bold min-w-0 [overflow-wrap:anywhere]">
                          {x.name}
                        </span>
                        <span className="flex-none text-[16px] font-semibold tabular-nums">
                          {rupees(x.revenue)}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-sunk overflow-hidden">
                        <div
                          className="h-full rounded-full bg-teal"
                          style={{
                            width: `${Math.max(4, Math.round((x.qty / report.dishes[0]!.qty) * 100))}%`,
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3 text-[14px] text-ink2 tabular-nums">
                        <span>
                          {x.qty} {t('sold')}
                        </span>
                        <Change now={x.qty} before={x.before} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              {report.slow.length > 0 && (
                <section className="flex flex-col gap-2 rounded-3xl bg-marigold-soft p-5">
                  <h2 className="m-0 text-[17px] font-extrabold text-marigold-text">{t('slow')}</h2>
                  <p className="m-0 text-[15px] leading-relaxed text-marigold-text">{t('slowHint')}</p>
                  <p className="m-0 text-[17px] font-bold text-ink">{report.slow.slice(0, 8).join(' · ')}</p>
                </section>
              )}

              <section className="grid grid-cols-2 gap-3">
                {peakHour >= 0 && d.hours[peakHour]! > 0 && (
                  <div className="rounded-2xl bg-sunk p-4">
                    <p className="m-0 text-[14px] font-bold text-ink2">{t('busiest')}</p>
                    <p className="m-0 text-[20px] font-extrabold">{hourText(peakHour)}</p>
                  </div>
                )}
                {period !== 'day' && peakDay >= 0 && d.weekdays[peakDay]! > 0 && (
                  <div className="rounded-2xl bg-sunk p-4">
                    <p className="m-0 text-[14px] font-bold text-ink2">{t('busiestDay')}</p>
                    <p className="m-0 text-[20px] font-extrabold">{WEEKDAYS[lang][peakDay]}</p>
                  </div>
                )}
              </section>
            </>
          ) : (
            <p className="m-0 text-[18px] text-ink2 font-semibold">{t('noSales')}</p>
          )}
          {(d.sales?.length ?? 0) > 0 && (
            <SalesList
              big
              sales={d.sales}
              count={d.totals.confirmed}
              revenue={d.totals.revenue}
              words={{
                latest: t('latestSales'),
                title: t('everySale'),
                none: t('noSales'),
                more: t('showAll'),
                upi: t('paidUpiTag'),
                tiffin: t('tiffinTag'),
                notCollected: t('notCollectedPaid'),
                delivery: t('delivery'),
                pickup: t('pickup'),
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function Delta({ now, before }: { now: number; before: number }) {
  const { t } = useT();
  if (!before) return null;
  const pct = Math.round(((now - before) / before) * 100);
  return (
    <p className="m-0 mt-1 text-[13px] text-on-brand2 tabular-nums">
      {pct >= 0 ? '▲' : '▼'} {Math.abs(pct)}% {t('vsBefore')}
    </p>
  );
}
