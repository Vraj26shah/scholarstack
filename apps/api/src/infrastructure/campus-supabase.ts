import {
  type ChatReportStatus,
  type ChatSender,
  type MessInput,
  type MessOrderStatus,
  type MessReportStatus,
  OPEN_MESS_ORDER,
  type PushDailyDto,
  type PushKind,
  ReminderPrefs,
  type TiffinPlan,
} from '@ss/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ChatMessageRecord,
  ChatReportRecord,
  ChatReportRepository,
  LiveSignal,
  MessBlockRecord,
  MessBlockRepository,
  MessOrderRecord,
  MessOrderRepository,
  MessRecord,
  MessReportRecord,
  MessReportRepository,
  MessRepository,
  MessViewRepository,
  OrderChatRepository,
  OrderChatState,
  PhoneRecord,
  PhoneRepository,
  PushCounter,
  PushRepository,
  PushSubscriptionRecord,
  TiffinMarkRecord,
  TiffinMarkRepository,
} from '../domain/campus-ports';
import { sha256Hex } from './crypto';
import { type Row, must } from './supabase';

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

const toMess = (r: Row): MessRecord => ({
  slug: r.slug as string,
  name: r.name as string,
  kind: r.kind as MessRecord['kind'],
  place: (r.place as string) ?? '',
  source: r.source as MessRecord['source'],
  note: (r.note as string) ?? '',
  prices: (r.prices as string) ?? '',
  phone: (r.phone as string) ?? '',
  orderNote: (r.order_note as string) ?? '',
  order: (r.order_menu as MessRecord['order']) ?? [],
  offers: (r.offers as MessRecord['offers']) ?? [],
  ownerEmails: (r.owner_emails as string[]) ?? [],
  ordersOpen: !!r.orders_open,
  dailyOrderCap: Number(r.daily_order_cap ?? 0),
  meals: r.meals as MessRecord['meals'],
  weeks: r.weeks as MessRecord['weeks'],
  cycleStart: String(r.cycle_start).slice(0, 10),
  published: !!r.published,
  sort: (r.sort as number) ?? 0,
  updatedAt: new Date(r.updated_at as string),
});

export class SupabaseMesses implements MessRepository {
  constructor(private readonly db: SupabaseClient) {}
  async list() {
    return (must(await this.db.from('messes').select('*').order('sort').order('name')) as Row[]).map(toMess);
  }
  async find(slug: string) {
    const row = must(await this.db.from('messes').select('*').eq('slug', slug).maybeSingle()) as Row | null;
    return row ? toMess(row) : null;
  }
  async save(m: MessInput & { sort: number }) {
    return toMess(
      must(
        await this.db
          .from('messes')
          .upsert(
            {
              slug: m.slug,
              name: m.name,
              kind: m.kind,
              place: m.place,
              source: m.source,
              note: m.note,
              prices: m.prices,
              phone: m.phone,
              order_note: m.orderNote,
              order_menu: m.order,
              owner_emails: m.ownerEmails,
              orders_open: m.ordersOpen,
              daily_order_cap: m.dailyOrderCap ?? 0,
              offers: m.offers ?? [],
              meals: m.meals,
              weeks: m.weeks,
              cycle_start: m.cycleStart,
              published: m.published,
              sort: m.sort,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'slug' },
          )
          .select('*')
          .single(),
      ) as Row,
    );
  }
  async remove(slug: string) {
    must(await this.db.from('messes').delete().eq('slug', slug));
  }
}

const toReport = (r: Row): MessReportRecord => ({
  id: r.id as string,
  slug: r.mess_slug as string,
  day: (r.day as MessReportRecord['day']) ?? null,
  meal: (r.meal as MessReportRecord['meal']) ?? null,
  message: r.message as string,
  contact: (r.contact as string) ?? '',
  status: r.status as MessReportStatus,
  createdAt: new Date(r.created_at as string),
});

