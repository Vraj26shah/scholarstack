import type { CashRewardDto, EarningsDto, TopContributorDto } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { formatMoney } from '../../lib/format';
import { Button } from '../../shared/ui/button';
import { U, input } from './ui';

const KEY = ['admin', 'earnings'] as const;
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

function RewardRow({ r }: { r: CashRewardDto }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const paid = useMutation({
    mutationFn: () => api.adminRewardPaid(r.contributionId, note),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="font-semibold tabular-nums w-20">₹{r.amountRupees.toLocaleString('en-IN')}</span>
      <span className="flex-1 min-w-[200px] text-[14px] [overflow-wrap:anywhere]">
        <strong>{r.name ?? r.email}</strong> · “{r.title}”
        <span className="block text-[12px] text-ink2">
          {r.paidAt
            ? `Paid ${day(r.paidAt)}${r.note ? ` · ${r.note}` : ''}`
            : `Accepted ${day(r.approvedAt)} · ${r.email}`}
        </span>
      </span>
      {!r.paidAt && (
        <span className="flex flex-wrap items-center gap-2">
          <input
            className={`${input} h-9 w-44`}
            placeholder="UPI reference"
            aria-label={`UPI reference for ${r.title}`}
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button size="sm" onClick={() => paid.mutate()} disabled={paid.isPending}>
            Mark paid
          </Button>
        </span>
      )}
      {paid.isError && <span className="w-full text-sm text-blush-text">{friendly(paid.error)}</span>}
    </li>
  );
}

function TopRow({ t, i, year }: { t: TopContributorDto; i: number; year: number }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<'cash' | 'gift'>('cash');
  const [amount, setAmount] = useState(String(Math.ceil(t.bonusPaise / 100)));
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const perk = useMutation({
    mutationFn: () =>
      api.adminRecordBonus({ userId: t.contributorId, year, kind, amountRupees: Number(amount) || 0, note }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
  const ok = kind === 'cash' ? Number(amount) >= 1 : note.trim().length >= 2;
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`font-display font-extrabold text-[26px] leading-none w-8 ${i === 0 ? 'text-teal-text' : 'text-ink2'}`}
        >
          {i + 1}
        </span>
        <span className="flex-1 min-w-[200px] text-[14px] [overflow-wrap:anywhere]">
          <strong>{t.name ?? t.email}</strong>
          <span className="block text-[12px] text-ink2">
            {t.sales} sales across {t.courses} course{t.courses === 1 ? '' : 's'} · earned{' '}
            {formatMoney(t.earnedPaise)}
          </span>
        </span>
        {t.perk ? (
          <span className="text-[13px] font-semibold text-teal-text">
            {t.perk.kind === 'gift'
              ? `Gift: ${t.perk.note}`
              : `Bonus ${formatMoney(t.perk.amountPaise)} paid`}{' '}
            · {day(t.bonusPaidAt)}
          </span>
        ) : (
          <Button
            size="sm"
            variant={i === 0 ? 'brand' : 'outline'}
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            {i === 0 ? `Give the bonus (${formatMoney(t.bonusPaise)})` : 'Give a perk'}
          </Button>
        )}
      </div>
      {open && !t.perk && (
        <div className="flex flex-wrap items-end gap-2 pl-11">
          <select
            aria-label="Perk"
            className={`${input} h-9 w-36`}
            value={kind}
            onChange={(e) => setKind(e.target.value as 'cash' | 'gift')}
          >
            <option value="cash">Cash (UPI)</option>
            <option value="gift">A gift or prize</option>
          </select>
          {kind === 'cash' && (
            <input
              className={`${input} h-9 w-28`}
              inputMode="numeric"
              aria-label="Amount in rupees"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
            />
          )}
          <input
            className={`${input} h-9 w-64`}
            placeholder={kind === 'cash' ? 'UPI reference' : 'What it was, e.g. headphones'}
            aria-label={kind === 'cash' ? 'UPI reference' : 'What the gift was'}
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button size="sm" disabled={!ok || perk.isPending} onClick={() => perk.mutate()}>
            Record it
          </Button>
        </div>
      )}
      {perk.isError && <span className="text-sm text-blush-text">{friendly(perk.error)}</span>}
    </li>
  );
}

/** The year's top partners, with their bonus or a perk (cash or a gift), recorded once a year. */
export function PartnerMoney() {
  const q = useQuery({ queryKey: KEY, queryFn: api.adminEarnings });
  const data = q.data;
  if (!data) return q.isError ? <p className="m-0 text-sm text-blush-text">{friendly(q.error)}</p> : null;
  return (
    <>
      <section className="flex flex-col gap-3 pt-4">
        <h3 className="m-0 font-display font-extrabold text-[22px] tracking-[-0.03em]">
          Top contributors, last 12 months
        </h3>
        <p className="m-0 text-[14px] text-ink2">
          The year's top contributor gets <U>25% extra, up to ₹10,000</U>. One perk per person a year.
        </p>
        {data.topContributors.length === 0 ? (
          <p className="m-0 text-[14px] text-ink2">No royalty sales in the last 12 months yet.</p>
        ) : (
          <ol className="m-0 p-0 list-none flex flex-col divide-y divide-line rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)]">
            {data.topContributors.map((t, i) => (
              <TopRow key={t.contributorId} t={t} i={i} year={data.bonusYear} />
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

/** Cash rewards still to pay, and every payment made to a partner. */
export function PartnerPayments({ data }: { data: EarningsDto }) {
  return (
    <>
      <section className="flex flex-col gap-3 pt-4">
        <h3 className="m-0 font-display font-extrabold text-[22px] tracking-[-0.03em]">Cash rewards</h3>
        {data.cashRewards.length === 0 ? (
          <p className="m-0 text-[14px] text-ink2">
            None yet. Accept an upload with a <U>Cash</U> reward and it shows here until you mark it paid.
          </p>
        ) : (
          <ul className="m-0 p-0 list-none flex flex-col divide-y divide-line rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)]">
            {data.cashRewards.map((r) => (
              <RewardRow key={r.contributionId} r={r} />
            ))}
          </ul>
        )}
      </section>
      {data.payouts.length > 0 && (
        <section className="flex flex-col gap-3 pt-4">
          <h3 className="m-0 font-display font-extrabold text-[22px] tracking-[-0.03em]">
            Payments to contributors
          </h3>
          <ul className="m-0 p-0 list-none flex flex-col divide-y divide-line rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)]">
            {data.payouts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 text-[14px]">
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
    </>
  );
}
