/**
 * In-memory adapters for every repository port. They follow the same contracts as the
 * Supabase adapters (Liskov), so use cases behave identically in tests, demo mode and production.
 */
import type { ConversionReport } from '@ss/contracts';
import type {
  ActiveSession,
  Announcement,
  Batch,
  Branch,
  Bundle,
  Course,
  CourseFile,
  Device,
  Feature,
  FileUpsert,
  Order,
  OutgoingEmail,
  Principal,
  Profile,
  ReadingProgress,
  StoredObject,
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
  DeviceRepository,
  EmailQuota,
  EntitlementRepository,
  FeatureRepository,
  IdGenerator,
  LeaseRepository,
  Mailer,
  ObjectStore,
  OrderRepository,
  ProfileRepository,
  ProgressRepository,
  RecipientSource,
  SessionRegistry,
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
  devices = new Map<string, Device>();
  sessions = new Map<string, ActiveSession>();
  leases = new Map<string, ViewerLease>();
  orders = new Map<string, Order>();
  entitlements = new Map<string, { orderId: string; revoked: boolean }>(); // key: user|course
  progress = new Map<string, ReadingProgress>(); // key: user|file
  access = new Map<string, number>(); // key: user|file|day
  bundles = new Map<string, Bundle>();
  features = new Map<string, Feature>();
  announcements = new Map<string, Announcement>();
  quota = new Map<string, number>(); // key: day
  outbox: OutgoingEmail[] = [];

  constructor(
    readonly ids: IdGenerator,
    readonly clock: Clock,
  ) {}

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
    return this.db.batches.filter((batch) => publicYears.has(batch.year));
  }
  async listBranches() {
    return [...this.db.branches];
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
  async ensure(p: Principal) {
    const existing = this.db.profiles.get(p.userId);
    if (existing) return existing;
    const profile: Profile = { id: p.userId, email: p.email, fullName: null, emailOptIn: true };
    this.db.profiles.set(p.userId, profile);
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
    if (o.status !== 'paid') this.db.orders.set(o.id, { ...o, status: 'paid', gatewayPaymentId });
    for (const courseId of o.courseIds) {
      const key = `${o.userId}|${courseId}`;
      const current = this.db.entitlements.get(key);
      if (!current || current.revoked) this.db.entitlements.set(key, { orderId: o.id, revoked: false });
    }
  }
  async revokeByPayment(gatewayPaymentId: string) {
    for (const o of this.db.orders.values()) {
      if (o.gatewayPaymentId !== gatewayPaymentId) continue;
      this.db.orders.set(o.id, { ...o, status: 'disputed' });
      for (const courseId of o.courseIds) {
        const key = `${o.userId}|${courseId}`;
        const e = this.db.entitlements.get(key);
        if (e?.orderId === o.id) this.db.entitlements.set(key, { ...e, revoked: true });
      }
    }
  }
  async has(userId: string, courseId: string) {
    const e = this.db.entitlements.get(`${userId}|${courseId}`);
    return !!e && !e.revoked;
  }
  async listCourseIds(userId: string) {
    return [...this.db.entitlements.entries()]
      .filter(([k, e]) => k.startsWith(`${userId}|`) && !e.revoked)
      .map(([k]) => k.split('|')[1]!);
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
export class MemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<
    string,
    { size: number; etag: string; contentType: string; body?: Uint8Array }
  >();
  constructor(private readonly produce?: (key: string) => Promise<Uint8Array | null>) {}

  put(key: string, body: Uint8Array, contentType: string, etag = `e${body.length}`) {
    this.objects.set(key, { size: body.length, etag, contentType, body });
  }

  async deletePrefix(prefix: string): Promise<void> {
    for (const key of this.objects.keys()) {
      if (key.startsWith(prefix)) this.objects.delete(key);
    }
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
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
    if (o?.body) return { body: o.body, contentType: o.contentType, etag: o.etag, size: o.size };
    if (this.produce) {
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
  async create(a: Pick<Announcement, 'subject' | 'heading' | 'body' | 'ctaLabel' | 'ctaUrl' | 'featureKey'>) {
    const row: Announcement = {
      ...a,
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
