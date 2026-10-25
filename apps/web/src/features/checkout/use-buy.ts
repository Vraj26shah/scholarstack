import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

  async function buy() {
    if (status !== 'ready') {
      navigate(`/sign-in?next=${encodeURIComponent(returnTo)}`);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const order = await api.startCheckout(item);
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
      else if (e instanceof ApiError && e.code === 'PAYMENTS_UNAVAILABLE') {
        setProblem({ kind: 'unavailable', message: e.message });
        reportProblem('payment', 'Payments could not start (Razorpay refused the order)');
      } else
        setProblem({
          kind: 'error',
          message: e instanceof Error && !(e instanceof ApiError) ? e.message : friendly(e),
        });
    } finally {
      setBusy(false);
    }
  }

  return {
    buy,
    busy,
    problem,
    /** Only the quiet "window closed" note shows inline; the rest open the result window. */
    error: problem?.kind === 'closed' ? problem.message : null,
    dismiss: () => setProblem(null),
    signedIn: status === 'ready',
  };
}
