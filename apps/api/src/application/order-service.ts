import {
  type AdminDisputeDto,
  COMBO_PREFIX,
  type DisputeKind,
  HANDOVER,
  type HandoverInput,
  type InsightPeriod,
  MESS_ORDER_NEXT,
  MESS_PHOTO_MAX_BYTES,
  type MessDto,
  type MessOrderDto,
  type MessOrderStatus,
  NO_SHOW,
  type OrderStandingDto,
  type OwnedMessDto,
  type OwnerCustomerDetailDto,
  type OwnerCustomerDto,
  type OwnerMessInput,
  type PlaceMessOrderInput,
  type ReplyTimeDto,
  TIFFIN_MAKEUP_DAYS,
  TIFFIN_MEALS,
  TIFFIN_START_WITHIN_DAYS,
  type TiffinConfirmInput,
  type TiffinMarkInput,
  type TiffinMeal,
  type TiffinMealDto,
  type TiffinRowDto,
  type TiffinSheetDto,
  bestDiscount,
  campusClock,
  comboLineName,
  isTiffinItem,
  makeupUntil,
  normaliseEmail,
  normaliseMobile,
  offerLive,
  offerProblem,
  tiffinEnds,
} from '@ss/contracts';
import type {
  MessBlockRepository,
  MessOrderRecord,
  MessOrderRepository,
  MessRecord,
  MessRepository,
  MessViewRepository,
  OrderChatRepository,
  TiffinMarkRecord,
  TiffinMarkRepository,
} from '../domain/campus-ports';
import type { Principal } from '../domain/entities';
import type { Clock, FeatureRepository, UploadStore } from '../domain/ports';
import { MESS_FEATURE, toDto as messDto } from './campus-service';
import { fail } from './errors';
import type { FeeService } from './fee-service';
import {
  ORDER_SCOPE,
  handoverCode,
  mealScope,
  newHandoverSecret,
  noShowCounts,
  studentOptions,
  triesToday,
} from './handover';
import type { OrderEvents } from './order-events';
import { addDays, computeInsights, periodRange } from './owner-insights';
import type { PhoneService } from './phone-service';

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

/**
 * The restaurant sees a student's mobile number only while it has something to do for them: an
 * accepted order (until a day after it ends) or a running tiffin plan. Not on a new order it hasn't
 * accepted, and not on old orders, so numbers can't be collected for ordering off the site.
 */
export function ownerSeesPhone(o: MessOrderRecord, now: Date): boolean {
  if (o.status === 'accepted' || o.status === 'ready') return true;
  if (o.tiffin && o.status === 'done' && o.tiffin.endsOn >= campusClock(now).date) return true;
  const accepted = !!o.chat.acceptedAt || o.status === 'done' || !!o.chat.noShowAt;
  return accepted && o.status !== 'placed' && now.getTime() - o.updatedAt.getTime() < DAY_MS;
}

/** Whose eyes an order is shown to: their unread count, and what their own "clear chat" hid. */
export type OrderViewer = 'student' | 'owner' | 'admin';

export const toDto = (
  o: MessOrderRecord,
  /** The restaurant (its UPI ID is shown on pay-first orders), or just its name. */
  mess: string | { name: string; upiId?: string },
  viewer: OrderViewer = 'admin',
  topic = '',
  now: Date = new Date(),
): MessOrderDto => {
  const c = o.chat;
  const messName = typeof mess === 'string' ? mess : mess.name;
  const cleared = viewer === 'student' ? c.studentClearedAt : viewer === 'owner' ? c.ownerClearedAt : null;
  const showLast = !!c.lastAt && !!c.lastSender && (!cleared || c.lastAt > cleared);
  return {
    ...baseDto(o, messName),
    phone: viewer !== 'owner' || ownerSeesPhone(o, now) ? o.phone : '',
    respondedAt: c.respondedAt?.toISOString() ?? null,
    endedBy: c.endedBy,
    unread: viewer === 'student' ? c.studentUnread : viewer === 'owner' ? c.ownerUnread : 0,
    last: showLast
      ? { sender: c.lastSender as 'student', body: c.lastBody, at: c.lastAt!.toISOString() }
      : null,
    topic,
    tiffin: o.tiffin ?? null,
    payment: c.payment ?? '',
    upiId: c.payment && typeof mess !== 'string' ? (mess.upiId ?? '') : '',
    noShow: !!c.noShowAt,
    trust: null,
    // The code is the student's alone, and only while there's food still to hand over.
    handoverCode:
      viewer === 'student' && !o.tiffin && ['placed', 'accepted', 'ready'].includes(o.status)
        ? handoverCode(c.handoverSecret, ORDER_SCOPE)
        : '',
    handoverHow: c.handoverHow,
    handedOverAt: c.handedOverAt?.toISOString() ?? null,
    dispute: c.dispute
      ? { kind: c.dispute, state: c.disputeState, at: c.disputedAt?.toISOString() ?? '', note: c.disputeNote }
      : null,
    ...(viewer === 'student' ? studentOptions(o, now) : { canConfirm: false, canDispute: '' as DisputeKind }),
  };
};