export class SupabaseMessReports implements MessReportRepository {
  constructor(private readonly db: SupabaseClient) {}
  async add(r: Omit<MessReportRecord, 'id' | 'status' | 'createdAt'> & { ipHash: string }) {
    must(
      await this.db.from('mess_reports').insert({
        mess_slug: r.slug,
        day: r.day,
        meal: r.meal,
        message: r.message,
        contact: r.contact,
        ip_hash: r.ipHash,
      }),
    );
  }
  async list(limit: number) {
    return (
      must(
        await this.db
          .from('mess_reports')
          .select('id, mess_slug, day, meal, message, contact, status, created_at')
          .order('created_at', { ascending: false })
          .limit(limit),
      ) as Row[]
    ).map(toReport);
  }
  async setStatus(id: string, status: MessReportStatus) {
    if (!isUuid(id)) return false;
    const rows = must(
      await this.db.from('mess_reports').update({ status }).eq('id', id).select('id'),
    ) as Row[];
    return rows.length > 0;
  }
}

/** Settings saved before a field existed still read as today's shape (defaults filled in). */
const readPrefs = (v: unknown) => {
  const parsed = ReminderPrefs.safeParse(v ?? {});
  return parsed.success ? parsed.data : ReminderPrefs.parse({});
};

const toSub = (r: Row): PushSubscriptionRecord => ({
  id: r.id as string,
  endpoint: r.endpoint as string,
  p256dh: r.p256dh as string,
  auth: r.auth as string,
  prefs: readPrefs(r.prefs),
  userId: (r.user_id as string | null) ?? null,
  email: (r.email as string) ?? '',
  label: (r.label as string) ?? '',
  createdAt: new Date(r.created_at as string),
  seenAt: r.seen_at ? new Date(r.seen_at as string) : null,
});

export class SupabasePush implements PushRepository {
  constructor(private readonly db: SupabaseClient) {}
  async upsert(sub: Omit<PushSubscriptionRecord, 'id' | 'createdAt' | 'seenAt'>) {
    const row: Row = {
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
      prefs: sub.prefs,
      label: sub.label,
      updated_at: new Date().toISOString(),
    };
    // Turning reminders on while signed out never unlinks a device from its account.
    if (sub.userId) row.user_id = sub.userId;
    if (sub.email) row.email = sub.email;
    return toSub(
      must(
        await this.db.from('push_subscriptions').upsert(row, { onConflict: 'endpoint' }).select('*').single(),
      ) as Row,
    );
  }
  async findByEndpoint(endpoint: string) {
    const row = must(
      await this.db.from('push_subscriptions').select('*').eq('endpoint', endpoint).maybeSingle(),
    ) as Row | null;
    return row ? toSub(row) : null;
  }
  async setPrefs(endpoint: string, prefs: ReminderPrefs) {
    const rows = must(
      await this.db
        .from('push_subscriptions')
        .update({ prefs, updated_at: new Date().toISOString() })
        .eq('endpoint', endpoint)
        .select('id'),
    ) as Row[];
    return rows.length > 0;
  }
  async removeByEndpoint(endpoint: string) {
    must(await this.db.from('push_subscriptions').delete().eq('endpoint', endpoint));
  }
  async markSeen(endpoint: string) {
    const rows = must(
      await this.db
        .from('push_subscriptions')
        .update({ seen_at: new Date().toISOString() })
        .eq('endpoint', endpoint)
        .select('id'),
    ) as Row[];
    return rows.length > 0;
  }
  async removeIds(ids: string[]) {
    const ok = ids.filter(isUuid);
    if (ok.length) must(await this.db.from('push_subscriptions').delete().in('id', ok));
  }
  /**
   * Every device. The database hands back at most 1,000 rows per request whatever the limit asks
   * for, so read page by page (ordered, so no row is skipped or read twice).
   */
  async listAll() {
    const out: Row[] = [];
    for (let from = 0; from < 50_000; from += PAGE) {
      const page = must(
        await this.db
          .from('push_subscriptions')
          .select('*')
          .order('id')
          .range(from, from + PAGE - 1),
      ) as Row[];
      out.push(...page);
      if (page.length < PAGE) break;
    }
    return out.map(toSub);
  }
  async listForUser(userId: string) {
    if (!isUuid(userId)) return [];
    return (
      must(
        await this.db.from('push_subscriptions').select('*').eq('user_id', userId).order('created_at'),
      ) as Row[]
    ).map(toSub);
  }
  async listForEmails(emails: string[]) {
    const want = emails.filter(Boolean);
    if (!want.length) return [];
    return (
      must(await this.db.from('push_subscriptions').select('*').in('email', want).limit(50)) as Row[]
    ).map(toSub);
  }
  async sentSince(day: string) {
    const out: Row[] = [];
    for (let from = 0; from < 200_000; from += PAGE) {
      const page = must(
        await this.db
          .from('push_sent')
          .select('subscription_id, key')
          .gte('day', day)
          .order('subscription_id')
          .order('key')
          .range(from, from + PAGE - 1),
      ) as Row[];
      out.push(...page);
      if (page.length < PAGE) break;
    }
    return out.map((r) => ({ subscriptionId: r.subscription_id as string, key: r.key as string }));
  }
  async recordSent(rows: { subscriptionId: string; key: string; day: string }[]) {
    if (!rows.length) return;
    must(
      await this.db.from('push_sent').upsert(
        rows.map((r) => ({ subscription_id: r.subscriptionId, key: r.key, day: r.day })),
        { onConflict: 'subscription_id,key', ignoreDuplicates: true },
      ),
    );
  }
  async unrecordSent(rows: { subscriptionId: string; key: string }[]) {
    const ok = rows.filter((r) => isUuid(r.subscriptionId));
    // One request per 40: or(and(subscription_id.eq.X,key.eq."class:2026-11-25:540"),...) keeps
    // the address short enough for the database's web server.
    const quote = (v: string) => `"${v.replace(/["\\]/g, '')}"`;
    for (let i = 0; i < ok.length; i += 40)
      must(
        await this.db
          .from('push_sent')
          .delete()
          .or(
            ok
              .slice(i, i + 40)
              .map((r) => `and(subscription_id.eq.${r.subscriptionId},key.eq.${quote(r.key)})`)
              .join(','),
          ),
      );
  }
  async pruneSent(beforeDay: string) {
    must(await this.db.from('push_sent').delete().lt('day', beforeDay));
  }
  async bumpDaily(day: string, kind: PushKind, add: Partial<Record<PushCounter, number>>) {
    must(
      await this.db.rpc('push_daily_add', {
        p_day: day,
        p_kind: kind,
        p_sent: add.sent ?? 0,
        p_seen: add.seen ?? 0,
        p_opened: add.opened ?? 0,
        p_failed: add.failed ?? 0,
        p_gone: add.gone ?? 0,
      }),
    );
  }
  async daily(sinceDay: string): Promise<PushDailyDto[]> {
    return (
      must(
        await this.db
          .from('push_daily')
          .select('day, kind, sent, seen, opened, failed, gone')
          .gte('day', sinceDay)
          .order('day', { ascending: false })
          .order('kind')
          .limit(500),
      ) as Row[]
    ).map((r) => ({
      day: String(r.day),
      kind: r.kind as PushKind,
      sent: Number(r.sent ?? 0),
      seen: Number(r.seen ?? 0),
      opened: Number(r.opened ?? 0),
      failed: Number(r.failed ?? 0),
      gone: Number(r.gone ?? 0),
    }));
  }
}

