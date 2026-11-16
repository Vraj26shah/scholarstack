import { CheckPromoBody, StartCheckoutBody, VerifyPaymentBody } from '@ss/contracts';
import { Hono } from 'hono';
import { type AppEnv, requireLive, throttle } from '../helpers';

export const checkoutRoutes = new Hono<AppEnv>();

checkoutRoutes.post('/orders', async (c) => {
  const { principal } = await requireLive(c);
  await throttle(c, 'orders', principal.userId);
  const item = StartCheckoutBody.parse(await c.req.json());
  return c.json(await c.get('container').checkout.start(principal, item), 201);
});

/** Whether any promo code is running, so pages show the "Have a promo code?" link only then. */
checkoutRoutes.get('/promo/active', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({ active: await c.get('container').promoCodes.anyRunning() });
});

/** The "Apply" button: checks a code for this student and item, and returns the new price. */
checkoutRoutes.post('/promo/check', async (c) => {
  const { principal } = await requireLive(c);
  await throttle(c, 'promo', principal.userId);
  const body = CheckPromoBody.parse(await c.req.json());
  const item = 'bundleId' in body ? { bundleId: body.bundleId } : { courseId: body.courseId };
  return c.json(await c.get('container').checkout.quotePromo(principal, item, body.code));
});

checkoutRoutes.post('/orders/verify', async (c) => {
  const { principal } = await requireLive(c);
  await throttle(c, 'verify', principal.userId);
  const body = VerifyPaymentBody.parse(await c.req.json());
  return c.json(await c.get('container').checkout.verify(principal, body));
});

checkoutRoutes.get('/orders/:id', async (c) => {
  const { principal } = await requireLive(c);
  return c.json(await c.get('container').checkout.status(principal, c.req.param('id')));
});

/**
 * Razorpay's redirect route (callback_url). The student's browser lands here, a form POST from
 * Razorpay, when a netbanking or wallet page couldn't report back to the popup. We record the
 * result and send them to the receipt page, which shows success, "still confirming" or failure.
 */
checkoutRoutes.post('/payments/razorpay/return', async (c) => {
  const orderId = (c.req.query('order') ?? '').slice(0, 64);
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const field = (k: string) => {
    const v = (form as Record<string, unknown>)[k];
    return typeof v === 'string' ? v.slice(0, 200) : undefined;
  };
  const result = orderId
    ? await c.get('container').checkout.completeRedirect({
        orderId,
        gatewayOrderId: field('razorpay_order_id'),
        gatewayPaymentId: field('razorpay_payment_id'),
        signature: field('razorpay_signature'),
        errorDescription: field('error[description]'),
      })
    : { outcome: 'failed' as const, reason: 'We could not find that order.' };
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'razorpay.return',
      outcome: result.outcome,
      requestId: c.get('requestId'),
    }),
  );
  const target = new URL(`/checkout/${encodeURIComponent(orderId || 'unknown')}`, 'https://x');
  target.searchParams.set('via', 'bank');
  if (result.outcome === 'failed') target.searchParams.set('failed', result.reason ?? '');
  return c.redirect(`${target.pathname}${target.search}`, 303);
});

/** Razorpay → us. Verified by HMAC of the raw body; no user auth. */
checkoutRoutes.post('/webhooks/razorpay', async (c) => {
  const raw = await c.req.text();
  const signature = c.req.header('x-razorpay-signature') ?? '';
  const outcome = await c.get('container').checkout.handleWebhook(raw, signature);
  console.log(
    JSON.stringify({ level: 'info', event: 'razorpay.webhook', outcome, requestId: c.get('requestId') }),
  );
  return c.json({ ok: true, outcome });
});
