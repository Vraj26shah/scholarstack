import { MESS_ORDER_STATUS_TEXT, type MessOrderStatus, ORDER_TIMERS } from '@ss/contracts';
import type {
  LiveSignal,
  MessOrderRecord,
  MessOrderRepository,
  MessRecord,
  OrderChatRepository,
  PushMessage,
  PushRepository,
  PushSender,
  PushSubscriptionRecord,
} from '../domain/campus-ports';
import type { Clock } from '../domain/ports';

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const items = (o: MessOrderRecord) => o.lines.reduce((n, l) => n + l.qty, 0);

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
}

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
  ) {}

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

  async toOwners(mess: Pick<MessRecord, 'ownerEmails'>, message: PushMessage, ttl = 600) {
    return this.deliver(await this.ownerDevices(mess), message, ttl);
  }

  async toStudent(order: Pick<MessOrderRecord, 'userId'>, message: PushMessage, ttl = 3600) {
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
        body: `${items(order)} item${items(order) === 1 ? '' : 's'} · ${order.mode === 'delivery' ? `Deliver to ${order.address}` : 'Pickup'} · ${order.name}`.slice(
          0,
          160,
        ),
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

  /** The order moved on: a line in the chat, a notification to whoever didn't do it, and a ping. */
  async statusChanged(order: MessOrderRecord, mess: MessRecord, by: 'owner' | 'student' | 'auto' | 'admin') {
    const note = order.ownerNote ? ` “${order.ownerNote}”` : '';
    const line =
      by === 'student' && order.status === 'cancelled'
        ? 'The student cancelled this order.'
        : by === 'auto'
          ? "Cancelled automatically: the restaurant didn't answer within 10 minutes."
          : `${STATUS_LINE[order.status] ?? MESS_ORDER_STATUS_TEXT[order.status]}${note}`;
    await this.system(order, line).catch(() => {});
    // The student's own cancellation isn't news to them: no unread badge for it.
    if (by === 'student')
      await this.orders.patch(order.id, { studentUnread: order.chat.studentUnread }).catch(() => null);
    if (by === 'student') {
      await this.toOwners(mess, {
        title: `Order ${order.code} cancelled`,
        body: `${order.name} cancelled their order.`,
        tag: `order-${order.id}`,
        url: ownerChatUrl(order),
      }).catch(() => null);
    } else {
      await this.toStudent(order, {
        title: `${mess.name} · ${order.code}`,
        body: line.slice(0, 160),
        tag: `order-${order.id}`,
        url: studentChatUrl(order),
        quietWhen: `chat=${order.id}`,
      }).catch(() => null);
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
      const age = now - o.createdAt.getTime();
      const mess = messOf(o.messSlug);
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