/** The most rows the database returns per request. */
const PAGE = 1000;

const ORDER_COLS =
  'id, code, mess_slug, user_id, email, lines, total, mode, address, name, phone, note, status, owner_note, ip_hash, created_at, updated_at, student_unread, owner_unread, student_read_at, owner_read_at, student_cleared_at, owner_cleared_at, last_body, last_sender, last_at, responded_at, nudged_at, ended_by, alert_note, tiffin_plan, tiffin_starts, tiffin_ends, discount, offer_label';

const when = (v: unknown) => (v ? new Date(v as string) : null);

const toChatState = (r: Row): OrderChatState => ({
  studentUnread: Number(r.student_unread ?? 0),
  ownerUnread: Number(r.owner_unread ?? 0),
  studentReadAt: when(r.student_read_at),
  ownerReadAt: when(r.owner_read_at),
  studentClearedAt: when(r.student_cleared_at),
  ownerClearedAt: when(r.owner_cleared_at),
  lastBody: (r.last_body as string) ?? '',
  lastSender: ((r.last_sender as string) ?? '') as OrderChatState['lastSender'],
  lastAt: when(r.last_at),
  respondedAt: when(r.responded_at),
  nudgedAt: when(r.nudged_at),
  endedBy: ((r.ended_by as string) ?? '') as OrderChatState['endedBy'],
  alertNote: (r.alert_note as string) ?? '',
});

