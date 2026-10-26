import type { MyContributionDto } from '@ss/contracts';
import { Link } from 'react-router-dom';
import { friendly } from '../../lib/api';
import { rewardText } from './rewards';
import { KIND_LABEL, formatBytes } from './rules';
import { useWithdrawContribution } from './use-contributions';

const STAMP: Record<MyContributionDto['status'], { label: string; tone: string }> = {
  pending: { label: 'IN REVIEW', tone: 'border-marigold-text text-marigold-text' },
  approved: { label: 'ACCEPTED', tone: 'border-teal-text text-teal-text' },
  rejected: { label: 'NOT USED', tone: 'border-ink2 text-ink2' },
};

const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

const TRACK = [
  ['review', 'In review'],
  ['accepted', 'Accepted'],
  ['filed', 'In a course'],
  ['live', 'Live'],
] as const;

/** Where the notes are: in review → accepted → in a course → live. */
function Track({ p }: { p: MyContributionDto['progress'] }) {
  if (p.step === 'rejected') return null;
  const at = TRACK.findIndex(([k]) => k === p.step);
  return (
    <ol aria-label="Progress" className="m-0 p-0 list-none grid grid-cols-4 gap-1">
      {TRACK.map(([k, label], i) => (
        <li key={k} aria-current={i === at ? 'step' : undefined} className="flex flex-col gap-1">
          <span className={`h-1 rounded-full ${i <= at ? 'bg-teal' : 'bg-line'}`} />
          <span className={`font-mono text-[10.5px] ${i <= at ? 'text-ink font-semibold' : 'text-ink2'}`}>
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Slip({ c, i }: { c: MyContributionDto; i: number }) {
  const withdraw = useWithdrawContribution();
  const stamp = STAMP[c.status];
  const reward = rewardText(c.reward, c.rewardPaidAt);
  return (
    <li className="relative rounded-[14px] bg-card px-5 pt-4 pb-5 flex flex-col gap-2.5 shadow-[0_14px_30px_-26px_var(--shadow),0_0_0_1px_var(--line)] min-w-0">
      <div className="flex justify-between gap-3 font-mono text-[11px] text-ink2 pb-2 border-b-2 border-card-head">
        <span>
          NO. {String(i + 1).padStart(2, '0')} · {KIND_LABEL[c.kind].toUpperCase()}
        </span>
        <span>{day(c.createdAt)}</span>
      </div>
      <span
        aria-hidden="true"
        className={`absolute right-4 top-11 rotate-[-6deg] rounded-md border-2 px-2 py-0.5 font-mono text-[11px] font-semibold tracking-[0.06em] ${stamp.tone}`}
      >
        {stamp.label}
      </span>
      <span className="sr-only">Status: {stamp.label.toLowerCase()}.</span>
      <span className="pr-28 font-display font-extrabold text-[21px] leading-tight tracking-[-0.03em] [overflow-wrap:anywhere]">
        {c.title}
      </span>
      <span className="text-[13px] text-ink2">
        {c.courseHint ? `${c.courseHint} · ` : ''}
        {c.files.length} file{c.files.length === 1 ? '' : 's'} · {formatBytes(c.totalBytes)}
      </span>
      <Track p={c.progress} />
      {c.progress.courseSlug && (
        <span className="text-[13px] text-ink2">
          {c.progress.step === 'live' ? 'Students are reading it in ' : 'Being added to '}
          <Link to={`/c/${c.progress.courseSlug}`} className="font-semibold text-teal-text">
            {c.progress.courseTitle}
          </Link>
          .
        </span>
      )}
      {reward && (
        <span className="self-start rounded-md bg-mist text-on-mist px-2.5 py-1 text-[13px] font-semibold">
          {reward}
        </span>
      )}
      {c.reviewNote && (
        <p className="m-0 border-l-[3px] border-line pl-3 text-[14px] leading-relaxed text-ink2">
          “{c.reviewNote}”
        </p>
      )}
      {c.status === 'pending' && (
        <button
          type="button"
          onClick={() => withdraw.mutate(c.id)}
          disabled={withdraw.isPending}
          className="self-start text-[13px] font-semibold text-ink2 underline underline-offset-2 disabled:opacity-50"
        >
          {withdraw.isPending ? 'Taking it back…' : 'Take it back'}
        </button>
      )}
      {withdraw.isError && <span className="text-[13px] text-blush-text">{friendly(withdraw.error)}</span>}
    </li>
  );
}

/** Everything this student has shared, newest first. */
export function MyContributions({ items }: { items: MyContributionDto[] }) {
  if (items.length === 0)
    return (
      <p className="m-0 text-[15px] text-ink2">Nothing yet. Your uploads show up here with their review.</p>
    );
  return (
    <ul className="m-0 p-0 list-none grid gap-4 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
      {items.map((c, i) => (
        <Slip key={c.id} c={c} i={items.length - 1 - i} />
      ))}
    </ul>
  );
}
