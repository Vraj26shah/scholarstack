import type { PromoQuoteDto } from '@ss/contracts';
import { useEffect, useState } from 'react';
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

/** The buy button's logic for a course or a bundle: sign in if needed, pay, then confirm. */
export function useBuy(item: { courseId: string } | { bundleId: string }, returnTo: string) {
  const { status } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<BuyProblem | null>(null);
  // A promo code the student applied: its quote sets the button's price, and the code goes with
  // the order (the server checks it again and charges exactly that).
  const [promo, setPromo] = useState<PromoQuoteDto | null>(null);
  const itemKey = 'courseId' in item ? `c:${item.courseId}` : `b:${item.bundleId}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different course or bundle drops the code
  useEffect(() => setPromo(null), [itemKey]);

  async function applyPromo(code: string) {
    const quote = await api.checkPromo(item, code);
    setPromo(quote);
    track('apply_promo_code', { coupon: quote.code });
    return quote;
  }

  async function buy() {
    if (status !== 'ready') {
      navigate(`/sign-in?next=${encodeURIComponent(returnTo)}`);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const order = await api.startCheckout(promo ? { ...item, promoCode: promo.code } : item);
      track('begin_checkout', {
        currency: 'INR',
        value: order.amountPaise / 100,
        ...('courseId' in item ? { item_id: item.courseId } : { item_id: item.bundleId }),
        ...(promo ? { coupon: promo.code } : {}),
      });
      const payment = await checkoutGateway.pay(order);
      navigate(`/checkout/${order.orderId}`, { state: { order, payment } });
    } catch (e) {
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
      else if (promo && e instanceof ApiError && e.code === 'BAD_REQUEST') {
        // The code worked when it was applied but not any more (it ended, ran out, or was used on
        // another order). Ask once more: if it really is the code, drop it so the button goes back
        // to the normal price and the next tap buys, instead of failing on every tap.
        const stillWorks = await api
          .checkPromo(item, promo.code)
          .then((quote) => {
            setPromo(quote);
            return true;
          })
          .catch((recheck) => {
            setPromo(null);
            setProblem({
              kind: 'error',
              message: `${friendly(recheck)} It has been removed, so you can buy at the normal price.`,
            });
            return false;
          });
        if (stillWorks) setProblem({ kind: 'error', message: friendly(e) });
      } else if (e instanceof ApiError && e.code === 'PAYMENTS_UNAVAILABLE') {
        setProblem({ kind: 'unavailable', message: e.message });
        reportProblem('payment', 'Payments could not start (Razorpay refused the order)');
      } else
        setProblem({
          kind: 'error',
          message: friendly(e),
        });
    } finally {
      setBusy(false);
    }
  }

  return {
    buy,
    busy,
    problem,
    /** Every outcome opens the result window (PaymentProblem) — nothing is left inline. */
    dismiss: () => setProblem(null),
    signedIn: status === 'ready',
    /** The applied promo code's quote, or null. */
    promo,
    applyPromo,
    clearPromo: () => setPromo(null),
  };
}
