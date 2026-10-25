import type { StartCheckoutDto } from '@ss/contracts';
import { api } from './api';
import { isDemo } from './env';

export interface PaymentResult {
  gatewayPaymentId: string;
  signature: string;
}

/**
 * The student left the payment window. `failure` holds the bank's reason when the last attempt
 * failed before they closed it (a decline, a timeout); empty when they simply closed it.
 */
/** The browser (an ad or tracker blocker, a strict privacy mode) stopped Razorpay from loading. */
export class PaymentBlocked extends Error {}

export class PaymentCancelled extends Error {
  constructor(readonly failure = '') {
    super(failure ? `Payment failed: ${failure}` : 'Payment window closed.');
  }
}

/** Collects payment for an order created by the API. */
export interface CheckoutGateway {
  pay(order: StartCheckoutDto): Promise<PaymentResult>;
}

declare global {
  interface Window {
    Razorpay?: new (
      options: Record<string, unknown>,
    ) => { open(): void; on?(event: string, handler: (response: never) => void): void };
  }
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.async = true;
    s.onerror = () => {
      s.remove();
      reject(
        navigator.onLine === false
          ? new Error('You seem to be offline. Check your connection and try again.')
          : new PaymentBlocked('blocked'),
      );
    };
    document.head.appendChild(s);
  });
}

class RazorpayCheckout implements CheckoutGateway {
  async pay(order: StartCheckoutDto): Promise<PaymentResult> {
    await loadRazorpay();
    return new Promise((resolve, reject) => {
      // Razorpay keeps its window open after a failed attempt so the student can retry;
      // if they then close it, they are told why the last attempt failed.
      let lastFailure = '';
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
        retry: { enabled: true, max_count: 3 },
        // Netbanking and wallets open the bank's page in a popup. Where the popup can't report
        // back (most phones, WhatsApp/Instagram in-app browsers), Razorpay brings the student
        // back to this address with the signed result instead, so the payment still completes.
        callback_url: `${window.location.origin}/api/payments/razorpay/return?order=${encodeURIComponent(order.orderId)}`,
        // Testing aid: VITE_RAZORPAY_FORCE_REDIRECT=1 makes every method use the redirect route.
        ...(import.meta.env.VITE_RAZORPAY_FORCE_REDIRECT === '1' ? { redirect: true } : {}),
        // List every everyday method, UPI first (what most students use), then netbanking,
        // cards and wallets. Razorpay still hides any method not switched on for the account.
        config: {
          display: {
            blocks: {
              everyday: {
                name: 'Pay with UPI, netbanking, card or wallet',
                instruments: [
                  { method: 'upi' },
                  { method: 'netbanking' },
                  { method: 'card' },
                  { method: 'wallet' },
                ],
              },
            },
            sequence: ['block.everyday'],
            preferences: { show_default_blocks: false },
          },
        },
        handler: (r: { razorpay_payment_id: string; razorpay_signature: string }) =>
          resolve({ gatewayPaymentId: r.razorpay_payment_id, signature: r.razorpay_signature }),
        modal: {
          ondismiss: () => reject(new PaymentCancelled(lastFailure)),
        },
      });
      rzp.on?.('payment.failed', (r: { error?: { description?: string } }) => {
        lastFailure = r.error?.description?.replace(/\.$/, '') || 'the bank declined it';
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
