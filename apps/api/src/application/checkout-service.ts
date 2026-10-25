import { type OrderDto, RazorpayWebhook, type StartCheckoutDto } from '@ss/contracts';
import type { Principal } from '../domain/entities';
import type {
  BundleRepository,
  CatalogueReader,
  EntitlementRepository,
  OrderRepository,
  PaymentGateway,
  PaymentState,
  ProfileRepository,
} from '../domain/ports';
import { fail } from './errors';
import { bundlePricing } from './pricing';

export type CheckoutItem = { courseId: string } | { bundleId: string };

/**
 * Buying a course or a bundle. The price always comes from the database, and access is granted only
 * after a verified gateway signature (checkout callback) or a verified webhook — whichever
 * arrives first; the grant is idempotent so both can arrive safely. All sales are final.
 */
/** Payment problems go to the logs (and the admin health card), never to the student. */
function logPayment(event: string, gatewayOrderId: string, error?: unknown) {
  console.error(
    JSON.stringify({
      level: 'warn',
      event: `payment.${event}`,
      gatewayOrderId,
      error: error instanceof Error ? error.message : undefined,
    }),
  );
}

export class CheckoutService {
  constructor(
    private readonly catalogue: CatalogueReader,
    private readonly bundles: BundleRepository,
    private readonly orders: OrderRepository,
    private readonly entitlements: EntitlementRepository,
    private readonly profiles: ProfileRepository,
    private readonly gateway: PaymentGateway,
  ) {}

  async start(principal: Principal, item: CheckoutItem): Promise<StartCheckoutDto> {
    const { title, amountPaise, courseId, bundleId, courseIds } =
      'bundleId' in item
        ? await this.priceBundle(principal, item.bundleId)
        : await this.priceCourse(principal, item.courseId);
    await this.profiles.ensure(principal);

    const receipt = `ss_${(bundleId ?? courseId ?? '').slice(0, 8)}_${Date.now().toString(36)}`;
    let gatewayOrderId: string;
    try {
      ({ gatewayOrderId } = await this.gateway.createOrder(amountPaise, receipt));
    } catch (error) {
      // The real reason (bad keys, Razorpay down) goes to the logs and the admin health card;
      // the student is told plainly that nothing was charged.
      console.error(
        '[checkout] payment order could not be created:',
        error instanceof Error ? error.message : error,
      );
      throw fail.paymentsUnavailable();
    }
    const order = await this.orders.create({
      userId: principal.userId,
      courseId,
      bundleId,
      courseIds,
      amountPaise,
      gatewayOrderId,
    });
    return {
      orderId: order.id,
      gatewayOrderId,
      amountPaise: order.amountPaise,
      currency: 'INR',
      keyId: this.gateway.keyId,
      courseTitle: title,
      email: principal.email,
    };
  }

  private async priceCourse(principal: Principal, courseId: string) {
    const course = await this.catalogue.findCourse(courseId);
    if (!course || course.status !== 'live') throw fail.notFound('That course');
    const files = await this.catalogue.listFiles([course.id]);
    if (!files.some((file) => file.conversionStatus === 'ready' && file.pageCount > 0))
      throw fail.notFound('That course');
    if (await this.entitlements.has(principal.userId, course.id)) throw fail.alreadyOwned();
    return {
      title: course.title,
      amountPaise: course.pricePaise,
      courseId: course.id,
      bundleId: null,
      courseIds: [course.id],
    };
  }

