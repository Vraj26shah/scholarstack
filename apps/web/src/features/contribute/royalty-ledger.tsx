import type { MyRoyaltyDto } from '@ss/contracts';
import { formatMoney } from '../../lib/format';

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** The contributor's own ledger: per course, sales since it started, earned, paid and still due. */
export function RoyaltyLedger({ items }: { items: MyRoyaltyDto[] }) {
  const due = items.reduce((t, r) => t + r.owedPaise, 0);
  const earned = items.reduce((t, r) => t + r.earnedPaise, 0);
  return (
    <section
      aria-labelledby="ledger-title"
      className="rounded-[18px] bg-brand text-white p-5 sm:p-7 flex flex-col gap-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[12px] text-on-brand2">YOUR ROYALTIES</span>
          <h2
            id="ledger-title"
            className="m-0 font-display font-extrabold text-[30px] leading-none tracking-[-0.04em]"
          >
            What your notes have earned
          </h2>
        </div>
        <div className="flex gap-6">
          <span className="flex flex-col">
            <span className="font-mono text-[11px] text-on-brand2">EARNED</span>
            <span className="font-display font-extrabold text-[30px] leading-none tabular-nums">
              {formatMoney(earned)}
            </span>
          </span>
          <span className="flex flex-col">
            <span className="font-mono text-[11px] text-on-brand2">DUE TO YOU</span>
            <span className="font-display font-extrabold text-[30px] leading-none tabular-nums text-mist">
              {formatMoney(due)}
            </span>
          </span>
        </div>
      </div>
      <ul className="m-0 p-0 list-none flex flex-col divide-y divide-white/15 rounded-[14px] bg-white/[0.06]">
        {items.map((r) => (
          <li
            key={r.courseId}
            className="grid gap-2 px-4 py-3.5 sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] sm:items-center"
          >
            <span className="flex flex-col min-w-0">
              <span className="font-semibold [overflow-wrap:anywhere]">{r.courseTitle}</span>
              <span className="text-[12px] text-on-brand2">
                {r.sharePercent}% since {day(r.since)}
              </span>
            </span>
            <span className="text-[14px] tabular-nums">
              <span className="text-on-brand2 sm:hidden">Sold </span>
              {r.sales} sold
            </span>
            <span className="text-[14px] tabular-nums">
              <span className="text-on-brand2">Paid </span>
              {formatMoney(r.paidPaise)}
            </span>
            <span className="text-[14px] font-semibold tabular-nums text-mist">
              <span className="text-on-brand2 font-normal">Due </span>
              {formatMoney(r.owedPaise)}
            </span>
          </li>
        ))}
      </ul>
      <p className="m-0 text-[13px] text-on-brand2">Counted on what students paid; paid to you by UPI.</p>
    </section>
  );
}
