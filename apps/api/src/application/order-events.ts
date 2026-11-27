import {
  MESS_ORDER_STATUS_TEXT,
  type MessOrderStatus,
  ORDER_TIMERS,
  PAY_FIRST_WINDOW_MS,
  PRESENCE_MS,
  normaliseEmail,
} from '@ss/contracts';
import type {
  LiveSignal,
  MessOrderRecord,
  MessOrderRepository,
  MessRecord,
  OrderChatRepository,
  PresenceRepository,
  PushMessage,
  PushRepository,
  PushSender,
  PushSubscriptionRecord,
} from '../domain/campus-ports';
import type { Clock } from '../domain/ports';

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
/** "2× Thali, 1× Paneer tikka · ₹260 · Pickup". */
export const orderSummary = (o: MessOrderRecord) =>
  `${o.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')} · ${rupees(o.total)} · ${o.mode === 'delivery' ? `to ${o.address}` : 'Pickup'}`;

/** Where a notification opens, for each side of an order. */
export const studentChatUrl = (o: { id: string }) => `/my-orders?chat=${encodeURIComponent(o.id)}`;
export const ownerChatUrl = (o: { id: string; messSlug: string }) =>
  `/orders?mess=${encodeURIComponent(o.messSlug)}&chat=${encodeURIComponent(o.id)}`;

/** What a student is told when the restaurant moves their order along. */
const STATUS_LINE: Partial<Record<MessOrderStatus, string>> = {
  accepted: 'Order accepted. It is being made.',
  ready: 'Your order is ready.',
  done: 'Order delivered. Enjoy your meal!',
  rejected: 'The restaurant declined this order.',
  cancelled: 'Order cancelled.',
};

/** Devices one notification goes to at most (owners may have many). */
export const MAX_FANOUT = 30;

export interface Delivery {
  devices: number;
  sent: number;
  /** Devices skipped because their person had this screen open (they saw it live). */
  skipped?: number;
}

/** What a student is looking at when they'd see news about this order live. */
export const studentScopes = (o: { id: string }) => ['orders', `chat:${o.id}`];
/** What an owner is looking at when they'd see news about this order live. */
export const ownerScopes = (o: { id: string; messSlug: string }) => [`board:${o.messSlug}`, `chat:${o.id}`];

/**
 * Everything that happens around an order besides the order itself: notifications to the owner's
 * and the student's devices, the "something changed" ping to open pages, status lines in the chat,
 * and the timers (a second alert at 3 minutes, cancelled at 10 when nobody answers).
 */
export class OrderEvents {
  constructor(
    private readonly orders: MessOrderRepository,
    private readonly chat: OrderChatRepository,
    private readonly push: PushRepository,
    private readonly sender: PushSender,
    private readonly live: LiveSignal,
    private readonly clock: Clock,
    /** Who has an order screen open: no notification for what they're already looking at. */
    private readonly presence?: PresenceRepository,
  ) {}

  /** Writes are skipped when the same person touched the same screen moments ago. */
  private touched = new Map<string, number>();

  /** This person has this screen open now (called by the pages' regular refreshes). */
  async here(scope: string, email: string) {
    if (!this.presence || !email) return;
    const who = normaliseEmail(email);
    const key = `${scope}|${who}`;
    const now = this.clock.now().getTime();
    if (now - (this.touched.get(key) ?? 0) < 10_000) return;
    this.touched.set(key, now);
    if (this.touched.size > 2000) this.touched.clear();
    await this.presence.touch(scope, who).catch(() => {});
  }

  /** They left these screens (tab hidden, app in the background, page closed). */
  async left(scopes: string[], email: string) {
    if (!this.presence || !email || !scopes.length) return;
    const who = normaliseEmail(email);
    for (const s of scopes) this.touched.delete(`${s}|${who}`);
    await this.presence.leave(scopes, who).catch(() => {});
  }

  /** Forget old presence rows (the cron). */
  async prunePresence() {
    await this.presence?.prune(new Date(this.clock.now().getTime() - 3600_000)).catch(() => {});
  }

  /** Emails of people looking at any of these screens right now. */
  private async lookingAt(scopes: string[] | undefined): Promise<Set<string>> {
    if (!this.presence || !scopes?.length) return new Set();
    const since = new Date(this.clock.now().getTime() - PRESENCE_MS);
    return this.presence.here(scopes, since).catch(() => new Set<string>());
  }

  get pushConfigured() {
    return !!this.sender.publicKey;
  }
  get liveConfigured() {
    return this.live.configured;
  }

  orderTopic(orderId: string) {
    return this.live.topic(`order:${orderId}`);
  }
  messTopic(slug: string) {
    return this.live.topic(`mess:${slug}`);
  }

  /** Open pages for this order (both sides) fetch again now. */
  async ping(order: Pick<MessOrderRecord, 'id' | 'messSlug'>) {
    if (!this.live.configured) return;
    await this.live
      .ping([await this.orderTopic(order.id), await this.messTopic(order.messSlug)])
      .catch(() => {});
  }

