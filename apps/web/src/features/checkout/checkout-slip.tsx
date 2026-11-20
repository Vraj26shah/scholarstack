import type { CheckoutQuoteDto } from '@ss/contracts';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { friendly } from '../../lib/api';
import { formatRupees } from '../../lib/format';
import { Button } from '../../shared/ui/button';
import { Sheet, Skeleton } from '../../shared/ui/feedback';
import { ArrowRight, Check, ChevronRight } from '../../shared/ui/icons';
import type { BuyState } from './use-buy';

/**
 * The check-out slip between the buy button and Razorpay: what the card costs, what the running
 * offer takes off, the promo code, and the total Razorpay will charge. Every line comes from the
 * server, worked out exactly as the order will be, so the slip and the payment window always
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

/** Counts from the last shown amount to the new one, so a code visibly takes money off. */
function useCountTo(target: number) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    from.current = target;
    if (start === target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(target);
      return;
    }
    const began = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / 420);
      const eased = 1 - (1 - t) ** 3;
      setShown(Math.round(start + (target - start) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  // Whole rupees while counting, so the digits don't flicker through paise.
  return Math.round(shown / 100) * 100;
}

/** The ruled card: one line per thing that changes the price, then the total. */
function Slip({ quote }: { quote: CheckoutQuoteDto | null }) {
  const total = useCountTo(quote?.totalPaise ?? 0);
  return (
    <div className="relative rounded-[14px] bg-card px-[18px] pt-3.5 pb-4 shadow-[0_18px_34px_-24px_var(--shadow),0_0_0_1px_var(--line)]">
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
          <dl className="m-0 flex flex-col text-[15px] divide-y divide-dashed divide-line">
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
              <Line label="Promo code" value={`−${formatRupees(quote.promo.discountPaise)}`} tone="save" />
            )}
          </dl>
          <div className="flex items-baseline justify-between mt-1 pt-2.5 border-t-2 border-card-head">
            <span className="font-semibold">To pay</span>
            <span
              className="font-display font-extrabold text-[30px] leading-none tracking-[-0.04em] tabular-nums"
              aria-label={formatRupees(quote.totalPaise)}
            >
              {formatRupees(total)}
            </span>
          </div>
          {quote.totalPaise < quote.fullPaise && (
            <p className="m-0 mt-1.5 text-right text-[13px] font-semibold text-teal-text">
              You save {formatRupees(quote.fullPaise - quote.totalPaise)} in all
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
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className={`m-0 min-w-0 truncate ${tone === 'save' ? 'font-semibold' : 'text-ink2'}`}>{label}</dt>
      <dd className={`m-0 tabular-nums ${tone === 'save' ? 'font-semibold text-teal-text' : ''}`}>{value}</dd>
    </div>
  );
}

/** A small ticket glyph for the coupon row. */
const Ticket = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M3 8.5V6.8C3 5.8 3.8 5 4.8 5h14.4c1 0 1.8.8 1.8 1.8v1.7a2.5 2.5 0 0 0 0 5v1.7c0 1-.8 1.8-1.8 1.8H4.8c-1 0-1.8-.8-1.8-1.8v-1.7a2.5 2.5 0 0 0 0-5Z"
      stroke="currentColor"
      strokeWidth="1.7"
    />
    <path d="M9.5 5v14" stroke="currentColor" strokeWidth="1.7" strokeDasharray="2 2.2" />
  </svg>
);

/** Ten bits of paper thrown out from the tick when a code goes on. Decoration only. */
const BURST = Array.from({ length: 10 }, (_, i) => {
  const angle = (i / 10) * Math.PI * 2 + 0.3;
  const reach = 30 + (i % 3) * 9;
  return {
    dx: `${Math.round(Math.cos(angle) * reach)}px`,
    dy: `${Math.round(Math.sin(angle) * reach)}px`,
    color: ['var(--marigold)', 'var(--teal)', 'var(--card-head)'][i % 3],
  };
});

/**
 * The promo code, as a coupon. Closed, it is one row ("Have a promo code?"), so a student without
 * one goes straight to Pay. Open, a field and Apply. Applied, a ticket: the code, what it saves,
 * who shared it, and Remove, with a short burst the moment it goes on.
 */
