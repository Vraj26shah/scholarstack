import type { CourseEarningDto, EarningsDto } from '@ss/contracts';
import { DEFAULT_ROYALTY_PERCENT } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, friendly } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { Button } from '../../shared/ui/button';
import { Skeleton } from '../../shared/ui/feedback';
import { EarningsExtras } from './earnings-extras';
import { Field, Panel, StatusPill, U, input, plural } from './ui';

const KEY = ['admin', 'earnings'] as const;
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

function Figure({
  label,
  value,
  hint,
  tone = 'ink',
}: { label: string; value: string; hint: string; tone?: 'ink' | 'teal' | 'marigold' }) {
  return (
    <div className="flex flex-col gap-1 bg-surface px-4 py-3.5 min-w-0">
      <span className="font-mono text-[11px] tracking-[0.06em] text-ink2">{label.toUpperCase()}</span>
      <span
        className={`font-display font-extrabold text-[30px] leading-none tracking-[-0.03em] tabular-nums ${
          tone === 'teal' ? 'text-teal-text' : tone === 'marigold' ? 'text-marigold-text' : 'text-ink'
        }`}
      >
        {value}
      </span>
      <span className="text-[12px] text-ink2">{hint}</span>
    </div>
  );
}

/** Give a student a share of a course, record a payment to them, or end the royalty. */
function RoyaltyEditor({ c, onDone }: { c: CourseEarningDto; onDone: () => void }) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: KEY });
  const r = c.royalty;
  const [email, setEmail] = useState(r?.email ?? '');
  const [share, setShare] = useState(String(r?.sharePercent ?? DEFAULT_ROYALTY_PERCENT));
  const [amount, setAmount] = useState(r ? String(Math.floor(r.owedPaise / 100)) : '');
  const [note, setNote] = useState('');
  const [ending, setEnding] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      api.adminSetRoyalty({ courseId: c.courseId, email: email.trim(), sharePercent: Number(share) }),
    onSuccess: refresh,
  });
  const payout = useMutation({
    mutationFn: () => api.adminRecordPayout({ courseId: c.courseId, amountRupees: Number(amount), note }),
    onSuccess: () => {
      setNote('');
      refresh();
    },
  });
  const end = useMutation({ mutationFn: () => api.adminRemoveRoyalty(c.courseId), onSuccess: refresh });
  const error = save.error ?? payout.error ?? end.error;
  return (
    <div className="flex flex-col gap-4 rounded-xl bg-sunk p-4">
      {r && (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[14px] text-ink2">
            Pay {r.name ?? r.email} by UPI first, then record it here. They see what's been paid on their
            Contribute page.
          </p>
          <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)_auto] items-end">
            <Field label="Paid (₹)">
              <input
                className={input}
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <Field label="Note (UPI reference)">
              <input
                className={input}
                value={note}
                maxLength={300}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            <Button onClick={() => payout.mutate()} disabled={payout.isPending || !(Number(amount) >= 1)}>
              {payout.isPending ? 'Saving…' : 'Record payment'}
            </Button>
          </div>
          {payout.isSuccess && <p className="m-0 text-[13px] text-teal-text">Payment recorded.</p>}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px_auto] items-end">
        <Field label={r ? 'Royalty goes to' : 'Give a royalty to (college email)'}>
          <input
            className={input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name.23bce10001@vitbhopal.ac.in"
          />
        </Field>
        <Field label="Share (%)">
          <input
            className={input}
            inputMode="numeric"
            value={share}
            onChange={(e) => setShare(e.target.value.replace(/\D/g, '').slice(0, 2))}
          />
        </Field>
        <Button
          variant="outline"
          onClick={() => save.mutate()}
          disabled={save.isPending || !email.includes('@') || !(Number(share) >= 1)}
        >
          {save.isPending ? 'Saving…' : r ? 'Update' : 'Start royalty'}
        </Button>
      </div>
      {!r && (
        <p className="m-0 text-[13px] text-ink2">
          Sales from now on count towards it. The student must have signed in once.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {r &&
          (ending ? (
            <>
              <Button size="sm" variant="ink" onClick={() => end.mutate()} disabled={end.isPending}>
                Yes, end the royalty
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEnding(false)}>
                Keep it
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setEnding(true)}>
              End royalty
            </Button>
          ))}
        <Button size="sm" variant="ghost" onClick={onDone}>
          Close
        </Button>
      </div>
      {error && <p className="m-0 text-sm text-blush-text">{friendly(error)}</p>}
    </div>
  );
}

