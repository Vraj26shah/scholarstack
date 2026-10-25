/** Supabase adapters for earnings, royalties, the people directory and the help desk. */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CourseRoyalty, RoyaltyPayout, StoredFile, SupportQuery } from '../domain/entities';
import type {
  AcademicRepository,
  AdminDirectory,
  CourseUpdateSource,
  DeliveryLog,
  EarningsRepository,
  PeopleDirectory,
  SignInStrikes,
  SupportRepository,
} from '../domain/ports';
import { type Row, must } from './supabase';

const UUID = /^[0-9a-f-]{36}$/i;
const date = (v: unknown) => new Date(v as string);
const num = (v: unknown) => Number(v ?? 0);

const toRoyalty = (r: Row): CourseRoyalty => ({
  courseId: r.course_id as string,
  userId: r.user_id as string,
  sharePercent: num(r.share_percent),
  since: date(r.since),
  contributionId: (r.contribution_id as string | null) ?? null,
  createdBy: (r.created_by as string) ?? '',
});

const toPayout = (r: Row): RoyaltyPayout => ({
  id: r.id as string,
  courseId: r.course_id as string,
  userId: r.user_id as string,
  amountPaise: num(r.amount_paise),
  note: (r.note as string) ?? '',
  paidAt: date(r.paid_at),
  recordedBy: (r.recorded_by as string) ?? '',
});

export class SupabaseEarnings implements EarningsRepository {
  constructor(private readonly db: SupabaseClient) {}
  async courseEarnings() {
    const rows = must(await this.db.rpc('course_earnings')) as Row[];
    return rows.map((r) => ({
      courseId: r.course_id as string,
      sales: num(r.sales),
      buyers: num(r.buyers),
      revenuePaise: num(r.revenue_paise),
      lastSaleAt: r.last_sale_at ? date(r.last_sale_at) : null,
      freeAccess: num(r.free_access),
      readingNow: num(r.reading_now),
      royaltySales: num(r.royalty_sales),
      royaltyRevenuePaise: num(r.royalty_revenue_paise),
      paidOutPaise: num(r.paid_out_paise),
    }));
  }
  async paidTotals() {
    const rows = must(await this.db.rpc('paid_totals')) as Row[];
    return { orders: num(rows[0]?.orders), buyers: num(rows[0]?.buyers) };
  }
  async royalties() {
    return (must(await this.db.from('course_royalties').select('*')) as Row[]).map(toRoyalty);
  }
  async royaltiesForUser(userId: string) {
    return (must(await this.db.from('course_royalties').select('*').eq('user_id', userId)) as Row[]).map(
      toRoyalty,
    );
  }
  async setRoyalty(r: CourseRoyalty) {
    must(
      await this.db.from('course_royalties').upsert(
        {
          course_id: r.courseId,
          user_id: r.userId,
          share_percent: r.sharePercent,
          since: r.since.toISOString(),
          contribution_id: r.contributionId,
          created_by: r.createdBy,
        },
        { onConflict: 'course_id' },
      ),
    );
  }
  async removeRoyalty(courseId: string) {
    if (!UUID.test(courseId)) return;
    must(await this.db.from('course_royalties').delete().eq('course_id', courseId));
  }
  async addPayout(p: Omit<RoyaltyPayout, 'id' | 'paidAt'>) {
    const row = must(
      await this.db
        .from('royalty_payouts')
        .insert({
          course_id: p.courseId,
          user_id: p.userId,
          amount_paise: p.amountPaise,
          note: p.note,
          recorded_by: p.recordedBy,
        })
        .select('*')
        .single(),
    ) as Row;
    return toPayout(row);
  }
  async payouts(limit: number) {
    return (
      must(
        await this.db.from('royalty_payouts').select('*').order('paid_at', { ascending: false }).limit(limit),
      ) as Row[]
    ).map(toPayout);
  }
  async royaltyEarningsSince(since: Date) {
    const rows = must(await this.db.rpc('royalty_earnings_since', { p_since: since.toISOString() })) as Row[];
    return rows.map((r) => ({
      userId: r.user_id as string,
      courseId: r.course_id as string,
      sharePercent: num(r.share_percent),
      sales: num(r.sales),
      revenuePaise: num(r.revenue_paise),
    }));
  }
  async bonuses(year: number) {
    const rows = must(await this.db.from('contributor_bonuses').select('*').eq('year', year)) as Row[];
    return rows.map((r) => ({
      userId: r.user_id as string,
      amountPaise: num(r.amount_paise),
      paidAt: date(r.paid_at),
    }));
  }
  async addBonus(b: { userId: string; year: number; amountPaise: number; note: string; recordedBy: string }) {
    must(
      await this.db.from('contributor_bonuses').insert({
        user_id: b.userId,
        year: b.year,
        amount_paise: b.amountPaise,
        note: b.note,
        recorded_by: b.recordedBy,
      }),
    );
  }
}

