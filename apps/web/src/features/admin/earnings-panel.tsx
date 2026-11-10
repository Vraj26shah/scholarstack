import type { CourseEarningDto, EarningsDto } from '@ss/contracts';
import { DEFAULT_ROYALTY_PERCENT } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, friendly } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { Button } from '../../shared/ui/button';
import { Skeleton } from '../../shared/ui/feedback';
import { PartnerPayments } from './earnings-extras';
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
      <span className="font-mono text-[11px] tracking-[0.06em] text-ink2">{label}</span>
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
      <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,0.8fr))_minmax(0,1.6fr)] md:items-center">
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
            ['Free', String(c.freeAccess)],
            ['Money in', formatMoney(c.revenuePaise)],
            ['Fees + contributor', formatMoney(c.feesPaise + c.partnerPaise)],
            ['Left for us', formatMoney(c.profitPaise)],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="flex md:flex-col items-baseline md:items-start justify-between gap-1">
            <span className="text-[12px] font-semibold text-ink2 md:hidden">{label}</span>
            <span
              className={`tabular-nums text-[16px] ${
                label === 'Left for us'
                  ? `font-semibold ${c.profitPaise < 0 ? 'text-blush-text' : 'text-teal-text'}`
                  : ''
              }`}
            >
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
      {c.partnerUploads.length > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-ink2">
            {c.partnerUploads.length} contributor upload{c.partnerUploads.length === 1 ? '' : 's'} filed into
            this course
          </summary>
          <ul className="m-0 mt-2 pl-5 flex flex-col gap-1 text-ink2">
            {c.partnerUploads.map((u) => (
              <li key={u.contributionId}>
                <strong className="text-ink">{u.title}</strong> by {u.email} · {u.files} file
                {u.files === 1 ? '' : 's'} in{' '}
                <span className="font-mono text-[12px] break-all">{u.folder || 'the course folder'}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {c.profitPaise < 0 && (
        <p className="m-0 text-[13px] font-semibold text-blush-text">
          This course is losing money: contributors and fees cost more than it brought in. Check its royalty
          share or price.
        </p>
      )}
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
      title="Earnings"
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
          <section className="grid grid-cols-2 lg:grid-cols-5 gap-px overflow-hidden rounded-2xl bg-line shadow-[0_0_0_1px_var(--line)] [&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1">
            <Figure
              label="Money in"
              value={formatMoney(data.totals.revenuePaise)}
              hint={`${data.totals.sales} paid orders · ${data.totals.buyers} students`}
            />
            <Figure
              label="Payment fees"
              value={formatMoney(data.totals.feesPaise)}
              hint="the payment provider's cut"
            />
            <Figure
              label="Contributors earn"
              value={formatMoney(data.totals.partnerPaise)}
              hint="royalties and cash rewards"
            />
            <Figure
              label="Left for us"
              value={formatMoney(data.totals.profitPaise)}
              hint={`${data.totals.freeAccess} free accesses given (not counted)`}
              tone={data.totals.profitPaise < 0 ? 'marigold' : 'teal'}
            />
            <Figure
              label="Owed to contributors"
              value={formatMoney(data.totals.royaltyOwedPaise + data.totals.cashOwedPaise)}
              hint={`${formatMoney(data.totals.royaltyPaidPaise)} paid so far`}
              tone={data.totals.royaltyOwedPaise + data.totals.cashOwedPaise ? 'marigold' : 'teal'}
            />
          </section>
          <p className="m-0 text-[13px] text-ink2">
            "Left for us" is money in, minus fees and what contributors earn. Free access isn't a sale.
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
            className="hidden md:grid grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,0.8fr))_minmax(0,1.6fr)] gap-3 px-4 font-mono text-[11px] text-ink2"
          >
            <span>COURSE</span>
            <span>SOLD</span>
            <span>FREE</span>
            <span>Money in</span>
            <span>FEES + CONTRIBUTOR</span>
            <span>Left for us</span>
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
          <section className="flex flex-col gap-3 pt-4">
            <h3 className="m-0 font-display font-extrabold text-[22px] tracking-[-0.03em]">Bundles</h3>
            {data.bundles.length === 0 ? (
              <p className="m-0 text-[14px] text-ink2">No bundles yet.</p>
            ) : (
              <ul className="m-0 p-0 list-none flex flex-col divide-y divide-line rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)]">
                {data.bundles.map((b) => (
                  <li
                    key={b.bundleId}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[14px]"
                  >
                    <StatusPill status={b.status} />
                    <span className="flex-1 min-w-[180px] font-semibold">{b.title}</span>
                    <span className="tabular-nums">
                      {b.sales} sold · {b.buyers} buyer{b.buyers === 1 ? '' : 's'}
                    </span>
                    <span className="tabular-nums font-semibold">{formatMoney(b.revenuePaise)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="m-0 text-[12px] text-ink2">
              Bundle money is also counted in its courses above, split by price.
            </p>
          </section>
          <PartnerPayments data={data} />
          <p className="m-0 text-[13px] text-ink2">
            The year's top contributors and their perks are in <strong>Money › Contributors</strong>.
          </p>
          <p className="m-0 text-[12px] text-ink2">
            {plural(data.courses.length, 'course')} in the catalogue.
          </p>
        </>
      )}
    </Panel>
  );
}
