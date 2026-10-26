import { DEFAULT_ROYALTY_PERCENT as SHARE } from '@ss/contracts';
import { PROMISE } from '../../shared/copy';

const WAYS = [
  {
    no: '01',
    what: 'Anything useful',
    examples: 'One unit’s notes, slides that explain, a lab record, a few past papers.',
    pay: 'Paid for what we use',
    detail:
      'A one-off payment by UPI, sized to how much your upload adds. Or a free course, if you’d rather.',
  },
  {
    no: '02',
    what: 'A complete paper or set',
    examples: 'A full question-paper set with answers, or every unit of one course.',
    pay: 'Paid by contribution',
    detail: 'The more of a course it completes, the more we pay. Agreed with you before it goes on sale.',
  },
  {
    no: '03',
    what: 'A whole subject',
    examples: 'Your notes for the entire subject, good enough to sell as the course.',
    pay: `${SHARE}% of every sale`,
    detail: `Each time a student buys that course, ${SHARE}% of what they paid is yours, until the course is replaced with newer notes. You see every sale on this page.`,
  },
];

const STEPS = [
  ['Upload', 'Files go to private storage. Only the library can open them.'],
  ['We read it', 'A person checks every file, usually within a few days.'],
  ['On the shelf', 'Good notes become part of a course, with your OK on the deal.'],
  ['You get paid', 'By UPI. Earned, paid and due are listed here.'],
];

export function WaysToEarn() {
  return (
    <section id="how" aria-labelledby="ways-title" className="scroll-mt-6 flex flex-col gap-8">
      <div className="flex flex-col gap-3 max-w-[760px]">
        <span className="font-mono text-[12px] text-ink2">THE RATE CARD</span>
        <h2
          id="ways-title"
          className="m-0 font-display font-extrabold text-[clamp(36px,5vw,58px)] leading-[0.95] tracking-[-0.05em]"
        >
          Three ways your notes pay you back.
        </h2>
      </div>
      <ol className="m-0 p-0 list-none grid gap-4 md:grid-cols-3">
        {WAYS.map((w, i) => (
          <li
            key={w.no}
            className={`flex flex-col gap-3 rounded-2xl bg-card p-5 shadow-[0_0_0_1px_var(--line)] ${
              i === 2 ? 'border-t-4 border-teal' : ''
            }`}
          >
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink2">
              {w.no} · {w.what}
            </span>
            <p
              className={`m-0 font-display font-extrabold leading-tight tracking-[-0.03em] text-[28px] ${i === 2 ? 'text-teal-text' : ''}`}
            >
              {w.pay}
            </p>
            <p className="m-0 text-[14px] leading-relaxed text-ink2">{w.examples}</p>
            <p className="m-0 text-[15px] leading-relaxed">{w.detail}</p>
          </li>
        ))}
      </ol>
      <p className="m-0 rounded-2xl bg-card px-5 py-4 text-[15px] leading-relaxed shadow-[0_0_0_1px_var(--line)]">
        <strong className="font-semibold">Top contributor of the year.</strong> {PROMISE.yearlyBonus}
      </p>
      <ol className="m-0 p-0 list-none grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map(([title, text], i) => (
          <li key={title} className="relative flex gap-3.5 pt-5 border-t-2 border-dashed border-line">
            <span
              aria-hidden="true"
              className="absolute -top-[9px] left-0 size-4 rounded-full bg-teal ring-4 ring-bg"
            />
            <span className="font-mono text-[12px] text-ink2 pt-1">{String(i + 1).padStart(2, '0')}</span>
            <span className="flex flex-col gap-1">
              <span className="text-[17px] font-semibold">{title}</span>
              <span className="text-[14px] leading-relaxed text-ink2">{text}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
