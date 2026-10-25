import type {
  Branch,
  CourseEarningRow,
  CourseRoyalty,
  RoyaltyPayout,
  SupportQuery,
} from '../domain/entities';
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
import type { MemoryDb } from './memory';

/** Same rules as the course_earnings() SQL: bundles split by course price, paid orders only. */
export class MemoryEarnings implements EarningsRepository {
  constructor(private readonly db: MemoryDb) {}

  private lines() {
    const out: { orderId: string; userId: string; courseId: string; paidAt: Date; amountPaise: number }[] =
      [];
    for (const o of this.db.orders.values()) {
      if (o.status !== 'paid') continue;
      const paidAt = this.db.paidAt.get(o.id) ?? new Date(0);
      const weights = o.courseIds.map((id) => Math.max(this.db.courses.get(id)?.pricePaise ?? 1, 1));
      const sum = weights.reduce((a, b) => a + b, 0);
      o.courseIds.forEach((courseId, i) =>
        out.push({
          orderId: o.id,
          userId: o.userId,
          courseId,
          paidAt,
          amountPaise:
            o.courseIds.length === 1 ? o.amountPaise : Math.round((o.amountPaise * weights[i]!) / sum),
        }),
      );
    }
    return out;
  }

  async courseEarnings(): Promise<CourseEarningRow[]> {
    const lines = this.lines();
    const now = this.db.clock.now().getTime();
    return [...this.db.courses.values()].map((c) => {
      const mine = lines.filter((l) => l.courseId === c.id);
      const r = this.db.royalties.get(c.id);
      const since = r ? mine.filter((l) => l.paidAt.getTime() >= r.since.getTime()) : [];
      const ents = [...this.db.entitlements.entries()]
        .filter(([k]) => k.endsWith(`|${c.id}`))
        .map(([, e]) => e);
      return {
        courseId: c.id,
        sales: mine.length,
        buyers: new Set(mine.map((l) => l.userId)).size,
        revenuePaise: mine.reduce((t, l) => t + l.amountPaise, 0),
        lastSaleAt: mine.length ? new Date(Math.max(...mine.map((l) => l.paidAt.getTime()))) : null,
        freeAccess: ents.filter((e) => e.grantedBy === 'admin' && !e.revoked).length,
        readingNow: ents.filter((e) => !e.revoked && (!e.expiresAt || e.expiresAt.getTime() > now)).length,
        royaltySales: since.length,
        royaltyRevenuePaise: since.reduce((t, l) => t + l.amountPaise, 0),
        paidOutPaise: r
          ? this.db.payouts
              .filter((p) => p.courseId === c.id && p.userId === r.userId)
              .reduce((t, p) => t + p.amountPaise, 0)
          : 0,
      };
    });
  }
  async paidTotals() {
    const paid = [...this.db.orders.values()].filter((o) => o.status === 'paid');
    return { orders: paid.length, buyers: new Set(paid.map((o) => o.userId)).size };
  }
  async royalties() {
    return [...this.db.royalties.values()];
  }
  async royaltiesForUser(userId: string) {
    return [...this.db.royalties.values()].filter((r) => r.userId === userId);
  }
  async setRoyalty(r: CourseRoyalty) {
    this.db.royalties.set(r.courseId, r);
  }
  async removeRoyalty(courseId: string) {
    this.db.royalties.delete(courseId);
  }
  async addPayout(p: Omit<RoyaltyPayout, 'id' | 'paidAt'>) {
    const row: RoyaltyPayout = { ...p, id: crypto.randomUUID(), paidAt: this.db.clock.now() };
    this.db.payouts.unshift(row);
    return row;
  }
  async payouts(limit: number) {
    return this.db.payouts.slice(0, limit);
  }
  async royaltyEarningsSince(since: Date) {
    const lines = this.lines();
    return [...this.db.royalties.values()].map((r) => {
      const from = Math.max(r.since.getTime(), since.getTime());
      const mine = lines.filter((l) => l.courseId === r.courseId && l.paidAt.getTime() >= from);
      return {
        userId: r.userId,
        courseId: r.courseId,
        sharePercent: r.sharePercent,
        sales: mine.length,
        revenuePaise: mine.reduce((t, l) => t + l.amountPaise, 0),
      };
    });
  }
  async bonuses(year: number) {
    return this.db.bonuses.filter((b) => b.year === year);
  }
  async addBonus(b: { userId: string; year: number; amountPaise: number; note: string; recordedBy: string }) {
    if (this.db.bonuses.some((x) => x.userId === b.userId && x.year === b.year))
      throw new Error('duplicate bonus');
    this.db.bonuses.push({ ...b, paidAt: this.db.clock.now() });
  }
}

export class MemoryPeople implements PeopleDirectory {
  constructor(private readonly db: MemoryDb) {}
  async byIds(userIds: string[]) {
    const out = new Map<string, { email: string; name: string | null }>();
    for (const id of userIds) {
      const p = this.db.profiles.get(id);
      if (p) out.set(id, { email: p.email, name: p.fullName ?? null });
    }
    return out;
  }
}

