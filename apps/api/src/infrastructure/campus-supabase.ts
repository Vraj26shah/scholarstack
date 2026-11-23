import {
  type MessInput,
  type MessOrderStatus,
  type MessReportStatus,
  OPEN_MESS_ORDER,
  ReminderPrefs,
} from '@ss/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  MessOrderRecord,
  MessOrderRepository,
  MessRecord,
  MessReportRecord,
  MessReportRepository,
  MessRepository,
  PushRepository,
  PushSubscriptionRecord,
} from '../domain/campus-ports';
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
  ownerEmails: (r.owner_emails as string[]) ?? [],
  ordersOpen: !!r.orders_open,
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
  label: (r.label as string) ?? '',
  createdAt: new Date(r.created_at as string),
});

export class SupabasePush implements PushRepository {
  constructor(private readonly db: SupabaseClient) {}
  async upsert(sub: Omit<PushSubscriptionRecord, 'id' | 'createdAt'>) {
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
  async removeIds(ids: string[]) {
    const ok = ids.filter(isUuid);
    if (ok.length) must(await this.db.from('push_subscriptions').delete().in('id', ok));
  }
  async listAll() {
    return (must(await this.db.from('push_subscriptions').select('*').limit(5000)) as Row[]).map(toSub);
  }
  async listForUser(userId: string) {
    if (!isUuid(userId)) return [];
    return (
      must(
        await this.db.from('push_subscriptions').select('*').eq('user_id', userId).order('created_at'),
      ) as Row[]
    ).map(toSub);
  }
  async sentSince(day: string) {
    return (
      must(
        await this.db.from('push_sent').select('subscription_id, key').gte('day', day).limit(20000),
      ) as Row[]
    ).map((r) => ({ subscriptionId: r.subscription_id as string, key: r.key as string }));
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
  async pruneSent(beforeDay: string) {
    must(await this.db.from('push_sent').delete().lt('day', beforeDay));
  }
}

const ORDER_COLS =
  'id, code, mess_slug, user_id, email, lines, total, mode, address, name, phone, note, status, owner_note, ip_hash, created_at, updated_at';

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
});

const count = (res: { count: number | null; error: { message: string } | null }) => {
  if (res.error) throw new Error(`Supabase: ${res.error.message.slice(0, 300)}`);
  return res.count ?? 0;
};

export class SupabaseMessOrders implements MessOrderRepository {
  constructor(private readonly db: SupabaseClient) {}
  async add(o: Omit<MessOrderRecord, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'ownerNote'>) {
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
}
