import type { DiscountOrderDto } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { friendly } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { Button } from '../../shared/ui/button';
import { Skeleton } from '../../shared/ui/feedback';
import { input } from './ui';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/** Where an order's discount came from, in words. */
export const discountSource = (o: DiscountOrderDto) =>
  o.offer && o.promo
    ? `${o.offer.title} + code ${o.promo.code}`
    : o.offer
      ? o.offer.title
      : o.promo
        ? `Code ${o.promo.code}`
        : 'Full price';

/** A spreadsheet of these orders, for the admin's own records or for paying a creator. */
export function downloadCsv(orders: DiscountOrderDto[], name: string) {
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rupees = (p: number) => (p / 100).toFixed(2);
  const rows = [
    [
      'Paid at',
      'Student',
      'Email',
      'Bought',
      'Course or bundle',
      'Price before discounts (₹)',
      'Paid (₹)',
      'Offer',
      'Offer saved (₹)',
      'Promo code',
      'Code saved (₹)',
      'Creator',
      'Creator commission (₹)',
    ],
    ...orders.map((o) => [
      new Date(o.paidAt).toISOString(),
      o.studentName,
      o.studentEmail,
      o.itemKind,
      o.itemTitle,
      rupees(o.fullPaise),
      rupees(o.amountPaise),
      o.offer?.title ?? '',
      o.offer ? rupees(o.offer.discountPaise) : '',
      o.promo?.code ?? '',
      o.promo ? rupees(o.promo.discountPaise) : '',
      o.promo?.creatorName ?? '',
      o.promo ? rupees(o.promo.commissionPaise) : '',
    ]),
  ];
  const csv = `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Paid orders, one row each: when, who, what, the price before and after, and why it was lower. */
export function OrdersList({
  orders,
  empty,
  searchable = false,
}: { orders: DiscountOrderDto[]; empty: string; searchable?: boolean }) {
  const [q, setQ] = useState('');
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = words.length
    ? orders.filter((o) =>
        words.every((w) =>
          [o.studentName ?? '', o.studentEmail, o.itemTitle, discountSource(o), o.promo?.creatorName ?? '']
            .join(' ')
            .toLowerCase()
            .includes(w),
        ),
      )
    : orders;
  return (
    <div className="flex flex-col gap-2">
      {searchable && orders.length > 0 && (
        <input
          type="search"
          aria-label="Search orders"
          placeholder="Search by student, email, course, offer or code"
          className={`${input} h-10 text-sm sm:w-96`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      {shown.length === 0 ? (
        <p className="m-0 text-[14px] text-ink2">{orders.length ? 'No order matches that search.' : empty}</p>
      ) : (
        <ul
          aria-label="Paid orders"
          className="m-0 p-0 list-none flex flex-col divide-y divide-line rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)]"
        >
          {shown.map((o) => {
            const saved = o.fullPaise - o.amountPaise;
            return (
              <li
                key={o.orderId}
                className="grid gap-x-4 gap-y-1 px-4 py-3 text-[14px] md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1.3fr)_auto] md:items-center"
              >
                <span className="flex flex-col min-w-0">
                  <span className="font-semibold [overflow-wrap:anywhere]">
                    {o.studentName || o.studentEmail}
                  </span>
                  {o.studentName && (
                    <span className="text-[12px] text-ink2 [overflow-wrap:anywhere]">{o.studentEmail}</span>
                  )}
                </span>
                <span className="flex flex-col min-w-0">
                  <span className="[overflow-wrap:anywhere]">{o.itemTitle}</span>
                  <span className="font-mono text-[11px] text-ink2">
                    {o.itemKind} · {when(o.paidAt)}
                  </span>
                </span>
                <span className="flex flex-wrap gap-1.5 min-w-0">
                  {o.offer && (
                    <span className="inline-flex items-center h-6 px-2 rounded-md bg-marigold-soft text-marigold-text text-[12px] font-semibold">
                      {o.offer.title} · −{formatMoney(o.offer.discountPaise)}
                    </span>
                  )}
                  {o.promo && (
                    <span
                      className="inline-flex items-center h-6 px-2 rounded-md bg-mist text-on-mist text-[12px] font-semibold"
                      title={
                        o.promo.creatorName
                          ? `${o.promo.creatorName} earns ${formatMoney(o.promo.commissionPaise)}`
                          : undefined
                      }
                    >
                      <span className="font-mono">{o.promo.code}</span>&nbsp;· −
                      {formatMoney(o.promo.discountPaise)}
                    </span>
                  )}
                  {!o.offer && !o.promo && <span className="text-[12px] text-ink2">Full price</span>}
                </span>
                <span className="flex md:flex-col items-baseline md:items-end gap-2 md:gap-0 tabular-nums">
                  <span className="font-semibold">{formatMoney(o.amountPaise)}</span>
                  {saved > 0 && (
                    <span className="text-[12px] text-ink2 line-through">{formatMoney(o.fullPaise)}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * "Students who used it" under an offer or a code: loaded only when opened, so the list screen
 * stays quick. A failure shows here with a retry and never touches the rest of the screen.
 */
export function UsedBy({
  queryKey,
  load,
  count,
  csvName,
}: {
  queryKey: unknown[];
  load: () => Promise<DiscountOrderDto[]>;
  count: number;
  csvName: string;
}) {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey, queryFn: load, enabled: open });
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="ghost"
        size="sm"
        className="self-start !px-0 !h-auto text-teal-text hover:!bg-transparent"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? 'Hide the list' : `See who used it (${count} paid ${count === 1 ? 'order' : 'orders'})`}
      </Button>
      {open &&
        (q.isLoading ? (
          <Skeleton className="h-20 rounded-2xl" />
        ) : q.isError ? (
          <p className="m-0 text-sm text-blush-text">
            {friendly(q.error)}{' '}
            <button
              type="button"
              className="font-semibold underline bg-transparent border-0 p-0 cursor-pointer text-blush-text"
              onClick={() => q.refetch()}
            >
              Try again
            </button>
          </p>
        ) : (
          <>
            <OrdersList orders={q.data ?? []} empty="No paid orders yet." />
            {(q.data?.length ?? 0) > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => downloadCsv(q.data ?? [], csvName)}
              >
                Download as spreadsheet (CSV)
              </Button>
            )}
          </>
        ))}
    </div>
  );
}
