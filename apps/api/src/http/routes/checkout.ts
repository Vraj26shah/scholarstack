import { StartCheckoutBody, VerifyPaymentBody } from '@ss/contracts';
import { Hono } from 'hono';
import { type AppEnv, requireLive } from '../helpers';

export const checkoutRoutes = new Hono<AppEnv>();

checkoutRoutes.post('/orders', async (c) => {
  const { principal } = await requireLive(c);
  const item = StartCheckoutBody.parse(await c.req.json());
  return c.json(await c.get('container').checkout.start(principal, item), 201);
});

checkoutRoutes.post('/orders/verify', async (c) => {
  const { principal } = await requireLive(c);
  const body = VerifyPaymentBody.parse(await c.req.json());
  return c.json(await c.get('container').checkout.verify(principal, body));
});

checkoutRoutes.get('/orders/:id', async (c) => {
  const { principal } = await requireLive(c);
  return c.json(await c.get('container').checkout.status(principal, c.req.param('id')));
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
