import { DEFAULT_ROYALTY_PERCENT as SHARE } from '@ss/contracts';
import { PROMISE } from '../../shared/copy';
import { Reveal } from '../../shared/ui/motion';

const WAYS = [
  {
    no: '01',
    what: 'Anything useful',
    examples: 'One unit’s notes, slides that explain, a lab record, a few past papers.',
    pay: 'Paid for what we use',
    detail:
      'A one-off payment by UPI, sized to how much your upload adds. Or a free course, if you’d rather.',
    stamp: 'ONE-OFF',
  },
  {
    no: '02',
    what: 'A complete paper or set',
    examples: 'A full question-paper set with answers, or every unit of one course.',
    pay: 'Paid by contribution',
    detail: 'The more of a course it completes, the more we pay. Agreed with you before it goes on sale.',
    stamp: 'BIGGER',
  },
  {
    no: '03',
    what: 'A whole subject',
    examples: 'Your notes for the entire subject, good enough to sell as the course.',
    pay: `${SHARE}% of every sale`,
    detail: `Each time a student buys that course, ${SHARE}% of what they paid is yours, until the course is replaced with newer notes. You see every sale on this page.`,
    stamp: 'ROYALTY',
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
      <ol className="m-0 p-0 list-none grid gap-5 md:grid-cols-3">
        {WAYS.map((w, i) => (
          <Reveal as="li" key={w.no} index={i}>
            <article
              className={`ruled lift relative h-full rounded-[16px] px-5 pt-4 pb-6 flex flex-col gap-3 shadow-[0_18px_34px_-24px_var(--shadow),0_0_0_1px_var(--line)] ${
                i === 2 ? 'md:-translate-y-3' : ''
              }`}
              style={{ backgroundPosition: '0 46px' }}
            >
              <div className="flex justify-between gap-3 font-mono text-[11px] text-ink2 pb-2 border-b-2 border-card-head">
                <span>RATE · {w.no}</span>
                <span>{w.what.toUpperCase()}</span>
              </div>
              <span
                aria-hidden="true"
                className={`absolute right-4 top-11 rotate-[-7deg] rounded-md border-2 px-2 py-0.5 font-mono text-[11.5px] font-semibold tracking-[0.06em] ${
                  i === 2 ? 'border-teal-text text-teal-text' : 'border-marigold-text text-marigold-text'
                }`}
              >
                {w.stamp}
              </span>
              <p className="m-0 pt-7 pr-20 text-[14px] leading-relaxed text-ink2">{w.examples}</p>
              <p
                className={`m-0 font-display font-extrabold leading-[0.95] tracking-[-0.04em] ${
                  i === 2 ? 'text-[44px] text-teal-text' : 'text-[30px]'
                }`}
              >
                {w.pay}
              </p>
              <p className="m-0 text-[15px] leading-relaxed">{w.detail}</p>
            </article>
          </Reveal>
        ))}
      </ol>
      <p className="m-0 max-w-[760px] rounded-xl border-2 border-teal-text bg-mist/40 px-5 py-4 text-[15px] leading-relaxed">
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
