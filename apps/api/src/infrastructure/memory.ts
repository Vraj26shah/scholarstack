/**
 * In-memory adapters for every repository port. They follow the same contracts as the
 * Supabase adapters (Liskov), so use cases behave identically in tests, demo mode and production.
 */
import type { ConversionReport } from '@ss/contracts';
import { accessEnd } from '../domain/access-window';
import type {
  AccessChange,
  AccessRecord,
  ActiveSession,
  Announcement,
  Batch,
  Branch,
  Bundle,
  Contribution,
  Course,
  CourseFile,
  CourseRoyalty,
  Device,
  EndedAccess,
  EndingAccess,
  Feature,
  FileUpsert,
  Order,
  OutgoingEmail,
  Principal,
  Profile,
  ReadingProgress,
  RoyaltyPayout,
  StoredObject,
  SupportQuery,
  ViewerLease,
} from '../domain/entities';
import { isVisible } from '../domain/entities';
import type {
  AccessLog,
  AnnouncementRepository,
  BundleRepository,
  CatalogueReader,
  CatalogueWriter,
  Clock,
  ContributionRepository,
  DatabaseHousekeeping,
  DeviceRepository,
  EmailQuota,
  EntitlementRepository,
  FeatureRepository,
  IdGenerator,
  LeaseRepository,
  Mailer,
  ObjectStore,
  OrderRepository,
  ProblemLog,
  ProblemReport,
  ProfileRepository,
  ProgressRepository,
  RecipientSource,
  SessionRegistry,
  SettingsRepository,
  UploadStore,
} from '../domain/ports';

export class MemoryDb {
  batches: Batch[] = [];
  branches: Branch[] = [];
  courses = new Map<string, Course>();
  courseBranches = new Map<string, string[]>();
  files = new Map<string, CourseFile>();
  /** key: course|unitKey */
  units = new Map<string, { title: string; kind: CourseFile['unitKind']; sort: number; hidden: boolean }>();
  pages = new Map<string, { imageKey: string; tileSeed: string }[]>();
  profiles = new Map<string, Profile>();
  contributions = new Map<string, Contribution>();
  contributionBlocked = new Set<string>();
  settings = new Map<string, unknown>();
  devices = new Map<string, Device>();
  sessions = new Map<string, ActiveSession>();
  leases = new Map<string, ViewerLease>();
  orders = new Map<string, Order>();
  /** When each order was paid (orders.paid_at). */
  paidAt = new Map<string, Date>();
  royalties = new Map<string, CourseRoyalty>();
  payouts: RoyaltyPayout[] = [];
  bonuses: {
    userId: string;
    year: number;
    amountPaise: number;
    note: string;
    paidAt: Date;
    recordedBy: string;
  }[] = [];
  support = new Map<string, SupportQuery>();
  /** announcement id → (user id → sent at) */
  deliveries = new Map<string, Map<string, Date>>();
  /** The admin list as the database holds it (empty: the configured list is used). */
  admins: { email: string; source: 'github' | 'manual'; addedAt: Date }[] = [];
  /** Gifts for college emails with no account yet, key: email|course. */
  pendingGrants = new Map<
    string,
    { email: string; courseId: string; until: Date | null; adminEmail: string }
  >();
  /** When each course's students were last told about new notes. */
  filesNotifiedAt = new Map<string, Date>();
  readonly startedAt = new Date();
  /** key: user|course */
  entitlements = new Map<
    string,
    {
      orderId: string;
      revoked: boolean;
      grantedAt?: Date;
      expiresAt?: Date | null;
      revokedAt?: Date | null;
      revokeReason?: 'admin' | 'dispute' | null;
      grantedBy?: 'purchase' | 'admin';
      grantedByAdmin?: string | null;
      endNotifiedAt?: Date | null;
      endingNotifiedAt?: Date | null;
    }
  >();
  progress = new Map<string, ReadingProgress>(); // key: user|file
  access = new Map<string, number>(); // key: user|file|day
  bundles = new Map<string, Bundle>();
  features = new Map<string, Feature>();
  announcements = new Map<string, Announcement>();
  quota = new Map<string, number>(); // key: day
  problems = new Map<string, ProblemReport>();
  outbox: OutgoingEmail[] = [];

  constructor(
    readonly ids: IdGenerator,
    readonly clock: Clock,
  ) {}

  /** Every branch, hidden ones too (the catalogue only sees active ones). */
  allBranches(): Branch[] {
    return [...this.branches];
  }

  day(): string {
    return this.clock.now().toISOString().slice(0, 10);
  }
}

