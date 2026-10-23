import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, api, friendly } from '../../lib/api';
import { PaymentCancelled, checkoutGateway } from '../../lib/payments';
import { useSession } from '../../lib/session';

/** The buy button's logic for a course or a bundle: sign in if needed, pay, then confirm. */
export function useBuy(item: { courseId: string } | { bundleId: string }, returnTo: string) {
  const { status } = useSession();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function buy() {
    if (status !== 'ready') {
      navigate(`/sign-in?next=${encodeURIComponent(returnTo)}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const order = await api.startCheckout(item);
      const payment = await checkoutGateway.pay(order);
      navigate(`/checkout/${order.orderId}`, { state: { order, payment } });
    } catch (e) {
      if (e instanceof PaymentCancelled) setError('Payment window closed. Nothing was charged.');
      else if (e instanceof ApiError && e.code === 'ALREADY_OWNED') navigate('/shelf');
      else setError(e instanceof Error && !(e instanceof ApiError) ? e.message : friendly(e));
    } finally {
      setBusy(false);
    }
  }

  return { buy, busy, error, signedIn: status === 'ready' };
}
