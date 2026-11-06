import { DEFAULT_ROYALTY_PERCENT as SHARE, netOfFees } from '@ss/contracts';
import { useState } from 'react';
import { PROMISE } from '../../shared/copy';
import { Hl } from '../../shared/ui/brand';

const WHY = [
  {
    title: 'You write. We do the rest.',
    text: 'Checking, putting units in order, page-one previews, copy protection, payments and student questions are on us.',
  },
  {
    title: 'Every rupee in the open.',
    text: 'Each sale, what you’ve earned, what we’ve paid and what is due is listed on this page. Paid by UPI.',
  },
  {
    title: 'Help the batch after you.',
    text: 'Juniors get notes from someone who sat the same exam, from the same syllabus, instead of guessing.',
  },
];

const WAYS = [
  {
    no: '01',
    what: 'A few good files',
    examples: 'One unit’s notes, slides that explain, a lab record, a few past papers.',
    pay: 'One-off payment',
    detail: 'Paid by UPI for what we use, sized to how much it adds. Or a free course, if you’d rather.',
  },
  {
    no: '02',
    what: 'A complete paper or set',
    examples: 'A full question-paper set with answers, or every unit of one course.',
    pay: 'Bigger payment',
    detail: 'The more of a course it completes, the more we pay. Agreed with you before it goes on sale.',
  },
  {
    no: '03',
    what: 'A whole subject',
    examples: 'Your notes for the entire subject, good enough to sell as the course.',
    pay: `${SHARE}% of every sale`,
    detail: `Every time a student buys that course, ${SHARE}% of what the sale brings in is yours, until the course is replaced with newer notes.`,
  },
];

const STEPS = [
  ['Upload', 'Two minutes. Files go to private storage that only we can open.'],
  ['We read it', 'A person checks every file, usually within a few days.'],
  ['We agree the deal', 'You see the offer before anything goes on sale.'],
  ['You get paid', 'By UPI, with every payment listed on this page.'],
];

const PRICE = 99;
const rupees = (paise: number) => `₹${Math.floor(paise / 100).toLocaleString('en-IN')}`;

/**
 * Earnings calculator for a whole subject. The student drags how many buyers there are; every
 * step of the sum is shown (sales → fee → share), so the number is never a mystery.
 */
function Calculator() {
  const [students, setStudents] = useState(60);
  const gross = students * PRICE * 100;
  const net = netOfFees(gross);
  const term = Math.floor((net * SHARE) / 100);
  return (
    <div className="rounded-2xl bg-card p-5 sm:p-6 shadow-[0_0_0_1px_var(--line)] flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-teal-text">
          Earnings calculator · whole subject
        </span>
        <label htmlFor="calc-students" className="text-[15px] font-semibold">
          Drag to set how many students buy your subject
        </label>
      </div>
      <div className="flex items-center gap-4">
        <input
          id="calc-students"
          type="range"
          min={10}
          max={300}
          step={10}
          value={students}
          aria-valuetext={`${students} students`}
          onChange={(e) => setStudents(Number(e.target.value))}
          className="w-full accent-[var(--teal)]"
        />
        <span className="flex-none rounded-full bg-mist/50 px-3 py-1 font-mono text-[13px] font-semibold tabular-nums">
          {students} students
        </span>
      </div>
      <ol
        aria-label="How it adds up"
        className="m-0 p-0 list-none grid grid-cols-1 sm:grid-cols-3 gap-2 text-[13px]"
      >
        <li className="rounded-xl bg-sunk px-3 py-2.5">
          <span className="block text-ink2">1 · Sales</span>
          <span className="font-semibold tabular-nums">
            {students} × ₹{PRICE} = {rupees(gross)}
          </span>
        </li>
        <li className="rounded-xl bg-sunk px-3 py-2.5">
          <span className="block text-ink2">2 · After payment fee</span>
          <span className="font-semibold tabular-nums">
            {rupees(gross)} − {rupees(gross - net)} = {rupees(net)}
          </span>
        </li>
        <li className="rounded-xl bg-mist/50 px-3 py-2.5">
          <span className="block text-ink2">3 · Your {SHARE}%</span>
          <span className="font-semibold tabular-nums text-teal-text">{rupees(term)}</span>
        </li>
      </ol>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-sunk px-4 py-3">
          <div className="text-[13px] text-ink2">You earn from one batch</div>
          <div className="font-display font-extrabold text-[32px] leading-none tracking-[-0.03em] tabular-nums mt-1">
            {rupees(term)}
          </div>
        </div>
        <div className="rounded-xl bg-sunk px-4 py-3">
          <div className="text-[13px] text-ink2">Over 4 batches (one a year)</div>
          <div className="font-display font-extrabold text-[32px] leading-none tracking-[-0.03em] tabular-nums mt-1">
            {rupees(term * 4)}
          </div>
        </div>
      </div>
      <p className="m-0 text-[13px] text-ink2">
        An example at ₹{PRICE} a course, not a promise: <Hl>you earn on every real sale</Hl>, paid by UPI.
      </p>
    </div>
  );
}

export function WaysToEarn() {
  return (
    <section id="how" aria-labelledby="ways-title" className="scroll-mt-6 flex flex-col gap-8">
      <ul className="m-0 p-0 list-none grid gap-4 md:grid-cols-3">
        {WHY.map((w) => (
          <li key={w.title} className="flex flex-col gap-2 pt-4 border-t-2 border-teal">
            <span className="text-[18px] font-semibold">{w.title}</span>
            <span className="text-[15px] leading-relaxed text-ink2">{w.text}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-3 max-w-[760px]">
        <span className="font-mono text-[12px] text-ink2">How contributors are paid</span>
        <h2
          id="ways-title"
          className="m-0 font-display font-extrabold text-[clamp(34px,5vw,56px)] leading-[0.95] tracking-[-0.05em]"
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
            <span className="text-[12px] font-medium text-ink2">
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-stretch">
        <Calculator />
        <div className="rounded-2xl bg-brand text-white p-5 sm:p-6 flex flex-col gap-4">
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-on-brand2">
            Contributor of the year
          </span>
          <div className="flex items-baseline gap-3">
            <span className="font-display font-extrabold text-[56px] leading-none tracking-[-0.04em] text-mist">
              +25%
            </span>
            <span className="text-[14px] text-on-brand2">bonus for the top seller</span>
          </div>
          <p className="m-0 text-[15px] leading-relaxed">{PROMISE.yearlyBonus}</p>
          <ul className="m-0 mt-auto p-0 list-none flex flex-col gap-2 border-t border-white/15 pt-4 text-[13px] text-on-brand2">
            <li>✓ Every sale listed on this page as it happens</li>
            <li>✓ Paid to your UPI, no invoices</li>
            <li>✓ {PROMISE.royaltyBasis}</li>
          </ul>
        </div>
      </div>

      {/* Phones: one line down the left joining the steps; wider screens: one line across. */}
      <ol className="m-0 p-0 list-none grid gap-0 sm:gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map(([title, text], i) => (
          <li
            key={title}
            className={`relative flex gap-3.5 pl-8 pb-6 sm:pl-0 sm:pb-0 sm:pt-5 border-l-2 sm:border-l-0 sm:border-t-2 border-dashed border-line ml-2 sm:ml-0 ${
              i === STEPS.length - 1 ? 'border-l-transparent sm:border-t-line' : ''
            }`}
          >
            <span
              aria-hidden="true"
              className="absolute top-0 -left-[9px] sm:-top-[9px] sm:left-0 size-4 rounded-full bg-teal ring-4 ring-bg"
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