export class MemoryCatalogue implements CatalogueReader, CatalogueWriter {
  constructor(private readonly db: MemoryDb) {}
  async listBatches() {
    const publicYears = new Set(
      [...this.db.courses.values()].filter((c) => c.status === 'live').map((c) => c.batchYear),
    );
    return this.db.batches.filter((batch) => batch.visible !== false && publicYears.has(batch.year));
  }
  async listBranches() {
    return this.db.branches.filter((b) => b.isActive !== false);
  }
  async listLiveCourses(batchYear: number, branchSlug: string) {
    return [...this.db.courses.values()].filter(
      (c) =>
        c.batchYear === batchYear &&
        (c.branchSlug === branchSlug || this.db.courseBranches.get(c.id)?.includes(branchSlug)) &&
        c.status === 'live',
    );
  }
  async findCourse(idOrSlug: string) {
    return (
      this.db.courses.get(idOrSlug) ?? [...this.db.courses.values()].find((c) => c.slug === idOrSlug) ?? null
    );
  }
  async coursesByIds(ids: string[]) {
    return ids.map((id) => this.db.courses.get(id)).filter((c): c is Course => !!c);
  }
  async ensureBatch(year: number) {
    if (!this.db.batches.some((b) => b.year === year)) this.db.batches.push({ year });
  }
  async moveCourseSource(
    courseId: string,
    newPrefix: string,
    files: { fileId: string; sourceKey: string; sourceEtag: string }[],
  ): Promise<void> {
    const course = this.db.courses.get(courseId);
    if (!course) throw new Error('course not found');
    this.db.courses.set(courseId, { ...course, r2Prefix: newPrefix });
    for (const f of files) {
      const file = this.db.files.get(f.fileId);
      if (file && file.courseId === courseId)
        this.db.files.set(f.fileId, { ...file, sourceKey: f.sourceKey, sourceEtag: f.sourceEtag });
    }
  }