  /** Bundle price, scaled down for courses the buyer already owns; only unowned courses are granted. */
  private async priceBundle(principal: Principal, bundleId: string) {
    const bundle = await this.bundles.find(bundleId);
    if (!bundle || bundle.status !== 'live') throw fail.notFound('That bundle');
    const liveCourses = (await this.catalogue.coursesByIds(bundle.courseIds)).filter(
      (course) => course.status === 'live',
    );
    const files = await this.catalogue.listFiles(liveCourses.map((course) => course.id));
    const readableCourses = new Set(
      files
        .filter((file) => file.conversionStatus === 'ready' && file.pageCount > 0)
        .map((file) => file.courseId),
    );
    const courses = liveCourses.filter((course) => readableCourses.has(course.id));
    if (courses.length === 0) throw fail.notFound('That bundle');
    const owned = new Set(await this.entitlements.listCourseIds(principal.userId));
    const remaining = courses.filter((c) => !owned.has(c.id));
    if (remaining.length === 0) throw fail.alreadyOwned();
    const price = bundlePricing(
      bundle.pricePaise,
      courses.map((c) => c.pricePaise),
      courses.filter((c) => owned.has(c.id)).map((c) => c.pricePaise),
    );
    return {
      title: bundle.title,
      amountPaise: price.payablePaise,
      courseId: null,
      bundleId: bundle.id,
      courseIds: remaining.map((c) => c.id),
    };
  }

  async verify(
    principal: Principal,
    input: { orderId: string; gatewayOrderId: string; gatewayPaymentId: string; signature: string },
  ): Promise<OrderDto> {
    const order = await this.orders.findById(input.orderId);
    if (!order || order.userId !== principal.userId || order.gatewayOrderId !== input.gatewayOrderId) {
      throw fail.notFound('That order');
    }
    const valid = await this.gateway.verifyCheckout(
      input.gatewayOrderId,
      input.gatewayPaymentId,
      input.signature,
    );
    if (!valid) throw fail.paymentInvalid();
    if (order.status === 'paid') return this.status(principal, order.id);
    // The signature only proves the bank approved the payment. Make sure the money is captured
    // (netbanking/UPI can stop at "authorised") before handing over the course.
    let state: PaymentState;
    try {
      state = await this.gateway.confirmPayment(
        input.gatewayOrderId,
        input.gatewayPaymentId,
        order.amountPaise,
      );
    } catch (error) {
      // Razorpay unreachable: don't fail the student. The status check and webhook finish it.
      logPayment('confirm_unavailable', input.gatewayOrderId, error);
      state = 'pending';
    }
    if (state === 'failed') {
      logPayment('confirm_failed', input.gatewayOrderId);
      throw fail.paymentInvalid();
    }
    if (state === 'captured') await this.orders.grant(input.gatewayOrderId, input.gatewayPaymentId);
    return this.status(principal, order.id);
  }

  /**
   * Razorpay's redirect route: when a bank or wallet page can't report back to the popup
   * (phones, WhatsApp/Instagram in-app browsers, blocked popups), Razorpay sends the student
   * back to our site with a signed result instead. No sign-in is needed here: the signature
   * proves the result came from Razorpay, and the payment is still confirmed with Razorpay
   * before anything is granted. Returns what the result page should show.
   */
  async completeRedirect(input: {
    orderId: string;
    gatewayOrderId?: string;
    gatewayPaymentId?: string;
    signature?: string;
    errorDescription?: string;
  }): Promise<{ outcome: 'paid' | 'pending' | 'failed'; reason?: string }> {
    const order = await this.orders.findById(input.orderId).catch(() => null);
    if (!order) return { outcome: 'failed', reason: 'We could not find that order.' };
    if (order.status === 'paid') return { outcome: 'paid' };
    if (!input.gatewayPaymentId || !input.signature || input.gatewayOrderId !== order.gatewayOrderId) {
      // Razorpay reports a failed attempt (or the student backed out of the bank page).
      // Another attempt may still have succeeded: ask Razorpay before saying no.
      const paid = await this.gateway
        .findPaidPayment(order.gatewayOrderId, order.amountPaise)
        .catch(() => null);
      if (paid) {
        await this.orders.grant(order.gatewayOrderId, paid);
        return { outcome: 'paid' };
      }
      return {
        outcome: 'failed',
        reason: input.errorDescription?.slice(0, 200) || 'The payment was not completed.',
      };
    }
    const valid = await this.gateway.verifyCheckout(
      order.gatewayOrderId,
      input.gatewayPaymentId,
      input.signature,
    );
    if (!valid) return { outcome: 'failed', reason: 'We could not verify that payment.' };
    let state: PaymentState;
    try {
      state = await this.gateway.confirmPayment(
        order.gatewayOrderId,
        input.gatewayPaymentId,
        order.amountPaise,
      );
    } catch (error) {
      logPayment('redirect_confirm_unavailable', order.gatewayOrderId, error);
      state = 'pending';
    }
    if (state === 'captured') {
      await this.orders.grant(order.gatewayOrderId, input.gatewayPaymentId);
      return { outcome: 'paid' };
    }
    if (state === 'failed') return { outcome: 'failed', reason: 'Your bank did not complete the payment.' };
    return { outcome: 'pending' };
  }

