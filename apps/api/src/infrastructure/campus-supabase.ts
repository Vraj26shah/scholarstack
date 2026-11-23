import { type MessInput, type MessReportStatus, ReminderPrefs } from '@ss/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
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