  async deleteFiles(fileIds: string[]) {
    let n = 0;
    const courses = new Set<string>();
    for (const id of fileIds) {
      const f = this.db.files.get(id);
      if (!f) continue;
      courses.add(f.courseId);
      this.db.files.delete(id);
      this.db.pages.delete(id);
      for (const k of this.db.progress.keys()) if (k.endsWith(`|${id}`)) this.db.progress.delete(k);
      n++;
    }
    for (const k of [...this.db.units.keys()]) {
      const [courseId, unitKey] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
      if (!courses.has(courseId)) continue;
      if (![...this.db.files.values()].some((f) => f.courseId === courseId && f.unitKey === unitKey))
        this.db.units.delete(k);
    }
    return n;
  }
  async deleteCourse(courseId: string): Promise<'deleted' | 'sold' | 'not-found'> {
    if (!this.db.courses.has(courseId)) return 'not-found';
    const sold =
      [...this.db.entitlements.keys()].some((k) => k.endsWith(`|${courseId}`)) ||
      [...this.db.orders.values()].some(
        (o) => o.courseIds.includes(courseId) && (o.status === 'paid' || o.gatewayPaymentId),
      );
    if (sold) return 'sold';
    for (const [id, o] of this.db.orders) if (o.courseIds.includes(courseId)) this.db.orders.delete(id);
    for (const [id, f] of this.db.files)
      if (f.courseId === courseId) {
        this.db.files.delete(id);
        this.db.pages.delete(id);
      }
    for (const k of this.db.units.keys()) if (k.startsWith(`${courseId}|`)) this.db.units.delete(k);
    for (const b of this.db.bundles.values())
      if (b.courseIds.includes(courseId)) b.courseIds = b.courseIds.filter((id) => id !== courseId);
    this.db.courses.delete(courseId);
    return 'deleted';
  }
  async updateCourse(courseId: string, patch: Partial<Omit<Course, 'id' | 'r2Prefix'>>) {
    const course = this.db.courses.get(courseId);
    if (!course) return null;
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const updated: Course = { ...course, ...clean };
    this.db.courses.set(courseId, updated);
    return updated;
  }
  /** A file with its unit's current settings applied. */
  private withUnit(f: CourseFile): CourseFile {
    const unit = this.db.units.get(`${f.courseId}|${f.unitKey}`);
    return unit
      ? { ...f, unitTitle: unit.title, unitKind: unit.kind, unitSort: unit.sort, unitHidden: unit.hidden }
      : f;
  }
  async listAllFiles(courseIds: string[]) {
    const set = new Set(courseIds);
    return [...this.db.files.values()].filter((f) => set.has(f.courseId)).map((f) => this.withUnit(f));
  }
  async listPageManifests(fileIds: string[]) {
    const result = new Map<string, Array<{ pageNo: number; imageKey: string }>>();
    for (const fileId of new Set(fileIds)) {
      result.set(
        fileId,
        (this.db.pages.get(fileId) ?? []).map((page, index) => ({
          pageNo: index + 1,
          imageKey: page.imageKey,
        })),
      );
    }
    return result;
  }
  async listFiles(courseIds: string[]) {
    return (await this.listAllFiles(courseIds)).filter(isVisible);
  }
  async listHiddenFiles(courseIds: string[]) {
    return (await this.listAllFiles(courseIds)).filter((f) => !isVisible(f));
  }
  async findAnyFile(fileId: string) {
    const f = this.db.files.get(fileId);
    return f ? this.withUnit(f) : null;
  }
  async findFile(fileId: string) {
    const f = await this.findAnyFile(fileId);
    return f && isVisible(f) ? f : null;
  }
  async setUnitHidden(courseId: string, unitKey: string, hidden: boolean) {
    const key = `${courseId}|${unitKey}`;
    const unit = this.db.units.get(key);
    if (!unit) return false;
    this.db.units.set(key, { ...unit, hidden });
    return true;
  }
  async setFileHidden(fileId: string, hidden: boolean) {
    const f = this.db.files.get(fileId);
    if (!f) return false;
    this.db.files.set(fileId, { ...f, hidden });
    return true;
  }
  async markFileSourceMissing(fileId: string) {
    const file = this.db.files.get(fileId);
    if (!file) return false;
    this.db.pages.delete(fileId);
    this.db.files.set(fileId, {
      ...file,
      sourceMissingAt: new Date().toISOString(),
      hidden: true,
      conversionStatus: 'failed',
      conversionError: 'R2 source missing. This file is offline until its source is restored.',
      conversionErrorStage: 'downloading_source',
      conversionStage: 'failed',
      conversionProgressCurrent: 0,
      conversionProgressTotal: 0,
      pageCount: 0,
      previewKey: null,
    });
    return true;
  }
  async markConversionPending(fileId: string) {
    const file = this.db.files.get(fileId);
    if (!file) return false;
    this.db.pages.delete(file.id);
    this.db.files.set(fileId, {
      ...file,
      conversionStatus: 'pending',
      conversionError: null,
      conversionErrorStage: null,
      conversionStage: null,
      conversionProgressCurrent: 0,
      conversionProgressTotal: 0,
      conversionQueueId: null,
      conversionQueuePosition: 0,
      conversionQueueTotal: 0,
      conversionUpdatedAt: new Date().toISOString(),
      pageCount: 0,
      previewKey: null,
    });
    return true;
  }
  async listAllCourses() {
    return [...this.db.courses.values()];
  }
  async listCourseBranchSlugs(courseIds: string[]) {
    const assignments = new Map<string, string[]>();
    for (const id of courseIds) {
      const course = this.db.courses.get(id);
      const assigned = this.db.courseBranches.get(id) ?? (course ? [course.branchSlug] : []);
      if (assigned.length) assignments.set(id, [...assigned]);
    }
    return assignments;
  }
  async setCourseBranches(courseId: string, branchSlugs: string[]) {
    this.db.courseBranches.set(courseId, [...new Set(branchSlugs)]);
  }
  async upsertCourseByPrefix(c: Omit<Course, 'id' | 'status'>) {
    const existing = [...this.db.courses.values()].find((x) => x.r2Prefix === c.r2Prefix);
    if (existing) return { course: existing, created: false };
    const course: Course = { ...c, id: this.db.ids.next(), status: 'draft' };
    this.db.courses.set(course.id, course);
    this.db.courseBranches.set(course.id, [course.branchSlug]);
    return { course, created: true };
  }
  async upsertFileBySourceKey(f: FileUpsert) {
    const unitKey = `${f.courseId}|${f.unitKey}`;
    const unit = this.db.units.get(unitKey);
    this.db.units.set(unitKey, {
      title: f.unitTitle,
      kind: f.unitKind,
      sort: f.unitSort,
      hidden: unit ? unit.hidden : f.unitHiddenIfNew,
    });
    const existing = [...this.db.files.values()].find((x) => x.sourceKey === f.sourceKey);
    if (
      existing &&
      existing.sourceEtag === f.sourceEtag &&
      existing.sizeBytes === f.sizeBytes &&
      existing.unitKey === f.unitKey
    ) {
      if (existing.sourceMissingAt) {
        const restored = { ...existing, sourceMissingAt: null };
        this.db.files.set(existing.id, restored);
        return { file: this.withUnit(restored), change: 'same' as const };
      }
      return { file: this.withUnit(existing), change: 'same' as const };
    }
    const file: CourseFile = {
      id: existing?.id ?? this.db.ids.next(),
      courseId: f.courseId,
      unitKey: f.unitKey,
      unitTitle: f.unitTitle,
      unitKind: f.unitKind,
      unitSort: f.unitSort,
      unitHidden: false,
      hidden: existing ? existing.hidden : f.hiddenIfNew,
      name: f.name,
      format: f.format,
      sizeBytes: f.sizeBytes,
      pageCount: 0,
      sourceKey: f.sourceKey,
      sourceEtag: f.sourceEtag,
      sourceMissingAt: null,
      conversionStatus: 'pending',
      conversionError: null,
      sort: f.sort,
      previewKey: null,
    };
    if (existing) this.db.pages.delete(existing.id);
    this.db.files.set(file.id, file);
    return { file: this.withUnit(file), change: existing ? ('changed' as const) : ('added' as const) };
  }
  async applyConversion(report: ConversionReport) {
    const file = this.db.files.get(report.fileId);
    if (!file) return;
    this.db.pages.delete(file.id);
    if (report.status === 'ready') {
      this.db.pages.set(
        file.id,
        report.pages.map((p) => ({ imageKey: p.imageKey, tileSeed: p.tileSeed })),
      );
    }
    this.db.files.set(file.id, {
      ...file,
      conversionStatus: report.status,
      conversionError: report.error ?? null,
      conversionErrorStage: report.status === 'failed' ? (report.errorStage ?? null) : null,
      conversionStage: report.status === 'ready' ? 'complete' : 'failed',
      conversionProgressCurrent: report.status === 'ready' ? report.pages.length : 0,
      conversionProgressTotal: report.status === 'ready' ? report.pages.length : 0,
      conversionQueueId: report.queueId ?? file.conversionQueueId ?? null,
      conversionQueuePosition: report.queuePosition ?? file.conversionQueuePosition ?? 0,
      conversionQueueTotal: report.queueTotal ?? file.conversionQueueTotal ?? 0,
      conversionUpdatedAt: new Date().toISOString(),
      pageCount: report.status === 'ready' ? report.pages.length : 0,
      previewKey: report.status === 'ready' ? (report.previewKey ?? null) : null,
    });
  }

