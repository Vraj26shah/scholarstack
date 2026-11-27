import type { FeeRuleDto, FeeStatementDto, LedgerEntryDto, OwnedMessDto } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { api, friendly } from '../../lib/api';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';

/** Paise as rupees: ₹1,234 or ₹1,234.50. */
export const money = (paise: number) => {
  const neg = paise < 0;
  const r = Math.abs(paise) / 100;
  const s = r.toLocaleString('en-IN', {
    minimumFractionDigits: Number.isInteger(r) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${neg ? '−' : ''}₹${s}`;
};

export const monthName = (period: string) =>
  new Date(`${period}-15T12:00:00+05:30`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

const dayName = (iso: string) =>
  new Date(`${iso}T12:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** The fee in words: "₹5 + 2% per order, tiffin plans ₹50", "₹3,000 a month", with any free period. */
export function ruleText(r: FeeRuleDto | null) {
  if (!r || r.mode === 'none') return 'No fee';
  const free = r.freeUntil ? ` · free until ${dayName(r.freeUntil)}` : '';
  if (r.mode === 'monthly') return `₹${r.monthly.toLocaleString('en-IN')} a month${free}`;
  const parts = [r.perOrder ? `₹${r.perOrder}` : '', r.percent ? `${r.percent}%` : ''].filter(Boolean);
  const tiffin = r.tiffinFee ? `, tiffin plans ₹${r.tiffinFee}${r.percent ? ` + ${r.percent}%` : ''}` : '';
  return `${parts.join(' + ') || '₹0'} per order${tiffin}${free}`;
}

const KIND: Record<LedgerEntryDto['kind'], string> = {
  order: 'Order',
  waive: 'Waived',
  unwaive: 'Waiver undone',
  monthly: 'Monthly plan',
  adjust: 'Adjustment',
  payment: 'Payment received',
};

/** The last 12 months (newest first) for the month picker. */
export function recentMonths(current: string, n = 12) {
  const out: string[] = [];
  let [y, m] = current.split('-').map(Number) as [number, number];
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m--;
    if (!m) {
      m = 12;
      y--;
    }
  }
  return out;
}

const thisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);

/**
 * One restaurant's fee statement for a month: what's owed, every order's fee, payments, and how
 * the month was closed. Shown to the owner (read only) and to the admin (with `entryAction`).
 */
export function FeeStatement({
  s,
  period,
  onPeriod,
  entryAction,
  owner = false,
}: {
  s: FeeStatementDto;
  period: string;
  onPeriod: (p: string) => void;
  entryAction?: (e: LedgerEntryDto) => ReactNode;
  owner?: boolean;
}) {
  const months = recentMonths(thisMonth());
  const owed = s.balanceNow;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
        <div>
          <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink2">
            {owed > 0 ? (owner ? 'You owe now' : 'Owed now') : owed < 0 ? 'In credit' : 'Settled'}
          </p>
          <p
            className={`m-0 font-display text-[40px] leading-none font-extrabold tabular-nums ${owed > 0 ? 'text-ink' : 'text-teal-text'}`}
          >
            {money(Math.abs(owed))}
          </p>
        </div>
        <div className="min-w-0">
          <p className="m-0 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink2">Fee</p>
          <p className="m-0 text-[16px] font-semibold text-ink">{ruleText(s.rule)}</p>
          {s.rule?.note && <p className="m-0 text-[13px] text-ink2">{s.rule.note}</p>}
        </div>
        <label className="flex flex-col gap-1 sm:ml-auto">
          <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink2">Month</span>
          <select
            value={period}
            onChange={(e) => onPeriod(e.target.value)}
            className="h-10 rounded-lg border-[1.5px] border-line bg-surface px-3 text-[14px] outline-none focus:border-teal"
          >
            {months.map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
                {s.settlements.some((x) => x.period === m) ? ' · closed' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section aria-label={monthName(s.period)} className="flex flex-col gap-3">
        <h2 className="m-0 flex flex-wrap items-baseline gap-x-3 border-b-2 border-ink pb-1.5 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink">
          {monthName(s.period)}
          <span className="text-ink2 normal-case tracking-normal font-normal">
            {s.settlement
              ? `Closed ${dayName(s.settlement.closedAt.slice(0, 10))}${s.settlement.note ? ` · “${s.settlement.note}”` : ''}`
              : s.period === thisMonth()
                ? 'So far this month'
                : 'Not closed yet'}
          </span>
        </h2>
        <dl className="m-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-4">
          {(
            [
              ['Orders on the site', String(s.orders), s.waived ? `${s.waived} waived` : ''],
              ['Students paid', money(s.sales * 100), ''],
              ['Brought forward', money(s.opening), ''],
              ['Fees', money(s.charges), s.monthlySoFar ? `+ ${money(s.monthlySoFar)} monthly so far` : ''],
              ['Credits', money(s.credits), ''],
              ['Paid', money(s.payments), ''],
            ] as const
          ).map(([label, v, sub]) => (
            <div key={label} className="border-t-2 border-ink pt-2">
              <dt className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink2">{label}</dt>
              <dd className="m-0 font-display text-[24px] leading-tight font-extrabold tabular-nums">{v}</dd>
              {sub && <dd className="m-0 text-[12.5px] text-ink2">{sub}</dd>}
            </div>
          ))}
        </dl>
        <p className="m-0 text-[15px] text-ink">
          {s.period === thisMonth() ? 'Balance now' : 'Balance at the end of the month'}:{' '}
          <strong className="tabular-nums">{money(s.closing)}</strong>
        </p>
      </section>

      <section aria-label="Entries" className="flex flex-col">
        <h2 className="m-0 border-b-2 border-ink pb-1.5 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink">
          Every entry · {s.entries.length}
        </h2>
        {!s.entries.length ? (
          <p className="m-0 py-3 text-[14px] text-ink2">Nothing this month.</p>
        ) : (
          <ul className="m-0 p-0 list-none divide-y divide-line">
            {s.entries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5 text-[14px]">
                <span className="w-14 shrink-0 tabular-nums text-ink2">{dayName(e.day)}</span>
                <span className="flex-1 min-w-[200px] text-ink">
                  <strong>{KIND[e.kind]}</strong>
                  {e.order && (
                    <>
                      {' '}
                      · {e.order.code} · {e.order.name} · ₹{e.order.total}
                      {e.order.tiffin ? ' · tiffin plan' : ''}
                    </>
                  )}
                  {e.method ? ` · ${e.method}` : ''}
                  <span className="block text-[13px] text-ink2">
                    {e.note}
                    {e.waived ? ' · waived' : ''}
                    {!owner && e.createdBy && e.createdBy !== 'system' ? ` · by ${e.createdBy}` : ''}
                  </span>
                </span>
                <span
                  className={`tabular-nums font-semibold ${e.amount < 0 ? 'text-teal-text' : 'text-ink'} ${e.waived ? 'line-through opacity-60' : ''}`}
                >
                  {e.amount > 0 ? '+' : ''}
                  {money(e.amount)}
                </span>
                {entryAction?.(e)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {s.settlements.length > 0 && (
        <section aria-label="Closed months" className="flex flex-col">
          <h2 className="m-0 border-b-2 border-ink pb-1.5 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink">
            Closed months
          </h2>
          <ul className="m-0 p-0 list-none divide-y divide-line">
            {s.settlements.map((x) => (
              <li key={x.period} className="flex flex-wrap items-baseline gap-x-4 py-2 text-[14px]">
                <button
                  type="button"
                  onClick={() => onPeriod(x.period)}
                  className="border-0 bg-transparent p-0 font-semibold text-ink underline underline-offset-4 cursor-pointer"
                >
                  {monthName(x.period)}
                </button>
                <span className="text-ink2">
                  {x.orders} orders · fees {money(x.charges)} · paid {money(x.payments)}
                </span>
                <span className="ml-auto tabular-nums font-semibold">
                  {x.closing === 0 ? 'Settled' : `Carried on ${money(x.closing)}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {owner && (
        <p className="m-0 max-w-[640px] text-[13.5px] text-ink2">
          A fee is added only when you accept an order on the site. An order you cancel within 15 minutes of
          accepting, or one the admin decides never reached the student, isn't charged. Questions about an
          entry? Message Scholars Stack: every entry stays here, nothing is ever changed or removed.
        </p>
      )}
    </div>
  );
}

/** The owner's own fees (website dashboard tab and Partner app › More). */
export function OwnerFees({ mess }: { mess: OwnedMessDto }) {
  const [period, setPeriod] = useState(thisMonth());
  const q = useQuery({
    queryKey: ['owner-fees', mess.slug, period],
    queryFn: () => api.ownerFees(mess.slug, period),
  });
  if (q.isLoading) return <Skeleton className="h-48" />;
  if (q.isError || !q.data)
    return (
      <ErrorState title="Couldn't load your fees" message={friendly(q.error)} onRetry={() => q.refetch()} />
    );
  return <FeeStatement s={q.data} period={period} onPeriod={setPeriod} owner />;
}