function PromoBox({ buyState }: { buyState: BuyState }) {
  const { quote, applyPromo, clearPromo, busy: paying, justApplied } = buyState;
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped on every refusal so the field shakes again for a second wrong code.
  const [shake, setShake] = useState(0);

  const promo = quote?.promo;
  if (promo) {
    const fresh = justApplied === promo.code;
    return (
      <div
        className={`relative flex items-center gap-3 rounded-2xl border-[1.5px] border-dashed border-teal/40 bg-teal/5 pl-3.5 pr-3 py-3 ${fresh ? 'coupon-in' : ''}`}
        aria-live="polite"
      >
        <span className="relative flex-none grid place-items-center w-9 h-9 rounded-full bg-teal text-white">
          <Check size={18} />
          {fresh && (
            <span aria-hidden="true" className="absolute inset-0">
              {BURST.map((b) => (
                <span
                  key={`${b.dx}${b.dy}`}
                  className="confetti"
                  style={{ ['--dx' as string]: b.dx, ['--dy' as string]: b.dy, background: b.color }}
                />
              ))}
            </span>
          )}
        </span>
        <span className="flex-1 min-w-0 flex flex-col">
          <span className="text-[14.5px] leading-snug">
            <span className="font-mono font-bold tracking-[0.04em] text-teal-text">{promo.code}</span>{' '}
            <span className="font-semibold">applied</span>
          </span>
          <span className="text-[13.5px] leading-snug text-ink2">
            You save <b className="text-ink">{formatRupees(promo.discountPaise)}</b>
            {promo.percentOff ? ` · ${promo.percentOff}% off` : ''}
            {promo.creatorName ? ` · shared by ${promo.creatorName}` : ''}
          </span>
        </span>
        <button
          type="button"
          className="flex-none bg-transparent border-0 px-1.5 py-1 cursor-pointer text-[13.5px] font-semibold text-ink2 hover:text-blush-text disabled:opacity-50"
          disabled={paying}
          onClick={clearPromo}
        >
          Remove
        </button>
      </div>
    );
  }

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press group flex items-center gap-3 w-full text-left rounded-2xl border-[1.5px] border-dashed border-line bg-transparent px-3.5 py-3 cursor-pointer hover:border-teal/40 hover:bg-teal/5"
      >
        <span className="flex-none text-teal-text">
          <Ticket />
        </span>
        <span className="flex-1 text-[15px] font-semibold">Have a promo code?</span>
        <span className="flex items-center gap-0.5 text-[14px] font-semibold text-teal-text">
          Apply <ChevronRight size={16} />
        </span>
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
      setShake((n) => n + 1);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      <div
        key={shake}
        className={`flex items-center gap-1.5 rounded-2xl border-[1.5px] bg-surface pl-3 pr-1.5 py-1.5 focus-within:border-teal ${
          error ? 'border-blush-text shake' : 'border-line'
        }`}
      >
        <span className="flex-none text-ink2">
          <Ticket size={18} />
        </span>
        <input
          // biome-ignore lint/a11y/noAutofocus: opened on purpose by the student
          autoFocus
          aria-label="Promo code"
          aria-invalid={!!error}
          placeholder="Enter promo code"
          autoComplete="off"
          autoCapitalize="characters"
          enterKeyHint="go"
          spellCheck={false}
          maxLength={40}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase().replace(/\s+/g, ''));
            setError(null);
          }}
          // The pill around it shows focus (focus-within); a second ring inside it looked broken.
          style={{ outline: 'none' }}
          className="h-10 flex-1 min-w-0 bg-transparent border-0 px-1 font-mono text-[15px] tracking-[0.06em] text-ink outline-none placeholder:font-sans placeholder:tracking-normal"
        />
        <Button type="submit" size="sm" variant="brand" disabled={busy || !code.trim()} className="h-10 px-4">
          {busy ? 'Checking…' : 'Apply'}
        </Button>
      </div>
      {error && (
        <span role="alert" className="pl-1 text-[13.5px] text-blush-text">
          {error}
        </span>
      )}
    </form>
  );
}