  async updateConversionProgress(
    progress: import('@ss/contracts').ConversionProgressReport & { error?: string; errorStage?: 'dispatch' },
  ) {
    const file = this.db.files.get(progress.fileId);
    if (!file) return;
    const queued = progress.stage === 'queued';
    const failed = progress.stage === 'failed';
    if (queued) this.db.pages.delete(file.id);
    this.db.files.set(file.id, {
      ...file,
      conversionStatus: queued ? 'pending' : failed ? 'failed' : file.conversionStatus,
      conversionError: queued
        ? null
        : failed
          ? (progress.error ?? 'The converter could not start this file.')
          : file.conversionError,
      conversionErrorStage: queued
        ? null
        : failed
          ? (progress.errorStage ?? null)
          : file.conversionErrorStage,
      conversionStage: progress.stage,
      conversionProgressCurrent: progress.current,
      conversionProgressTotal: progress.total,
      conversionQueueId: progress.queueId,
      conversionQueuePosition: progress.queuePosition,
      conversionQueueTotal: progress.queueTotal,
      conversionUpdatedAt: new Date().toISOString(),
      ...(queued ? { pageCount: 0, previewKey: null } : {}),
    });
  }
  async publishCourse(courseId: string, pricePaise: number) {
    const course = this.db.courses.get(courseId);
    if (!course) return null;
    const updated: Course = { ...course, status: 'live', pricePaise };
    this.db.courses.set(courseId, updated);
    return updated;
  }
}

export class MemoryProfiles implements ProfileRepository {
  constructor(private readonly db: MemoryDb) {}
  async findByEmails(emails: string[]) {
    const wanted = new Set(emails.map((e) => e.toLowerCase()));
    return [...this.db.profiles.values()]
      .filter((p) => wanted.has(p.email.toLowerCase()))
      .map((p) => ({ id: p.id, email: p.email.toLowerCase() }));
  }
  async ensure(p: Principal) {
    const existing = this.db.profiles.get(p.userId);
    if (existing) return existing;
    const profile: Profile = { id: p.userId, email: p.email, fullName: null, emailOptIn: true };
    this.db.profiles.set(p.userId, profile);
    // Same as the database trigger: courses an admin gave this email before they signed up.
    for (const [key, g] of this.db.pendingGrants) {
      if (g.email !== p.email.toLowerCase()) continue;
      const ek = `${p.userId}|${g.courseId}`;
      if (!this.db.entitlements.has(ek))
        this.db.entitlements.set(ek, {
          orderId: '',
          revoked: false,
          grantedAt: new Date(),
          expiresAt: g.until,
          revokedAt: null,
          revokeReason: null,
          grantedBy: 'admin',
          grantedByAdmin: g.adminEmail,
          endNotifiedAt: null,
        });
      this.db.pendingGrants.delete(key);
    }
    return profile;
  }
  async updateName(userId: string, fullName: string) {
    const p = this.db.profiles.get(userId);
    if (p) this.db.profiles.set(userId, { ...p, fullName });
  }
  async setEmailOptIn(userId: string, emailOptIn: boolean) {
    const p = this.db.profiles.get(userId);
    if (p) this.db.profiles.set(userId, { ...p, emailOptIn });
  }
}

export class MemoryDevices implements DeviceRepository {
  constructor(private readonly db: MemoryDb) {}
  async listActive(userId: string) {
    return [...this.db.devices.values()]
      .filter((d) => d.userId === userId && !d.revokedAt)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }
  async find(deviceId: string) {
    return this.db.devices.get(deviceId) ?? null;
  }
  async create(userId: string, label: string) {
    const now = this.db.clock.now();
    const device: Device = {
      id: this.db.ids.next(),
      userId,
      label,
      createdAt: now,
      lastSeenAt: now,
      revokedAt: null,
    };
    this.db.devices.set(device.id, device);
    return device;
  }
  async touch(deviceId: string) {
    const d = this.db.devices.get(deviceId);
    if (d) this.db.devices.set(deviceId, { ...d, lastSeenAt: this.db.clock.now() });
  }
  async revoke(deviceId: string) {
    const d = this.db.devices.get(deviceId);
    if (d) this.db.devices.set(deviceId, { ...d, revokedAt: this.db.clock.now() });
  }
}

export class MemorySessions implements SessionRegistry {
  constructor(private readonly db: MemoryDb) {}
  async list(userId: string) {
    return [...this.db.sessions.values()].filter((session) => session.userId === userId);
  }
  async set(s: ActiveSession) {
    this.db.sessions.set(`${s.userId}:${s.deviceId}`, s);
  }
}

export class MemoryLeases implements LeaseRepository {
  constructor(private readonly db: MemoryDb) {}
  async get(userId: string) {
    return this.db.leases.get(userId) ?? null;
  }
  async put(l: ViewerLease) {
    this.db.leases.set(l.userId, l);
  }
}