const CHAT_COLUMNS: Record<keyof OrderChatState, string> = {
  studentUnread: 'student_unread',
  ownerUnread: 'owner_unread',
  studentReadAt: 'student_read_at',
  ownerReadAt: 'owner_read_at',
  studentClearedAt: 'student_cleared_at',
  ownerClearedAt: 'owner_cleared_at',
  lastBody: 'last_body',
  lastSender: 'last_sender',
  lastAt: 'last_at',
  respondedAt: 'responded_at',
  nudgedAt: 'nudged_at',
  endedBy: 'ended_by',
  alertNote: 'alert_note',
};

const toOrder = (r: Row): MessOrderRecord => ({
  id: r.id as string,
  code: r.code as string,
  messSlug: r.mess_slug as string,
  userId: r.user_id as string,
  email: (r.email as string) ?? '',
  lines: (r.lines as MessOrderRecord['lines']) ?? [],
  total: Number(r.total),
  mode: r.mode as MessOrderRecord['mode'],
  address: (r.address as string) ?? '',
  name: (r.name as string) ?? '',
  phone: (r.phone as string) ?? '',
  note: (r.note as string) ?? '',
  status: r.status as MessOrderStatus,
  ownerNote: (r.owner_note as string) ?? '',
  ipHash: (r.ip_hash as string) ?? '',
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  chat: toChatState(r),
  tiffin: r.tiffin_plan
    ? {
        plan: r.tiffin_plan as TiffinPlan,
        startsOn: String(r.tiffin_starts).slice(0, 10),
        endsOn: String(r.tiffin_ends).slice(0, 10),
      }
    : null,
  discount: Number(r.discount ?? 0),
  offer: (r.offer_label as string) ?? '',
});

const count = (res: { count: number | null; error: { message: string } | null }) => {
  if (res.error) throw new Error(`Supabase: ${res.error.message.slice(0, 300)}`);
  return res.count ?? 0;
};