function CourseRow({ c }: { c: CourseEarningDto }) {
  const [open, setOpen] = useState(false);
  const r = c.royalty;
  return (
    <li className="rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)] p-4 flex flex-col gap-3 min-w-0">
      <div className="grid gap-3 md:grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,0.8fr))_minmax(0,1.6fr)] md:items-center">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={c.status} />
            <span className="font-mono text-[12px] text-ink2">{formatMoney(c.pricePaise)}</span>
          </div>
          <span className="font-semibold text-[15px] [overflow-wrap:anywhere]">{c.title}</span>
          <span className="text-[12px] text-ink2">Last sale {day(c.lastSaleAt)}</span>
        </div>
        {(
          [
            ['Sold', String(c.sales)],
            ['Buyers', String(c.buyers)],
            ['Free', String(c.freeAccess)],
            ['Earned', formatMoney(c.revenuePaise)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="flex md:flex-col items-baseline md:items-start justify-between gap-1">
            <span className="text-[12px] font-semibold text-ink2 md:hidden">{label}</span>
            <span className={`tabular-nums text-[16px] ${label === 'Earned' ? 'font-semibold' : ''}`}>
              {value}
            </span>
          </div>
        ))}
        <div className="flex flex-col gap-1.5 min-w-0">
          {r ? (
            <>
              <span className="text-[13px] [overflow-wrap:anywhere]">
                <strong>{r.sharePercent}%</strong> to {r.name ?? r.email}
              </span>
              <span className="text-[12px] text-ink2 tabular-nums">
                Earned {formatMoney(r.earnedPaise)} · paid {formatMoney(r.paidPaise)}
              </span>
              <span
                className={`text-[13px] font-semibold tabular-nums ${r.owedPaise ? 'text-marigold-text' : 'text-teal-text'}`}
              >
                {r.owedPaise ? `Owe ${formatMoney(r.owedPaise)}` : 'All paid'}
              </span>
            </>
          ) : (
            <span className="text-[13px] text-ink2">No royalty</span>
          )}
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            {r ? 'Pay or change' : 'Give royalty'}
          </Button>
        </div>
      </div>
      {open && <RoyaltyEditor c={c} onDone={() => setOpen(false)} />}
    </li>
  );
}

type Show = 'all' | 'sold' | 'royalty' | 'owed';

/** What each course has earned, who bought it, and what is owed to contributors. */
export function EarningsPanel() {
  const q = useQuery({ queryKey: KEY, queryFn: api.adminEarnings, refetchInterval: 60_000 });
  const [show, setShow] = useState<Show>('sold');
  const [search, setSearch] = useState('');
  const data: EarningsDto | undefined = q.data;
  const rows = useMemo(
    () =>
      (data?.courses ?? [])
        .filter((c) =>
          show === 'sold'
            ? c.sales > 0
            : show === 'royalty'
              ? !!c.royalty
              : show === 'owed'
                ? !!c.royalty?.owedPaise
                : true,
        )
        .filter((c) => c.title.toLowerCase().includes(search.trim().toLowerCase())),
    [data, show, search],
  );
  return (
    <Panel
      title="Earnings & royalties"
      aside={
        <Button variant="outline" onClick={() => void q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? 'Counting…' : 'Refresh'}
        </Button>
      }
    >
      {q.isError && <p className="m-0 text-sm text-blush-text">{friendly(q.error)}</p>}
      {!data && !q.isError && <Skeleton className="h-28 rounded-2xl" />}
      {data && (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-px overflow-hidden rounded-2xl bg-line shadow-[0_0_0_1px_var(--line)]">
            <Figure
              label="Earned"
              value={formatMoney(data.totals.revenuePaise)}
              hint="paid orders, all time"
            />
            <Figure label="Paid orders" value={String(data.totals.sales)} hint="courses and bundles" />
            <Figure
              label="Paying students"
              value={String(data.totals.buyers)}
              hint="different people who paid"
            />
            <Figure
              label="Owed to contributors"
              value={formatMoney(data.totals.royaltyOwedPaise + data.totals.cashOwedPaise)}
              hint={`${formatMoney(data.totals.royaltyPaidPaise)} paid so far`}
              tone={data.totals.royaltyOwedPaise + data.totals.cashOwedPaise ? 'marigold' : 'teal'}
            />
          </section>
          <p className="m-0 text-[13px] text-ink2">
            A bundle's payment is shared between its courses by their prices, so every rupee is counted once.
            Amounts are what students paid, before Razorpay's fee. "Free" is access you gave without payment.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ['sold', 'Sold at least once'],
                ['royalty', 'With a royalty'],
                ['owed', 'Money owed'],
                ['all', 'All courses'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={show === k}
                onClick={() => setShow(k)}
                className={`h-9 rounded-full px-3.5 text-sm font-semibold border ${show === k ? 'bg-brand text-white border-brand' : 'border-line text-ink2'}`}
              >
                {label}
              </button>
            ))}
            <input
              className={`${input} h-9 ml-auto w-full sm:w-64`}
              placeholder="Find a course"
              aria-label="Find a course"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div
            aria-hidden="true"
            className="hidden md:grid grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,0.8fr))_minmax(0,1.6fr)] gap-3 px-4 font-mono text-[11px] text-ink2"
          >
            <span>COURSE</span>
            <span>SOLD</span>
            <span>BUYERS</span>
            <span>FREE</span>
            <span>EARNED</span>
            <span>ROYALTY</span>
          </div>
          {search.trim() && rows.length > 0 && (
            <p className="m-0 text-[15px]" role="status">
              <U>{formatMoney(rows.reduce((t, c) => t + c.revenuePaise, 0))}</U> earned from{' '}
              {rows.length === 1 ? rows[0]!.title : `${rows.length} matching courses`},{' '}
              {rows.reduce((t, c) => t + c.sales, 0)} sales.
            </p>
          )}
          {rows.length === 0 ? (
            <p className="m-0 rounded-2xl bg-card p-5 text-ink2 shadow-[0_0_0_1px_var(--line)]">
              {show === 'sold' ? 'No sales yet.' : 'Nothing matches.'}
            </p>
          ) : (
            <ul className="m-0 p-0 list-none flex flex-col gap-3">
              {rows.map((c) => (
                <CourseRow key={c.courseId} c={c} />
              ))}
            </ul>
          )}
          <EarningsExtras data={data} />
          {data.payouts.length > 0 && (
            <section className="flex flex-col gap-3 pt-4">
              <h3 className="m-0 font-display font-extrabold text-[22px] tracking-[-0.03em]">
                Payments to contributors
              </h3>
              <ul className="m-0 p-0 list-none flex flex-col divide-y divide-line rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)]">
                {data.payouts.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 text-[14px]"
                  >
                    <span className="font-semibold tabular-nums">{formatMoney(p.amountPaise)}</span>
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      {p.email} · {p.courseTitle}
                    </span>
                    <span className="text-ink2 text-[13px]">
                      {day(p.paidAt)}
                      {p.note ? ` · ${p.note}` : ''} · by {p.recordedBy}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="m-0 text-[12px] text-ink2">
            {plural(data.courses.length, 'course')} in the catalogue.
          </p>
        </>
      )}
    </Panel>
  );
}
