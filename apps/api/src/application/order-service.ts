import {
  MESS_ORDER_NEXT,
  MESS_PHOTO_MAX_BYTES,
  type MessDto,
  type MessOrderDto,
  type MessOrderStatus,
  type OwnedMessDto,
  type OwnerMessInput,
  type PlaceMessOrderInput,
  type ReplyTimeDto,
  campusClock,
  normaliseEmail,
  normaliseMobile,
} from '@ss/contracts';
import type {
  MessBlockRepository,
  MessOrderRecord,
  MessOrderRepository,
  MessRecord,
  MessRepository,
  OrderChatRepository,
} from '../domain/campus-ports';
import type { Principal } from '../domain/entities';
import type { Clock, FeatureRepository, UploadStore } from '../domain/ports';
import { MESS_FEATURE, toDto as messDto } from './campus-service';
import { fail } from './errors';
import type { OrderEvents } from './order-events';

/**
 * Limits that keep ordering honest without getting in a hungry student's way. A student is signed
 * in with their college email, so every order has a real person behind it; these stop mistakes
 * (double taps) and abuse (fake orders to a small kitchen).
 */
export const ORDER_LIMITS = {
  /** Orders still being handled at once, per student. */
  openPerStudent: 2,
  /** Per student per day, all restaurants. */
  perStudentPerDay: 8,
  /** Per network per day (many accounts on one connection). */
  perNetworkPerDay: 15,
  /** Per restaurant per day: a ceiling no real day reaches, so a flood can't bury a kitchen. */
  perMessPerDay: 400,
  /** A second order within this long of the last one is refused (a double tap). */
  gapMs: 60_000,
};

const DAY_MS = 24 * 3600 * 1000;

/** Where an item photo is stored: its own folder per restaurant, away from the notes. */
export const photoKey = (slug: string, file: string) => `mess-photos/${slug}/${file}`;

/** What the first bytes say the file really is (the name and the browser's word are not trusted). */
export function imageKind(b: Uint8Array): { ext: 'jpg' | 'png' | 'webp'; type: string } | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return { ext: 'jpg', type: 'image/jpeg' };
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return { ext: 'png', type: 'image/png' };
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP')
    return { ext: 'webp', type: 'image/webp' };
  return null;
}
const CODE_CHARS = 'ACDEFGHJKMNPQRTUVWXY3479';
const newCode = () =>
  Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

/** Whose eyes an order is shown to: their unread count, and what their own "clear chat" hid. */
export type OrderViewer = 'student' | 'owner' | 'admin';

export const toDto = (
  o: MessOrderRecord,
  messName: string,
  viewer: OrderViewer = 'admin',
  topic = '',
): MessOrderDto => {
  const c = o.chat;
  const cleared = viewer === 'student' ? c.studentClearedAt : viewer === 'owner' ? c.ownerClearedAt : null;
  const showLast = !!c.lastAt && !!c.lastSender && (!cleared || c.lastAt > cleared);
  return {
    ...baseDto(o, messName),
    respondedAt: c.respondedAt?.toISOString() ?? null,
    endedBy: c.endedBy,
    unread: viewer === 'student' ? c.studentUnread : viewer === 'owner' ? c.ownerUnread : 0,
    last: showLast
      ? { sender: c.lastSender as 'student', body: c.lastBody, at: c.lastAt!.toISOString() }
      : null,
    topic,
  };
};

const baseDto = (o: MessOrderRecord, messName: string) => ({
  id: o.id,
  code: o.code,
  messSlug: o.messSlug,
  messName,
  lines: o.lines,
  total: o.total,
  mode: o.mode,
  address: o.address,
  name: o.name,
  phone: o.phone,
  note: o.note,
  status: o.status,
  ownerNote: o.ownerNote,
  createdAt: o.createdAt.toISOString(),
  updatedAt: o.updatedAt.toISOString(),
});

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
};

/** Optional parts: without them ordering still works (tests, older setups), just more quietly. */
export interface OrderExtras {
  events?: OrderEvents;
  blocks?: MessBlockRepository;
  chat?: OrderChatRepository;
}

/** Orders from students to restaurants for day scholars, and the owner's side of them. */
export class OrderService {
  private ownerCache: { at: number; byEmail: Map<string, string[]> } | null = null;
  private replyCache = new Map<string, { at: number; value: ReplyTimeDto }>();

  constructor(
    private readonly messes: MessRepository,
    private readonly orders: MessOrderRepository,
    private readonly features: FeatureRepository,
    private readonly clock: Clock,
    /** Where item photos are kept (the R2 bucket in production). */
    private readonly photos?: UploadStore,
    private readonly extras: OrderExtras = {},
  ) {}

