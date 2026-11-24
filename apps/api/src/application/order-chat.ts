import {
  type AdminOrderRowDto,
  type AdminOrdersOverviewDto,
  type AdminRestaurantStatsDto,
  CHAT_LIMITS,
  type ChatMessageDto,
  type ChatMessageInput,
  type ChatReportDto,
  type ChatReportStatus,
  MESS_ORDER_STATUSES,
  MESS_PHOTO_MAX_BYTES,
  type MessBlockDto,
  type MessOrderStatus,
  OPEN_MESS_ORDER,
  type OrderChatDto,
  type OrderStatusCounts,
  campusClock,
  normaliseEmail,
} from '@ss/contracts';
import type {
  ChatMessageRecord,
  ChatReportRepository,
  MessBlockRecord,
  MessBlockRepository,
  MessOrderRecord,
  MessOrderRepository,
  MessRecord,
  MessRepository,
  OrderChatRepository,
} from '../domain/campus-ports';
import type { Principal } from '../domain/entities';
import type { Clock, UploadStore } from '../domain/ports';
import { fail } from './errors';
import { type OrderEvents, ownerChatUrl, studentChatUrl } from './order-events';
import { type OrderService, imageKind, toDto } from './order-service';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** Chat photos: their own folder per order, never public (served only to the two sides and admins). */
export const chatPhotoKey = (orderId: string, file: string) => `chat-photos/${orderId}/${file}`;
const PHOTO_NAME = /^[a-f0-9]{24}\.(webp|jpg|png)$/;
/** Order ids: UUIDs in production, "order-12" in the demo and tests. */
const ORDER_ID = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|order-\d{1,9})$/i;

type Side = 'student' | 'owner';

/**
 * Who is asking. `asOwner`: the page opened the chat from the restaurant's dashboard, so an admin
 * or owner who also placed the order (testing their own restaurant) answers as the restaurant.
 */
export type ChatAccess = boolean | { admin: boolean; asOwner?: boolean };
const isAdmin = (a: ChatAccess) => (typeof a === 'boolean' ? a : a.admin);
const asOwner = (a: ChatAccess) => typeof a !== 'boolean' && !!a.asOwner;

const toMessage = (m: ChatMessageRecord): ChatMessageDto => ({
  id: m.id,
  sender: m.sender,
  body: m.body,
  photo: m.photo,
  createdAt: m.createdAt.toISOString(),
});

const zeroCounts = (): OrderStatusCounts =>
  Object.fromEntries(MESS_ORDER_STATUSES.map((s) => [s, 0])) as OrderStatusCounts;

const digits = (phone: string) => {
  const d = phone.replace(/\D/g, '');
  return d.length === 10 ? `+91${d}` : d ? `+${d}` : '';
};

/**
 * The chat on each order, like a messaging app: the student and the restaurant write to each
 * other (text, photos, quick replies), see when the other has read it, and each can clear the chat
 * for themselves only. The owner can block a student; either side can report a chat to the admin,
 * who reads every chat in full and is the only one who can clear it for everyone.
 */
export class ChatService {
  constructor(
    private readonly messes: MessRepository,
    private readonly orders: MessOrderRepository,
    private readonly chat: OrderChatRepository,
    private readonly blocks: MessBlockRepository,
    private readonly reports: ChatReportRepository,
    private readonly events: OrderEvents,
    private readonly orderService: OrderService,
    private readonly clock: Clock,
    private readonly photos?: UploadStore,
  ) {}

  /** The order, its restaurant, and which side this person is on. Strangers get "not found". */
  private async resolve(p: Principal, admin: ChatAccess, orderId: string) {
    const order = await this.orders.find(orderId);
    if (!order) throw fail.notFound('That chat');
    const mess = await this.messes.find(order.messSlug);
    if (!mess) throw fail.notFound('That chat');
    const owns = isAdmin(admin) || mess.ownerEmails.includes(normaliseEmail(p.email));
    let side: Side;
    if (owns && asOwner(admin)) side = 'owner';
    else if (order.userId === p.userId) side = 'student';
    else if (owns) side = 'owner';
    else throw fail.notFound('That chat');
    return { order, mess, side };
  }

  private async state(order: MessOrderRecord, mess: MessRecord, side: Side | 'admin') {
    const blocked = !!(await this.blocks.find(mess.slug, order.userId));
    const ended = !OPEN_MESS_ORDER.includes(order.status);
    const stale =
      ended && this.clock.now().getTime() - order.updatedAt.getTime() > CHAT_LIMITS.openHoursAfterEnd * HOUR;
    const closedReason =
      side === 'admin'
        ? 'Admins can read every chat but do not write in them.'
        : blocked
          ? side === 'student'
            ? "You can't message this restaurant."
            : 'You blocked this student. Unblock them to send messages.'
          : stale
            ? `This order finished more than ${CHAT_LIMITS.openHoursAfterEnd} hours ago, so the chat is closed.`
            : '';
    return { blocked, canSend: !closedReason, closedReason };
  }

