import { type OrderDto, RazorpayWebhook, type StartCheckoutDto } from '@ss/contracts';
import type { Principal } from '../domain/entities';
import type {
  BundleRepository,
  CatalogueReader,
  EntitlementRepository,
  OrderRepository,
  PaymentGateway,
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
    const { gatewayOrderId } = await this.gateway.createOrder(amountPaise, receipt);
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
    await this.orders.grant(input.gatewayOrderId, input.gatewayPaymentId);
    return this.status(principal, order.id);
  }

  async status(principal: Principal, orderId: string): Promise<OrderDto> {
    const order = await this.orders.findById(orderId);
    if (!order || order.userId !== principal.userId) throw fail.notFound('That order');
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

    if (event === 'payment.captured' && payment?.order_id) {
      const order = await this.orders.findByGatewayOrderId(payment.order_id);
      if (!order) return 'ignored:unknown-order';
      if (order.amountPaise !== payment.amount) return 'ignored:amount-mismatch';
      await this.orders.grant(payment.order_id, payment.id);
      return 'granted';
    }
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