  private get events() {
    return this.extras.events;
  }

  private topic(o: { id: string }) {
    return this.events ? this.events.orderTopic(o.id) : Promise.resolve('');
  }

  /** Runs the 3- and 10-minute timers on these orders before they're shown. */
  private async swept(list: MessOrderRecord[]) {
    if (!this.events || !list.some((o) => o.status === 'placed')) return list;
    const messes = new Map((await this.messes.list()).map((m) => [m.slug, m]));
    return this.events.sweep(list, (slug) => messes.get(slug));
  }

  /** The five-minute cron: every order still waiting, anywhere. */
  async sweepAll() {
    if (!this.events) return 0;
    const now = this.clock.now().getTime();
    const waiting = await this.orders.listPlacedBefore(new Date(now - 2.5 * 60_000), 100);
    const after = await this.swept(waiting);
    return after.filter(
      (o, i) => o.status !== waiting[i]!.status || o.chat.nudgedAt !== waiting[i]!.chat.nudgedAt,
    ).length;
  }

  // ── Owners ──

  /** Restaurant slugs this address runs (cached for a minute: it's asked on every sign-in). */
  private async ownedSlugs(email: string): Promise<string[]> {
    const now = this.clock.now().getTime();
    if (!this.ownerCache || now - this.ownerCache.at > 60_000) {
      const byEmail = new Map<string, string[]>();
      for (const m of await this.messes.list())
        for (const e of m.ownerEmails) byEmail.set(e, [...(byEmail.get(e) ?? []), m.slug]);
      this.ownerCache = { at: now, byEmail };
    }
    return this.ownerCache.byEmail.get(normaliseEmail(email)) ?? [];
  }

  /** Forget the cached owner list (after an admin edits a restaurant). */
  forgetOwners() {
    this.ownerCache = null;
  }

  /** Owners may sign in with any address, like admins. */
  async isOwner(email: string): Promise<boolean> {
    return (await this.ownedSlugs(email)).length > 0;
  }

  /** The restaurants this person runs (admins: every restaurant). */
  async owned(p: Principal, admin: boolean): Promise<OwnedMessDto[]> {
    const slugs = new Set(await this.ownedSlugs(p.email));
    const mine = (await this.messes.list()).filter(
      (m) => m.kind === 'restaurant' && (admin || slugs.has(m.slug)),
    );
    const since = new Date(this.clock.now().getTime() - DAY_MS);
    return Promise.all(
      mine.map(async (m) => ({
        slug: m.slug,
        name: m.name,
        ordersOpen: m.ordersOpen,
        topic: this.events ? await this.events.messTopic(m.slug) : '',
        // Admins see every restaurant: only count unread for the ones they actually run.
        unread:
          admin && !slugs.has(m.slug)
            ? 0
            : (await this.orders.listForMess(m.slug, since, 200)).reduce((n, o) => n + o.chat.ownerUnread, 0),
      })),
    );
  }

  /** The restaurant, if this person runs it (admins: any restaurant). */
  async ownedMess(p: Principal, admin: boolean, slug: string): Promise<MessRecord> {
    const mess = await this.messes.find(slug);
    if (!mess || mess.kind !== 'restaurant') throw fail.notFound('That restaurant');
    if (!admin && !mess.ownerEmails.includes(normaliseEmail(p.email))) throw fail.forbidden();
    return mess;
  }

  /** The whole restaurant, for its owner's dashboard (who else runs it is not shown). */
  async ownerMess(p: Principal, admin: boolean, slug: string): Promise<MessDto> {
    const dto = messDto(await this.ownedMess(p, admin, slug));
    return admin ? dto : { ...dto, ownerEmails: [] };
  }

  /**
   * The owner saves their menu card, weekly menu, prices, contact and timings. Everything else
   * (link, kind, who owns it, published, taking orders) stays exactly as it was: those are the
   * admin's, or have their own switch.
   */
  async ownerSave(p: Principal, admin: boolean, slug: string, input: OwnerMessInput): Promise<MessDto> {
    const current = await this.ownedMess(p, admin, slug);
    const { updatedAt: _u, ...rest } = current;
    const saved = await this.messes.save({ ...rest, ...input, source: 'owner' });
    const dto = messDto(saved);
    return admin ? dto : { ...dto, ownerEmails: [] };
  }