  private async dto(order: MessOrderRecord, mess: MessRecord, side: Side | 'admin'): Promise<OrderChatDto> {
    const c = order.chat;
    const clearedAt = side === 'student' ? c.studentClearedAt : side === 'owner' ? c.ownerClearedAt : null;
    const [messages, st, topic] = await Promise.all([
      this.chat.list(order.id, clearedAt, 400),
      this.state(order, mess, side),
      this.events.orderTopic(order.id),
    ]);
    return {
      order: toDto(order, mess.name, side, topic),
      role: side,
      messages: messages.map(toMessage),
      otherReadAt:
        side === 'student'
          ? (c.ownerReadAt?.toISOString() ?? null)
          : side === 'owner'
            ? (c.studentReadAt?.toISOString() ?? null)
            : null,
      ...st,
      callPhone: side === 'student' ? digits(mess.phone) : side === 'owner' ? digits(order.phone) : '',
      clearedAt: clearedAt?.toISOString() ?? null,
    };
  }

  async get(p: Principal, admin: ChatAccess, orderId: string): Promise<OrderChatDto> {
    const r = await this.resolve(p, admin, orderId);
    const [order] = await this.events.sweep([r.order], () => r.mess);
    return this.dto(order!, r.mess, r.side);
  }

  async send(
    p: Principal,
    admin: ChatAccess,
    orderId: string,
    input: ChatMessageInput,
  ): Promise<ChatMessageDto> {
    const { order, mess, side } = await this.resolve(p, admin, orderId);
    const st = await this.state(order, mess, side);
    if (!st.canSend) throw fail.badRequest(st.closedReason);
    const now = this.clock.now().getTime();
    const [minute, day] = await Promise.all([
      this.chat.countByUserSince(p.userId, new Date(now - 60_000)),
      this.chat.countByUserSince(p.userId, new Date(now - DAY)),
    ]);
    if (minute >= CHAT_LIMITS.perMinute) throw fail.rateLimited();
    if (day >= CHAT_LIMITS.perDay)
      throw fail.badRequest("That's the most messages for today. Use the Call button.");

    const saved = await this.chat.post({
      orderId,
      sender: side,
      userId: p.userId,
      body: input.body,
      photo: input.photo,
    });
    // Writing in a chat means you've read it.
    await this.orders.patch(
      orderId,
      side === 'student'
        ? { studentUnread: 0, studentReadAt: this.clock.now() }
        : { ownerUnread: 0, ownerReadAt: this.clock.now() },
    );
    const preview = input.body ? input.body.slice(0, 140) : '📷 Photo';
    await Promise.all([
      this.events.ping(order),
      side === 'student'
        ? this.events
            .toOwners(mess, {
              title: `${order.name} · order ${order.code}`,
              body: preview,
              tag: `chat-${order.id}`,
              url: ownerChatUrl(order),
              quietWhen: `chat=${order.id}`,
            })
            .catch(() => null)
        : this.events
            .toStudent(order, {
              title: `${mess.name} · ${order.code}`,
              body: preview,
              tag: `chat-${order.id}`,
              url: studentChatUrl(order),
              quietWhen: `chat=${order.id}`,
            })
            .catch(() => null),
    ]);
    return toMessage(saved);
  }

  /** A photo for the chat: real JPEG/PNG/WebP only, under a random name in this order's folder. */
  async uploadPhoto(p: Principal, admin: ChatAccess, orderId: string, bytes: Uint8Array) {
    const { order, mess, side } = await this.resolve(p, admin, orderId);
    const st = await this.state(order, mess, side);
    if (!st.canSend) throw fail.badRequest(st.closedReason);
    if (!this.photos) throw fail.badRequest('Photos are not set up on this server.');
    if (bytes.byteLength > MESS_PHOTO_MAX_BYTES)
      throw fail.badRequest('That photo is too big. Use one under 1.5 MB.');
    const kind = imageKind(bytes);
    if (!kind) throw fail.badRequest('Use a JPEG, PNG or WebP photo.');
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    const photo = `${id}.${kind.ext}`;
    await this.photos.save(chatPhotoKey(orderId, photo), bytes, kind.type);
    return { photo };
  }