  /** Owner devices that get alerts, by the restaurant's owner addresses. */
  ownerDevices(mess: Pick<MessRecord, 'ownerEmails'>) {
    return mess.ownerEmails.length ? this.push.listForEmails(mess.ownerEmails) : Promise.resolve([]);
  }

  private async deliver(
    subs: PushSubscriptionRecord[],
    message: PushMessage,
    ttl: number,
  ): Promise<Delivery> {
    if (!this.pushConfigured || !subs.length) return { devices: subs.length, sent: 0 };
    const gone: string[] = [];
    let sent = 0;
    await Promise.all(
      // Newest devices first. A Worker request may make only so many outgoing calls (50 on the
      // free plan), so one alert reaches at most MAX_FANOUT devices.
      [...subs]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, MAX_FANOUT)
        .map(async (s) => {
          const r = await this.sender.send(s, message, ttl).catch(() => 'failed' as const);
          if (r === 'ok') sent++;
          if (r === 'gone') gone.push(s.id);
        }),
    );
    if (gone.length) await this.push.removeIds(gone).catch(() => {});
    return { devices: subs.length - gone.length, sent };
  }

  /**
   * To every owner device. With `quiet` (the screens where this shows up live), owners who have one
   * of them open are skipped: their page already shows it, so the notification would only cost a
   * send and buzz a phone that's in their hand.
   */
  async toOwners(
    mess: Pick<MessRecord, 'ownerEmails'>,
    message: PushMessage,
    ttl = 600,
    quiet?: string[],
  ): Promise<Delivery> {
    const [all, here] = await Promise.all([this.ownerDevices(mess), this.lookingAt(quiet)]);
    const subs = here.size ? all.filter((s) => !here.has(normaliseEmail(s.email))) : all;
    const d = await this.deliver(subs, message, ttl);
    return quiet ? { ...d, skipped: all.length - subs.length } : d;
  }

  /** To the student's devices; with `quiet`, nothing when they have one of those screens open. */
  async toStudent(
    order: Pick<MessOrderRecord, 'userId'> & { email?: string },
    message: PushMessage,
    ttl = 3600,
    quiet?: string[],
  ): Promise<Delivery> {
    if (order.email && quiet?.length) {
      const here = await this.lookingAt(quiet);
      if (here.has(normaliseEmail(order.email))) return { devices: 0, sent: 0, skipped: 1 };
    }
    return this.deliver(await this.push.listForUser(order.userId), message, ttl);
  }

  /** A status line in the chat ("Order accepted · Ready in 15 min"). */
  async system(order: MessOrderRecord, text: string) {
    await this.chat.post({
      orderId: order.id,
      sender: 'system',
      userId: null,
      body: text.slice(0, 1000),
      photo: '',
    });
  }

  /** A new order: alert every owner device (it stays on screen until tapped), and note what happened. */
  async placed(order: MessOrderRecord, mess: MessRecord) {
    const sent = await this.toOwners(
      mess,
      {
        title: `🔔 New order ${order.code} · ${rupees(order.total)}`,
        body: `${order.name}: ${orderSummary(order)}`.slice(0, 200),
        tag: `order-${order.id}`,
        url: ownerChatUrl(order).replace(/&chat=.*/, ''),
        requireInteraction: true,
        actions: [{ action: 'open', title: 'Open orders' }],
      },
      ORDER_TIMERS.autoCancelAfterMs / 1000,
    ).catch(() => ({ devices: 0, sent: 0 }));
    const alertNote = !this.pushConfigured
      ? 'Push is not set up on the server'
      : sent.devices === 0
        ? 'No owner phone has alerts on'
        : `Alert sent to ${sent.sent} of ${sent.devices} owner device${sent.devices === 1 ? '' : 's'}`;
    await this.orders.patch(order.id, { alertNote }).catch(() => null);
    await this.ping(order);
  }

  /** The student says they paid by UPI: the owner checks their UPI app, then accepts. */
  async paymentClaimed(order: MessOrderRecord, mess: MessRecord) {
    await this.system(order, `The student says they paid ${rupees(order.total)} by UPI.`).catch(() => {});
    await this.toOwners(
      mess,
      {
        title: `💰 Paid? Order ${order.code} · ${rupees(order.total)}`,
        body: `${order.name} says they paid by UPI. Check your UPI app, then tap "Payment received" and accept.`.slice(
          0,
          200,
        ),
        tag: `order-${order.id}`,
        url: ownerChatUrl(order).replace(/&chat=.*/, ''),
        requireInteraction: true,
      },
      ORDER_TIMERS.autoCancelAfterMs / 1000,
    ).catch(() => null);
    await this.ping(order);
  }

  /** The order moved on: a line in the chat, a notification to whoever didn't do it, and a ping. */
  async statusChanged(
    order: MessOrderRecord,
    mess: MessRecord,
    by: 'owner' | 'student' | 'auto' | 'admin',
    /** The step it was at before (a restaurant cancelling after accepting says so). */
    from?: MessOrderStatus,
    /** Says what happened in words of its own (a handover with or without the code). */
    said?: string,
  ) {
    const note = order.ownerNote ? ` “${order.ownerNote}”` : '';
    const line =
      said ??
      (by === 'student' && order.status === 'cancelled'
        ? 'The student cancelled this order.'
        : order.status === 'rejected' && from && from !== 'placed'
          ? `The restaurant cancelled this order.${note}`
          : order.chat.noShowAt && order.status === 'cancelled'
            ? "The restaurant marked this order as not collected. Orders you don't collect count against you: after 2 you pay first, after 3 ordering is paused."
            : by === 'auto' && order.chat.payment === 'due'
              ? 'Cancelled automatically: it was not paid within 20 minutes.'
              : by === 'auto'
                ? "Cancelled automatically: the restaurant didn't answer within 10 minutes."
                : `${STATUS_LINE[order.status] ?? MESS_ORDER_STATUS_TEXT[order.status]}${note}`);
    await this.system(order, line).catch(() => {});
    // The student's own cancellation isn't news to them: no unread badge for it.
    if (by === 'student')
      await this.orders.patch(order.id, { studentUnread: order.chat.studentUnread }).catch(() => null);
    if (by === 'student' || by === 'auto') {
      // The kitchen may already be cooking: this one stays on screen (and rings) until tapped, and
      // says exactly what not to make. Its tag replaces the "new order" alert for the same order.
      await this.toOwners(
        mess,
        {
          title: `❌ Order ${order.code} cancelled${by === 'student' ? ` by ${order.name}` : ''}`,
          body: `${by === 'student' ? "Don't make it" : order.chat.payment === 'due' ? 'It was never paid, so it was cancelled' : 'Nobody answered in 10 minutes, so it was cancelled'}: ${orderSummary(order)}`.slice(
            0,
            200,
          ),
          tag: `order-${order.id}`,
          url: ownerChatUrl(order),
          requireInteraction: by === 'student',
        },
        3600,
      ).catch(() => null);
    }
    if (by !== 'student') {
      await this.toStudent(
        order,
        {
          title: `${mess.name} · ${order.code}`,
          body: line.slice(0, 160),
          tag: `order-${order.id}`,
          url: studentChatUrl(order),
          quietWhen: `chat=${order.id}`,
        },
        3600,
        studentScopes(order),
      ).catch(() => null);
    }
    await this.ping(order);
  }

  /**
   * The timers, run whenever orders are read (the student's page, the owner's board, a chat) and by
   * the five-minute cron: a second alert to the owner after 3 minutes, and cancelled after 10.
   * Returns the orders as they are now.
   */
  async sweep(list: MessOrderRecord[], messOf: (slug: string) => MessRecord | null | undefined) {
    const now = this.clock.now().getTime();
    const out: MessOrderRecord[] = [];
    for (const o of list) {
      const mess = messOf(o.messSlug);
      // Pay-first: the student has 20 minutes to pay; the owner's clock starts once they say they have.
      if (o.status === 'placed' && mess && o.chat.payment === 'due') {
        if (now - o.createdAt.getTime() >= PAY_FIRST_WINDOW_MS) {
          const done = await this.orders.patch(
            o.id,
            { status: 'cancelled', endedBy: 'auto', ownerNote: 'Not paid within 20 minutes' },
            'placed',
          );
          if (done) await this.statusChanged(done, mess, 'auto');
          out.push((await this.orders.find(o.id)) ?? done ?? o);
        } else out.push(o);
        continue;
      }
      const age = now - (o.chat.payment && o.chat.paidAt ? o.chat.paidAt : o.createdAt).getTime();
      if (o.status !== 'placed' || !mess || age < ORDER_TIMERS.nudgeAfterMs) {
        out.push(o);
        continue;
      }
      if (age >= ORDER_TIMERS.autoCancelAfterMs) {
        const done = await this.orders.patch(
          o.id,
          { status: 'cancelled', endedBy: 'auto', ownerNote: "The restaurant didn't answer in 10 minutes" },
          'placed',
        );
        if (done) await this.statusChanged(done, mess, 'auto');
        out.push((await this.orders.find(o.id)) ?? done ?? o);
        continue;
      }
      if (!o.chat.nudgedAt) {
        const nudged = await this.orders.patch(o.id, { nudgedAt: new Date(now) }, 'placed');
        if (nudged && !o.chat.nudgedAt) {
          await this.toOwners(
            mess,
            {
              title: `⏰ Still waiting: order ${o.code}`,
              body: `${o.name} has waited ${Math.floor(age / 60_000)} minutes. Accept or decline it, or it is cancelled at 10 minutes.`,
              tag: `order-${o.id}`,
              url: '/orders',
              requireInteraction: true,
            },
            420,
          ).catch(() => null);
          await this.ping(o);
          out.push(nudged);
          continue;
        }
      }
      out.push(o);
    }
    return out;
  }
}
