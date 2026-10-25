import type { PaymentGateway, PaymentState } from '../domain/ports';
import { hmacSha256Hex, safeEqual } from './crypto';

interface RazorpayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
}

/** Network calls to Razorpay give up after this long, so a slow gateway never hangs a request. */
const TIMEOUT_MS = 8000;

/** Razorpay Standard Checkout. Orders API + signature checks per Razorpay's docs. */
export class RazorpayGateway implements PaymentGateway {
  constructor(
    readonly keyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string,
  ) {}

  private get auth() {
    return `Basic ${btoa(`${this.keyId}:${this.keySecret}`)}`;
  }

  async checkKeys() {
    const mode = this.keyId.startsWith('rzp_live_') ? ('live' as const) : ('test' as const);
    if (!this.keyId || !this.keySecret)
      return { ok: false, mode, message: 'RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET is empty.' };
    const res = await fetch('https://api.razorpay.com/v1/orders?count=1', {
      headers: { authorization: this.auth },
    });
    if (res.ok) return { ok: true, mode, message: `Razorpay ${mode} keys work. Checkout can take payments.` };
    if (res.status === 401)
      return {
        ok: false,
        mode,
        message:
          'Razorpay rejected the API keys (401): the key secret does not belong to this key ID. In the Razorpay dashboard → Settings → API Keys, regenerate the key and put both the new ID and secret in .env.',
      };
    return { ok: false, mode, message: `Razorpay answered ${res.status}. Try again shortly.` };
  }

  /** One Razorpay API call with auth, a timeout, and a single retry on a network blip or 5xx. */
  private async call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`https://api.razorpay.com/v1${path}`, {
          method: init.method ?? 'GET',
          headers: { 'content-type': 'application/json', authorization: this.auth },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.ok) return (await res.json()) as T;
        const text = await res.text();
        const error = Object.assign(new Error(`Razorpay ${path} ${res.status}: ${text.slice(0, 300)}`), {
          status: res.status,
        });
        if (res.status < 500) throw error; // a real answer: don't retry
        last = error;
      } catch (e) {
        if ((e as { status?: number }).status !== undefined && (e as { status: number }).status < 500)
          throw e;
        last = e;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    throw last;
  }

  async createOrder(amountPaise: number, receipt: string): Promise<{ gatewayOrderId: string }> {
    const body = await this.call<{ id: string }>('/orders', {
      method: 'POST',
      body: { amount: amountPaise, currency: 'INR', receipt },
    });
    return { gatewayOrderId: body.id };
  }

  async confirmPayment(
    gatewayOrderId: string,
    gatewayPaymentId: string,
    amountPaise: number,
  ): Promise<PaymentState> {
    const payment = await this.call<RazorpayPayment>(`/payments/${encodeURIComponent(gatewayPaymentId)}`);
    return this.settle(payment, gatewayOrderId, amountPaise);
  }

  async findPaidPayment(gatewayOrderId: string, amountPaise: number): Promise<string | null> {
    const list = await this.call<{ items: RazorpayPayment[] }>(
      `/orders/${encodeURIComponent(gatewayOrderId)}/payments`,
    );
    // Captured first, then anything still capturable (a retried netbanking attempt, say).
    const items = [...list.items].sort(
      (a, b) => Number(b.status === 'captured') - Number(a.status === 'captured'),
    );
    for (const p of items) {
      if (p.status !== 'captured' && p.status !== 'authorized') continue;
      if ((await this.settle(p, gatewayOrderId, amountPaise)) === 'captured') return p.id;
    }
    return null;
  }

  /** Checks the payment is for this order and amount, capturing it if only authorised. */
  private async settle(
    payment: RazorpayPayment,
    gatewayOrderId: string,
    amountPaise: number,
  ): Promise<PaymentState> {
    if (payment.order_id !== gatewayOrderId || payment.amount !== amountPaise || payment.currency !== 'INR')
      return 'failed';
    if (payment.status === 'captured') return 'captured';
    if (payment.status === 'failed' || payment.status === 'refunded') return 'failed';
    if (payment.status === 'created') return 'pending';
    // authorized: take the money now, or it is refunded to the student in a few days.
    try {
      const captured = await this.call<RazorpayPayment>(
        `/payments/${encodeURIComponent(payment.id)}/capture`,
        {
          method: 'POST',
          body: { amount: amountPaise, currency: 'INR' },
        },
      );
      return captured.status === 'captured' ? 'captured' : 'pending';
    } catch {
      // Someone else (auto-capture, the webhook, a parallel check) may have captured it first.
      const again = await this.call<RazorpayPayment>(`/payments/${encodeURIComponent(payment.id)}`);
      return again.status === 'captured' ? 'captured' : again.status === 'failed' ? 'failed' : 'pending';
    }
  }

  async verifyCheckout(
    gatewayOrderId: string,
    gatewayPaymentId: string,
    signature: string,
  ): Promise<boolean> {
    const expected = await hmacSha256Hex(this.keySecret, `${gatewayOrderId}|${gatewayPaymentId}`);
    return safeEqual(expected, signature);
  }

  async verifyWebhook(rawBody: string, signature: string): Promise<boolean> {
    const expected = await hmacSha256Hex(this.webhookSecret, rawBody);
    return safeEqual(expected, signature);
  }
}