export class MemoryOrders implements OrderRepository, EntitlementRepository {
  constructor(private readonly db: MemoryDb) {}
  async create(o: Omit<Order, 'id' | 'status' | 'gatewayPaymentId'>) {
    const order: Order = { ...o, id: this.db.ids.next(), status: 'created', gatewayPaymentId: null };
    this.db.orders.set(order.id, order);
    return order;
  }
  async findById(id: string) {
    return this.db.orders.get(id) ?? null;
  }
  async findByGatewayOrderId(gatewayOrderId: string) {
    return [...this.db.orders.values()].find((o) => o.gatewayOrderId === gatewayOrderId) ?? null;
  }
  async markFailed(gatewayOrderId: string) {
    const o = await this.findByGatewayOrderId(gatewayOrderId);
    if (o && o.status === 'created') this.db.orders.set(o.id, { ...o, status: 'failed' });
  }
  async grant(gatewayOrderId: string, gatewayPaymentId: string) {
    const o = await this.findByGatewayOrderId(gatewayOrderId);
    if (!o) throw new Error('order not found');
    if (o.status !== 'paid') {
      this.db.orders.set(o.id, { ...o, status: 'paid', gatewayPaymentId });
      this.db.paidAt.set(o.id, this.db.clock.now());
    }
    for (const courseId of o.courseIds) {
      const key = `${o.userId}|${courseId}`;
      const current = this.db.entitlements.get(key);
      const now = new Date();
      const ended = current?.expiresAt && current.expiresAt.getTime() <= now.getTime();
      if (!current || current.revoked || ended) {
        // Same rule as grant_order: every purchase lasts ACCESS_MONTHS from the day it's bought.
        this.db.entitlements.set(key, {
          orderId: o.id,
          revoked: false,
          grantedAt: now,
          expiresAt: accessEnd(now),
          revokedAt: null,
          revokeReason: null,
          grantedBy: 'purchase',
          grantedByAdmin: null,
          endNotifiedAt: null,
        });
      }
    }
  }
  async revokeByPayment(gatewayPaymentId: string) {
    for (const o of this.db.orders.values()) {
      if (o.gatewayPaymentId !== gatewayPaymentId) continue;
      this.db.orders.set(o.id, { ...o, status: 'disputed' });
      for (const courseId of o.courseIds) {
        const key = `${o.userId}|${courseId}`;
        const e = this.db.entitlements.get(key);
        if (e?.orderId === o.id)
          this.db.entitlements.set(key, {
            ...e,
            revoked: true,
            revokedAt: new Date(),
            revokeReason: 'dispute',
          });
      }
    }
  }
  private active(e: { revoked: boolean; expiresAt?: Date | null }) {
    return !e.revoked && !(e.expiresAt && e.expiresAt.getTime() <= Date.now());
  }
  private record(key: string): AccessRecord {
    const e = this.db.entitlements.get(key)!;
    const [userId, courseId] = key.split('|') as [string, string];
    const profile = this.db.profiles.get(userId);
    return {
      userId,
      courseId,
      email: profile?.email ?? '',
      fullName: profile?.fullName ?? null,
      grantedAt: e.grantedAt ?? new Date(0),
      expiresAt: e.expiresAt ?? null,
      revokedAt: e.revoked ? (e.revokedAt ?? new Date(0)) : null,
      revokeReason: e.revoked ? (e.revokeReason ?? 'dispute') : null,
      grantedBy: e.grantedBy ?? 'purchase',
    };
  }
  async has(userId: string, courseId: string) {
    const e = this.db.entitlements.get(`${userId}|${courseId}`);
    return !!e && this.active(e);
  }
  async listCourseIds(userId: string) {
    return [...this.db.entitlements.entries()]
      .filter(([k, e]) => k.startsWith(`${userId}|`) && this.active(e))
      .map(([k]) => k.split('|')[1]!);
  }
  async listForUser(userId: string) {
    return [...this.db.entitlements.keys()]
      .filter((k) => k.startsWith(`${userId}|`))
      .map((k) => this.record(k));
  }
  async listForCourse(courseId: string) {
    return [...this.db.entitlements.keys()]
      .filter((k) => k.endsWith(`|${courseId}`))
      .map((k) => this.record(k));
  }
  async changeAccess(courseId: string, userIds: string[], change: AccessChange) {
    let n = 0;
    for (const userId of new Set(userIds)) {
      const key = `${userId}|${courseId}`;
      const e = this.db.entitlements.get(key);
      if (!e) continue;
      if (change.kind === 'block' && !e.revoked) {
        this.db.entitlements.set(key, { ...e, revoked: true, revokedAt: new Date(), revokeReason: 'admin' });
        n++;
      } else if (change.kind === 'restore' && e.revoked && e.revokeReason === 'admin') {
        this.db.entitlements.set(key, { ...e, revoked: false, revokedAt: null, revokeReason: null });
        n++;
      } else if (change.kind === 'until' && !(e.revoked && e.revokeReason !== 'admin')) {
        this.db.entitlements.set(key, {
          ...e,
          expiresAt: change.until,
          endNotifiedAt: null,
          endingNotifiedAt: null,
        });
        n++;
      }
    }
    return n;
  }
  async listEndedUnnotified(limit: number) {
    const now = Date.now();
    const out: EndedAccess[] = [];
    for (const [key, e] of this.db.entitlements) {
      if (e.revoked || !e.expiresAt || e.expiresAt.getTime() > now || e.endNotifiedAt) continue;
      const [userId, courseId] = key.split('|') as [string, string];
      const profile = this.db.profiles.get(userId);
      const course = this.db.courses.get(courseId);
      if (!profile || !course) continue;
      out.push({
        userId,
        email: profile.email,
        fullName: profile.fullName,
        courseId,
        courseTitle: course.title,
        courseSlug: course.slug,
        expiresAt: e.expiresAt,
      });
    }
    return out.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime()).slice(0, limit);
  }
  async listEndingSoon(before: Date, limit: number) {
    const now = this.db.clock.now().getTime();
    const out: EndingAccess[] = [];
    for (const [key, e] of this.db.entitlements) {
      if (e.revoked || !e.expiresAt || e.endingNotifiedAt) continue;
      const t = e.expiresAt.getTime();
      if (t <= now || t > before.getTime()) continue;
      const [userId, courseId] = key.split('|') as [string, string];
      const profile = this.db.profiles.get(userId);
      const course = this.db.courses.get(courseId);
      if (!profile || !course) continue;
      out.push({
        userId,
        email: profile.email,
        fullName: profile.fullName,
        courseId,
        courseTitle: course.title,
        courseSlug: course.slug,
        expiresAt: e.expiresAt,
        termLabel: course.termLabel ?? '',
      });
    }
    return out.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime()).slice(0, limit);
  }
  async addPendingGrants(courseId: string, emails: string[], until: Date | null, adminEmail: string) {
    for (const email of emails)
      this.db.pendingGrants.set(`${email}|${courseId}`, { email, courseId, until, adminEmail });
  }
  async markEndingNotified(items: { userId: string; courseId: string }[]) {
    for (const { userId, courseId } of items) {
      const key = `${userId}|${courseId}`;
      const e = this.db.entitlements.get(key);
      if (e) this.db.entitlements.set(key, { ...e, endingNotifiedAt: new Date() });
    }
  }
  async markEndNotified(items: { userId: string; courseId: string }[]) {
    for (const { userId, courseId } of items) {
      const key = `${userId}|${courseId}`;
      const e = this.db.entitlements.get(key);
      if (e) this.db.entitlements.set(key, { ...e, endNotifiedAt: new Date() });
    }
  }
  async grantByAdmin(courseId: string, userIds: string[], until: Date | null, adminEmail: string) {
    let n = 0;
    for (const userId of new Set(userIds)) {
      const key = `${userId}|${courseId}`;
      const e = this.db.entitlements.get(key);
      this.db.entitlements.set(key, {
        orderId: e?.orderId ?? '',
        revoked: false,
        grantedAt: new Date(),
        expiresAt: until,
        revokedAt: null,
        revokeReason: null,
        grantedBy: 'admin',
        grantedByAdmin: adminEmail,
        endNotifiedAt: null,
      });
      n++;
    }
    return n;
  }
  async applyTerm(courseId: string, until: Date | null) {
    let n = 0;
    for (const [key, e] of this.db.entitlements)
      if (key.endsWith(`|${courseId}`) && !e.revoked) {
        this.db.entitlements.set(key, {
          ...e,
          expiresAt: until,
          endNotifiedAt: null,
          endingNotifiedAt: null,
        });
        n++;
      }
    return n;
  }
}

