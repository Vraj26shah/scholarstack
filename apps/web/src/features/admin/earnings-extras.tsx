import type { CashRewardDto, EarningsDto, TopContributorDto } from '@ss/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
  const [note, setNote] = useState('');
  const bonus = useMutation({
    mutationFn: () =>
      api.adminRecordBonus({
        userId: t.contributorId,
        year,
        amountRupees: Math.ceil(t.bonusPaise / 100),
        note,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
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
      {i === 0 &&
        (t.bonusPaidAt ? (
          <span className="text-[13px] font-semibold text-teal-text">Bonus paid {day(t.bonusPaidAt)}</span>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[13px]">
              Bonus <U>{formatMoney(t.bonusPaise)}</U>
            </span>
            <input
              className={`${input} h-9 w-40`}
              placeholder="UPI reference"
              aria-label="UPI reference for the bonus"
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button size="sm" onClick={() => bonus.mutate()} disabled={bonus.isPending || t.bonusPaise < 100}>
              Mark bonus paid
            </Button>
          </span>
        ))}
      {bonus.isError && <span className="w-full text-sm text-blush-text">{friendly(bonus.error)}</span>}
    </li>
  );
}

/** Cash rewards still to pay, and the year's top contributors with their bonus. */
export function EarningsExtras({ data }: { data: EarningsDto }) {
  return (
    <>
      <section className="flex flex-col gap-3 pt-4">
        <h3 className="m-0 font-display font-extrabold text-[22px] tracking-[-0.03em]">
          Top contributors, last 12 months
        </h3>
        <p className="m-0 text-[14px] text-ink2">
          The year's top contributor gets <U>what they earned, once more</U> as a bonus. Pay by UPI, then mark
          it.
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
    </>
  );
}
