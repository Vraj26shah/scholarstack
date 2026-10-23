import type { StartCheckoutDto } from '@ss/contracts';
import { api } from './api';
import { isDemo } from './env';

export interface PaymentResult {
  gatewayPaymentId: string;
  signature: string;
}

export class PaymentCancelled extends Error {}

/** Collects payment for an order created by the API. */
export interface CheckoutGateway {
  pay(order: StartCheckoutDto): Promise<PaymentResult>;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void };
  }
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the payment window. Check your connection.'));
    document.head.appendChild(s);
  });
}

class RazorpayCheckout implements CheckoutGateway {
  async pay(order: StartCheckoutDto): Promise<PaymentResult> {
    await loadRazorpay();
    return new Promise((resolve, reject) => {
      const rzp = new window.Razorpay!({
        key: order.keyId,
        amount: order.amountPaise,
        currency: order.currency,
        order_id: order.gatewayOrderId,
        name: 'Scholars Stack',
        description: order.courseTitle,
        prefill: { email: order.email },
        notes: { course: order.courseTitle },
        theme: { color: '#2F3C7E' },
        handler: (r: { razorpay_payment_id: string; razorpay_signature: string }) =>
          resolve({ gatewayPaymentId: r.razorpay_payment_id, signature: r.razorpay_signature }),
        modal: { ondismiss: () => reject(new PaymentCancelled('Payment window closed.')) },
      });
      rzp.open();
    });
  }
}

/** Demo: the API simulates Razorpay and returns a correctly signed payment. */
class DemoCheckout implements CheckoutGateway {
  async pay(order: StartCheckoutDto): Promise<PaymentResult> {
    await new Promise((r) => setTimeout(r, 600));
    return api.demoPay(order.gatewayOrderId);
  }
}

export const checkoutGateway: CheckoutGateway = isDemo ? new DemoCheckout() : new RazorpayCheckout();