export class MemoryReading implements ProgressRepository, AccessLog {
  constructor(private readonly db: MemoryDb) {}
  async get(userId: string, fileId: string) {
    return this.db.progress.get(`${userId}|${fileId}`) ?? null;
  }
  async set(userId: string, fileId: string, page: number) {
    this.db.progress.set(`${userId}|${fileId}`, { userId, fileId, page, updatedAt: this.db.clock.now() });
  }
  async latest(userId: string, limit: number) {
    return [...this.db.progress.values()]
      .filter((p) => p.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit);
  }
  async addPages(userId: string, fileId: string, pages: number) {
    const key = `${userId}|${fileId}|${this.db.day()}`;
    this.db.access.set(key, (this.db.access.get(key) ?? 0) + pages);
    return this.pagesToday(userId);
  }
  async pagesToday(userId: string) {
    const suffix = `|${this.db.day()}`;
    let total = 0;
    for (const [k, v] of this.db.access) if (k.startsWith(`${userId}|`) && k.endsWith(suffix)) total += v;
    return total;
  }
}

/** Object store backed by a map; values can be produced lazily (demo pages are generated on demand). */
export class MemoryObjectStore implements ObjectStore, UploadStore {
  private readonly objects = new Map<
    string,
    { size: number; etag: string; contentType: string; body?: Uint8Array }
  >();
  constructor(private readonly produce?: (key: string) => Promise<Uint8Array | null>) {}

  async save(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    this.put(key, bytes, contentType);
  }

  put(key: string, body: Uint8Array, contentType: string, etag = `e${body.length}`, size = body.length) {
    this.objects.set(key, { size, etag, contentType, body });
  }

