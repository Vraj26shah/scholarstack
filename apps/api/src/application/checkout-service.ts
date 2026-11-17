import { type OrderDto, type PromoQuoteDto, RazorpayWebhook, type StartCheckoutDto } from '@ss/contracts';
import type { Principal } from '../domain/entities';
import type {
  BundleRepository,
  CatalogueReader,
  DiscountLedger,
  EntitlementRepository,
  OrderRepository,
  PaymentGateway,
  PaymentState,
  ProfileRepository,
} from '../domain/ports';
import { reportServerError } from './error-reporter';
import { fail } from './errors';
import { type Priced, shownBundleTitle } from './offers';
import type { PriceBook } from './price-book';
import { bundlePricing } from './pricing';
import type { PromoCodeService } from './promo-service';

export type CheckoutItem = { courseId: string } | { bundleId: string };

/** The offer behind a price, if one is running on it. */
const offerOf = (p: Priced) =>
  p.offer && p.offerId ? { offerId: p.offerId, title: p.offer.title, percentOff: p.offer.percentOff } : null;

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
    private readonly prices: PriceBook,
    private readonly promos: PromoCodeService,
    private readonly discounts: DiscountLedger,
  ) {}

  /** What this student pays for the item: today's price, then the promo code if one was given. */
  private async price(principal: Principal, item: CheckoutItem, promoCode?: string) {
    const base =
      'bundleId' in item
        ? await this.priceBundle(principal, item.bundleId)
        : await this.priceCourse(principal, item.courseId);
    const code = promoCode?.trim();
    // offerPaise: the price after any offer, before the code.
    if (!code) return { ...base, offerPaise: base.amountPaise, promo: null };
    const promo = await this.promos.apply(
      principal.userId,
      base.bundleId ? { bundleId: base.bundleId } : { courseId: base.courseId! },
      code,
      base.amountPaise,
    );
    return { ...base, offerPaise: base.amountPaise, amountPaise: promo.pricePaise, promo };
  }

  /** The "Apply" button: does the code work here, and what is the new price? Creates nothing. */
  async quotePromo(principal: Principal, item: CheckoutItem, code: string): Promise<PromoQuoteDto> {
    const { promo } = await this.price(principal, item, code);
    if (!promo) throw fail.badRequest('Type a promo code first.');
    return {
      code: promo.promo.code,
      fullPaise: promo.fullPaise,
      pricePaise: promo.pricePaise,
      discountPaise: promo.discountPaise,
    };
  }

  async start(principal: Principal, item: CheckoutItem & { promoCode?: string }): Promise<StartCheckoutDto> {
    // The price and the buyer's profile row don't depend on each other.
    const [{ title, amountPaise, courseId, bundleId, courseIds, promo, fullPaise, offer, offerPaise }] =
      await Promise.all([
        this.price(
          principal,
          'bundleId' in item ? { bundleId: item.bundleId } : { courseId: item.courseId },
          item.promoCode,
        ),
        this.profiles.ensure(principal),
      ]);

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
      // A student was ready to pay and couldn't: worth an alert, not just a log line.
      reportServerError(error, { where: 'checkout: Razorpay order' });
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
    // Counted as a use only once the order is paid; written now so the order remembers its code.
    if (promo) await this.promos.record(order.id, principal.userId, promo);
    // Which festival offer gave this price, for the admin's report. Reporting only: a hiccup here
    // must never stop a student paying.
    if (offer && fullPaise > offerPaise)
      await this.discounts
        .recordOffer({
          orderId: order.id,
          offerId: offer.offerId,
          title: offer.title,
          percentOff: offer.percentOff,
          fullPaise,
          discountPaise: fullPaise - offerPaise,
        })
        .catch((error) =>
          console.error(
            '[checkout] could not record the offer on an order:',
            error instanceof Error ? error.message : error,
          ),
        );
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
    // Independent reads, side by side: Apply and Buy wait for the slowest one, not all three in turn.
    // Today's price: a running offer (Diwali, say) is charged exactly as the card showed it.
    const [files, owned, today] = await Promise.all([
      this.catalogue.listFiles([course.id]),
      this.entitlements.has(principal.userId, course.id),
      this.prices.coursePrice(course),
    ]);
    if (!files.some((file) => file.conversionStatus === 'ready' && file.pageCount > 0))
      throw fail.notFound('That course');
    if (owned) throw fail.alreadyOwned();
    return {
      title: course.title,
      amountPaise: today.pricePaise,
      courseId: course.id,
      bundleId: null,
      courseIds: [course.id],
      fullPaise: course.pricePaise,
      offer: offerOf(today),
    };
  }

  /** Bundle price, scaled down for courses the buyer already owns; only unowned courses are granted. */
  private async priceBundle(principal: Principal, bundleId: string) {
    const bundle = await this.bundles.find(bundleId);
    if (!bundle || bundle.status !== 'live') throw fail.notFound('That bundle');
    const liveCourses = (await this.catalogue.coursesByIds(bundle.courseIds)).filter(
      (course) => course.status === 'live',
    );
    const [files, ownedIds] = await Promise.all([
      this.catalogue.listFiles(liveCourses.map((course) => course.id)),
      this.entitlements.listCourseIds(principal.userId),
    ]);
    const readableCourses = new Set(
      files
        .filter((file) => file.conversionStatus === 'ready' && file.pageCount > 0)
        .map((file) => file.courseId),
    );
    const courses = liveCourses.filter((course) => readableCourses.has(course.id));
    if (courses.length === 0) throw fail.notFound('That bundle');
    const owned = new Set(ownedIds);
    const remaining = courses.filter((c) => !owned.has(c.id));
    if (remaining.length === 0) throw fail.alreadyOwned();
    const today = await this.prices.bundlePrice(bundle, courses);
    const price = bundlePricing(
      today.pricePaise,
      courses.map((c) => c.pricePaise),
      courses.filter((c) => owned.has(c.id)).map((c) => c.pricePaise),
      remaining.reduce((s, c) => s + (today.coursePrices.get(c.id)?.pricePaise ?? c.pricePaise), 0),
    );
    // The same buyer's price with no offer running, to know what the offer took off.
    const full = bundlePricing(
      bundle.pricePaise,
      courses.map((c) => c.pricePaise),
      courses.filter((c) => owned.has(c.id)).map((c) => c.pricePaise),
    );
    return {
      // The payment window names the pack the way the page did ("Diwali pack · …" during the offer).
      title: shownBundleTitle(bundle, today.offer),
      amountPaise: price.payablePaise,
      courseId: null,
      bundleId: bundle.id,
      courseIds: remaining.map((c) => c.id),
      fullPaise: Math.max(full.payablePaise, price.payablePaise),
      offer: offerOf(today),
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