/**
 * Demo gateway: same signature rules, no network. `simulatePayment` plays the part of
 * Razorpay Checkout so the full purchase flow can be tested end to end.
 */
export class DemoGateway implements PaymentGateway {
  readonly keyId = 'rzp_demo';
  private counter = 0;
  async checkKeys(): ReturnType<PaymentGateway['checkKeys']> {
    return { ok: true, mode: 'demo', message: 'Demo payments: no real money moves.' };
  }
  constructor(
    private readonly keySecret: string,
    private readonly webhookSecret: string,
  ) {}

  /** What "Razorpay" knows in the demo: each order's amount and each payment's state. */
  private readonly orderAmounts = new Map<string, number>();
  private readonly payments = new Map<string, { orderId: string; status: PaymentState | 'authorized' }>();

  async createOrder(amountPaise: number): Promise<{ gatewayOrderId: string }> {
    this.counter += 1;
    const gatewayOrderId = `order_demo_${Date.now().toString(36)}${this.counter}`;
    this.orderAmounts.set(gatewayOrderId, amountPaise);
    return { gatewayOrderId };
  }

  /**
   * Plays the student paying. `authorized` stands in for netbanking/UPI that is approved but not
   * yet captured; `pending` for a bank that hasn't answered; `failed` for a decline.
   */
  async simulatePayment(
    gatewayOrderId: string,
    status: 'captured' | 'authorized' | 'pending' | 'failed' = 'captured',
  ): Promise<{ gatewayPaymentId: string; signature: string }> {
    this.counter += 1;
    const gatewayPaymentId = `pay_demo_${Date.now().toString(36)}${this.counter}`;
    this.payments.set(gatewayPaymentId, { orderId: gatewayOrderId, status });
    return {
      gatewayPaymentId,
      signature: await hmacSha256Hex(this.keySecret, `${gatewayOrderId}|${gatewayPaymentId}`),
    };
  }

  /** The bank finally answers for a pending payment. */
  settleLater(gatewayPaymentId: string, status: 'captured' | 'failed') {
    const p = this.payments.get(gatewayPaymentId);
    if (p) p.status = status;
  }

  async confirmPayment(
    gatewayOrderId: string,
    gatewayPaymentId: string,
    amountPaise: number,
  ): Promise<PaymentState> {
    const p = this.payments.get(gatewayPaymentId);
    // Payments made outside the simulator (tests posting webhooks) count as captured.
    if (!p) return 'captured';
    if (p.orderId !== gatewayOrderId) return 'failed';
    const amount = this.orderAmounts.get(gatewayOrderId);
    if (amount !== undefined && amount !== amountPaise) return 'failed';
    if (p.status === 'authorized') p.status = 'captured';
    return p.status as PaymentState;
  }

  async findPaidPayment(gatewayOrderId: string, amountPaise: number): Promise<string | null> {
    for (const [id, p] of this.payments)
      if (
        p.orderId === gatewayOrderId &&
        (await this.confirmPayment(gatewayOrderId, id, amountPaise)) === 'captured'
      )
        return id;
    return null;
  }

  async signWebhook(rawBody: string): Promise<string> {
    return hmacSha256Hex(this.webhookSecret, rawBody);
  }

  async verifyCheckout(
    gatewayOrderId: string,
    gatewayPaymentId: string,
    signature: string,
  ): Promise<boolean> {
    return safeEqual(await hmacSha256Hex(this.keySecret, `${gatewayOrderId}|${gatewayPaymentId}`), signature);
  }

  async verifyWebhook(rawBody: string, signature: string): Promise<boolean> {
    return safeEqual(await hmacSha256Hex(this.webhookSecret, rawBody), signature);
  }
}