  async deletePrefix(prefix: string): Promise<void> {
    for (const key of this.objects.keys()) {
      if (key.startsWith(prefix)) this.objects.delete(key);
    }
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async copy(fromKey: string, toKey: string) {
    const o = this.objects.get(fromKey);
    if (!o) throw new Error(`object not found: ${fromKey}`);
    this.objects.set(toKey, { ...o });
    return { etag: o.etag, size: o.size };
  }

  async list(prefix: string): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    do {
      const page = await this.listPage(prefix, cursor, 1000);
      out.push(...page.objects);
      if (page.nextCursor && (page.nextCursor === cursor || seenCursors.has(page.nextCursor))) {
        throw new Error('Memory object store repeated a continuation cursor.');
      }
      if (page.nextCursor) seenCursors.add(page.nextCursor);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return out;
  }

  async listPage(prefix: string, cursor?: string, limit = 500) {
    const sorted = [...this.objects.entries()]
      .filter(([key]) => key.startsWith(prefix) && (!cursor || key > cursor))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const batch = sorted.slice(0, Math.max(1, limit));
    return {
      objects: batch.map(([key, value]) => ({ key, size: value.size, etag: value.etag })),
      nextCursor: sorted.length > batch.length ? (batch.at(-1)?.[0] ?? null) : null,
    };
  }

  async get(key: string) {
    const o = this.objects.get(key);
    // Demo pages: stored objects mark presence (like R2), the producer draws the real image.
    if (o && this.produce) {
      const bytes = await this.produce(key);
      if (bytes) return { body: bytes, contentType: 'image/webp', etag: o.etag };
    }
    if (o?.body) return { body: o.body, contentType: o.contentType, etag: o.etag, size: o.size };
    if (this.produce && !o) {
      const bytes = await this.produce(key);
      if (bytes) return { body: bytes, contentType: 'image/webp' };
    }
    return null;
  }
}

export class MemoryBundles implements BundleRepository {
  constructor(private readonly db: MemoryDb) {}
  async listLive() {
    return [...this.db.bundles.values()].filter((b) => b.status === 'live');
  }
  async listAll() {
    return [...this.db.bundles.values()];
  }
  async find(idOrSlug: string) {
    return (
      this.db.bundles.get(idOrSlug) ?? [...this.db.bundles.values()].find((b) => b.slug === idOrSlug) ?? null
    );
  }
  async save(b: Omit<Bundle, 'id'> & { id?: string }) {
    const bundle: Bundle = { ...b, id: b.id ?? this.db.ids.next(), courseIds: [...new Set(b.courseIds)] };
    this.db.bundles.set(bundle.id, bundle);
    return bundle;
  }
}

export class MemoryFeatures implements FeatureRepository {
  constructor(private readonly db: MemoryDb) {}
  async list() {
    return [...this.db.features.values()];
  }
  async find(key: string) {
    return this.db.features.get(key) ?? null;
  }
  async save(f: Feature) {
    this.db.features.set(f.key, f);
    return f;
  }
}

export class MemoryAnnouncements implements AnnouncementRepository {
  constructor(private readonly db: MemoryDb) {}
  async list() {
    return [...this.db.announcements.values()];
  }
  async find(id: string) {
    return this.db.announcements.get(id) ?? null;
  }
  async create(
    a: Pick<Announcement, 'subject' | 'heading' | 'body' | 'ctaLabel' | 'ctaUrl' | 'featureKey'> & {
      courseId?: string | null;
    },
  ) {
    const row: Announcement = {
      ...a,
      courseId: a.courseId ?? null,
      id: this.db.ids.next(),
      status: 'draft',
      recipients: 0,
      sent: 0,
      cursorId: null,
      error: null,
      createdAt: this.db.clock.now(),
      sentAt: null,
    };
    this.db.announcements.set(row.id, row);
    return row;
  }
  async update(id: string, patch: Partial<Omit<Announcement, 'id' | 'createdAt'>>) {
    const current = this.db.announcements.get(id);
    if (!current) throw new Error('announcement not found');
    const row = { ...current, ...patch };
    this.db.announcements.set(id, row);
    return row;
  }
  async listSending() {
    return [...this.db.announcements.values()].filter((a) => a.status === 'sending');
  }
}

/** Opted-in profiles ordered by id, the same order the Supabase adapter uses. */
export class MemoryRecipients implements RecipientSource {
  constructor(private readonly db: MemoryDb) {}
  private all() {
    return [...this.db.profiles.values()].filter((p) => p.emailOptIn).sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  async count() {
    return this.all().length;
  }
  async after(cursorId: string | null, limit: number) {
    return this.all()
      .filter((p) => cursorId === null || p.id > cursorId)
      .slice(0, limit)
      .map((p) => ({ id: p.id, email: p.email, fullName: p.fullName }));
  }
}

export class MemoryProblems implements ProblemLog {
  constructor(private readonly db: MemoryDb) {}
  async record(p: Omit<ProblemReport, 'count' | 'firstAt' | 'lastAt'>) {
    const now = new Date();
    const old = this.db.problems.get(p.fingerprint);
    this.db.problems.set(
      p.fingerprint,
      old
        ? { ...old, ...p, count: old.count + 1, lastAt: now }
        : { ...p, count: 1, firstAt: now, lastAt: now },
    );
  }
  async list(limit: number) {
    return [...this.db.problems.values()]
      .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
      .slice(0, limit);
  }
  async clear(fingerprints?: string[]) {
    const keys = fingerprints ?? [...this.db.problems.keys()];
    let n = 0;
    for (const k of keys) if (this.db.problems.delete(k)) n++;
    return n;
  }
}

export class MemoryHousekeeping implements DatabaseHousekeeping {
  constructor(private readonly db: MemoryDb) {}
  async tables() {
    return Object.entries(this.db)
      .filter(([, v]) => v instanceof Map)
      .map(([table, v]) => ({ table, rows: (v as Map<unknown, unknown>).size, bytes: 0 }));
  }
  private abandoned(_days: number) {
    const granted = new Set(
      [...this.db.entitlements.values()].map((e) => (e as { orderId?: string | null }).orderId),
    );
    return [...this.db.orders.values()].filter(
      (o) => o.status !== 'paid' && !o.gatewayPaymentId && !granted.has(o.id),
    );
  }
  async countAbandonedOrders(days: number) {
    return this.abandoned(days).length;
  }
  async cleanAbandonedOrders(days: number) {
    const gone = this.abandoned(days);
    for (const o of gone) this.db.orders.delete(o.id);
    return gone.length;
  }
}

export class MemoryQuota implements EmailQuota {
  constructor(private readonly db: MemoryDb) {}
  async usedOn(day: string) {
    return this.db.quota.get(day) ?? 0;
  }
  async add(day: string, count: number) {
    const total = (this.db.quota.get(day) ?? 0) + count;
    this.db.quota.set(day, total);
    return total;
  }
}

/** Demo/test mailer: keeps every email in an outbox you can inspect. */
export class MemoryMailer implements Mailer {
  readonly provider = 'demo' as const;
  failNext = false;
  constructor(private readonly db: MemoryDb) {}
  async sendBatch(messages: OutgoingEmail[]) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('Simulated provider outage');
    }
    this.db.outbox.push(...messages);
  }
}