  /**
   * The order's state. While it isn't paid, ask Razorpay directly whether any attempt succeeded,
   * so a slow netbanking/UPI confirmation, a closed tab or a missing webhook never strands a
   * student who paid.
   */
  async status(principal: Principal, orderId: string): Promise<OrderDto> {
    let order = await this.orders.findById(orderId);
    if (!order || order.userId !== principal.userId) throw fail.notFound('That order');
    if (order.status !== 'paid') {
      try {
        const paymentId = await this.gateway.findPaidPayment(order.gatewayOrderId, order.amountPaise);
        if (paymentId) {
          await this.orders.grant(order.gatewayOrderId, paymentId);
          order = (await this.orders.findById(orderId)) ?? order;
        }
      } catch (error) {
        logPayment('reconcile_unavailable', order.gatewayOrderId, error);
      }
    }
    return {
      id: order.id,
      courseId: order.courseId ?? order.courseIds[0]!,
      bundleId: order.bundleId,
      courseIds: order.courseIds,
      status: order.status,
      amountPaise: order.amountPaise,
    };
  }

  /** Returns a short label of what happened, for logs. */
  async handleWebhook(rawBody: string, signature: string): Promise<string> {
    if (!(await this.gateway.verifyWebhook(rawBody, signature))) throw fail.paymentInvalid();
    const parsed = RazorpayWebhook.safeParse(JSON.parse(rawBody));
    if (!parsed.success) return 'ignored:shape';
    const { event, payload } = parsed.data;
    const payment = payload.payment?.entity;

    // order.paid / payment.captured: the money is ours. payment.authorized: approved but not yet
    // captured (common for netbanking/UPI with manual capture), so capture it, then grant.
    if (
      (event === 'payment.captured' || event === 'order.paid' || event === 'payment.authorized') &&
      payment?.order_id
    ) {
      const order = await this.orders.findByGatewayOrderId(payment.order_id);
      if (!order) return 'ignored:unknown-order';
      if (order.amountPaise !== payment.amount) return 'ignored:amount-mismatch';
      if (order.status === 'paid') return 'already-paid';
      if (event === 'payment.authorized') {
        const state = await this.gateway.confirmPayment(payment.order_id, payment.id, order.amountPaise);
        if (state !== 'captured') return `waiting:${state}`;
      }
      await this.orders.grant(payment.order_id, payment.id);
      return 'granted';
    }
    // One failed attempt doesn't end the order: Razorpay lets the student retry (another bank,
    // UPI app or card) on the same order, and a later success still grants.
    if (event === 'payment.failed' && payment?.order_id) {
      await this.orders.markFailed(payment.order_id);
      return 'failed';
    }
    if (event === 'payment.dispute.lost') {
      const paymentId = payload.dispute?.entity.payment_id ?? payment?.id;
      if (paymentId) await this.orders.revokeByPayment(paymentId);
      return 'revoked';
    }
    return `ignored:${event}`;
  }
}