const DAY = 24 * 3600 * 1000;
/** No-shows in the window, from a student's recent orders. */
export function standingOf(orders: MessOrderRecord[], now: Date): OrderStandingDto {
  const since = now.getTime() - NO_SHOW.windowDays * DAY;
  const misses = orders
    .filter(noShowCounts)
    .map((o) => o.chat.noShowAt?.getTime() ?? 0)
    .filter((t) => t > since)
    .sort((a, b) => b - a);
  const paused = misses.length >= NO_SHOW.pauseAt;
  // Paused until enough of them are older than the window to fall below the line.
  const until = paused ? misses[NO_SHOW.pauseAt - 1]! + NO_SHOW.windowDays * DAY : 0;
  return {
    noShows: misses.length,
    payFirst: misses.length >= NO_SHOW.payFirstAt,
    pausedUntil: paused ? new Date(until).toISOString() : null,
  };
}

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
  discount: o.discount ?? 0,
  offer: o.offer ?? '',
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
  /** Checked mobile numbers: with an SMS service set up, every order needs one. */
  phones?: PhoneService;
  /** Opens of each restaurant page, for the owner's insights. */
  views?: MessViewRepository;
  /** Tiffin meals marked delivered or missed. */
  tiffinMarks?: TiffinMarkRepository;
  /** Restaurant fees: written when an order is accepted. */
  fees?: FeeService;
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
    await this.events.prunePresence();
    await this.extras.fees?.reconcile().catch(() => 0);
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
    // Offers must make sense against the menu they're saved with.
    const menu = input.order.flatMap((s) => s.items);
    for (const o of input.offers ?? []) {
      const problem = offerProblem(o, menu);
      if (problem) throw fail.badRequest(problem);
    }
    const codes = (input.offers ?? []).filter((o) => o.kind === 'code').map((o) => o.code);
    if (new Set(codes).size !== codes.length) throw fail.badRequest('Two offers use the same code.');
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
    const trust = await this.trustFor(list.filter((o) => ['placed', 'accepted', 'ready'].includes(o.status)));
    return Promise.all(
      list.map(async (o) => ({
        ...toDto(o, mess, 'owner', await this.topic(o), this.clock.now()),
        trust: trust.get(o.userId) ?? null,
      })),
    );
  }

  /** Each student's record across all restaurants: orders that went through, and no-shows. */
  private async trustFor(list: MessOrderRecord[]) {
    const out = new Map<string, { orders: number; noShows: number }>();
    const now = this.clock.now();
    const users = [...new Set(list.map((o) => o.userId))].slice(0, 30);
    const lists = await Promise.all(users.map((u) => this.orders.listForUser(u, 100)));
    users.forEach((userId, i) => {
      const theirs = lists[i]!;
      out.set(userId, {
        orders: theirs.filter((o) => ['accepted', 'ready', 'done'].includes(o.status)).length,
        noShows: standingOf(theirs, now).noShows,
      });
    });
    return out;
  }

  /** A student's standing: how many orders they didn't collect, and what that means now. */
  async standing(p: Principal): Promise<OrderStandingDto> {
    return standingOf(await this.orders.listForUser(p.userId, 100), this.clock.now());
  }

  /** The restaurant saw the student's UPI payment arrive: the order can now be accepted. */
  async confirmPaid(p: Principal, admin: boolean, id: string) {
    const order = await this.orders.find(id);
    if (!order) throw fail.notFound('That order');
    const mess = await this.ownedMess(p, admin, order.messSlug);
    if (order.status !== 'placed' || !order.chat.payment)
      throw fail.badRequest('This order has no payment waiting.');
    let saved = order;
    if (order.chat.payment !== 'paid') {
      saved =
        (await this.orders.patch(
          id,
          { payment: 'paid', paidAt: order.chat.paidAt ?? this.clock.now() },
          'placed',
        )) ?? order;
      await this.events?.system(saved, 'The restaurant received the payment.').catch(() => {});
      await this.events?.ping(saved);
    }
    return toDto(saved, mess, 'owner', await this.topic(saved));
  }

  /** The student never came for it (or never took the delivery): it ends, and counts against them. */
  async noShow(p: Principal, admin: boolean, id: string) {
    const order = await this.orders.find(id);
    if (!order) throw fail.notFound('That order');
    const mess = await this.ownedMess(p, admin, order.messSlug);
    if (order.tiffin || !['accepted', 'ready'].includes(order.status))
      throw fail.badRequest('Only an accepted order that was never collected can be marked.');
    const since = (order.chat.respondedAt ?? order.createdAt).getTime();
    const wait = HANDOVER.noShowAfterMinutes * 60_000 - (this.clock.now().getTime() - since);
    if (wait > 0)
      throw fail.badRequest(
        `Give the student time to come: you can mark this in ${Math.ceil(wait / 60_000)} min.`,
      );
    if (order.chat.dispute === 'not_received' && order.chat.disputeState === 'open')
      throw fail.badRequest('The student says this never reached them. The admin will look at it.');
    const saved = await this.orders.patch(
      id,
      { status: 'cancelled', endedBy: 'owner', ownerNote: 'Not collected', noShowAt: this.clock.now() },
      order.status,
    );
    if (!saved) throw fail.badRequest('This order just changed. Look again.');
    await this.events?.statusChanged(saved, mess, 'owner', order.status);
    const now = (await this.orders.find(id)) ?? saved;
    return toDto(now, mess, 'owner', await this.topic(now));
  }

  /**
   * The restaurant hands the food over. With the student's code it's proved; without one (left at
   * the door, phone dead) it's the restaurant's word, and the student is asked "Did you get it?".
   * A code typed later on a handover marked without one upgrades it (and settles a contest).
   */
  async handover(p: Principal, admin: boolean, id: string, input: HandoverInput) {
    const order = await this.orders.find(id);
    if (!order) throw fail.notFound('That order');
    const mess = await this.ownedMess(p, admin, order.messSlug);
    if (order.tiffin) throw fail.badRequest('Tiffin meals are marked on the tiffin sheet.');
    const c = order.chat;
    const upgrade = order.status === 'done' && c.handoverHow === 'owner' && !!input.code;
    if (!upgrade && order.status !== 'accepted' && order.status !== 'ready')
      throw fail.badRequest(
        order.status === 'done' ? 'This order was already handed over.' : 'Accept the order first.',
      );
    const now = this.clock.now();
    const today = campusClock(now).date;
    let how: 'code' | 'owner';
    if (input.code) {
      if (!c.handoverSecret) throw fail.badRequest('This order has no code. Hand it over without one.');
      const tries = triesToday(order, today);
      if (tries >= HANDOVER.triesPerDay)
        throw fail.badRequest(
          'Too many wrong codes today. Hand it over without the code: the student will be asked to confirm.',
        );
      if (input.code !== handoverCode(c.handoverSecret, ORDER_SCOPE)) {
        await this.orders.patch(id, { handoverTries: tries + 1, handoverTriesOn: today });
        const left = HANDOVER.triesPerDay - tries - 1;
        throw fail.badRequest(
          left > 0
            ? `That's not the student's code. ${left} ${left === 1 ? 'try' : 'tries'} left today.`
            : 'That code is wrong too. Hand it over without the code: the student will be asked to confirm.',
        );
      }
      how = 'code';
    } else {
      if (!input.withoutCode) throw fail.badRequest("Type the student's 4-digit code.");
      how = 'owner';
    }
    const settles = c.dispute === 'not_received' && c.disputeState === 'open' && how === 'code';
    const saved = await this.orders.patch(
      id,
      {
        status: 'done',
        handoverHow: how,
        handedOverAt: upgrade ? (c.handedOverAt ?? now) : now,
        ...(settles ? { disputeState: 'settled' as const } : {}),
      },
      order.status,
    );
    if (!saved) throw fail.badRequest('This order just changed. Look again.');
    const said =
      how === 'code'
        ? upgrade
          ? "The student's code was entered: it reached them."
          : "Handed over. The student's code matched."
        : c.handoverSecret
          ? 'The restaurant marked it handed over without the code. Did you get it? Say so on the order.'
          : undefined;
    if (upgrade) {
      await this.events?.system(saved, said!).catch(() => {});
      await this.events?.ping(saved);
    } else await this.events?.statusChanged(saved, mess, 'owner', order.status, said);
    const after = (await this.orders.find(id)) ?? saved;
    return toDto(after, mess, 'owner', await this.topic(after), now);
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
    // A tiffin plan still running can be stopped by the restaurant (out of tiffins, closing…).
    const runningTiffin =
      order.status === 'done' && !!order.tiffin && order.tiffin.endsOn >= campusClock(this.clock.now()).date;
    if (!MESS_ORDER_NEXT[order.status].includes(status) && !(runningTiffin && status === 'rejected'))
      throw fail.badRequest(`This order is already ${order.status}; it can't be moved to ${status}.`);
    // "Done" without a code (an older screen): handed over on the restaurant's word, the student confirms.
    if (status === 'done' && !order.tiffin)
      return this.handover(p, admin, id, { code: '', withoutCode: true });
    if (status === 'rejected' && note.length < 3) throw fail.badRequest('Say why, so the student knows.');
    if (status === 'accepted' && (order.chat.payment === 'due' || order.chat.payment === 'claimed'))
      throw fail.badRequest(
        'This order is paid first. Check your UPI app, tap "Payment received", then accept it.',
      );
    // A tiffin plan has no kitchen steps: accepting it switches it on for its 30 days.
    const to = order.tiffin && status === 'accepted' ? 'done' : status;
    const why =
      order.tiffin && status === 'accepted' && !note
        ? `Tiffin on from ${order.tiffin.startsOn} to ${order.tiffin.endsOn}`
        : note;
    let saved = await this.orders.setStatus(id, to, why);
    if (!saved) throw fail.notFound('That order');
    if (order.status === 'placed')
      saved =
        (await this.orders.patch(id, {
          respondedAt: this.clock.now(),
          ...(status === 'accepted' ? { acceptedAt: this.clock.now() } : {}),
        })) ?? saved;
    if (status === 'rejected') saved = (await this.orders.patch(id, { endedBy: 'owner' })) ?? saved;
    // The fee is written the moment an order is accepted (the cron writes it if this fails), and a
    // cancellation soon after accepting (ran out, closed) isn't charged.
    if (order.status === 'placed' && status === 'accepted')
      await this.extras.fees?.accepted(saved).catch(() => {});
    if (status === 'rejected' && order.status !== 'placed')
      await this.extras.fees?.cancelledAfterAccepting(saved).catch(() => {});
    await this.events?.statusChanged(saved, mess, 'owner', order.status);
    saved = (await this.orders.find(id)) ?? saved;
    this.replyCache.delete(mess.slug);
    return toDto(saved, mess, 'owner', await this.topic(saved));
  }

  /**
   * Someone opened a restaurant's page: counted once per visitor per day for its owner's insights.
   * The owners themselves (and admins) are not counted, so the numbers are real customers.
   */
  async recordView(
    slug: string,
    who: { userId: string; email: string } | null,
    admin: boolean,
    ipHash: string,
  ) {
    if (!this.extras.views || admin) return;
    const mess = await this.messes.find(slug);
    if (!mess || mess.kind !== 'restaurant' || !mess.published) return;
    if (who && mess.ownerEmails.includes(normaliseEmail(who.email))) return;
    const day = campusClock(this.clock.now()).date;
    await this.extras.views.hit(slug, day, who ? `u:${who.userId}` : `a:${ipHash}`, who?.userId ?? null);
  }

  /** The owner's numbers for a day, week, month or year (campus time), with the period before. */
  async insights(p: Principal, admin: boolean, slug: string, period: InsightPeriod, anchor?: string) {
    await this.ownedMess(p, admin, slug);
    const today = campusClock(this.clock.now()).date;
    const at = anchor && /^\d{4}-\d{2}-\d{2}$/.test(anchor) && anchor <= today ? anchor : today;
    const r = periodRange(period, at);
    const prev = periodRange(period, r.prev);
    // A year before the previous period too: to tell new customers from returning ones.
    const since = new Date(`${addDays(prev.from, -365)}T00:00:00+05:30`);
    const [orders, views] = await Promise.all([
      this.orders.listSince(since, 10000, slug),
      this.extras.views ? this.extras.views.between(slug, prev.from, r.to) : Promise.resolve([]),
    ]);
    return computeInsights({ period, anchor: at, now: this.clock.now(), orders, views });
  }

  /** Everyone who ordered here in the last 90 days, newest first: the owner's customer list. */
  async customers(p: Principal, admin: boolean, slug: string): Promise<OwnerCustomerDto[]> {
    await this.ownedMess(p, admin, slug);
    const since = new Date(this.clock.now().getTime() - 90 * DAY_MS);
    const [orders, blocks] = await Promise.all([
      this.orders.listSince(since, 2000, slug),
      this.extras.blocks ? this.extras.blocks.list(slug) : Promise.resolve([]),
    ]);
    const today = campusClock(this.clock.now()).date;
    const blocked = new Set(blocks.map((b) => b.userId));
    const by = new Map<string, OwnerCustomerDto>();
    // Oldest first, so the latest order's name and number win.
    for (const o of [...orders].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      const c = by.get(o.userId) ?? {
        userId: o.userId,
        name: o.name,
        phone: '',
        orders: 0,
        spent: 0,
        firstOrderAt: o.createdAt.toISOString(),
        lastOrderAt: o.createdAt.toISOString(),
        lastOrderId: o.id,
        tiffin: null,
        blocked: blocked.has(o.userId),
      };
      c.orders++;
      if (o.status !== 'rejected' && o.status !== 'cancelled') c.spent += o.total;
      c.name = o.name || c.name;
      // Only a customer with an order on the go (or a running tiffin) shows a number.
      if (ownerSeesPhone(o, this.clock.now())) c.phone = o.phone || c.phone;
      c.lastOrderAt = o.createdAt.toISOString();
      c.lastOrderId = o.id;
      if (o.tiffin && o.status === 'done' && o.tiffin.endsOn >= today) c.tiffin = o.tiffin;
      by.set(o.userId, c);
    }
    return [...by.values()].sort((a, b) => b.lastOrderAt.localeCompare(a.lastOrderAt));
  }

  /** One student's record at this restaurant over the last 12 months: visits, orders, habits. */
  async customer(
    p: Principal,
    admin: boolean,
    slug: string,
    userId: string,
  ): Promise<OwnerCustomerDetailDto> {
    await this.ownedMess(p, admin, slug);
    const now = this.clock.now();
    const since = new Date(now.getTime() - 365 * DAY_MS);
    const today = campusClock(now).date;
    const fromDay = campusClock(since).date;
    const [all, views, blocks] = await Promise.all([
      this.orders.listSince(since, 5000, slug),
      this.extras.views ? this.extras.views.between(slug, fromDay, today) : Promise.resolve([]),
      this.extras.blocks ? this.extras.blocks.list(slug) : Promise.resolve([]),
    ]);
    const mine = all
      .filter((o) => o.userId === userId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (!mine.length) throw fail.notFound('That customer');
    const last = mine[mine.length - 1]!;
    const done = mine.filter((o) => o.status === 'accepted' || o.status === 'ready' || o.status === 'done');
    const spent = done.reduce((n, o) => n + o.total, 0);
    const active = mine.filter((o) => o.tiffin && o.status === 'done' && o.tiffin.endsOn >= today).at(-1);
    const dishes = new Map<string, number>();
    for (const o of done) for (const l of o.lines) dishes.set(l.name, (dishes.get(l.name) ?? 0) + l.qty);
    const hours = new Array(24).fill(0) as number[];
    for (const o of mine) hours[Math.floor(campusClock(o.createdAt).minutes / 60)]!++;
    const peak = Math.max(...hours);
    const months = new Map<string, { spent: number; orders: number }>();
    for (const o of mine) {
      const m = campusClock(o.createdAt).date.slice(0, 7);
      const row = months.get(m) ?? { spent: 0, orders: 0 };
      row.orders++;
      if (done.includes(o)) row.spent += o.total;
      months.set(m, row);
    }
    const seen = views.filter((v) => v.userId === userId || v.visitor === `u:${userId}`);
    return {
      customer: {
        userId,
        name: last.name,
        phone: mine.some((o) => ownerSeesPhone(o, now)) ? last.phone : '',
        orders: mine.length,
        spent,
        firstOrderAt: mine[0]!.createdAt.toISOString(),
        lastOrderAt: last.createdAt.toISOString(),
        lastOrderId: last.id,
        tiffin: active?.tiffin ? ({ ...active.tiffin } as OwnerCustomerDto['tiffin']) : null,
        blocked: blocks.some((b) => b.userId === userId),
      },
      visitDays: seen.length,
      views: seen.reduce((n, v) => n + v.views, 0),
      completed: done.length,
      cancelledByThem: mine.filter((o) => o.status === 'cancelled' && o.chat.endedBy === 'student').length,
      declinedByYou: mine.filter(
        (o) =>
          o.status === 'rejected' ||
          (o.status === 'cancelled' && o.chat.endedBy === 'owner' && !o.chat.noShowAt),
      ).length,
      unanswered: mine.filter((o) => o.status === 'cancelled' && o.chat.endedBy === 'auto').length,
      noShows: mine.filter((o) => o.chat.noShowAt).length,
      noShowsEverywhere: standingOf(await this.orders.listForUser(userId, 100), now).noShows,
      avgOrder: done.length ? Math.round(spent / done.length) : 0,
      modes: {
        delivery: mine.filter((o) => o.mode === 'delivery').length,
        pickup: mine.filter((o) => o.mode === 'pickup').length,
      },
      favourites: [...dishes.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, qty]) => ({ name, qty })),
      usualHour: peak > 0 ? hours.indexOf(peak) : -1,
      months: [...months.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, r]) => ({ month, ...r })),
      history: [...mine].reverse().map((o) => ({
        id: o.id,
        code: o.code,
        createdAt: o.createdAt.toISOString(),
        total: o.total,
        status: o.status,
        mode: o.mode,
        items: o.lines.map((l) => `${l.qty} × ${l.name}`).join(', '),
        offer: o.offer,
      })),
    };
  }

  /**
   * The tiffin delivery sheet for a day: who gets lunch and dinner (with how each was marked),
   * missed meals from the last few days that can still be made up, and plans ending soon.
   */
  async tiffinSheet(p: Principal, admin: boolean, slug: string, date?: string): Promise<TiffinSheetDto> {
    await this.ownedMess(p, admin, slug);
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : campusClock(this.clock.now()).date;
    const since = new Date(this.clock.now().getTime() - 75 * DAY_MS);
    const all = (await this.orders.listSince(since, 3000, slug)).filter((o) => o.tiffin);
    const plans = all.filter((o) => o.status === 'done');
    // Marks over the plans' whole lives (for each student's record), not just around this day.
    const firstDay = plans.reduce(
      (m, o) => (o.tiffin!.startsOn < m ? o.tiffin!.startsOn : m),
      addDays(day, -TIFFIN_MAKEUP_DAYS),
    );
    const marks = this.extras.tiffinMarks
      ? await this.extras.tiffinMarks.list(
          plans.map((o) => o.id),
          firstDay,
          addDays(day, TIFFIN_MAKEUP_DAYS),
        )
      : [];
    const fullMark = (id: string, d: string, meal: TiffinMeal, makeupFor = '') =>
      marks.find((m) => m.orderId === id && m.day === d && m.meal === meal && m.makeupFor === makeupFor);
    const markOf = (id: string, d: string, meal: TiffinMeal, makeupFor = '') =>
      fullMark(id, d, meal, makeupFor)?.status ?? null;
    const serves = (o: MessOrderRecord, meal: TiffinMeal) =>
      o.tiffin!.plan === 'both' || o.tiffin!.plan === meal;
    const soonDay = addDays(day, 3);
    const today = campusClock(this.clock.now()).date;
    // One student's plan so far, up to the sheet's day.
    const recordOf = (o: MessOrderRecord): TiffinRowDto['record'] => {
      const t = o.tiffin!;
      const perDay = t.plan === 'both' ? 2 : 1;
      const days = Math.round((Date.parse(t.endsOn) - Date.parse(t.startsOn)) / DAY_MS) + 1;
      const mine = marks.filter((m) => m.orderId === o.id);
      const regular = mine.filter((m) => m.makeupFor === '' && m.day <= day);
      const delivered = regular.filter((m) => m.status === 'delivered').length;
      const missedMarks = regular.filter((m) => m.status === 'missed');
      const madeUp = mine.filter(
        (m) => m.makeupFor !== '' && m.status === 'delivered' && m.day <= day,
      ).length;
      const lapsed = missedMarks.filter(
        (m) =>
          addDays(m.day, TIFFIN_MAKEUP_DAYS) < today &&
          !mine.some((x) => x.makeupFor === m.day && x.meal === m.meal && x.status === 'delivered'),
      ).length;
      const upTo = day < t.endsOn ? day : t.endsOn;
      const daysSoFar =
        upTo < t.startsOn ? 0 : Math.round((Date.parse(upTo) - Date.parse(t.startsOn)) / DAY_MS) + 1;
      const scheduled = daysSoFar * perDay;
      return {
        total: days * perDay,
        delivered,
        missed: missedMarks.length,
        madeUp,
        lapsed,
        unmarked: Math.max(0, scheduled - delivered - missedMarks.length),
        left: Math.max(0, days * perDay - scheduled),
      };
    };
    const row = (
      o: MessOrderRecord,
      meal: TiffinMeal,
      mark: TiffinRowDto['mark'],
      makeupFor = '',
    ): TiffinRowDto => ({
      orderId: o.id,
      code: o.code,
      name: o.name,
      phone: o.phone,
      mode: o.mode,
      address: o.address,
      plan: o.tiffin!.plan,
      startsOn: o.tiffin!.startsOn,
      endsOn: o.tiffin!.endsOn,
      note: o.note,
      unread: o.chat.ownerUnread,
      meal,
      mark,
      how: mark ? (fullMark(o.id, day, meal, makeupFor)?.how ?? '') : '',
      confirm: mark ? (fullMark(o.id, day, meal, makeupFor)?.confirm ?? '') : '',
      makeupFor,
      makeupUntil: makeupFor ? makeupUntil(makeupFor) : '',
      record: recordOf(o),
    });
    const on = plans.filter((o) => o.tiffin!.startsOn <= day && o.tiffin!.endsOn >= day);
    const byPlace = (x: TiffinRowDto, y: TiffinRowDto) =>
      x.address.localeCompare(y.address) || x.name.localeCompare(y.name);
    const meals = (meal: TiffinMeal) =>
      on
        .filter((o) => serves(o, meal))
        .map((o) => row(o, meal, markOf(o.id, day, meal)))
        .sort(byPlace);
    const lunch = meals('lunch');
    const dinner = meals('dinner');
    // A meal missed in the last few days, not yet made up on another day: it can still be given.
    const makeups: TiffinRowDto[] = [];
    for (const o of plans)
      for (let back = TIFFIN_MAKEUP_DAYS; back >= 1; back--) {
        const missedOn = addDays(day, -back);
        for (const meal of TIFFIN_MEALS) {
          if (!serves(o, meal) || markOf(o.id, missedOn, meal) !== 'missed') continue;
          const usedElsewhere = marks.some(
            (m) =>
              m.orderId === o.id &&
              m.meal === meal &&
              m.makeupFor === missedOn &&
              m.day !== day &&
              m.status === 'delivered',
          );
          if (!usedElsewhere) makeups.push(row(o, meal, markOf(o.id, day, meal, missedOn), missedOn));
        }
      }
    const regular = [...lunch, ...dinner];
    return {
      date: day,
      lunch,
      dinner,
      makeups: makeups.sort((x, y) => x.makeupUntil.localeCompare(y.makeupUntil) || byPlace(x, y)),
      counts: {
        delivered: regular.filter((r) => r.mark === 'delivered').length,
        missed: regular.filter((r) => r.mark === 'missed').length,
        pending: regular.filter((r) => !r.mark).length,
      },
      ending: on
        .filter((o) => o.tiffin!.endsOn <= soonDay)
        .map((o) => row(o, o.tiffin!.plan === 'dinner' ? 'dinner' : 'lunch', null)),
      waiting: all.filter((o) => o.status === 'placed').length,
      active: on.length,
    };
  }

  /** The checks every tiffin meal key must pass: on the plan, or a make-up for a meal really missed. */
  private async checkMeal(
    order: MessOrderRecord,
    input: { day: string; meal: TiffinMeal; makeupFor: string },
    givenNow: boolean,
  ) {
    const t = order.tiffin!;
    if (t.plan !== 'both' && t.plan !== input.meal)
      throw fail.badRequest(`This plan doesn't include ${input.meal}.`);
    if (input.makeupFor) {
      const missed = await this.extras.tiffinMarks!.list([order.id], input.makeupFor, input.makeupFor);
      if (!missed.some((m) => m.meal === input.meal && !m.makeupFor && m.status === 'missed'))
        throw fail.badRequest('That meal was not marked missed.');
      if (givenNow && (input.day <= input.makeupFor || input.day > makeupUntil(input.makeupFor)))
        throw fail.badRequest(`A missed meal can be made up within ${TIFFIN_MAKEUP_DAYS} days.`);
    } else if (input.day < t.startsOn || input.day > t.endsOn) {
      throw fail.badRequest('That day is outside the plan.');
    }
  }

  private async markOn(key: { orderId: string; day: string; meal: TiffinMeal; makeupFor: string }) {
    const list = await this.extras.tiffinMarks!.list([key.orderId], key.day, key.day);
    return list.find((m) => m.meal === key.meal && m.makeupFor === key.makeupFor) ?? null;
  }

  /** A line in the chat that isn't news to whoever did it (their unread count stays as it was). */
  private async say(order: MessOrderRecord, text: string, by: 'student' | 'owner' | 'admin') {
    if (!this.events) return;
    await this.events.system(order, text).catch(() => {});
    if (by === 'student')
      await this.orders.patch(order.id, { studentUnread: order.chat.studentUnread }).catch(() => null);
    if (by === 'owner')
      await this.orders.patch(order.id, { ownerUnread: order.chat.ownerUnread }).catch(() => null);
  }

  /**
   * The owner marks a tiffin meal: delivered, missed, or takes the mark back. Delivered takes the
   * student's code for that meal; without one, the student is asked "Did you get it?". A make-up
   * meal (for a meal missed on `makeupFor`) can only be given within TIFFIN_MAKEUP_DAYS days.
   */
  async markTiffin(p: Principal, admin: boolean, input: TiffinMarkInput) {
    const order = await this.orders.find(input.orderId);
    if (!order || !order.tiffin) throw fail.notFound('That tiffin plan');
    const mess = await this.ownedMess(p, admin, order.messSlug);
    if (!this.extras.tiffinMarks) throw fail.badRequest('Tiffin marks are not set up.');
    if (order.status !== 'done') throw fail.badRequest("This tiffin plan isn't running.");
    const now = this.clock.now();
    const today = campusClock(now).date;
    if (input.day > today) throw fail.badRequest("You can't mark a day that hasn't come yet.");
    if (input.makeupFor && input.status === 'missed')
      throw fail.badRequest('A make-up meal is either given or not.');
    await this.checkMeal(order, input, true);
    const key = { orderId: order.id, day: input.day, meal: input.meal, makeupFor: input.makeupFor };
    const label = input.meal === 'lunch' ? 'Lunch' : 'Dinner';
    const existing = await this.markOn(key);
    // A meal the student says never came: only their code for it (proof) changes that now.
    if (existing?.confirm === 'no' && !existing.decided && !(input.status === 'delivered' && input.code))
      throw fail.badRequest(
        'The student says this meal never came. Type their code for it, or the admin will decide.',
      );
    const secret = order.chat.handoverSecret;
    if (input.status === 'delivered') {
      let how: TiffinMarkRecord['how'] = secret ? 'owner' : '';
      if (input.code) {
        if (!secret) throw fail.badRequest('This plan has no codes. Mark it without one.');
        const tries = triesToday(order, today);
        if (tries >= HANDOVER.triesPerDay)
          throw fail.badRequest(
            'Too many wrong codes today. Mark it without the code: the student will be asked to confirm.',
          );
        if (input.code !== handoverCode(secret, mealScope(input.day, input.meal, input.makeupFor))) {
          await this.orders.patch(order.id, { handoverTries: tries + 1, handoverTriesOn: today });
          const left = HANDOVER.triesPerDay - tries - 1;
          throw fail.badRequest(
            left > 0
              ? `That's not the student's code for this ${input.meal}. ${left} ${left === 1 ? 'try' : 'tries'} left today.`
              : 'That code is wrong too. Mark it without the code: the student will be asked to confirm.',
          );
        }
        how = 'code';
      }
      // Already proved (code, or the student's own word): marking it again without a code changes nothing.
      const proved =
        existing?.status === 'delivered' && (existing.how === 'code' || existing.how === 'student');
      if (!(proved && how !== 'code')) {
        await this.extras.tiffinMarks.set({ ...key, status: 'delivered', how, confirm: '', decided: '' });
        if (existing?.confirm === 'no')
          await this.say(
            order,
            `${label} on ${input.day}: the student's code was entered, so it reached them.`,
            'owner',
          );
        if (how === 'owner')
          await this.events
            ?.toStudent(
              order,
              {
                title: `${mess.name} · ${label.toLowerCase()} delivered?`,
                body: `${mess.name} marked your ${input.meal} delivered without your code. Did you get it? Tap to say.`,
                tag: `tiffin-${order.id}-${input.day}-${input.meal}`,
                url: '/my-orders',
              },
              2 * 24 * 3600,
              ['orders'],
            )
            .catch(() => null);
      }
    } else if (input.status === 'missed') {
      await this.extras.tiffinMarks.set({ ...key, status: 'missed' });
    } else {
      await this.extras.tiffinMarks.clear(key);
    }
    if (input.status === 'missed' && !input.makeupFor)
      await this.say(
        order,
        `${label} on ${input.day} was missed. It can be made up until ${makeupUntil(input.day)}.`,
        'owner',
      );
    await this.events?.ping(order);
    return this.tiffinSheet(p, admin, mess.slug, input.day);
  }

  /** The student's meals to show: today's (with codes), make-ups due, and deliveries to confirm. */
  private studentMeals(o: MessOrderRecord, mine: TiffinMarkRecord[], today: string, now: Date) {
    const t = o.tiffin!;
    const secret = o.chat.handoverSecret;
    const serves = (meal: TiffinMeal) => t.plan === 'both' || t.plan === meal;
    const find = (day: string, meal: TiffinMeal, makeupFor: string) =>
      mine.find((m) => m.day === day && m.meal === meal && m.makeupFor === makeupFor);
    const fresh = (m: TiffinMarkRecord) =>
      !m.markedAt || now.getTime() - m.markedAt.getTime() <= HANDOVER.answerHours * 3600_000;
    const out: TiffinMealDto[] = [];
    const add = (day: string, meal: TiffinMeal, makeupFor: string) => {
      const m = find(day, meal, makeupFor);
      const open = !m;
      out.push({
        day,
        meal,
        makeupFor,
        code: open && secret ? handoverCode(secret, mealScope(day, meal, makeupFor)) : '',
        mark: m?.status ?? null,
        how: m?.how ?? '',
        confirm: m?.confirm ?? '',
        canAnswer:
          (open && day === today) ||
          (!!m && m.status === 'delivered' && m.how === 'owner' && !m.decided && fresh(m)),
      });
    };
    if (t.startsOn <= today && today <= t.endsOn)
      for (const meal of TIFFIN_MEALS) if (serves(meal)) add(today, meal, '');
    // A missed meal that can still be made up: today's make-up gets its own code.
    for (const m of mine)
      if (
        !m.makeupFor &&
        m.status === 'missed' &&
        m.day < today &&
        makeupUntil(m.day) >= today &&
        !mine.some(
          (x) => x.makeupFor === m.day && x.meal === m.meal && x.status === 'delivered' && x.day !== today,
        )
      )
        add(today, m.meal, m.day);
    // Earlier deliveries marked without a code that still wait for "Did you get it?".
    for (const m of mine)
      if (
        m.status === 'delivered' &&
        m.how === 'owner' &&
        !m.decided &&
        fresh(m) &&
        !out.some((x) => x.day === m.day && x.meal === m.meal && x.makeupFor === m.makeupFor)
      )
        add(m.day, m.meal, m.makeupFor);
    return out;
  }

  /**
   * The student about one tiffin meal: "I got it" (today's meal, or one marked delivered without
   * their code), or "I didn't get it" (only on one marked delivered without their code, within
   * HANDOVER.answerHours). A "no" goes to the admin.
   */
  async confirmTiffin(p: Principal, input: TiffinConfirmInput): Promise<MessOrderDto[]> {
    const order = await this.orders.find(input.orderId);
    if (!order || order.userId !== p.userId || !order.tiffin) throw fail.notFound('That tiffin plan');
    if (!this.extras.tiffinMarks) throw fail.badRequest('Tiffin marks are not set up.');
    if (order.status !== 'done') throw fail.badRequest("This tiffin plan isn't running.");
    const mess = await this.messes.find(order.messSlug);
    const now = this.clock.now();
    const today = campusClock(now).date;
    const key = { orderId: order.id, day: input.day, meal: input.meal, makeupFor: input.makeupFor };
    const label = input.meal === 'lunch' ? 'Lunch' : 'Dinner';
    const m = await this.markOn(key);
    const answerable =
      !!m &&
      m.status === 'delivered' &&
      m.how === 'owner' &&
      !m.decided &&
      (!m.markedAt || now.getTime() - m.markedAt.getTime() <= HANDOVER.answerHours * 3600_000);
    if (input.answer === 'yes') {
      if (!m) {
        if (input.day !== today) throw fail.badRequest("You can only say so for today's meal.");
        await this.checkMeal(order, input, true);
        await this.extras.tiffinMarks.set({ ...key, status: 'delivered', how: 'student' });
        await this.say(order, `${label} on ${input.day}: the student says they got it.`, 'student');
      } else if (answerable) {
        if (m.confirm !== 'yes') {
          await this.extras.tiffinMarks.set({ ...m, confirm: 'yes' });
          await this.say(order, `${label} on ${input.day}: the student confirmed they got it.`, 'student');
        }
      } else throw fail.badRequest('There is nothing to confirm for this meal.');
    } else {
      if (!answerable)
        throw fail.badRequest(
          `You can say a meal didn't come only when it was marked delivered without your code, within ${HANDOVER.answerHours} hours.`,
        );
      if (m!.confirm !== 'no') {
        await this.extras.tiffinMarks.set({ ...m!, confirm: 'no' });
        await this.say(
          order,
          `${label} on ${input.day}: the student says it never came. The admin will look at it.`,
          'student',
        );
        if (mess)
          await this.events
            ?.toOwners(
              mess,
              {
                title: `⚠️ ${order.name}: ${input.meal} not received`,
                body: `${order.name} says their ${input.meal} on ${input.day} never came. If it did, type their code for it on the tiffin sheet.`,
                tag: `tiffin-${order.id}-${input.day}-${input.meal}`,
                url: '/orders',
              },
              24 * 3600,
            )
            .catch(() => null);
      }
    }
    await this.events?.ping(order);
    return this.mine(p);
  }

  // ── Handover from the student's side, and contests ──

  /** The student says they got the food: the order is done (or a handover without code is confirmed). */
  async confirmReceived(p: Principal, id: string): Promise<MessOrderDto> {
    const order = await this.orders.find(id);
    if (!order || order.userId !== p.userId) throw fail.notFound('That order');
    const mess = await this.messes.find(order.messSlug);
    const now = this.clock.now();
    if (!studentOptions(order, now).canConfirm)
      throw fail.badRequest('There is nothing to confirm on this order.');
    let saved: MessOrderRecord | null;
    if (order.status === 'accepted' || order.status === 'ready') {
      saved = await this.orders.patch(
        id,
        { status: 'done', handoverHow: 'student', handedOverAt: now },
        order.status,
      );
      if (!saved) throw fail.badRequest('This order just changed. Look again.');
      await this.say(saved, 'The student says they got it.', 'student');
    } else {
      const withdrawn = order.chat.dispute === 'not_received' && order.chat.disputeState === 'open';
      saved = await this.orders.patch(id, {
        handoverHow: 'student',
        ...(withdrawn ? { disputeState: 'settled' as const } : {}),
      });
      await this.say(
        saved ?? order,
        withdrawn ? 'The student says it reached them after all.' : 'The student confirmed they got it.',
        'student',
      );
    }
    await this.events?.ping(order);
    const after = (await this.orders.find(id)) ?? saved ?? order;
    return toDto(after, mess ?? '', 'student', await this.topic(after), now);
  }

  /** The student contests: food that never came, or a "didn't collect" they say is wrong. */
  async dispute(p: Principal, id: string, kind: 'not_received' | 'no_show', note: string) {
    const order = await this.orders.find(id);
    if (!order || order.userId !== p.userId) throw fail.notFound('That order');
    const mess = await this.messes.find(order.messSlug);
    const now = this.clock.now();
    if (studentOptions(order, now).canDispute !== kind)
      throw fail.badRequest(
        kind === 'no_show'
          ? `A "didn't collect" can be contested within ${HANDOVER.answerHours} hours.`
          : 'You can say this once the restaurant marks it handed over, or when it is very late.',
      );
    const saved =
      (await this.orders.patch(id, {
        dispute: kind,
        disputeState: 'open',
        disputedAt: now,
        disputeNote: note.slice(0, 300),
      })) ?? order;
    const quoted = note ? ` “${note.slice(0, 300)}”` : '';
    await this.say(
      saved,
      kind === 'no_show'
        ? `The student says they did collect it (or weren't given the chance).${quoted} The admin will look at it; until then it doesn't count against them.`
        : `The student says they didn't get this order.${quoted} The admin will look at it.`,
      'student',
    );
    if (mess)
      await this.events
        ?.toOwners(
          mess,
          {
            title: `⚠️ Order ${order.code}: ${kind === 'no_show' ? '"didn\'t collect" contested' : 'not received'}`,
            body:
              kind === 'no_show'
                ? `${order.name} says they did collect it. The admin will decide.`
                : `${order.name} says it never reached them. If it did, type their code on the order.`,
            tag: `order-${order.id}`,
            url: '/orders',
          },
          24 * 3600,
          [`board:${order.messSlug}`, `chat:${order.id}`],
        )
        .catch(() => null);
    await this.events?.ping(order);
    const after = (await this.orders.find(id)) ?? saved;
    return toDto(after, mess ?? '', 'student', await this.topic(after), now);
  }

  // ── The admin decides contests ──

  /** Everything contested in the last 90 days, open ones first. */
  async disputes(): Promise<AdminDisputeDto[]> {
    const now = this.clock.now();
    const since = new Date(now.getTime() - 90 * DAY_MS);
    const [orders, messes, marks] = await Promise.all([
      this.orders.listSince(since, 10000),
      this.messes.list(),
      this.extras.tiffinMarks
        ? this.extras.tiffinMarks.listDisputed(campusClock(since).date)
        : Promise.resolve([]),
    ]);
    const names = new Map(messes.map((m) => [m.slug, m.name]));
    const byId = new Map(orders.map((o) => [o.id, o]));
    const rows: Omit<AdminDisputeDto, 'studentDisputes' | 'messDisputes'>[] = [];
    const base = (o: MessOrderRecord) => ({
      orderId: o.id,
      code: o.code,
      messSlug: o.messSlug,
      messName: names.get(o.messSlug) ?? o.messSlug,
      name: o.name,
      email: o.email,
      phone: o.phone,
      total: o.total,
    });
    for (const o of orders)
      if (o.chat.dispute)
        rows.push({
          ...base(o),
          kind: o.chat.dispute,
          state: o.chat.disputeState,
          note: o.chat.disputeNote,
          at: (o.chat.disputedAt ?? o.updatedAt).toISOString(),
          meal: null,
        });
    for (const m of marks) {
      const o = byId.get(m.orderId) ?? (await this.orders.find(m.orderId));
      if (!o) continue;
      rows.push({
        ...base(o),
        kind: 'tiffin',
        state: m.decided || 'open',
        note: '',
        at: (m.markedAt ?? new Date(`${m.day}T12:00:00+05:30`)).toISOString(),
        meal: { day: m.day, meal: m.meal, makeupFor: m.makeupFor },
      });
    }
    const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
    return rows
      .map((r) => ({
        ...r,
        studentDisputes: count((x) => x.email === r.email),
        messDisputes: count((x) => x.messSlug === r.messSlug),
      }))
      .sort((a, b) => Number(b.state === 'open') - Number(a.state === 'open') || b.at.localeCompare(a.at));
  }

  /** The admin sides with the student or the restaurant on a contested order. */
  async decideDispute(orderId: string, decision: 'student' | 'owner') {
    const order = await this.orders.find(orderId);
    if (!order || !order.chat.dispute) throw fail.notFound('That contest');
    if (order.chat.disputeState === 'settled')
      throw fail.badRequest("The student's code was entered on this one: it's settled.");
    const saved = (await this.orders.patch(orderId, { disputeState: decision })) ?? order;
    // Food that never reached the student isn't charged to the restaurant (and is again if the
    // admin changes their mind). A no-show was the restaurant's order either way.
    if (order.chat.dispute === 'not_received' && this.extras.fees)
      await this.extras.fees
        .waive(
          orderId,
          decision === 'student',
          decision === 'student'
            ? 'The admin decided it never reached the student'
            : 'The admin decided it reached the student',
          'admin',
        )
        .catch(() => false);
    const noShow = order.chat.dispute === 'no_show';
    await this.say(
      saved,
      decision === 'student'
        ? noShow
          ? "The admin looked at it: this order doesn't count as not collected."
          : 'The admin looked at it and sided with the student.'
        : noShow
          ? 'The admin looked at it: the "not collected" stands.'
          : 'The admin looked at it and sided with the restaurant.',
      'admin',
    );
    await this.events?.ping(order);
    return this.disputes();
  }

  /** The admin decides a tiffin meal the student says never came (for the student: it counts as missed). */
  async decideTiffin(
    key: { orderId: string; day: string; meal: TiffinMeal; makeupFor: string },
    decision: 'student' | 'owner',
  ) {
    const order = await this.orders.find(key.orderId);
    if (!order || !order.tiffin || !this.extras.tiffinMarks) throw fail.notFound('That tiffin plan');
    const m = await this.markOn(key);
    if (!m || m.confirm !== 'no') throw fail.notFound('That contest');
    await this.extras.tiffinMarks.set({
      ...m,
      decided: decision,
      status: decision === 'student' ? 'missed' : 'delivered',
    });
    const label = key.meal === 'lunch' ? 'Lunch' : 'Dinner';
    await this.say(
      order,
      decision === 'student'
        ? `${label} on ${key.day}: the admin sided with the student, so it counts as missed.`
        : `${label} on ${key.day}: the admin sided with the restaurant, so it counts as delivered.`,
      'admin',
    );
    await this.events?.ping(order);
    return this.disputes();
  }

  // ── Who is looking (no notification for what's already on their screen) ──

  async here(scope: string, email: string) {
    await this.events?.here(scope, email);
  }

  async left(scopes: string[], email: string) {
    await this.events?.left(scopes, email);
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
    let phone = normaliseMobile(input.phone);
    // With SMS codes set up, the order carries the account's checked number, never a typed one.
    if (this.extras.phones?.available) {
      phone = await this.extras.phones.verified(p.userId);
      if (!phone) throw fail.badRequest('Check your mobile number with the SMS code first.');
    }
    if (!phone) throw fail.badRequest('Use a 10-digit Indian mobile number.');
    if (await this.extras.blocks?.find(slug, p.userId, phone))
      throw fail.badRequest(`${mess.name} isn't taking orders from this account.`);
    const past = await this.orders.listForUser(p.userId, 100);
    const standing = standingOf(past, this.clock.now());
    if (standing.pausedUntil)
      throw fail.badRequest(
        `You didn't collect ${standing.noShows} orders in the last ${NO_SHOW.windowDays} days, so ordering is paused until ${campusClock(new Date(standing.pausedUntil)).date}.`,
      );

    // Prices come from the restaurant's own list, never from the browser.
    const items = new Map(mess.order.flatMap((s) => s.items).map((i) => [i.name.toLowerCase(), i]));
    const tiffinLines = input.lines.filter((l) => {
      const it = items.get(l.name.toLowerCase());
      return it ? isTiffinItem(it) : false;
    });
    let tiffin: MessOrderRecord['tiffin'] = null;
    if (tiffinLines.length) {
      if (input.lines.length > 1 || tiffinLines[0]!.qty !== 1)
        throw fail.badRequest('Order a tiffin plan on its own, one at a time.');
      if (!input.tiffin) throw fail.badRequest('Choose lunch, dinner or both, and the first day.');
      const today = campusClock(this.clock.now()).date;
      const latest = new Date(`${today}T00:00:00Z`);
      latest.setUTCDate(latest.getUTCDate() + TIFFIN_START_WITHIN_DAYS);
      if (input.tiffin.startsOn < today || input.tiffin.startsOn > latest.toISOString().slice(0, 10))
        throw fail.badRequest(
          `Pick a first day between today and ${TIFFIN_START_WITHIN_DAYS} days from now.`,
        );
      tiffin = {
        plan: input.tiffin.plan,
        startsOn: input.tiffin.startsOn,
        endsOn: tiffinEnds(input.tiffin.startsOn),
      };
    }
    const today = campusClock(this.clock.now()).date;
    const offers = (mess.offers ?? []).filter((o) => offerLive(o, today));
    // A combo comes in as "combo:<offer id>": its price and contents are the owner's, never the browser's.
    const priced = input.lines.map((l) => {
      if (l.name.startsWith(COMBO_PREFIX)) {
        const combo = offers.find((o) => o.kind === 'combo' && `${COMBO_PREFIX}${o.id}` === l.name);
        if (!combo) throw fail.badRequest("That combo isn't on offer any more.");
        const out = combo.items.find((i) => items.get(i.name.toLowerCase())?.available === false);
        if (out) throw fail.badRequest(`"${out.name}" in the combo is sold out right now.`);
        const detail = combo.items
          .map((i) => `${i.qty}× ${i.name}`)
          .join(', ')
          .slice(0, 200);
        return { combo: true, line: { name: comboLineName(combo), qty: l.qty, price: combo.price, detail } };
      }
      const item = items.get(l.name.toLowerCase());
      if (!item) throw fail.badRequest(`"${l.name}" isn't on ${mess.name}'s list any more.`);
      if (item.available === false) throw fail.badRequest(`"${item.name}" is sold out right now.`);
      return { combo: false, line: { name: l.name, qty: l.qty, price: item.price, detail: l.detail } };
    });
    const lines = priced.map((x) => x.line);
    // One discount: the typed code if it works, else the best automatic deal. Combos and tiffin
    // plans are priced already, so the discount is on the rest.
    const subtotal = tiffin
      ? 0
      : priced.filter((x) => !x.combo).reduce((n, { line: l }) => n + l.qty * l.price, 0);
    const firstOrder = !past.some(
      (o) => o.messSlug === slug && ['accepted', 'ready', 'done', 'placed'].includes(o.status),
    );
    const deal = bestDiscount(offers, subtotal, { date: today, code: input.promoCode, firstOrder });
    if (input.promoCode && deal.codeProblem) throw fail.badRequest(deal.codeProblem);
    const discount = deal.saving;
    const offerLabel =
      !deal.offer || !discount ? '' : deal.offer.kind === 'code' ? deal.offer.code : deal.offer.title;

    await this.checkLimits(p.userId, ipHash, slug);
    if (mess.dailyOrderCap > 0) {
      // Since midnight on campus (IST): the owner's "most orders a day".
      const now = this.clock.now();
      const midnight = new Date(`${campusClock(now).date}T00:00:00+05:30`);
      const today = await this.orders.countSince({ messSlug: slug }, midnight);
      if (today >= mess.dailyOrderCap)
        throw fail.badRequest(`${mess.name} has taken all the orders it can today. Call them instead.`);
    }
    const total = Math.max(0, lines.reduce((n, l) => n + l.qty * l.price, 0) - discount);
    // Pay first by UPI: big orders (the owner's limit), tiffin plans, and students with no-shows.
    const payFirst = standing.payFirst || !!tiffin || (mess.prepayAbove > 0 && total > mess.prepayAbove);
    if (standing.payFirst && !mess.upiId)
      throw fail.badRequest(
        `After ${standing.noShows} orders you didn't collect, orders are paid first, and ${mess.name} doesn't take UPI on the site. Call them instead.`,
      );
    let order = await this.orders.add({
      handoverSecret: newHandoverSecret(),
      code: newCode(),
      messSlug: slug,
      userId: p.userId,
      email: p.email,
      lines,
      total,
      discount,
      offer: offerLabel,
      mode: input.mode,
      address: input.mode === 'delivery' ? input.address : '',
      name: input.name,
      phone,
      note: input.note,
      ipHash,
      tiffin,
    });
    if (payFirst && mess.upiId) order = (await this.orders.patch(order.id, { payment: 'due' })) ?? order;
    await this.events?.placed(order, mess);
    return toDto(order, mess, 'student', await this.topic(order), this.clock.now());
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
    const messes = new Map((await this.messes.list()).map((m) => [m.slug, m]));
    const list = await this.swept(await this.orders.listForUser(p.userId, 20));
    const dtos = await Promise.all(
      list.map(async (o) =>
        toDto(o, messes.get(o.messSlug) ?? '', 'student', await this.topic(o), this.clock.now()),
      ),
    );
    // A running tiffin plan: meals delivered and missed, and missed meals still to come.
    const plans = list.filter((o) => o.tiffin && o.status === 'done');
    if (plans.length && this.extras.tiffinMarks) {
      const today = campusClock(this.clock.now()).date;
      const from = plans.reduce((d, o) => (o.tiffin!.startsOn < d ? o.tiffin!.startsOn : d), today);
      const marks = await this.extras.tiffinMarks.list(
        plans.map((o) => o.id),
        from,
        today,
      );
      for (const d of dtos) {
        if (!d.tiffin || !plans.some((o) => o.id === d.id)) continue;
        const mine = marks.filter((m) => m.orderId === d.id);
        const regular = mine.filter((m) => !m.makeupFor);
        d.tiffin = {
          ...d.tiffin,
          delivered: mine.filter((m) => m.status === 'delivered').length,
          missed: regular.filter((m) => m.status === 'missed').length,
          makeups: regular
            .filter(
              (m) =>
                m.status === 'missed' &&
                makeupUntil(m.day) >= today &&
                !mine.some((x) => x.makeupFor === m.day && x.meal === m.meal && x.status === 'delivered'),
            )
            .map((m) => ({ day: m.day, meal: m.meal, until: makeupUntil(m.day) })),
          meals: this.studentMeals(plans.find((o) => o.id === d.id)!, mine, today, this.clock.now()),
        };
      }
    }
    return dtos;
  }

  async cancel(p: Principal, id: string): Promise<MessOrderDto> {
    const order = await this.orders.find(id);
    if (!order || order.userId !== p.userId) throw fail.notFound('That order');
    if (order.status !== 'placed')
      throw fail.badRequest('The restaurant has already started it. Call them to change it.');
    if (order.chat.payment === 'claimed' || order.chat.payment === 'paid')
      throw fail.badRequest(
        "You've paid for this one. Call the restaurant to cancel it and get your money back.",
      );
    await this.orders.setStatus(id, 'cancelled', '');
    const saved = (await this.orders.patch(id, { endedBy: 'student' }))!;
    const mess = await this.messes.find(order.messSlug);
    if (mess) await this.events?.statusChanged(saved, mess, 'student');
    return toDto(saved, mess ?? '', 'student', await this.topic(saved), this.clock.now());
  }

  /** The student says they paid by UPI: the restaurant is told to check and accept. */
  async claimPaid(p: Principal, id: string): Promise<MessOrderDto> {
    const order = await this.orders.find(id);
    if (!order || order.userId !== p.userId) throw fail.notFound('That order');
    const mess = await this.messes.find(order.messSlug);
    if (!mess || order.status !== 'placed' || !order.chat.payment)
      throw fail.badRequest('This order has no payment waiting.');
    let saved = order;
    if (order.chat.payment === 'due') {
      saved =
        (await this.orders.patch(id, { payment: 'claimed', paidAt: this.clock.now() }, 'placed')) ?? order;
      await this.events?.paymentClaimed(saved, mess);
    }
    return toDto(saved, mess, 'student', await this.topic(saved), this.clock.now());
  }
}