export class MemoryContributions implements ContributionRepository {
  constructor(private readonly db: MemoryDb) {}
  async create(c: Parameters<ContributionRepository['create']>[0]) {
    const row: Contribution = {
      ...c,
      status: 'pending',
      reviewNote: '',
      reward: null,
      reviewedBy: null,
      reviewedAt: null,
      createdAt: new Date(),
    };
    this.db.contributions.set(row.id, row);
    return row;
  }
  async find(id: string) {
    return this.db.contributions.get(id) ?? null;
  }
  async listForUser(userId: string) {
    return [...this.db.contributions.values()]
      .filter((c) => c.userId === userId)
      .sort((a, b) => +b.createdAt - +a.createdAt);
  }
  async list(status: Contribution['status'] | 'all', limit: number) {
    return [...this.db.contributions.values()]
      .filter((c) => status === 'all' || c.status === status)
      .sort((a, b) => +b.createdAt - +a.createdAt)
      .slice(0, limit);
  }
  async counts(userId: string, since: Date) {
    const mine = [...this.db.contributions.values()].filter((c) => c.userId === userId);
    return {
      recent: mine.filter((c) => c.createdAt >= since).length,
      pending: mine.filter((c) => c.status === 'pending').length,
      approved: mine.filter((c) => c.status === 'approved').length,
    };
  }
  async review(id: string, patch: Pick<Contribution, 'status' | 'reviewNote' | 'reward' | 'reviewedBy'>) {
    const c = this.db.contributions.get(id);
    if (!c) return null;
    const next = { ...c, ...patch, reviewedAt: new Date() };
    this.db.contributions.set(id, next);
    return next;
  }
  async remove(id: string) {
    this.db.contributions.delete(id);
  }
  async contributors(userIds: string[]) {
    const out = new Map<string, { email: string; name: string | null; blocked: boolean; approved: number }>();
    for (const id of userIds) {
      const p = this.db.profiles.get(id);
      out.set(id, {
        email: p?.email ?? '',
        name: p?.fullName ?? null,
        blocked: this.db.contributionBlocked.has(id),
        approved: [...this.db.contributions.values()].filter(
          (c) => c.userId === id && c.status === 'approved',
        ).length,
      });
    }
    return out;
  }
  async isBlocked(userId: string) {
    return this.db.contributionBlocked.has(userId);
  }
  async setBlocked(userId: string, blocked: boolean) {
    if (blocked) this.db.contributionBlocked.add(userId);
    else this.db.contributionBlocked.delete(userId);
  }
  async cashRewards() {
    return [...this.db.contributions.values()]
      .filter((c) => c.status === 'approved' && c.reward?.type === 'cash')
      .sort((a, b) => (b.reviewedAt?.getTime() ?? 0) - (a.reviewedAt?.getTime() ?? 0));
  }
  async markRewardPaid(id: string, note: string) {
    const c = this.db.contributions.get(id);
    if (c) this.db.contributions.set(id, { ...c, rewardPaidAt: new Date(), rewardPaidNote: note });
  }
}

export class MemorySettings implements SettingsRepository {
  constructor(private readonly db: MemoryDb) {}
  async get<T>(key: string, fallback: T): Promise<T> {
    return this.db.settings.has(key) ? (this.db.settings.get(key) as T) : fallback;
  }
  async set<T>(key: string, value: T) {
    this.db.settings.set(key, value);
  }
}