export class SupabasePeople implements PeopleDirectory {
  constructor(private readonly db: SupabaseClient) {}
  async byIds(userIds: string[]) {
    const out = new Map<string, { email: string; name: string | null }>();
    const ids = userIds.filter((id) => UUID.test(id));
    for (let i = 0; i < ids.length; i += 200) {
      const rows = must(
        await this.db
          .from('profiles')
          .select('id, email, full_name')
          .in('id', ids.slice(i, i + 200)),
      ) as Row[];
      for (const r of rows)
        out.set(r.id as string, { email: r.email as string, name: (r.full_name as string) ?? null });
    }
    return out;
  }
}

const SUPPORT_COLUMNS = '*, support_messages(*)';

const toQuery = (r: Row): SupportQuery => ({
  id: r.id as string,
  userId: r.user_id as string,
  topic: r.topic as SupportQuery['topic'],
  subject: r.subject as string,
  page: (r.page as string) ?? '',
  status: r.status as SupportQuery['status'],
  files: (r.files as StoredFile[]) ?? [],
  messages: ((r.support_messages as Row[]) ?? [])
    .map((m) => ({
      id: m.id as string,
      fromAdmin: Boolean(m.from_admin),
      author: (m.author as string) ?? '',
      body: m.body as string,
      createdAt: date(m.created_at),
    }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
  createdAt: date(r.created_at),
  updatedAt: date(r.updated_at),
});

export class SupabaseSupport implements SupportRepository {
  constructor(private readonly db: SupabaseClient) {}
  async create(q: Parameters<SupportRepository['create']>[0], first: { author: string; body: string }) {
    must(
      await this.db.from('support_queries').insert({
        id: q.id,
        user_id: q.userId,
        topic: q.topic,
        subject: q.subject,
        page: q.page,
        files: q.files,
      }),
    );
    try {
      must(
        await this.db
          .from('support_messages')
          .insert({ query_id: q.id, from_admin: false, author: first.author, body: first.body }),
      );
    } catch (error) {
      await this.db.from('support_queries').delete().eq('id', q.id);
      throw error;
    }
    return (await this.find(q.id))!;
  }
  async find(id: string) {
    if (!UUID.test(id)) return null;
    const row = must(
      await this.db.from('support_queries').select(SUPPORT_COLUMNS).eq('id', id).maybeSingle(),
    ) as Row | null;
    return row ? toQuery(row) : null;
  }
  async listForUser(userId: string) {
    const rows = must(
      await this.db
        .from('support_queries')
        .select(SUPPORT_COLUMNS)
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(50),
    ) as Row[];
    return rows.map(toQuery);
  }
  async list(status: SupportQuery['status'] | 'all', limit: number) {
    let q = this.db
      .from('support_queries')
      .select(SUPPORT_COLUMNS)
      .order('updated_at', { ascending: false })
      .limit(limit);
    if (status !== 'all') q = q.eq('status', status);
    return (must(await q) as Row[]).map(toQuery);
  }
  async addMessage(queryId: string, m: { fromAdmin: boolean; author: string; body: string }) {
    must(
      await this.db
        .from('support_messages')
        .insert({ query_id: queryId, from_admin: m.fromAdmin, author: m.author, body: m.body }),
    );
    must(
      await this.db
        .from('support_queries')
        .update({ status: m.fromAdmin ? 'answered' : 'open', updated_at: new Date().toISOString() })
        .eq('id', queryId),
    );
  }
  async setStatus(id: string, status: SupportQuery['status']) {
    if (!UUID.test(id)) return;
    must(
      await this.db
        .from('support_queries')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id),
    );
  }
  async counts(userId: string, since: Date) {
    const rows = must(
      await this.db.from('support_queries').select('status, created_at').eq('user_id', userId).limit(1000),
    ) as Row[];
    return {
      open: rows.filter((r) => r.status !== 'closed').length,
      recent: rows.filter((r) => date(r.created_at) >= since).length,
    };
  }
  async remove(id: string) {
    if (!UUID.test(id)) return;
    must(await this.db.from('support_queries').delete().eq('id', id));
  }
}

export class SupabaseAcademic implements AcademicRepository {
  constructor(private readonly db: SupabaseClient) {}
  private async counts() {
    const rows: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const page = must(
        await this.db
          .from('courses')
          .select('id, batch_year, status, course_programmes(programme_slug)')
          .range(from, from + 999),
      ) as Row[];
      rows.push(...page);
      if (page.length < 1000) break;
    }
    return rows;
  }
  async years() {
    const [batches, courses] = await Promise.all([
      this.db.from('batches').select('year, is_visible').order('year', { ascending: false }),
      this.counts(),
    ]);
    return (must(batches) as Row[]).map((b) => ({
      year: num(b.year),
      visible: b.is_visible !== false,
      courses: courses.filter((c) => c.batch_year === b.year).length,
      live: courses.filter((c) => c.batch_year === b.year && c.status === 'live').length,
    }));
  }
  async saveYear(year: number, visible: boolean) {
    must(await this.db.from('batches').upsert({ year, is_visible: visible }, { onConflict: 'year' }));
  }
  async deleteYear(year: number) {
    must(await this.db.from('batches').delete().eq('year', year));
  }
  async branches() {
    const [rows, courses] = await Promise.all([
      this.db.from('programmes').select('*').order('sort'),
      this.counts(),
    ]);
    return (must(rows) as Row[]).map((r) => ({
      slug: r.slug as string,
      code: r.code as string,
      name: r.name as string,
      shortName: (r.short_name as string) ?? '',
      isCommon: Boolean(r.is_common),
      isActive: r.is_active !== false,
      sort: num(r.sort),
      courses: courses.filter((c) =>
        ((c.course_programmes as Row[]) ?? []).some((p) => p.programme_slug === r.slug),
      ).length,
    }));
  }
  async saveBranch(b: Parameters<AcademicRepository['saveBranch']>[0]) {
    const row = {
      code: b.code,
      name: b.name,
      short_name: b.shortName,
      is_common: b.isCommon,
      is_active: b.isActive,
      sort: b.sort,
    };
    if (b.slug) must(await this.db.from('programmes').update(row).eq('slug', b.slug));
    else must(await this.db.from('programmes').insert({ ...row, slug: b.code.toLowerCase() }));
  }
  async moveCourses(fromYear: number, toYear: number, branchSlug: string | null) {
    return num(
      must(
        await this.db.rpc('move_batch_courses', { p_from: fromYear, p_to: toYear, p_programme: branchSlug }),
      ),
    );
  }
}

