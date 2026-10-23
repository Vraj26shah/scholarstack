import type { PaymentGateway } from '../domain/ports';
import { hmacSha256Hex, safeEqual } from './crypto';

/** Razorpay Standard Checkout. Orders API + signature checks per Razorpay's docs. */
export class RazorpayGateway implements PaymentGateway {
  constructor(
    readonly keyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string,
  ) {}

  async createOrder(amountPaise: number, receipt: string): Promise<{ gatewayOrderId: string }> {
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${btoa(`${this.keyId}:${this.keySecret}`)}`,
      },
      body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt }),
    });
    if (!res.ok) throw new Error(`Razorpay order failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { id: string };
    return { gatewayOrderId: body.id };
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
  constructor(
    private readonly keySecret: string,
    private readonly webhookSecret: string,
  ) {}

  async createOrder(): Promise<{ gatewayOrderId: string }> {
    this.counter += 1;
    return { gatewayOrderId: `order_demo_${Date.now().toString(36)}${this.counter}` };
  }

  async simulatePayment(gatewayOrderId: string): Promise<{ gatewayPaymentId: string; signature: string }> {
    const gatewayPaymentId = `pay_demo_${Date.now().toString(36)}`;
    return {
      gatewayPaymentId,
      signature: await hmacSha256Hex(this.keySecret, `${gatewayOrderId}|${gatewayPaymentId}`),
    };
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
