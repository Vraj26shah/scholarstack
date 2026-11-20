import type { CheckoutQuoteDto } from '@ss/contracts';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { track } from '../../lib/analytics';
import { ApiError, api, friendly } from '../../lib/api';
import { PaymentBlocked, PaymentCancelled, checkoutGateway } from '../../lib/payments';
import { reportProblem } from '../../lib/problems';
import { useSession } from '../../lib/session';

/**
 * What went wrong with a purchase, for the result window:
 * - closed: the student closed the payment window (a quiet note, not a window)
 * - declined: the bank or UPI app refused the payment
 * - unavailable: the payment window could not be opened at all (our side)
 * - blocked: the browser (an ad or tracker blocker) stopped the payment window loading
 * - error: anything else (connection, verification)
 */
export type BuyProblem = {
  kind: 'closed' | 'declined' | 'unavailable' | 'blocked' | 'error';
  message: string;
};

/**
 * The buy button's logic for a course or a bundle: sign in if needed, then the check-out slip
 * (price, offer, promo code, total, all worked out by the server), then Razorpay, then confirm.
 * The slip is where a promo code goes, so every buyer passes the box on the way to paying.
 */
export function useBuy(item: { courseId: string } | { bundleId: string }, returnTo: string) {
  const { status } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<BuyProblem | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [quote, setQuote] = useState<CheckoutQuoteDto | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  // Said once on the slip when a code that worked earlier no longer does.
  // A code that stopped working (switched off, run out, expired): which one, and why.
  const [notice, setNotice] = useState<{ code: string; message: string } | null>(null);
  // The code the student just applied, for the one-off "you save" moment on the slip.
  const [justApplied, setJustApplied] = useState<string | null>(null);
  // The latest request wins: a slow answer for an old code never overwrites a newer one.
  const asked = useRef(0);
  const itemKey = 'courseId' in item ? `c:${item.courseId}` : `b:${item.bundleId}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different course or bundle starts a new slip
  useEffect(() => {
    setQuote(null);
    setReviewing(false);
    setNotice(null);
  }, [itemKey]);

  const code = quote?.promo?.code;

  /** Fetches the slip. With a code that no longer works, falls back to the plain price and says so. */
  async function loadQuote(withCode?: string) {
    const ask = ++asked.current;
    setQuoteError(null);
    try {
      const next = await api.checkoutQuote(item, withCode);
      if (ask === asked.current) setQuote(next);
    } catch (e) {
      if (ask !== asked.current) return;
      if (withCode && e instanceof ApiError && e.code === 'BAD_REQUEST') {
        setNotice({ code: withCode.trim().toUpperCase(), message: `${friendly(e)} It has been removed.` });
        return loadQuote();
      }
      if (e instanceof ApiError && e.code === 'ALREADY_OWNED') {
        setReviewing(false);
        navigate('/shelf');
        return;
      }
      setQuoteError(friendly(e));
    }
  }

  /** The buy button: signed out → sign in and come back; signed in → open the slip. */
  async function buy() {
    if (status !== 'ready') {
      navigate(`/sign-in?next=${encodeURIComponent(returnTo)}`);
      return;
    }
    setProblem(null);
    setNotice(null);
    setJustApplied(null);
    setReviewing(true);
    await loadQuote(code);
  }

  /** "Apply" on the slip. Throws the plain-language reason when the code doesn't work here. */
  async function applyPromo(typed: string) {
    const ask = ++asked.current;
    const next = await api.checkoutQuote(item, typed);
    if (ask === asked.current) setQuote(next);
    setNotice(null);
    setJustApplied(next.promo?.code ?? null);
    if (next.promo) track('apply_promo_code', { coupon: next.promo.code });
    return next;
  }

  function clearPromo() {
    setNotice(null);
    setJustApplied(null);
    void loadQuote();
  }

  /** "Pay ₹…" on the slip: the server charges exactly the total it showed. */
  async function pay() {
    if (!quote || busy) return;
    setBusy(true);
    try {
      let order: Awaited<ReturnType<typeof api.startCheckout>>;
      try {
        order = await api.startCheckout(code ? { ...item, promoCode: code } : item);
      } catch (e) {
        if (code && e instanceof ApiError && e.code === 'BAD_REQUEST') {
          // The code ended or ran out between Apply and Pay: the slip drops it, shows the new
          // total and stays open, so the next tap pays the normal price on purpose.
          setNotice({ code, message: `${friendly(e)} It has been removed, so check the new total.` });
          await loadQuote();
          return;
        }
        throw e;
      }
      track('begin_checkout', {
        currency: 'INR',
        value: order.amountPaise / 100,
        ...('courseId' in item ? { item_id: item.courseId } : { item_id: item.bundleId }),
        ...(code ? { coupon: code } : {}),
      });
      // Close the slip before Razorpay opens its own window, so the two never fight over focus.
      setReviewing(false);
      const payment = await checkoutGateway.pay(order);
      navigate(`/checkout/${order.orderId}`, { state: { order, payment } });
    } catch (e) {
      setReviewing(false);
      if (e instanceof PaymentCancelled)
        setProblem(
          e.failure
            ? { kind: 'declined', message: e.failure }
            : { kind: 'closed', message: 'Payment window closed. Nothing was charged.' },
        );
      else if (e instanceof PaymentBlocked) {
        setProblem({ kind: 'blocked', message: '' });
        reportProblem('blocked', 'The Razorpay payment window was blocked by the browser');
      } else if (e instanceof ApiError && e.code === 'ALREADY_OWNED') navigate('/shelf');
      else if (e instanceof ApiError && e.code === 'PAYMENTS_UNAVAILABLE') {
        setProblem({ kind: 'unavailable', message: e.message });
        reportProblem('payment', 'Payments could not start (Razorpay refused the order)');
      } else setProblem({ kind: 'error', message: friendly(e) });
    } finally {
      setBusy(false);
    }
  }

  return {
    buy,
    pay,
    busy,
    problem,
    /** Every outcome opens the result window (PaymentProblem) — nothing is left inline. */
    dismiss: () => setProblem(null),
    signedIn: status === 'ready',
    /** The check-out slip: open, its lines, and why it couldn't load. */
    reviewing,
    closeReview: () => {
      if (!busy) setReviewing(false);
    },
    quote,
    quoteError,
    retryQuote: () => void loadQuote(code),
    notice,
    justApplied,
    applyPromo,
    clearPromo,
  };
}

export type BuyState = ReturnType<typeof useBuy>;
