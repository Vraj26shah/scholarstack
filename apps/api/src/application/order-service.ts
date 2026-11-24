import {
  MESS_ORDER_NEXT,
  MESS_PHOTO_MAX_BYTES,
  type MessDto,
  type MessOrderDto,
  type MessOrderStatus,
  type OwnedMessDto,
  type OwnerMessInput,
  type PlaceMessOrderInput,
  normaliseEmail,
  normaliseMobile,
} from '@ss/contracts';
import type {
  MessOrderRecord,
  MessOrderRepository,
  MessRecord,
  MessRepository,
} from '../domain/campus-ports';
import type { Principal } from '../domain/entities';
import type { Clock, FeatureRepository, UploadStore } from '../domain/ports';
import { MESS_FEATURE, toDto as messDto } from './campus-service';
import { fail } from './errors';

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

const toDto = (o: MessOrderRecord, messName: string): MessOrderDto => ({
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

/** Orders from students to restaurants for day scholars, and the owner's side of them. */
export class OrderService {
  private ownerCache: { at: number; byEmail: Map<string, string[]> } | null = null;

  constructor(
    private readonly messes: MessRepository,
    private readonly orders: MessOrderRepository,
    private readonly features: FeatureRepository,
    private readonly clock: Clock,
    /** Where item photos are kept (the R2 bucket in production). */
    private readonly photos?: UploadStore,
  ) {}

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
    return (await this.messes.list())
      .filter((m) => m.kind === 'restaurant' && (admin || slugs.has(m.slug)))
      .map((m) => ({ slug: m.slug, name: m.name, ordersOpen: m.ordersOpen }));
  }

  private async ownedMess(p: Principal, admin: boolean, slug: string): Promise<MessRecord> {
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
    return (await this.orders.listForMess(slug, since, 200)).map((o) => toDto(o, mess.name));
  }

  async setOpen(p: Principal, admin: boolean, slug: string, open: boolean): Promise<OwnedMessDto> {
    const mess = await this.ownedMess(p, admin, slug);
    const { updatedAt: _u, ...rest } = mess;
    const saved = await this.messes.save({ ...rest, ordersOpen: open });
    return { slug: saved.slug, name: saved.name, ordersOpen: saved.ordersOpen };
  }

  async setStatus(p: Principal, admin: boolean, id: string, status: MessOrderStatus, note: string) {
    const order = await this.orders.find(id);
    if (!order) throw fail.notFound('That order');
    const mess = await this.ownedMess(p, admin, order.messSlug);
    if (!MESS_ORDER_NEXT[order.status].includes(status))
      throw fail.badRequest(`This order is already ${order.status}; it can't be moved to ${status}.`);
    if (status === 'rejected' && note.length < 3) throw fail.badRequest('Say why, so the student knows.');
    const saved = await this.orders.setStatus(id, status, note);
    if (!saved) throw fail.notFound('That order');
    return toDto(saved, mess.name);
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

    // Prices come from the restaurant's own list, never from the browser.
    const items = new Map(mess.order.flatMap((s) => s.items).map((i) => [i.name.toLowerCase(), i]));
    const lines = input.lines.map((l) => {
      const item = items.get(l.name.toLowerCase());
      if (!item) throw fail.badRequest(`"${l.name}" isn't on ${mess.name}'s list any more.`);
      if (item.available === false) throw fail.badRequest(`"${item.name}" is sold out right now.`);
      return { name: l.name, qty: l.qty, price: item.price, detail: l.detail };
    });

    await this.checkLimits(p.userId, ipHash, slug);
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
    return toDto(order, mess.name);
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
    return (await this.orders.listForUser(p.userId, 10)).map((o) => toDto(o, names.get(o.messSlug) ?? ''));
  }

  async cancel(p: Principal, id: string): Promise<MessOrderDto> {
    const order = await this.orders.find(id);
    if (!order || order.userId !== p.userId) throw fail.notFound('That order');
    if (order.status !== 'placed')
      throw fail.badRequest('The restaurant has already started it. Call them to change it.');
    const saved = await this.orders.setStatus(id, 'cancelled', '');
    const mess = await this.messes.find(order.messSlug);
    return toDto(saved!, mess?.name ?? '');
  }
}