  /**
   * An item photo from the owner's dashboard. Only real JPEG, PNG or WebP images are kept, under a
   * random name in this restaurant's folder. Returns the file name to put on the item.
   */
  async ownerPhoto(
    p: Principal,
    admin: boolean,
    slug: string,
    bytes: Uint8Array,
  ): Promise<{ photo: string }> {
    await this.ownedMess(p, admin, slug);
    if (!this.photos) throw fail.badRequest('Photos are not set up on this server.');
    if (bytes.byteLength > MESS_PHOTO_MAX_BYTES)
      throw fail.badRequest('That photo is too big. Use one under 1.5 MB.');
    const kind = imageKind(bytes);
    if (!kind) throw fail.badRequest('Use a JPEG, PNG or WebP photo.');
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    const photo = `${id}.${kind.ext}`;
    await this.photos.save(photoKey(slug, photo), bytes, kind.type);
    return { photo };
  }

  /** A stored item photo, for the public menu (null when there's no such photo). */
  async photo(slug: string, file: string) {
    if (!this.photos || !/^[a-z0-9-]{1,60}$/.test(slug) || !/^[a-f0-9]{24}\.(webp|jpg|png)$/.test(file))
      return null;
    return this.photos.get(photoKey(slug, file));
  }

  /** The owner's board: everything still open, and today's finished orders. */
  async board(p: Principal, admin: boolean, slug: string): Promise<MessOrderDto[]> {
    const mess = await this.ownedMess(p, admin, slug);
    const since = new Date(this.clock.now().getTime() - DAY_MS);
    const list = await this.swept(await this.orders.listForMess(slug, since, 200));
    return Promise.all(list.map(async (o) => toDto(o, mess.name, 'owner', await this.topic(o))));
  }

  async setOpen(p: Principal, admin: boolean, slug: string, open: boolean): Promise<OwnedMessDto> {
    const mess = await this.ownedMess(p, admin, slug);
    const { updatedAt: _u, ...rest } = mess;
    const saved = await this.messes.save({ ...rest, ordersOpen: open });
    return {
      slug: saved.slug,
      name: saved.name,
      ordersOpen: saved.ordersOpen,
      topic: this.events ? await this.events.messTopic(saved.slug) : '',
      unread: 0,
    };
  }

  async setStatus(p: Principal, admin: boolean, id: string, status: MessOrderStatus, note: string) {
    const order = await this.orders.find(id);
    if (!order) throw fail.notFound('That order');
    const mess = await this.ownedMess(p, admin, order.messSlug);
    if (!MESS_ORDER_NEXT[order.status].includes(status))
      throw fail.badRequest(`This order is already ${order.status}; it can't be moved to ${status}.`);
    if (status === 'rejected' && note.length < 3) throw fail.badRequest('Say why, so the student knows.');
    let saved = await this.orders.setStatus(id, status, note);
    if (!saved) throw fail.notFound('That order');
    if (order.status === 'placed')
      saved = (await this.orders.patch(id, { respondedAt: this.clock.now() })) ?? saved;
    if (status === 'rejected') saved = (await this.orders.patch(id, { endedBy: 'owner' })) ?? saved;
    await this.events?.statusChanged(saved, mess, 'owner');
    saved = (await this.orders.find(id)) ?? saved;
    this.replyCache.delete(mess.slug);
    return toDto(saved, mess.name, 'owner', await this.topic(saved));
  }

  /**
   * How fast a restaurant answers: half of its answers (accepting or declining an order, or a chat
   * reply to a student) in the last 30 days came faster than this. Orders it let time out count as
   * ten minutes. Shown publicly on its page; cached for ten minutes.
   */
  async replyTime(slug: string): Promise<ReplyTimeDto> {
    const now = this.clock.now().getTime();
    const hit = this.replyCache.get(slug);
    if (hit && now - hit.at < 600_000) return hit.value;
    const since = new Date(now - 30 * DAY_MS);
    const [orders, replies] = await Promise.all([
      this.orders.listSince(since, 500, slug),
      this.extras.chat ? this.extras.chat.replyTimes(slug, since) : Promise.resolve([]),
    ]);
    const samples = [
      ...orders.flatMap((o) =>
        o.chat.respondedAt
          ? [o.chat.respondedAt.getTime() - o.createdAt.getTime()]
          : o.chat.endedBy === 'auto'
            ? [10 * 60_000]
            : [],
      ),
      ...replies,
    ];
    const m = median(samples);
    const value = {
      minutes: m === null || samples.length < 3 ? null : Math.max(1, Math.round(m / 60_000)),
      samples: samples.length,
    };
    this.replyCache.set(slug, { at: now, value });
    return value;
  }

  // ── Students ──