export class MemorySupport implements SupportRepository {
  constructor(private readonly db: MemoryDb) {}
  async create(q: Parameters<SupportRepository['create']>[0], first: { author: string; body: string }) {
    const now = this.db.clock.now();
    const row: SupportQuery = {
      ...q,
      status: 'open',
      messages: [
        { id: crypto.randomUUID(), fromAdmin: false, author: first.author, body: first.body, createdAt: now },
      ],
      createdAt: now,
      updatedAt: now,
    };
    this.db.support.set(row.id, row);
    return structuredClone(row);
  }
  async find(id: string) {
    const q = this.db.support.get(id);
    return q ? structuredClone(q) : null;
  }
  async listForUser(userId: string) {
    return [...this.db.support.values()]
      .filter((q) => q.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map((q) => structuredClone(q));
  }
  async list(status: SupportQuery['status'] | 'all', limit: number) {
    return [...this.db.support.values()]
      .filter((q) => status === 'all' || q.status === status)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit)
      .map((q) => structuredClone(q));
  }
  async addMessage(queryId: string, m: { fromAdmin: boolean; author: string; body: string }) {
    const q = this.db.support.get(queryId);
    if (!q) return;
    const now = this.db.clock.now();
    q.messages.push({ id: crypto.randomUUID(), ...m, createdAt: now });
    q.status = m.fromAdmin ? 'answered' : 'open';
    q.updatedAt = now;
  }
  async setStatus(id: string, status: SupportQuery['status']) {
    const q = this.db.support.get(id);
    if (q) {
      q.status = status;
      q.updatedAt = this.db.clock.now();
    }
  }
  async counts(userId: string, since: Date) {
    const mine = [...this.db.support.values()].filter((q) => q.userId === userId);
    return {
      open: mine.filter((q) => q.status !== 'closed').length,
      recent: mine.filter((q) => q.createdAt.getTime() >= since.getTime()).length,
    };
  }
  async remove(id: string) {
    this.db.support.delete(id);
  }
}

export class MemoryAcademic implements AcademicRepository {
  constructor(private readonly db: MemoryDb) {}
  async years() {
    const courses = [...this.db.courses.values()];
    return [...this.db.batches]
      .sort((a, b) => b.year - a.year)
      .map((b) => ({
        year: b.year,
        visible: b.visible !== false,
        courses: courses.filter((c) => c.batchYear === b.year).length,
        live: courses.filter((c) => c.batchYear === b.year && c.status === 'live').length,
      }));
  }
  async saveYear(year: number, visible: boolean) {
    const b = this.db.batches.find((x) => x.year === year);
    if (b) b.visible = visible;
    else this.db.batches.push({ year, visible });
  }
  async deleteYear(year: number) {
    this.db.batches = this.db.batches.filter((b) => b.year !== year);
  }
  async branches() {
    const courses = [...this.db.courses.values()];
    return [...this.db.branches]
      .sort((a, b) => a.sort - b.sort)
      .map((b) => ({
        slug: b.slug,
        code: b.code,
        name: b.name,
        shortName: b.shortName,
        isCommon: b.isCommon,
        isActive: b.isActive !== false,
        sort: b.sort,
        courses: courses.filter(
          (c) => c.branchSlug === b.slug || (this.db.courseBranches.get(c.id) ?? []).includes(b.slug),
        ).length,
      }));
  }
  async saveBranch(input: Parameters<AcademicRepository['saveBranch']>[0]) {
    const existing = input.slug ? this.db.branches.find((b) => b.slug === input.slug) : undefined;
    if (existing) Object.assign(existing, { ...input, slug: existing.slug });
    else
      this.db.branches.push({
        slug: input.code.toLowerCase(),
        code: input.code,
        name: input.name,
        shortName: input.shortName,
        isCommon: input.isCommon,
        isActive: input.isActive,
        sort: input.sort,
        tagline: '',
        description: '',
        courseCodes: [],
      });
  }
  async moveCourses(fromYear: number, toYear: number, branchSlug: string | null) {
    if (!this.db.batches.some((b) => b.year === toYear)) this.db.batches.push({ year: toYear });
    let n = 0;
    for (const c of this.db.courses.values()) {
      if (c.batchYear !== fromYear) continue;
      if (
        branchSlug &&
        c.branchSlug !== branchSlug &&
        !(this.db.courseBranches.get(c.id) ?? []).includes(branchSlug)
      )
        continue;
      c.batchYear = toYear;
      n++;
    }
    if (!branchSlug)
      for (const b of this.db.bundles.values()) if (b.batchYear === fromYear) b.batchYear = toYear;
    return n;
  }
}