export class SupabaseDeliveries implements DeliveryLog {
  constructor(private readonly db: SupabaseClient) {}
  async record(announcementId: string, userIds: string[]) {
    if (!UUID.test(announcementId) || userIds.length === 0) return;
    must(
      await this.db.from('announcement_deliveries').upsert(
        userIds.map((user_id) => ({ announcement_id: announcementId, user_id })),
        { onConflict: 'announcement_id,user_id', ignoreDuplicates: true },
      ),
    );
  }
  async pending(announcementId: string, limit: number) {
    const rows = must(
      await this.db.rpc('announcement_pending', { p_announcement: announcementId, p_limit: limit }),
    ) as Row[];
    return rows.map((r) => ({
      id: r.id as string,
      email: r.email as string,
      fullName: (r.full_name as string) ?? null,
    }));
  }
  async progress(announcementId: string) {
    const rows = must(
      await this.db.rpc('announcement_progress', { p_announcement: announcementId }),
    ) as Row[];
    return { sent: num(rows[0]?.sent), waiting: num(rows[0]?.waiting) };
  }
  async batches(announcementId: string) {
    const rows = must(await this.db.rpc('announcement_batches', { p_announcement: announcementId })) as Row[];
    return rows.map((r) => ({ batch: r.batch as string, sent: num(r.sent), waiting: num(r.waiting) }));
  }
  async recipients(announcementId: string, limit: number) {
    const rows = must(
      await this.db.rpc('announcement_recipients', { p_announcement: announcementId, p_limit: limit }),
    ) as Row[];
    return rows.map((r) => ({
      email: r.email as string,
      fullName: (r.full_name as string) ?? null,
      sentAt: r.sent_at ? date(r.sent_at) : null,
    }));
  }
}

export class SupabaseAdmins implements AdminDirectory {
  constructor(private readonly db: SupabaseClient) {}
  async list() {
    const rows = must(
      await this.db.from('admin_emails').select('email, source, added_at').order('added_at'),
    ) as Row[];
    return rows.map((r) => ({
      email: r.email as string,
      source: (r.source as 'github' | 'manual') ?? 'github',
      addedAt: date(r.added_at),
    }));
  }
}

export class SupabaseCourseUpdates implements CourseUpdateSource {
  constructor(private readonly db: SupabaseClient) {}
  async coursesWithNewFiles() {
    const rows = must(await this.db.rpc('courses_with_new_files')) as Row[];
    return rows.map((r) => ({
      courseId: r.course_id as string,
      title: r.title as string,
      slug: r.slug as string,
      fileNames: (r.file_names as string[]) ?? [],
    }));
  }
  async markFilesNotified(courseId: string) {
    if (!UUID.test(courseId)) return;
    must(
      await this.db
        .from('courses')
        .update({ files_notified_at: new Date().toISOString() })
        .eq('id', courseId),
    );
  }
}

export class SupabaseSignInStrikes implements SignInStrikes {
  constructor(private readonly db: SupabaseClient) {}
  async blockedUntil(ipHash: string) {
    const row = must(
      await this.db.from('signin_strikes').select('blocked_until').eq('ip_hash', ipHash).maybeSingle(),
    ) as Row | null;
    const until = row?.blocked_until ? date(row.blocked_until) : null;
    return until && until.getTime() > Date.now() ? until : null;
  }
  async strike(ipHash: string, limit: number, hours: number) {
    const until = must(
      await this.db.rpc('signin_strike', { p_ip: ipHash, p_limit: limit, p_hours: hours }),
    ) as string | null;
    return until ? date(until) : null;
  }
  async prune() {
    return num(must(await this.db.rpc('prune_signin_strikes')));
  }
}
