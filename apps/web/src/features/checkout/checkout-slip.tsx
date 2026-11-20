import type { CheckoutQuoteDto } from '@ss/contracts';
import { type FormEvent, type ReactNode, useState } from 'react';
import { friendly } from '../../lib/api';
import { formatRupees } from '../../lib/format';
import { Button } from '../../shared/ui/button';
import { Sheet, Skeleton } from '../../shared/ui/feedback';
import { ArrowRight } from '../../shared/ui/icons';
import type { BuyState } from './use-buy';

/**
 * The check-out slip between the buy button and Razorpay: what the card costs, what the running
 * offer takes off, the promo code box, and the total Razorpay will charge. Every line comes from
 * the server, worked out exactly as the order will be, so the slip and the payment window always
 * show the same amount.
 */
export function CheckoutSlip({ buyState }: { buyState: BuyState }) {
  const { reviewing, closeReview, quote, quoteError, retryQuote, notice, pay, busy } = buyState;
  return (
    <Sheet
      open={reviewing}
      onOpenChange={(o) => !o && closeReview()}
      dismissible={!busy}
      title={
        <>
          Check out<span className="text-teal-text">.</span>
        </>
      }
    >
      {quoteError ? (
        <div className="flex flex-col gap-3">
          <p role="alert" className="m-0 text-[15px] text-ink2">
            {quoteError}
          </p>
          <Button variant="outline" onClick={retryQuote} className="self-start">
            Try again
          </Button>
        </div>
      ) : (
        <>
          <Slip quote={quote} />
          {notice && (
            <p role="status" className="m-0 rounded-xl bg-blush text-blush-text px-3.5 py-2.5 text-[14px]">
              {notice}
            </p>
          )}
          {quote && <PromoBox key={quote.promo?.code ?? 'none'} buyState={buyState} />}
          <Button variant="buy" size="lg" onClick={pay} disabled={!quote || busy} className="w-full">
            {busy ? 'Opening payment…' : quote ? `Pay ${formatRupees(quote.totalPaise)}` : 'Pay'}
            {!busy && <ArrowRight size={18} />}
          </Button>
          <p className="m-0 -mt-1 text-[13px] leading-relaxed text-ink2 text-center">
            UPI, card or netbanking, through Razorpay. Purchases are final.
          </p>
        </>
      )}
    </Sheet>
  );
}

/** The ruled card: one line per thing that changes the price, then the total. */
function Slip({ quote }: { quote: CheckoutQuoteDto | null }) {
  return (
    <div className="ruled relative rounded-[14px] px-[18px] pt-3.5 pb-4 shadow-[0_18px_34px_-24px_var(--shadow),0_0_0_1px_var(--line)]">
      <div className="flex justify-between font-mono text-[11px] tracking-[0.08em] text-ink2 pb-2 border-b-2 border-card-head">
        <span>CHECK-OUT SLIP</span>
        <span>
          {quote
            ? quote.kind === 'bundle'
              ? `BUNDLE · ${quote.courseCount} ${quote.courseCount === 1 ? 'COURSE' : 'COURSES'}`
              : 'COURSE'
            : ''}
        </span>
      </div>
      {quote ? (
        <>
          <div className="font-display font-extrabold text-[22px] leading-[1.08] tracking-[-0.03em] mt-2.5 mb-2 text-balance">
            {quote.title}
          </div>
          <dl className="m-0 flex flex-col text-[15px]">
            <Line label="Price" value={formatRupees(quote.fullPaise)} />
            {quote.offer && (
              <Line
                label={
                  <>
                    {quote.offer.title}{' '}
                    <span className="text-ink2 font-normal">· {quote.offer.percentOff}% off</span>
                  </>
                }
                value={`−${formatRupees(quote.offer.discountPaise)}`}
                tone="save"
              />
            )}
            {quote.promo && (
              <Line
                label={
                  <>
                    Code <span className="font-mono">{quote.promo.code}</span>
                  </>
                }
                value={`−${formatRupees(quote.promo.discountPaise)}`}
                tone="save"
              />
            )}
          </dl>
          <div className="flex items-baseline justify-between mt-1 pt-2.5 border-t-2 border-card-head">
            <span className="font-semibold">To pay</span>
            <span className="font-display font-extrabold text-[30px] leading-none tracking-[-0.04em] tabular-nums">
              {formatRupees(quote.totalPaise)}
            </span>
          </div>
          {quote.totalPaise < quote.fullPaise && (
            <p className="m-0 mt-1.5 text-right text-[13px] font-semibold text-teal-text">
              You save {formatRupees(quote.fullPaise - quote.totalPaise)}
            </p>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-3 pt-3" aria-busy="true" aria-label="Working out your price">
          <Skeleton className="h-6 w-3/4 rounded-md" />
          <Skeleton className="h-4 w-full rounded-md" />
          <Skeleton className="h-4 w-full rounded-md" />
          <Skeleton className="h-8 w-1/3 self-end rounded-md" />
        </div>
      )}
    </div>
  );
}

function Line({ label, value, tone }: { label: ReactNode; value: string; tone?: 'save' }) {
  return (
    <div className="flex items-baseline justify-between gap-4 h-7">
      <dt className={`m-0 min-w-0 truncate ${tone === 'save' ? 'font-semibold' : 'text-ink2'}`}>{label}</dt>
      <dd className={`m-0 tabular-nums ${tone === 'save' ? 'font-semibold text-teal-text' : ''}`}>{value}</dd>
    </div>
  );
}

/**
 * "Have a promo code?" on the slip. Closed by default, so a student without one goes straight to
 * Pay; open, it is one field and Apply. An applied code shows as a line on the slip with Remove here.
 */
function PromoBox({ buyState }: { buyState: BuyState }) {
  const { quote, applyPromo, clearPromo, busy: paying } = buyState;
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link =
    'self-start bg-transparent border-0 p-0 cursor-pointer text-[14px] font-semibold text-teal-text underline-offset-2 hover:underline disabled:opacity-50';

  if (quote?.promo)
    return (
      <p className="m-0 text-[14px] text-ink2" aria-live="polite">
        <span className="font-mono font-semibold text-teal-text">{quote.promo.code}</span> applied.{' '}
        <button type="button" className={link} disabled={paying} onClick={clearPromo}>
          Remove
        </button>
      </p>
    );

  if (!open)
    return (
      <button type="button" className={link} onClick={() => setOpen(true)}>
        Have a promo code?
      </button>
    );

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await applyPromo(code);
    } catch (err) {
      setError(friendly(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <input
          // biome-ignore lint/a11y/noAutofocus: opened on purpose by the student
          autoFocus
          aria-label="Promo code"
          aria-invalid={!!error}
          placeholder="Promo code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={40}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            setError(null);
          }}
          className={`h-11 flex-1 min-w-0 rounded-xl bg-surface border-[1.5px] px-3.5 font-mono text-[15px] tracking-[0.04em] text-ink outline-none focus:border-teal ${error ? 'border-blush-text' : 'border-line'}`}
        />
        <Button type="submit" variant="outline" disabled={busy || !code.trim()}>
          {busy ? 'Checking…' : 'Apply'}
        </Button>
      </div>
      {error && (
        <span role="alert" className="text-[13.5px] text-blush-text">
          {error}
        </span>
      )}
    </form>
  );
}