  async photo(p: Principal, admin: ChatAccess, orderId: string, file: string) {
    if (!PHOTO_NAME.test(file) || !ORDER_ID.test(orderId) || !this.photos) return null;
    if (!isAdmin(admin)) await this.resolve(p, admin, orderId);
    return this.photos.get(chatPhotoKey(orderId, file));
  }

  async read(p: Principal, admin: ChatAccess, orderId: string) {
    const { order, side } = await this.resolve(p, admin, orderId);
    const c = order.chat;
    const unread = side === 'student' ? c.studentUnread : c.ownerUnread;
    if (unread === 0 && (side === 'student' ? c.studentReadAt : c.ownerReadAt)) return;
    await this.orders.patch(
      orderId,
      side === 'student'
        ? { studentUnread: 0, studentReadAt: this.clock.now() }
        : { ownerUnread: 0, ownerReadAt: this.clock.now() },
    );
    await this.events.ping(order); // the other side's ticks turn blue
  }

  /** "Clear chat": hidden for this person only. The other side and the admin still see it all. */
  async clear(p: Principal, admin: ChatAccess, orderId: string) {
    const { side } = await this.resolve(p, admin, orderId);
    const now = this.clock.now();
    await this.orders.patch(
      orderId,
      side === 'student'
        ? { studentClearedAt: now, studentUnread: 0, studentReadAt: now }
        : { ownerClearedAt: now, ownerUnread: 0, ownerReadAt: now },
    );
  }

  async report(p: Principal, admin: ChatAccess, orderId: string, reason: string) {
    const { side } = await this.resolve(p, admin, orderId);
    const since = new Date(this.clock.now().getTime() - HOUR);
    if ((await this.reports.countFor(orderId, side, since)) >= 2)
      throw fail.badRequest('You reported this chat already. The admin will look at it.');
    await this.reports.add({ orderId, by: side, reason });
  }

  // ── Blocking (owners) ──

  async block(p: Principal, admin: ChatAccess, orderId: string, reason: string) {
    const { order, mess, side } = await this.resolve(p, admin, orderId);
    if (side !== 'owner') throw fail.forbidden();
    await this.blocks.add({
      messSlug: mess.slug,
      userId: order.userId,
      phone: order.phone,
      email: order.email,
      name: order.name,
      reason,
    });
    await this.events.ping(order);
  }

  async unblock(p: Principal, admin: ChatAccess, orderId: string) {
    const { order, mess, side } = await this.resolve(p, admin, orderId);
    if (side !== 'owner') throw fail.forbidden();
    await this.blocks.remove(mess.slug, order.userId);
    await this.events.ping(order);
  }

  private blockDto(b: MessBlockRecord, names: Map<string, string>, withEmail: boolean): MessBlockDto {
    return {
      messSlug: b.messSlug,
      messName: names.get(b.messSlug) ?? b.messSlug,
      userId: b.userId,
      name: b.name,
      phone: b.phone,
      reason: b.reason,
      createdAt: b.createdAt.toISOString(),
      email: withEmail ? b.email : '',
    };
  }

  async ownerBlocks(p: Principal, admin: boolean, slug: string): Promise<MessBlockDto[]> {
    const mess = await this.orderService.ownedMess(p, admin, slug);
    const names = new Map([[mess.slug, mess.name]]);
    return (await this.blocks.list(slug)).map((b) => this.blockDto(b, names, false));
  }

  async ownerUnblock(p: Principal, admin: boolean, slug: string, userId: string) {
    await this.orderService.ownedMess(p, admin, slug);
    if (!(await this.blocks.remove(slug, userId))) throw fail.notFound('That block');
  }

  // ── Admin ──

  async adminChat(orderId: string): Promise<OrderChatDto> {
    const order = await this.orders.find(orderId);
    const mess = order ? await this.messes.find(order.messSlug) : null;
    if (!order || !mess) throw fail.notFound('That chat');
    return this.dto(order, mess, 'admin');
  }

  /** "Clear for everyone": the messages and photos are deleted; a line says the admin removed them. */
  async adminClear(orderId: string) {
    const order = await this.orders.find(orderId);
    if (!order) throw fail.notFound('That chat');
    const photos = await this.chat.removeAll(orderId);
    if (this.photos)
      await Promise.all(photos.map((f) => this.photos!.delete(chatPhotoKey(orderId, f)).catch(() => {})));
    await this.orders.patch(orderId, {
      studentUnread: 0,
      ownerUnread: 0,
      lastBody: '',
      lastSender: '',
      lastAt: null,
    });
    await this.events.system(order, 'Messages in this chat were removed by Scholars Stack.');
    await this.events.ping(order);
  }