export class MemoryDeliveries implements DeliveryLog {
  constructor(private readonly db: MemoryDb) {}
  private log(id: string) {
    let m = this.db.deliveries.get(id);
    if (!m) {
      m = new Map();
      this.db.deliveries.set(id, m);
    }
    return m;
  }
  /** Who an announcement is for: every opted-in student, or the students who have its course now. */
  private audience(announcementId: string) {
    const courseId = this.db.announcements.get(announcementId)?.courseId ?? null;
    const now = Date.now();
    return [...this.db.profiles.values()]
      .filter((p) => {
        if (!courseId) return p.emailOptIn;
        const e = this.db.entitlements.get(`${p.id}|${courseId}`);
        return !!e && !e.revoked && (!e.expiresAt || e.expiresAt.getTime() > now);
      })
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  async batches(announcementId: string) {
    const m = this.log(announcementId);
    const batchOf = (email: string) => {
      const y = /(\d{2})[a-z]{3}\d+@/.exec(email)?.[1];
      return y ? `20${y}` : 'Other';
    };
    const rows = new Map<string, { batch: string; sent: number; waiting: number }>();
    const bump = (email: string, key: 'sent' | 'waiting') => {
      const b = batchOf(email);
      const row = rows.get(b) ?? { batch: b, sent: 0, waiting: 0 };
      row[key]++;
      rows.set(b, row);
    };
    for (const id of m.keys()) bump(this.db.profiles.get(id)?.email ?? '', 'sent');
    for (const p of this.audience(announcementId)) if (!m.has(p.id)) bump(p.email, 'waiting');
    return [...rows.values()].sort((a, b) => b.batch.localeCompare(a.batch));
  }
  async record(announcementId: string, userIds: string[]) {
    const m = this.log(announcementId);
    for (const id of userIds) if (!m.has(id)) m.set(id, this.db.clock.now());
  }
  async pending(announcementId: string, limit: number) {
    const m = this.log(announcementId);
    return this.audience(announcementId)
      .filter((p) => !m.has(p.id))
      .slice(0, limit)
      .map((p) => ({ id: p.id, email: p.email, fullName: p.fullName }));
  }
  async progress(announcementId: string) {
    const m = this.log(announcementId);
    return { sent: m.size, waiting: this.audience(announcementId).filter((p) => !m.has(p.id)).length };
  }
  async recipients(announcementId: string, limit: number) {
    const m = this.log(announcementId);
    const sent = [...m.entries()].map(([id, at]) => {
      const p = this.db.profiles.get(id);
      return { email: p?.email ?? '', fullName: p?.fullName ?? null, sentAt: at };
    });
    const waiting = this.audience(announcementId)
      .filter((p) => !m.has(p.id))
      .map((p) => ({ email: p.email, fullName: p.fullName, sentAt: null }));
    return [...sent, ...waiting].slice(0, limit);
  }
}

export class MemoryAdmins implements AdminDirectory {
  constructor(private readonly db: MemoryDb) {}
  async list() {
    return [...this.db.admins];
  }
}

export class MemoryCourseUpdates implements CourseUpdateSource {
  constructor(private readonly db: MemoryDb) {}
  async coursesWithNewFiles() {
    const out: { courseId: string; title: string; slug: string; fileNames: string[] }[] = [];
    for (const c of this.db.courses.values()) {
      if (c.status !== 'live') continue;
      const since = (this.db.filesNotifiedAt.get(c.id) ?? this.db.startedAt).getTime();
      const names = [...this.db.files.values()]
        .filter(
          (f) =>
            f.courseId === c.id &&
            f.conversionStatus === 'ready' &&
            !f.hidden &&
            !f.unitHidden &&
            f.conversionUpdatedAt &&
            new Date(f.conversionUpdatedAt).getTime() > since,
        )
        .map((f) => f.name)
        .sort();
      if (names.length) out.push({ courseId: c.id, title: c.title, slug: c.slug, fileNames: names });
    }
    return out;
  }
  async markFilesNotified(courseId: string) {
    const newest = Math.max(
      Date.now(),
      ...[...this.db.files.values()]
        .filter((f) => f.courseId === courseId && f.conversionUpdatedAt)
        .map((f) => new Date(f.conversionUpdatedAt!).getTime()),
    );
    this.db.filesNotifiedAt.set(courseId, new Date(newest));
  }
}

export class MemorySignInStrikes implements SignInStrikes {
  private rows = new Map<string, { strikes: number; firstAt: number; blockedUntil: number | null }>();
  constructor(private readonly now: () => number = Date.now) {}
  async blockedUntil(ipHash: string) {
    const r = this.rows.get(ipHash);
    return r?.blockedUntil && r.blockedUntil > this.now() ? new Date(r.blockedUntil) : null;
  }
  async strike(ipHash: string, limit: number, hours: number) {
    const now = this.now();
    const windowMs = hours * 3_600_000;
    const r = this.rows.get(ipHash);
    const row =
      !r || r.firstAt < now - windowMs
        ? { strikes: 1, firstAt: now, blockedUntil: r?.blockedUntil ?? null }
        : { ...r, strikes: r.strikes + 1 };
    if (row.strikes >= limit && (!row.blockedUntil || row.blockedUntil < now))
      row.blockedUntil = now + windowMs;
    this.rows.set(ipHash, row);
    return row.blockedUntil && row.blockedUntil > now ? new Date(row.blockedUntil) : null;
  }
  async prune() {
    return 0;
  }
}
