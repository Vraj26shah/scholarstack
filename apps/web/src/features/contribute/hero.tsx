import { DEFAULT_ROYALTY_PERCENT as SHARE } from '@ss/contracts';
import { LABEL } from '../../shared/copy';
import { Ambient } from '../../shared/ui/ambient';
import { StackWord } from '../../shared/ui/brand';
import { LinkButton } from '../../shared/ui/button';
import { Header } from '../../shared/ui/chrome';
import { ArrowDown } from '../../shared/ui/icons';

/** An example royalty statement on paper: shows the 50% deal in numbers, not adjectives. */
function StatementSlip() {
  const price = 149;
  const sold = 40;
  const earned = (price * sold * SHARE) / 100;
  const rows: [string, string][] = [
    ['Course', 'DBMS · CSE3001'],
    ['Price', `₹${price}`],
    ['Sold this term', String(sold)],
    ['Your share', `${SHARE}%`],
  ];
  return (
    <figure
      aria-label={`Example: ${sold} sales at ₹${price} with a ${SHARE}% share earns ₹${earned.toLocaleString('en-IN')}`}
      className="relative m-0 w-[min(340px,100%)] rotate-[2.5deg] rounded-[14px] bg-card text-ink px-6 pt-5 pb-7 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.7)]"
    >
      <span
        aria-hidden="true"
        className="absolute -top-3 left-8 h-6 w-20 rotate-[-4deg] rounded-sm bg-mist/80"
      />
      <div className="flex justify-between font-mono text-[11px] text-ink2 pb-2 border-b-2 border-card-head">
        <span>ROYALTY STATEMENT</span>
        <span>EXAMPLE</span>
      </div>
      <dl className="m-0 mt-3 flex flex-col">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="flex justify-between gap-4 py-2 border-b border-dashed border-line text-[14px]"
          >
            <dt className="text-ink2">{k}</dt>
            <dd className="m-0 font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex items-end justify-between gap-3">
        <span className="text-[13px] text-ink2 leading-tight">
          You
          <br />
          earn
        </span>
        <span className="font-display font-extrabold text-[44px] leading-none tracking-[-0.04em] tabular-nums">
          ₹{earned.toLocaleString('en-IN')}
        </span>
      </div>
      <span
        aria-hidden="true"
        className="absolute -right-3 bottom-16 rotate-[-12deg] rounded-md border-2 border-teal-text px-2 py-0.5 font-mono text-[11.5px] font-semibold tracking-[0.06em] text-teal-text bg-card"
      >
        PAID TO YOU
      </span>
    </figure>
  );
}

export function ContributeHero() {
  return (
    <div className="p-2 sm:p-4">
      <section className="relative bg-brand text-white rounded-[28px] sm:rounded-[36px] overflow-hidden">
        <Ambient tone="navy" dust={false} />
        <div className="relative z-10">
          <Header onDark />
        </div>
        <div className="relative z-10 mx-auto max-w-[1280px] px-5 sm:px-9 pt-4 sm:pt-8 pb-16 sm:pb-20 flex flex-wrap items-center justify-between gap-12">
          <div className="flex-[1_1_560px] min-w-0 flex flex-col gap-6">
            <p className="m-0 font-mono text-[12px] sm:text-[13px] tracking-[0.14em] text-on-brand2">
              CONTRIBUTE · THE LIBRARY PAYS ITS AUTHORS
            </p>
            <h1 className="m-0 font-display font-extrabold text-[clamp(48px,8vw,96px)] leading-[0.92] tracking-[-0.055em]">
              Write it once.
              <br />
              <StackWord onDark animate className="mt-2 text-mist">
                Earn every term.
              </StackWord>
            </h1>
            <p className="m-0 max-w-[600px] text-[17px] sm:text-[19px] leading-relaxed text-on-brand2">
              Upload your notes, a full question paper, or a whole subject. If we use it, you get paid for it.
              If your notes become a course we sell, you get{' '}
              <strong className="text-white">{SHARE}% of every sale</strong>, for as long as it's on the
              shelf.
            </p>
            <div className="flex flex-wrap items-center gap-3.5">
              <LinkButton to="#share" variant="mist" size="lg">
                {LABEL.upload} <ArrowDown size={18} />
              </LinkButton>
              <LinkButton to="#how" variant="outline-light" size="lg">
                How you get paid
              </LinkButton>
            </div>
          </div>
          <StatementSlip />
        </div>
      </section>
    </div>
  );
}
