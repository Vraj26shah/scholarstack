import type { DiscountReportDto, PromoCreatorDto } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { Button } from '../../shared/ui/button';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { OrdersList, downloadCsv } from './discount-orders';
import { Field, Figure, Panel, input, plural } from './ui';

type Days = '7' | '30' | '90' | 'all';
const PERIODS: [Days, string][] = [
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
  ['all', 'All time'],
];
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '0%');
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Record money paid to a creator; never more than they are owed. */
function PayCreator({ c, onDone }: { c: PromoCreatorDto; onDone: () => void }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(String(Math.floor(c.owedPaise / 100)));
  const [note, setNote] = useState('');
  const paise = Math.round(Number(amount) * 100);
  const pay = useMutation({
    mutationFn: () => api.adminAddPromoPayout({ creatorName: c.name, amountPaise: paise, note: note.trim() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-discounts'] });
      onDone();
    },
  });
  const ok = Number.isFinite(paise) && paise >= 100 && paise <= c.owedPaise;
  return (
    <div className="flex flex-col gap-2 pt-1">
      <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)_auto] items-end">
        <Field label="Paid (₹)">
          <input
            className={`${input} font-mono`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
          />
        </Field>
        <Field label="Note (optional)">
          <input
            className={input}
            maxLength={200}
            placeholder="UPI ref, date…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <div className="flex gap-2">
          <Button disabled={!ok || pay.isPending} onClick={() => pay.mutate()}>
            {pay.isPending ? 'Saving…' : 'Record payment'}
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </div>
      {!ok && amount !== '' && (
        <p className="m-0 text-[13px] text-ink2">Between ₹1 and {formatMoney(c.owedPaise)}.</p>
      )}
      {pay.isError && <p className="m-0 text-sm text-blush-text">{friendly(pay.error)}</p>}
    </div>
  );
}

function CreatorRow({ c }: { c: PromoCreatorDto }) {
  const [paying, setPaying] = useState(false);
  return (
    <li className="px-4 py-3 flex flex-col gap-2">
      <div className="grid gap-x-4 gap-y-1 text-[14px] md:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,0.8fr))_auto] md:items-center">
        <span className="flex flex-col min-w-0">
          <span className="font-semibold [overflow-wrap:anywhere]">{c.name}</span>
          <span className="text-[12px] text-ink2 [overflow-wrap:anywhere]">
            {c.contact ? `${c.contact} · ` : ''}
            <span className="font-mono">{c.codes.join(', ')}</span>
          </span>
        </span>
        {(
          [
            ['Used', String(c.uses)],
            ['Their sales', formatMoney(c.salesPaise)],
            ['Earned', formatMoney(c.earnedPaise)],
            ['Paid', formatMoney(c.paidPaise)],
          ] as const
        ).map(([label, value]) => (
          <span key={label} className="flex md:flex-col items-baseline md:items-start justify-between gap-1">
            <span className="text-[12px] font-semibold text-ink2">{label}</span>
            <span className="tabular-nums">{value}</span>
          </span>
        ))}
        <span className="flex items-center gap-3 md:justify-end">
          <span
            className={`text-[14px] font-semibold tabular-nums ${c.owedPaise ? 'text-marigold-text' : 'text-teal-text'}`}
          >
            {c.owedPaise ? `Owe ${formatMoney(c.owedPaise)}` : 'All paid'}
          </span>
          {c.owedPaise > 0 && !paying && (
            <Button size="sm" variant="outline" onClick={() => setPaying(true)}>
              Pay
            </Button>
          )}
        </span>
      </div>
      {paying && <PayCreator c={c} onDone={() => setPaying(false)} />}
    </li>
  );
}

