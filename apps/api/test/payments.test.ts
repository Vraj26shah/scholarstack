import { describe, expect, it } from 'vitest';
import { Browser, setup } from './harness';

describe('payments', () => {
  it('when Razorpay refuses the order, the student is told nothing was charged and no order is left behind', async () => {
    const { env, app } = setup();
    env.gateway.createOrder = async () => {
      throw new Error('Razorpay order failed: 401 {"error":{"description":"Authentication failed"}}');
    };
    const s = new Browser(app);
    await s.signIn('buyer@vitbhopal.ac.in');
    const course = [...env.db.courses.values()].find((c) => c.status === 'live')!;
    const r = await s.call('POST', '/orders', { courseId: course.id });
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe('PAYMENTS_UNAVAILABLE');
    expect(r.json.error.message).toContain('Nothing was charged');
    expect(r.json.error.message).not.toContain('401');
    expect([...env.db.orders.values()].filter((o) => o.courseId === course.id)).toHaveLength(0);
  });

  it('the admin health check reports whether payments work', async () => {
    const { env, app } = setup();
    const a = new Browser(app);
    await a.signIn('admin@vitbhopal.ac.in');
    expect((await a.call('GET', '/admin/sync-health')).json.payments).toMatchObject({
      status: 'connected',
      mode: 'demo',
    });
    env.gateway.checkKeys = async () => ({
      ok: false,
      mode: 'test',
      message: 'Razorpay rejected the API keys (401)',
    });
    const bad = (await a.call('GET', '/admin/sync-health')).json.payments;
    expect(bad).toMatchObject({ status: 'error', mode: 'test' });
    expect(bad.message).toContain('rejected');
  });

  describe('netbanking and UPI', () => {
    async function start(email: string) {
      const { env, app } = setup();
      const b = new Browser(app);
      await b.signIn(email);
      const course = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
      const order = (await b.call('POST', '/orders', { courseId: course.id })).json;
      const owned = async () => (await b.call('GET', `/courses/${course.slug}`)).json.owned as boolean;
      const verify = (p: { gatewayPaymentId: string; signature: string }) =>
        b.call('POST', '/orders/verify', {
          orderId: order.orderId,
          gatewayOrderId: order.gatewayOrderId,
          ...p,
        });
      return { env, app, b, order, owned, verify };
    }

    it('an approved-but-not-captured payment is captured before the course is granted', async () => {
      const { env, order, owned, verify } = await start('nb1@vitbhopal.ac.in');
      const p = await env.gateway.simulatePayment(order.gatewayOrderId, 'authorized');
      const r = await verify(p);
      expect(r.json.status).toBe('paid');
      expect(await owned()).toBe(true);
    });

    it('a bank that is still confirming grants nothing yet, then the status check finishes it', async () => {
      const { env, b, order, owned, verify } = await start('nb2@vitbhopal.ac.in');
      const p = await env.gateway.simulatePayment(order.gatewayOrderId, 'pending');
      expect((await verify(p)).json.status).toBe('created');
      expect(await owned()).toBe(false);
      env.gateway.settleLater(p.gatewayPaymentId, 'captured');
      expect((await b.call('GET', `/orders/${order.orderId}`)).json.status).toBe('paid');
      expect(await owned()).toBe(true);
    });

    it('a declined payment with a valid signature grants nothing', async () => {
      const { env, order, owned, verify } = await start('nb3@vitbhopal.ac.in');
      const p = await env.gateway.simulatePayment(order.gatewayOrderId, 'failed');
      const r = await verify(p);
      expect(r.json.error.code).toBe('PAYMENT_INVALID');
      expect(await owned()).toBe(false);
    });

    it('a failed first attempt, then a successful retry on the same order, ends paid', async () => {
      const { env, app, order, owned, verify } = await start('nb4@vitbhopal.ac.in');
      const failed = JSON.stringify({
        event: 'payment.failed',
        payload: { payment: { entity: { id: 'pay_F1', order_id: order.gatewayOrderId, amount: 9900 } } },
      });
      await new Browser(app).call('POST', '/webhooks/razorpay', failed, {
        'x-razorpay-signature': await env.gateway.signWebhook(failed),
      });
      const p = await env.gateway.simulatePayment(order.gatewayOrderId, 'captured');
      expect((await verify(p)).json.status).toBe('paid');
      expect(await owned()).toBe(true);
    });

    it('the student closed the tab: checking the order finds the payment at Razorpay', async () => {
      const { env, b, order, owned } = await start('nb5@vitbhopal.ac.in');
      await env.gateway.simulatePayment(order.gatewayOrderId, 'authorized');
      expect((await b.call('GET', `/orders/${order.orderId}`)).json.status).toBe('paid');
      expect(await owned()).toBe(true);
    });

    it('a payment.authorized webhook captures, then grants', async () => {
      const { env, app, order, owned } = await start('nb6@vitbhopal.ac.in');
      const p = await env.gateway.simulatePayment(order.gatewayOrderId, 'authorized');
      const body = JSON.stringify({
        event: 'payment.authorized',
        payload: {
          payment: {
            entity: { id: p.gatewayPaymentId, order_id: order.gatewayOrderId, amount: order.amountPaise },
          },
        },
      });
      const r = await new Browser(app).call('POST', '/webhooks/razorpay', body, {
        'x-razorpay-signature': await env.gateway.signWebhook(body),
      });
      expect(r.json.outcome).toBe('granted');
      expect(await owned()).toBe(true);
    });

    it('Razorpay being unreachable never fails a student who paid', async () => {
      const { env, b, order, owned, verify } = await start('nb7@vitbhopal.ac.in');
      const p = await env.gateway.simulatePayment(order.gatewayOrderId, 'captured');
      const realConfirm = env.gateway.confirmPayment.bind(env.gateway);
      const realFind = env.gateway.findPaidPayment.bind(env.gateway);
      env.gateway.confirmPayment = async () => {
        throw new Error('timeout');
      };
      env.gateway.findPaidPayment = async () => {
        throw new Error('timeout');
      };
      const r = await verify(p);
      expect(r.status).toBe(200);
      expect(r.json.status).toBe('created');
      env.gateway.confirmPayment = realConfirm;
      env.gateway.findPaidPayment = realFind;
      expect((await b.call('GET', `/orders/${order.orderId}`)).json.status).toBe('paid');
      expect(await owned()).toBe(true);
    });
  });

  describe('the bank-page redirect route (phones, in-app browsers)', () => {
    async function start(email: string) {
      const { env, app } = setup();
      const b = new Browser(app);
      await b.signIn(email);
      const course = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
      const order = (await b.call('POST', '/orders', { courseId: course.id })).json;
      const owned = async () => (await b.call('GET', `/courses/${course.slug}`)).json.owned as boolean;
      // Razorpay posts a plain HTML form from its bank page; no sign-in comes with it.
      const back = (fields: Record<string, string>, orderId = order.orderId) =>
        new Browser(app).call(
          'POST',
          `/payments/razorpay/return?order=${orderId}`,
          new URLSearchParams(fields).toString(),
          {
            'content-type': 'application/x-www-form-urlencoded',
          },
        );
      return { env, order, owned, back };
    }

    it('a successful netbanking payment grants the course and lands on the receipt', async () => {
      const { env, order, owned, back } = await start('rd1@vitbhopal.ac.in');
      const p = await env.gateway.simulatePayment(order.gatewayOrderId, 'authorized');
      const r = await back({
        razorpay_payment_id: p.gatewayPaymentId,
        razorpay_order_id: order.gatewayOrderId,
        razorpay_signature: p.signature,
      });
      expect(r.status).toBe(303);
      expect(r.res.headers.get('location')).toBe(`/checkout/${order.orderId}?via=bank`);
      expect(await owned()).toBe(true);
    });

    it("a declined payment lands on the receipt with the bank's reason, and grants nothing", async () => {
      const { order, owned, back } = await start('rd2@vitbhopal.ac.in');
      const r = await back({
        'error[code]': 'BAD_REQUEST_ERROR',
        'error[description]': "Your payment didn't go through as it was declined by the bank.",
      });
      expect(r.status).toBe(303);
      const to = new URL(r.res.headers.get('location')!, 'https://x');
      expect(to.pathname).toBe(`/checkout/${order.orderId}`);
      expect(to.searchParams.get('failed')).toContain('declined by the bank');
      expect(await owned()).toBe(false);
    });

    it('a forged result grants nothing', async () => {
      const { order, owned, back } = await start('rd3@vitbhopal.ac.in');
      const r = await back({
        razorpay_payment_id: 'pay_fake',
        razorpay_order_id: order.gatewayOrderId,
        razorpay_signature: 'f'.repeat(64),
      });
      expect(new URL(r.res.headers.get('location')!, 'https://x').searchParams.get('failed')).toBeTruthy();
      expect(await owned()).toBe(false);
    });

    it('a failed redirect after an earlier attempt succeeded still ends paid', async () => {
      const { env, order, owned, back } = await start('rd4@vitbhopal.ac.in');
      await env.gateway.simulatePayment(order.gatewayOrderId, 'captured');
      const r = await back({ 'error[description]': 'Payment processing cancelled by user' });
      expect(r.res.headers.get('location')).toBe(`/checkout/${order.orderId}?via=bank`);
      expect(await owned()).toBe(true);
    });

    it('an unknown order is refused without granting anything', async () => {
      const { back } = await start('rd5@vitbhopal.ac.in');
      const r = await back(
        { razorpay_payment_id: 'pay_x', razorpay_order_id: 'order_x', razorpay_signature: 'x' },
        'nope',
      );
      expect(new URL(r.res.headers.get('location')!, 'https://x').searchParams.get('failed')).toContain(
        'could not find',
      );
    });
  });
});