  async place(p: Principal, admin: boolean, slug: string, input: PlaceMessOrderInput, ipHash: string) {
    if (!admin && (await this.features.find(MESS_FEATURE))?.status !== 'live')
      throw fail.notFound('The mess menu');
    const mess = await this.messes.find(slug);
    if (!mess || mess.kind !== 'restaurant' || (!mess.published && !admin))
      throw fail.notFound('That restaurant');
    if (!mess.ordersOpen)
      throw fail.badRequest(`${mess.name} isn't taking orders on the site right now. Call them instead.`);
    if (input.mode === 'delivery' && input.address.length < 3)
      throw fail.badRequest('Add where it should be delivered.');
    const phone = normaliseMobile(input.phone);
    if (!phone) throw fail.badRequest('Use a 10-digit Indian mobile number.');
    if (await this.extras.blocks?.find(slug, p.userId, phone))
      throw fail.badRequest(`${mess.name} isn't taking orders from this account.`);

    // Prices come from the restaurant's own list, never from the browser.
    const items = new Map(mess.order.flatMap((s) => s.items).map((i) => [i.name.toLowerCase(), i]));
    const lines = input.lines.map((l) => {
      const item = items.get(l.name.toLowerCase());
      if (!item) throw fail.badRequest(`"${l.name}" isn't on ${mess.name}'s list any more.`);
      if (item.available === false) throw fail.badRequest(`"${item.name}" is sold out right now.`);
      return { name: l.name, qty: l.qty, price: item.price, detail: l.detail };
    });

    await this.checkLimits(p.userId, ipHash, slug);
    if (mess.dailyOrderCap > 0) {
      // Since midnight on campus (IST): the owner's "most orders a day".
      const now = this.clock.now();
      const midnight = new Date(`${campusClock(now).date}T00:00:00+05:30`);
      const today = await this.orders.countSince({ messSlug: slug }, midnight);
      if (today >= mess.dailyOrderCap)
        throw fail.badRequest(`${mess.name} has taken all the orders it can today. Call them instead.`);
    }
    const order = await this.orders.add({
      code: newCode(),
      messSlug: slug,
      userId: p.userId,
      email: p.email,
      lines,
      total: lines.reduce((n, l) => n + l.qty * l.price, 0),
      mode: input.mode,
      address: input.mode === 'delivery' ? input.address : '',
      name: input.name,
      phone,
      note: input.note,
      ipHash,
    });
    await this.events?.placed(order, mess);
    return toDto(order, mess.name, 'student', await this.topic(order));
  }

  private async checkLimits(userId: string, ipHash: string, slug: string) {
    const now = this.clock.now().getTime();
    const day = new Date(now - DAY_MS);
    const [open, recent, mine, network, kitchen] = await Promise.all([
      this.orders.countOpenForUser(userId),
      this.orders.countSince({ userId }, new Date(now - ORDER_LIMITS.gapMs)),
      this.orders.countSince({ userId }, day),
      this.orders.countSince({ ipHash }, day),
      this.orders.countSince({ messSlug: slug }, day),
    ]);
    if (recent > 0) throw fail.rateLimited();
    if (open >= ORDER_LIMITS.openPerStudent)
      throw fail.badRequest('You have orders still being made. Wait for one to finish before ordering more.');
    if (mine >= ORDER_LIMITS.perStudentPerDay || network >= ORDER_LIMITS.perNetworkPerDay)
      throw fail.badRequest("That's the most orders for today. Call the restaurant if you need more.");
    if (kitchen >= ORDER_LIMITS.perMessPerDay)
      throw fail.badRequest('The restaurant has too many orders right now. Call them instead.');
  }

  async mine(p: Principal): Promise<MessOrderDto[]> {
    const names = new Map((await this.messes.list()).map((m) => [m.slug, m.name]));
    const list = await this.swept(await this.orders.listForUser(p.userId, 20));
    return Promise.all(
      list.map(async (o) => toDto(o, names.get(o.messSlug) ?? '', 'student', await this.topic(o))),
    );
  }

  async cancel(p: Principal, id: string): Promise<MessOrderDto> {
    const order = await this.orders.find(id);
    if (!order || order.userId !== p.userId) throw fail.notFound('That order');
    if (order.status !== 'placed')
      throw fail.badRequest('The restaurant has already started it. Call them to change it.');
    await this.orders.setStatus(id, 'cancelled', '');
    const saved = (await this.orders.patch(id, { endedBy: 'student' }))!;
    const mess = await this.messes.find(order.messSlug);
    if (mess) await this.events?.statusChanged(saved, mess, 'student');
    return toDto(saved, mess?.name ?? '', 'student', await this.topic(saved));
  }
}