  async adminOrders(slug?: string): Promise<AdminOrderRowDto[]> {
    const since = new Date(this.clock.now().getTime() - 14 * DAY);
    const [list, messes, reports] = await Promise.all([
      this.orders.listSince(since, 300, slug),
      this.messes.list(),
      this.reports.list(500),
    ]);
    const names = new Map(messes.map((m) => [m.slug, m.name]));
    const reportCount = new Map<string, number>();
    for (const r of reports) reportCount.set(r.orderId, (reportCount.get(r.orderId) ?? 0) + 1);
    return list.map((o) => ({
      ...toDto(o, names.get(o.messSlug) ?? o.messSlug, 'admin'),
      email: o.email,
      alertNote: o.chat.alertNote,
      reports: reportCount.get(o.id) ?? 0,
    }));
  }

  async adminOverview(): Promise<AdminOrdersOverviewDto> {
    const now = this.clock.now();
    const today = campusClock(now).date;
    const week = new Date(now.getTime() - 7 * DAY);
    const [messes, recent, allBlocks, reports] = await Promise.all([
      this.messes.list(),
      this.orders.listSince(week, 2000),
      this.blocks.list(),
      this.reports.list(500),
    ]);
    const openReportOrders = new Set(reports.filter((r) => r.status === 'new').map((r) => r.orderId));
    const restaurants: AdminRestaurantStatsDto[] = await Promise.all(
      messes
        .filter((m) => m.kind === 'restaurant')
        .map(async (m) => {
          const mine = recent.filter((o) => o.messSlug === m.slug);
          const todayCounts = zeroCounts();
          const weekCounts = zeroCounts();
          for (const o of mine) {
            weekCounts[o.status as MessOrderStatus]++;
            if (campusClock(o.createdAt).date === today) todayCounts[o.status as MessOrderStatus]++;
          }
          const [devices, reply] = await Promise.all([
            this.events.ownerDevices(m),
            this.orderService.replyTime(m.slug),
          ]);
          return {
            slug: m.slug,
            name: m.name,
            ordersOpen: m.ordersOpen,
            ownerEmails: m.ownerEmails,
            ownerDevices: devices.length,
            today: todayCounts,
            week: weekCounts,
            autoCancelledWeek: mine.filter((o) => o.chat.endedBy === 'auto').length,
            reply,
            blocks: allBlocks.filter((b) => b.messSlug === m.slug).length,
            openReports: mine.filter((o) => openReportOrders.has(o.id)).length,
          };
        }),
    );
    return {
      pushConfigured: this.events.pushConfigured,
      liveConfigured: this.events.liveConfigured,
      restaurants,
    };
  }

  async adminReports(): Promise<ChatReportDto[]> {
    const [reports, messes] = await Promise.all([this.reports.list(300), this.messes.list()]);
    const names = new Map(messes.map((m) => [m.slug, m.name]));
    const orders = new Map<string, MessOrderRecord | null>();
    for (const r of reports)
      if (!orders.has(r.orderId)) orders.set(r.orderId, await this.orders.find(r.orderId));
    return reports.map((r) => {
      const o = orders.get(r.orderId);
      return {
        id: r.id,
        orderId: r.orderId,
        orderCode: o?.code ?? '',
        messSlug: o?.messSlug ?? '',
        messName: o ? (names.get(o.messSlug) ?? o.messSlug) : '',
        by: r.by,
        reason: r.reason,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        studentEmail: o?.email ?? '',
        studentPhone: o?.phone ?? '',
      };
    });
  }

  async setReportStatus(id: string, status: ChatReportStatus) {
    if (!(await this.reports.setStatus(id, status))) throw fail.notFound('That report');
  }

  async adminBlocks(): Promise<MessBlockDto[]> {
    const [list, messes] = await Promise.all([this.blocks.list(), this.messes.list()]);
    const names = new Map(messes.map((m) => [m.slug, m.name]));
    return list.map((b) => this.blockDto(b, names, true));
  }

  async adminUnblock(slug: string, userId: string) {
    if (!(await this.blocks.remove(slug, userId))) throw fail.notFound('That block');
  }

  /** A test alert to every owner device of a restaurant: does the owner actually hear orders? */
  async testAlert(slug: string) {
    const mess = await this.messes.find(slug);
    if (!mess || mess.kind !== 'restaurant') throw fail.notFound('That restaurant');
    if (!this.events.pushConfigured) throw fail.badRequest('Push is not set up on the server (VAPID keys).');
    return this.events.toOwners(mess, {
      title: `Test alert · ${mess.name}`,
      body: 'This is how a new order will reach you. Tap to open your orders.',
      tag: 'owner-test',
      url: '/orders',
    });
  }
}