function Report({ data, days }: { data: DiscountReportDto; days: Days }) {
  const t = data.totals;
  const owed = data.creators.reduce((s, c) => s + c.owedPaise, 0);
  return (
    <>
      <section
        aria-label="Totals"
        className="grid grid-cols-2 lg:grid-cols-5 gap-px overflow-hidden rounded-2xl bg-line shadow-[0_0_0_1px_var(--line)] [&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1"
      >
        <Figure
          label="Students who bought"
          value={String(t.buyers)}
          hint={`${plural(t.paidOrders, 'paid order')} · ${formatMoney(t.revenuePaise)} in`}
        />
        <Figure
          label="Used a promo code"
          value={String(t.promoBuyers)}
          hint={`${pct(t.promoOrders, t.paidOrders)} of orders (${t.promoOrders})`}
          tone="teal"
        />
        <Figure
          label="Got an offer price"
          value={String(t.offerBuyers)}
          hint={`${pct(t.offerOrders, t.paidOrders)} of orders (${t.offerOrders})`}
          tone="teal"
        />
        <Figure
          label="Paid full price"
          value={String(t.fullPriceBuyers)}
          hint={`${pct(t.fullPriceOrders, t.paidOrders)} of orders · no offer, no code`}
        />
        <Figure
          label="Discounts given"
          value={formatMoney(t.discountPaise)}
          hint={`creators earned ${formatMoney(t.commissionPaise)}`}
          tone="marigold"
        />
      </section>

      <section className="flex flex-col gap-3 pt-2" aria-labelledby="creators-h">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="creators-h" className="m-0 font-display font-extrabold text-[22px] tracking-[-0.03em]">
            Promo code creators
          </h3>
          {data.creators.length > 0 && (
            <span className={`text-[14px] font-semibold ${owed ? 'text-marigold-text' : 'text-teal-text'}`}>
              {owed ? `You owe ${formatMoney(owed)} in total` : 'Everyone is paid'}
            </span>
          )}
        </div>
        {data.creators.length === 0 ? (
          <p className="m-0 text-[14px] text-ink2">
            No creators yet. Give a promo code a creator and a commission in Courses › Promo codes, and what
            they earn shows here.
          </p>
        ) : (
          <ul className="m-0 p-0 list-none flex flex-col divide-y divide-line rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)]">
            {data.creators.map((c) => (
              <CreatorRow key={c.name} c={c} />
            ))}
          </ul>
        )}
        <p className="m-0 text-[12px] text-ink2">
          Creator totals are all time. A commission is worked out when each order is placed, from what the
          student paid, so changing a rate later only affects new orders.
        </p>
        {data.payouts.length > 0 && (
          <details className="text-[14px]">
            <summary className="cursor-pointer text-ink2">Payments made ({data.payouts.length})</summary>
            <ul className="m-0 mt-2 p-0 list-none flex flex-col divide-y divide-line rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)]">
              {data.payouts.map((p) => (
                <li key={p.id} className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2.5">
                  <span className="font-mono text-[12px] text-ink2">{day(p.paidAt)}</span>
                  <span className="font-semibold">{p.creatorName}</span>
                  <span className="tabular-nums">{formatMoney(p.amountPaise)}</span>
                  {p.note && <span className="text-ink2">{p.note}</span>}
                  {p.recordedBy && <span className="text-[12px] text-ink2">by {p.recordedBy}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="flex flex-col gap-3 pt-2" aria-labelledby="orders-h">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="orders-h" className="m-0 font-display font-extrabold text-[22px] tracking-[-0.03em]">
            Every paid order
          </h3>
          {data.orders.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                downloadCsv(data.orders, `orders-${days === 'all' ? 'all-time' : `last-${days}-days`}`)
              }
            >
              Download as spreadsheet (CSV)
            </Button>
          )}
        </div>
        <OrdersList orders={data.orders} empty="No paid orders in this period." searchable />
        {data.ordersTruncated && (
          <p className="m-0 text-[12px] text-ink2">
            Showing the newest 500. Pick a shorter period to see the rest.
          </p>
        )}
      </section>
    </>
  );
}

/**
 * Money › Discounts: how many students used a promo code, got an offer price or paid full price;
 * every paid order with its student; and what each promo code's creator is owed.
 */
export function DiscountsPanel() {
  const [days, setDays] = useState<Days>('30');
  const q = useQuery({ queryKey: ['admin-discounts', days], queryFn: () => api.adminDiscounts(days) });
  return (
    <Panel
      title="Discounts"
      aside={
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Period">
          {PERIODS.map(([d, label]) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={days === d}
              onClick={() => setDays(d)}
              className={`h-9 rounded-full px-3.5 text-[13px] font-semibold border cursor-pointer ${
                days === d ? 'bg-brand text-white border-brand' : 'border-line text-ink2 hover:text-ink'
              }`}
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
        <ErrorState
          title="The discount report didn't load."
          message={friendly(q.error)}
          onRetry={() => q.refetch()}
        />
      ) : q.data ? (
        <Report data={q.data} days={days} />
      ) : null}
    </Panel>
  );
}
