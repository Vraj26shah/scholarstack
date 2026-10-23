import type { OrderDto, StartCheckoutDto } from '@ss/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { formatRupees } from '../../lib/format';
import type { PaymentResult } from '../../lib/payments';
import { LinkButton } from '../../shared/ui/button';
import { Page } from '../../shared/ui/chrome';
import { Spinner } from '../../shared/ui/feedback';

type Phase = 'confirming' | 'paid' | 'waiting' | 'failed';

/** "Filing your card…" — verifies the payment, then polls until the order is paid (webhook fallback). */
export function CheckoutPage() {
  const { orderId = '' } = useParams();
  const location = useLocation() as { state?: { order?: StartCheckoutDto; payment?: PaymentResult } };
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>('confirming');
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const state = location.state;
    let cancelled = false;

    async function run() {
      try {
        if (state?.order && state.payment) {
          const verified = await api.verifyPayment({
            orderId,
            gatewayOrderId: state.order.gatewayOrderId,
            gatewayPaymentId: state.payment.gatewayPaymentId,
            signature: state.payment.signature,
          });
          setOrder(verified);
          if (verified.status === 'paid') return finish();
        }
        // No callback data (page refreshed) or not yet paid: the webhook may still land.
        const deadline = Date.now() + 60_000;
        while (!cancelled && Date.now() < deadline) {
          const o = await api.order(orderId);
          setOrder(o);
          if (o.status === 'paid') return finish();
          if (o.status === 'failed') return setPhase('failed');
          await new Promise((r) => setTimeout(r, 3000));
        }
        if (!cancelled) setPhase('waiting');
      } catch (e) {
        setError(friendly(e));
        setPhase('failed');
      }
    }

    function finish() {
      setPhase('paid');
      void queryClient.invalidateQueries();
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [orderId, location.state, queryClient]);

  const title = location.state?.order?.courseTitle;
  const many = (order?.courseIds.length ?? 1) > 1;

  return (
    <Page>
      <div className="max-w-[560px] mx-auto pt-10 flex flex-col gap-6">
        {phase === 'confirming' && (
          <>
            <Spinner label="Confirming payment" />
            <h1 className="m-0 font-display font-extrabold text-[clamp(44px,8vw,58px)] leading-[0.92] tracking-[-0.055em]">
              Filing your <span className="text-teal-text">card…</span>
            </h1>
            <p className="m-0 text-ink2 text-[17px]">
              We're confirming the payment with your bank. Usually a few seconds, so keep this open.
            </p>
          </>
        )}
        {phase === 'paid' && (
          <>
            <h1 className="m-0 font-display font-extrabold text-[clamp(44px,8vw,58px)] leading-[0.92] tracking-[-0.055em]">
              {many ? "They're" : "It's"} on your <span className="text-teal-text">shelf.</span>
            </h1>
            <p className="m-0 text-ink2 text-[17px]">
              {many
                ? `Payment confirmed. All ${order?.courseIds.length} courses in ${title ?? 'the bundle'} are ready to read.`
                : 'Payment confirmed. Every file in the course is ready to read.'}
            </p>
            <LinkButton to="/shelf" variant="brand" size="lg">
              Go to my shelf
            </LinkButton>
          </>
        )}
        {phase === 'waiting' && (
          <>
            <h1 className="m-0 font-display font-extrabold text-[44px] leading-[0.95] tracking-[-0.05em]">
              Still confirming.
            </h1>
            <p className="m-0 text-ink2 text-[17px]">
              Your bank is taking a little longer. If you were charged, the course lands on your shelf within
              a few minutes, even if you close this page.
            </p>
            <LinkButton to="/shelf" variant="brand" size="lg">
              Go to my shelf
            </LinkButton>
          </>
        )}
        {phase === 'failed' && (
          <>
            <h1 className="m-0 font-display font-extrabold text-[44px] leading-[0.95] tracking-[-0.05em]">
              That payment didn't go through.
            </h1>
            <p className="m-0 text-ink2 text-[17px]">
              {error ?? 'Nothing was added to your shelf. You can try again from the course page.'}
            </p>
            <LinkButton to="/" variant="outline" size="lg">
              Back to the catalogue
            </LinkButton>
          </>
        )}

        <div
          className="ruled relative rounded-[14px] p-[16px_18px_44px] shadow-[0_24px_40px_-24px_var(--shadow),0_0_0_1px_var(--line)]"
          style={{ backgroundPosition: '0 48px' }}
        >
          <div className="flex justify-between font-mono text-[11px] text-ink2 pb-2 border-b-2 border-card-head">
            <span>RECEIPT</span>
            <span>{order ? formatRupees(order.amountPaise) : ''}</span>
          </div>
          <div className="font-display font-extrabold text-[24px] leading-tight tracking-[-0.035em] mt-3">
            {title ?? 'Your course'}
          </div>
          <div className="font-mono text-xs text-ink2 mt-2 break-all">ORDER {orderId}</div>
          <span aria-hidden="true" className="punch-hole" />
        </div>
        <p className="m-0 text-xs text-ink2 text-center">
          Missing after 10 minutes?{' '}
          <Link to="/contact" className="text-teal-text">
            Contact us
          </Link>{' '}
          with the order ID.
        </p>
      </div>
    </Page>
  );
}