export class SupabaseMessOrders implements MessOrderRepository {
  constructor(private readonly db: SupabaseClient) {}
  async add(o: Omit<MessOrderRecord, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'ownerNote' | 'chat'>) {
    return toOrder(
      must(
        await this.db
          .from('mess_orders')
          .insert({
            code: o.code,
            mess_slug: o.messSlug,
            user_id: o.userId,
            email: o.email,
            lines: o.lines,
            total: o.total,
            mode: o.mode,
            address: o.address,
            name: o.name,
            phone: o.phone,
            note: o.note,
            ip_hash: o.ipHash,
            tiffin_plan: o.tiffin?.plan ?? null,
            tiffin_starts: o.tiffin?.startsOn ?? null,
            tiffin_ends: o.tiffin?.endsOn ?? null,
            discount: o.discount ?? 0,
            offer_label: o.offer ?? '',
          })
          .select(ORDER_COLS)
          .single(),
      ) as Row,
    );
  }
  async find(id: string) {
    if (!isUuid(id)) return null;
    const row = must(
      await this.db.from('mess_orders').select(ORDER_COLS).eq('id', id).maybeSingle(),
    ) as Row | null;
    return row ? toOrder(row) : null;
  }
  async listForUser(userId: string, limit: number) {
    return (
      must(
        await this.db
          .from('mess_orders')
          .select(ORDER_COLS)
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(limit),
      ) as Row[]
    ).map(toOrder);
  }
  async listForMess(slug: string, since: Date, limit: number) {
    return (
      must(
        await this.db
          .from('mess_orders')
          .select(ORDER_COLS)
          .eq('mess_slug', slug)
          .or(`status.in.(${OPEN_MESS_ORDER.join(',')}),created_at.gte.${since.toISOString()}`)
          .order('created_at', { ascending: false })
          .limit(limit),
      ) as Row[]
    ).map(toOrder);
  }
  async setStatus(id: string, status: MessOrderStatus, ownerNote: string) {
    if (!isUuid(id)) return null;
    const rows = must(
      await this.db
        .from('mess_orders')
        .update({ status, owner_note: ownerNote, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select(ORDER_COLS),
    ) as Row[];
    return rows[0] ? toOrder(rows[0]) : null;
  }
  async countSince(by: { userId?: string; ipHash?: string; messSlug?: string }, since: Date) {
    let q = this.db
      .from('mess_orders')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since.toISOString());
    if (by.userId) q = q.eq('user_id', by.userId);
    if (by.ipHash) q = q.eq('ip_hash', by.ipHash);
    if (by.messSlug) q = q.eq('mess_slug', by.messSlug);
    return count(await q);
  }
  async countOpenForUser(userId: string) {
    return count(
      await this.db
        .from('mess_orders')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('status', [...OPEN_MESS_ORDER]),
    );
  }
  async patch(
    id: string,
    fields: Partial<OrderChatState> & { status?: MessOrderStatus; ownerNote?: string },
    ifStatus?: MessOrderStatus,
  ) {
    if (!isUuid(id)) return null;
    const { status, ownerNote, ...chat } = fields;
    const row: Row = {};
    if (status) {
      row.status = status;
      row.updated_at = new Date().toISOString();
    }
    if (ownerNote !== undefined) row.owner_note = ownerNote;
    for (const [k, v] of Object.entries(chat) as [keyof OrderChatState, unknown][])
      row[CHAT_COLUMNS[k]] = v instanceof Date ? v.toISOString() : v;
    let q = this.db.from('mess_orders').update(row).eq('id', id);
    if (ifStatus) q = q.eq('status', ifStatus);
    const rows = must(await q.select(ORDER_COLS)) as Row[];
    return rows[0] ? toOrder(rows[0]) : null;
  }
  async listPlacedBefore(before: Date, limit: number) {
    return (
      must(
        await this.db
          .from('mess_orders')
          .select(ORDER_COLS)
          .eq('status', 'placed')
          .lt('created_at', before.toISOString())
          .order('created_at')
          .limit(limit),
      ) as Row[]
    ).map(toOrder);
  }
  async listSince(since: Date, limit: number, slug?: string) {
    let q = this.db
      .from('mess_orders')
      .select(ORDER_COLS)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(limit);
    if (slug) q = q.eq('mess_slug', slug);
    return (must(await q) as Row[]).map(toOrder);
  }
}

const MSG_COLS = 'id, order_id, mess_slug, sender, user_id, body, photo, reply_ms, created_at';
const toMessage = (r: Row): ChatMessageRecord => ({
  id: r.id as string,
  orderId: r.order_id as string,
  messSlug: r.mess_slug as string,
  sender: r.sender as ChatSender,
  userId: (r.user_id as string | null) ?? null,
  body: (r.body as string) ?? '',
  photo: (r.photo as string) ?? '',
  replyMs: r.reply_ms === null || r.reply_ms === undefined ? null : Number(r.reply_ms),
  createdAt: new Date(r.created_at as string),
});

export class SupabaseOrderChat implements OrderChatRepository {
  constructor(private readonly db: SupabaseClient) {}
  async post(m: { orderId: string; sender: ChatSender; userId: string | null; body: string; photo: string }) {
    const row = must(
      await this.db
        .rpc('mess_chat_post', {
          p_order: m.orderId,
          p_sender: m.sender,
          p_user: m.userId,
          p_body: m.body,
          p_photo: m.photo,
        })
        .single(),
    ) as Row;
    return toMessage(row);
  }
  async list(orderId: string, after: Date | null, limit: number) {
    if (!isUuid(orderId)) return [];
    let q = this.db
      .from('mess_order_messages')
      .select(MSG_COLS)
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (after) q = q.gt('created_at', after.toISOString());
    return (must(await q) as Row[]).map(toMessage).reverse();
  }
  async removeAll(orderId: string) {
    if (!isUuid(orderId)) return [];
    const rows = must(
      await this.db.from('mess_order_messages').delete().eq('order_id', orderId).select('photo'),
    ) as Row[];
    return rows.map((r) => r.photo as string).filter(Boolean);
  }
  async countByUserSince(userId: string, since: Date) {
    if (!isUuid(userId)) return 0;
    return count(
      await this.db
        .from('mess_order_messages')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', since.toISOString()),
    );
  }
  async countFor(orderIds: string[]) {
    const ids = orderIds.filter(isUuid);
    const out = new Map<string, number>();
    if (!ids.length) return out;
    const rows = must(
      await this.db.from('mess_order_messages').select('order_id').in('order_id', ids).limit(20000),
    ) as Row[];
    for (const r of rows) out.set(r.order_id as string, (out.get(r.order_id as string) ?? 0) + 1);
    return out;
  }
  async replyTimes(slug: string, since: Date) {
    const rows = must(
      await this.db
        .from('mess_order_messages')
        .select('reply_ms')
        .eq('mess_slug', slug)
        .not('reply_ms', 'is', null)
        .gte('created_at', since.toISOString())
        .limit(2000),
    ) as Row[];
    return rows.map((r) => Number(r.reply_ms));
  }
}

const toBlock = (r: Row): MessBlockRecord => ({
  messSlug: r.mess_slug as string,
  userId: r.user_id as string,
  phone: (r.phone as string) ?? '',
  email: (r.email as string) ?? '',
  name: (r.name as string) ?? '',
  reason: (r.reason as string) ?? '',
  createdAt: new Date(r.created_at as string),
});

export class SupabaseMessBlocks implements MessBlockRepository {
  constructor(private readonly db: SupabaseClient) {}
  async list(slug?: string) {
    let q = this.db.from('mess_blocks').select('*').order('created_at', { ascending: false }).limit(1000);
    if (slug) q = q.eq('mess_slug', slug);
    return (must(await q) as Row[]).map(toBlock);
  }
  async find(slug: string, userId: string, phone?: string) {
    if (!isUuid(userId)) return null;
    const who =
      phone && /^\d{10}$/.test(phone) ? `user_id.eq.${userId},phone.eq.${phone}` : `user_id.eq.${userId}`;
    const rows = must(
      await this.db.from('mess_blocks').select('*').eq('mess_slug', slug).or(who).limit(1),
    ) as Row[];
    return rows[0] ? toBlock(rows[0]) : null;
  }
  async add(b: Omit<MessBlockRecord, 'createdAt'>) {
    must(
      await this.db.from('mess_blocks').upsert(
        {
          mess_slug: b.messSlug,
          user_id: b.userId,
          phone: b.phone,
          email: b.email,
          name: b.name,
          reason: b.reason,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'mess_slug,user_id' },
      ),
    );
  }
  async remove(slug: string, userId: string) {
    if (!isUuid(userId)) return false;
    const rows = must(
      await this.db
        .from('mess_blocks')
        .delete()
        .eq('mess_slug', slug)
        .eq('user_id', userId)
        .select('user_id'),
    ) as Row[];
    return rows.length > 0;
  }
}

const toChatReport = (r: Row): ChatReportRecord => ({
  id: r.id as string,
  orderId: r.order_id as string,
  by: r.by_role as ChatReportRecord['by'],
  reason: r.reason as string,
  status: r.status as ChatReportStatus,
  createdAt: new Date(r.created_at as string),
});

export class SupabaseChatReports implements ChatReportRepository {
  constructor(private readonly db: SupabaseClient) {}
  async add(r: Omit<ChatReportRecord, 'id' | 'status' | 'createdAt'>) {
    must(
      await this.db
        .from('mess_chat_reports')
        .insert({ order_id: r.orderId, by_role: r.by, reason: r.reason }),
    );
  }
  async list(limit: number) {
    return (
      must(
        await this.db
          .from('mess_chat_reports')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(limit),
      ) as Row[]
    ).map(toChatReport);
  }
  async setStatus(id: string, status: ChatReportStatus) {
    if (!isUuid(id)) return false;
    const rows = must(
      await this.db.from('mess_chat_reports').update({ status }).eq('id', id).select('id'),
    ) as Row[];
    return rows.length > 0;
  }
  async countFor(orderId: string, by: 'student' | 'owner', since: Date) {
    if (!isUuid(orderId)) return 0;
    return count(
      await this.db
        .from('mess_chat_reports')
        .select('id', { count: 'exact', head: true })
        .eq('order_id', orderId)
        .eq('by_role', by)
        .gte('created_at', since.toISOString()),
    );
  }
}

/**
 * Supabase Realtime "broadcast": the server sends a content-free ping on a channel whose name is a
 * keyed hash, so only pages the API gave the name to can listen. They then fetch through the API.
 */
export class SupabaseLiveSignal implements LiveSignal {
  readonly configured = true;
  constructor(
    private readonly url: string,
    private readonly key: string,
    private readonly fetcher: typeof fetch = (...a) => fetch(...a),
  ) {}
  async topic(key: string) {
    return `ss-${(await sha256Hex(`live|${this.key}|${key}`)).slice(0, 32)}`;
  }
  async ping(topics: string[]) {
    const list = topics.filter(Boolean);
    if (!list.length) return;
    await this.fetcher(`${this.url.replace(/\/$/, '')}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: this.key, authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: list.map((topic) => ({ topic, event: 'changed', payload: {}, private: false })),
      }),
    }).catch(() => {});
  }
}

const toPhone = (r: Row): PhoneRecord => ({
  userId: r.user_id as string,
  phone: (r.phone as string) ?? '',
  verifiedAt: r.verified_at ? new Date(r.verified_at as string) : null,
  pendingPhone: (r.pending_phone as string) ?? '',
  pendingRef: (r.pending_ref as string) ?? '',
  pendingAt: r.pending_at ? new Date(r.pending_at as string) : null,
  attempts: Number(r.attempts ?? 0),
  sendsDay: (r.sends_day as string) ?? '',
  sends: Number(r.sends ?? 0),
});

export class SupabasePhones implements PhoneRepository {
  constructor(private readonly db: SupabaseClient) {}
  async find(userId: string) {
    if (!isUuid(userId)) return null;
    const rows = must(await this.db.from('user_phones').select('*').eq('user_id', userId).limit(1)) as Row[];
    return rows[0] ? toPhone(rows[0]) : null;
  }
  async save(r: PhoneRecord) {
    if (!isUuid(r.userId)) return;
    must(
      await this.db.from('user_phones').upsert(
        {
          user_id: r.userId,
          phone: r.phone,
          verified_at: r.verifiedAt?.toISOString() ?? null,
          pending_phone: r.pendingPhone,
          pending_ref: r.pendingRef,
          pending_at: r.pendingAt?.toISOString() ?? null,
          attempts: r.attempts,
          sends_day: r.sendsDay || null,
          sends: r.sends,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      ),
    );
  }
  async sendsTo(phone: string, day: string) {
    if (!/^\d{10}$/.test(phone) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return 0;
    const rows = must(
      await this.db
        .from('user_phones')
        .select('sends')
        .eq('pending_phone', phone)
        .eq('sends_day', day)
        .limit(200),
    ) as Row[];
    return rows.reduce((n, r) => n + Number(r.sends ?? 0), 0);
  }
}

export class SupabaseMessViews implements MessViewRepository {
  constructor(private readonly db: SupabaseClient) {}
  async hit(slug: string, day: string, visitor: string, userId: string | null) {
    must(
      await this.db.rpc('mess_view_hit', {
        p_slug: slug,
        p_day: day,
        p_visitor: visitor.slice(0, 80),
        p_user: userId && isUuid(userId) ? userId : null,
      }),
    );
  }
  async between(slug: string, fromDay: string, toDay: string) {
    const rows = must(
      await this.db
        .from('mess_views_daily')
        .select('day, visitor, user_id, views')
        .eq('mess_slug', slug)
        .gte('day', fromDay)
        .lte('day', toDay)
        .limit(20000),
    ) as Row[];
    return rows.map((r) => ({
      day: r.day as string,
      visitor: r.visitor as string,
      userId: (r.user_id as string) ?? null,
      views: Number(r.views ?? 0),
    }));
  }
}

export class SupabaseTiffinMarks implements TiffinMarkRepository {
  constructor(private readonly db: SupabaseClient) {}
  async list(orderIds: string[], fromDay: string, toDay: string) {
    const ids = orderIds.filter(isUuid);
    if (!ids.length) return [];
    const rows = must(
      await this.db
        .from('tiffin_marks')
        .select('order_id, day, meal, makeup_for, status')
        .in('order_id', ids)
        .gte('day', fromDay)
        .lte('day', toDay)
        .limit(20000),
    ) as Row[];
    return rows.map((r) => ({
      orderId: r.order_id as string,
      day: String(r.day).slice(0, 10),
      meal: r.meal as TiffinMarkRecord['meal'],
      makeupFor: (r.makeup_for as string) ?? '',
      status: r.status as TiffinMarkRecord['status'],
    }));
  }
  async set(m: TiffinMarkRecord) {
    if (!isUuid(m.orderId)) return;
    must(
      await this.db.from('tiffin_marks').upsert(
        {
          order_id: m.orderId,
          day: m.day,
          meal: m.meal,
          makeup_for: m.makeupFor,
          status: m.status,
          marked_at: new Date().toISOString(),
        },
        { onConflict: 'order_id,day,meal,makeup_for' },
      ),
    );
  }
  async clear(m: Omit<TiffinMarkRecord, 'status'>) {
    if (!isUuid(m.orderId)) return;
    must(
      await this.db
        .from('tiffin_marks')
        .delete()
        .eq('order_id', m.orderId)
        .eq('day', m.day)
        .eq('meal', m.meal)
        .eq('makeup_for', m.makeupFor),
    );
  }
}
