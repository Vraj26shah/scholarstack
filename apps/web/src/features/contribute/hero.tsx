import { DEFAULT_ROYALTY_PERCENT as SHARE, netOfFees } from '@ss/contracts';
import { Ambient } from '../../shared/ui/ambient';
import { Hl, StackWord } from '../../shared/ui/brand';
import { LinkButton } from '../../shared/ui/button';
import { Header } from '../../shared/ui/chrome';
import { ArrowDown } from '../../shared/ui/icons';

const rupees = (paise: number) => `₹${Math.floor(paise / 100).toLocaleString('en-IN')}`;

/** An example royalty statement: the partner deal in real numbers, fee and all. */
function StatementSlip() {
  const price = 99;
  const sold = 40;
  const gross = price * sold * 100;
  const net = netOfFees(gross);
  const earned = Math.floor((net * SHARE) / 100);
  const rows: [string, string][] = [
    ['Course', 'DBMS · CSE3001'],
    ['Bought by one batch', `${sold} × ₹${price}`],
    ['Payment fee', `− ${rupees(gross - net)}`],
    ['Your share', `${SHARE}%`],
  ];
  return (
    <figure
      aria-label={`Example: ${sold} students buy at ₹${price}; after the payment fee your ${SHARE}% share is ${rupees(earned)}`}
      className="relative m-0 w-[min(340px,100%)] rounded-[14px] bg-card text-ink px-6 pt-5 pb-7 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.7)]"
    >
      <span aria-hidden="true" className="absolute -top-3 left-8 h-6 w-20 rounded-sm bg-mist/80" />
      <div className="flex justify-between font-mono text-[11px] text-ink2 pb-2 border-b-2 border-card-head">
        <span>Contributor statement</span>
        <span>Example</span>
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
          Paid to you
          <br />
          by UPI
        </span>
        <span className="font-display font-extrabold text-[44px] leading-none tracking-[-0.04em] tabular-nums">
          {rupees(earned)}
        </span>
      </div>
    </figure>
  );
}

export function ContributeHero() {
  return (
    <div className="p-2 sm:p-4">
      <section className="page-enter relative bg-brand text-white rounded-[28px] sm:rounded-[36px] overflow-hidden">
        <Ambient tone="navy" dust={false} />
        <div className="relative z-10">
          <Header onDark />
        </div>
        <div className="relative z-10 mx-auto max-w-[1280px] px-5 sm:px-9 pt-4 sm:pt-8 pb-12 sm:pb-16 flex flex-wrap items-center justify-between gap-10">
          <div className="flex-[1_1_560px] min-w-0 flex flex-col gap-6">
            <h1 className="m-0 font-display font-extrabold text-[clamp(44px,7.5vw,92px)] leading-[0.94] tracking-[-0.055em]">
              Your notes got you through.
              <br />
              <StackWord onDark animate className="mt-2 text-mist">
                Let them pay you.
              </StackWord>
            </h1>
            <p className="m-0 max-w-[600px] text-[17px] sm:text-[19px] leading-relaxed text-on-brand2">
              Share original notes, papers or slides. We review them and agree on a reward. Complete courses
              earn <Hl onDark>{SHARE}% per sale</Hl> while listed.
            </p>
            <div className="flex flex-wrap items-center gap-3.5">
              <LinkButton to="#share" variant="mist" size="lg">
                Become a contributor <ArrowDown size={18} />
              </LinkButton>
              <LinkButton to="#how" variant="outline-light" size="lg">
                See the numbers
              </LinkButton>
            </div>
          </div>
          <StatementSlip />
        </div>
      </section>
    </div>
  );
}
