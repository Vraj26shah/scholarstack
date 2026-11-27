import type { OwnerSaleDto } from '@ss/contracts';
import { useState } from 'react';
import { rupees } from './shared';

const time = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });

export interface SalesWords {
  title: string;
  none: string;
  more: string;
  upi: string;
  tiffin: string;
  notCollected: string;
  delivery: string;
  pickup: string;
  /** "Showing the latest {n}…" */
  latest: string;
}

export const SALES_EN: SalesWords = {
  title: 'Every sale',
  none: 'No sales in this period yet.',
  more: 'Show all',
  upi: 'Paid by UPI',
  tiffin: 'Tiffin',
  notCollected: 'Not collected (paid)',
  delivery: 'Delivery',
  pickup: 'Pickup',
  latest: 'Showing the latest {n}. Pick a shorter period to see the rest.',
};

/**
 * Every sale in the period, newest first: when, the order code, who, what, and the amount the
 * restaurant gets (after any offer), so every rupee in the totals can be matched to an order.
 */
export function SalesList({
  sales,
  count,
  revenue,
  words = SALES_EN,
  big = false,
}: {
  sales: OwnerSaleDto[];
  /** The period's real totals (the list holds the latest 300 at most). */
  count: number;
  revenue: number;
  words?: SalesWords;
  big?: boolean;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? sales : sales.slice(0, 20);
  return (
    <section className="flex flex-col gap-2">
      <h3
        className={`m-0 flex flex-wrap items-baseline justify-between gap-2 font-bold ${big ? 'text-[19px]' : 'text-[15px]'}`}
      >
        <span>
          {words.title} · {count}
        </span>
        <span className="tabular-nums">{rupees(revenue)}</span>
      </h3>
      {count > sales.length && (
        <p className="m-0 text-[12.5px] text-ink2">{words.latest.replace('{n}', String(sales.length))}</p>
      )}
      {sales.length === 0 ? (
        <p className="m-0 text-[14px] text-ink2">{words.none}</p>
      ) : (
        <ul className="m-0 p-0 list-none divide-y divide-line rounded-2xl bg-surface px-4 shadow-[0_0_0_1px_var(--line)]">
          {shown.map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-3 py-3">
              <span className="min-w-0 flex flex-col gap-0.5">
                <span className={`font-semibold text-ink ${big ? 'text-[16px]' : 'text-[14.5px]'}`}>
                  <span className="font-mono text-ink2">#{s.code}</span> · {s.name}
                </span>
                <span className="text-[13px] text-ink2 [overflow-wrap:anywhere]">{s.items}</span>
                <span className="flex flex-wrap gap-1.5 text-[12px]">
                  <span className="text-ink2">
                    {time(s.at)} · {s.mode === 'delivery' ? words.delivery : words.pickup}
                  </span>
                  {s.paidUpi && (
                    <span className="rounded-full bg-teal/10 px-2 font-semibold text-teal-text">
                      {words.upi}
                    </span>
                  )}
                  {s.tiffin && (
                    <span className="rounded-full bg-marigold-soft px-2 font-semibold text-marigold-text">
                      {words.tiffin}
                    </span>
                  )}
                  {s.offer && (
                    <span className="rounded-full bg-sunk px-2 font-semibold text-ink2">🏷️ {s.offer}</span>
                  )}
                  {s.notCollected && (
                    <span className="rounded-full bg-blush/40 px-2 font-semibold text-blush-text">
                      {words.notCollected}
                    </span>
                  )}
                </span>
              </span>
              <span
                className={`flex-none font-bold tabular-nums text-ink ${big ? 'text-[18px]' : 'text-[15px]'}`}
              >
                {rupees(s.total)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!all && sales.length > 20 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="self-start border-0 bg-transparent p-0 text-[14px] font-semibold text-teal-text underline underline-offset-4 cursor-pointer"
        >
          {words.more} ({sales.length})
        </button>
      )}
    </section>
  );
}
