/**
 * Ports: the only things use cases know about the outside world.
 * Each is small and single-purpose (interface segregation). Infrastructure adapters
 * implement them; use cases receive them through their constructors (dependency inversion).
 */
import type { ConversionProgressReport, ConversionReport } from '@ss/contracts';
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
  Recipient,
  StoredObject,
  ViewerLease,
} from './entities';

// ── Catalogue ──

export interface CatalogueReader {
  listBatches(): Promise<Batch[]>;
  listBranches(): Promise<Branch[]>;
  listLiveCourses(batchYear: number, branchSlug: string): Promise<Course[]>;
  findCourse(idOrSlug: string): Promise<Course | null>;
  coursesByIds(ids: string[]): Promise<Course[]>;
  /** Files students may see: hidden files and files in hidden units are left out. */
  listFiles(courseIds: string[]): Promise<CourseFile[]>;
  /** A file students may see, or null. */
  findFile(fileId: string): Promise<CourseFile | null>;
  /** Hidden files (reference books, textbooks): only their names are ever shown. */
  listHiddenFiles(courseIds: string[]): Promise<CourseFile[]>;
}

export interface CatalogueWriter {
  listAllCourses(): Promise<Course[]>;
  listCourseBranchSlugs(courseIds: string[]): Promise<Map<string, string[]>>;
  setCourseBranches(courseId: string, branchSlugs: string[]): Promise<void>;
  ensureBatch(year: number): Promise<void>;
  upsertCourseByPrefix(course: Omit<Course, 'id' | 'status'>): Promise<{ course: Course; created: boolean }>;
  updateCourse(courseId: string, patch: Partial<Omit<Course, 'id' | 'r2Prefix'>>): Promise<Course | null>;
  /** Every file, hidden or not (admin, importer, converter). */
  listAllFiles(courseIds: string[]): Promise<CourseFile[]>;
  /** Exact page_no -> image_key map stored in Supabase for selected files. */
  listPageManifests(fileIds: string[]): Promise<Map<string, Array<{ pageNo: number; imageKey: string }>>>;
  findAnyFile(fileId: string): Promise<CourseFile | null>;
  upsertFileBySourceKey(
    file: FileUpsert,
  ): Promise<{ file: CourseFile; change: 'added' | 'changed' | 'same' }>;
  /** Retires a source removed from R2 without deleting student reading history. */
  markFileSourceMissing(fileId: string): Promise<boolean>;
  setUnitHidden(courseId: string, unitKey: string, hidden: boolean): Promise<boolean>;
  setFileHidden(fileId: string, hidden: boolean): Promise<boolean>;
  markConversionPending(fileId: string): Promise<boolean>;
  updateConversionProgress(
    progress: ConversionProgressReport & { error?: string; errorStage?: 'dispatch' },
  ): Promise<void>;
  applyConversion(report: ConversionReport): Promise<void>;
  publishCourse(courseId: string, pricePaise: number): Promise<Course | null>;
}

export interface BundleRepository {
  listLive(): Promise<Bundle[]>;
  listAll(): Promise<Bundle[]>;
  find(idOrSlug: string): Promise<Bundle | null>;
  save(bundle: Omit<Bundle, 'id'> & { id?: string }): Promise<Bundle>;
}

// ── Accounts & sessions ──

export interface ProfileRepository {
  ensure(principal: Principal): Promise<Profile>;
  updateName(userId: string, fullName: string): Promise<void>;
  setEmailOptIn(userId: string, optIn: boolean): Promise<void>;
}

// ── Toolbox & email ──

export interface FeatureRepository {
  list(): Promise<Feature[]>;
  find(key: string): Promise<Feature | null>;
  save(feature: Feature): Promise<Feature>;
}

export interface AnnouncementRepository {
  list(): Promise<Announcement[]>;
  find(id: string): Promise<Announcement | null>;
  create(
    a: Pick<Announcement, 'subject' | 'heading' | 'body' | 'ctaLabel' | 'ctaUrl' | 'featureKey'>,
  ): Promise<Announcement>;
  update(id: string, patch: Partial<Omit<Announcement, 'id' | 'createdAt'>>): Promise<Announcement>;
  listSending(): Promise<Announcement[]>;
}

/** Signed-in students who still want feature emails, in a stable order for resumable sends. */
export interface RecipientSource {
  count(): Promise<number>;
  after(cursorId: string | null, limit: number): Promise<Recipient[]>;
}

export interface Mailer {
  readonly provider: 'brevo' | 'demo' | 'none';
  /** Sends each message individually addressed. Throws if the provider rejects the batch. */
  sendBatch(messages: OutgoingEmail[]): Promise<void>;
}

export interface EmailQuota {
  usedOn(day: string): Promise<number>;
  add(day: string, count: number): Promise<number>;
}

export interface DeviceRepository {
  listActive(userId: string): Promise<Device[]>;
  find(deviceId: string): Promise<Device | null>;
  create(userId: string, label: string): Promise<Device>;
  touch(deviceId: string): Promise<void>;
  revoke(deviceId: string): Promise<void>;
}

export interface SessionRegistry {
  list(userId: string): Promise<ActiveSession[]>;
  set(session: ActiveSession): Promise<void>;
}

export interface LeaseRepository {
  get(userId: string): Promise<ViewerLease | null>;
  put(lease: ViewerLease): Promise<void>;
}

// ── Commerce ──

export interface OrderRepository {
  create(order: Omit<Order, 'id' | 'status' | 'gatewayPaymentId'>): Promise<Order>;
  findById(id: string): Promise<Order | null>;
  findByGatewayOrderId(gatewayOrderId: string): Promise<Order | null>;
  markFailed(gatewayOrderId: string): Promise<void>;
  /** Marks paid and grants the course atomically; idempotent. */
  grant(gatewayOrderId: string, gatewayPaymentId: string): Promise<void>;
  revokeByPayment(gatewayPaymentId: string): Promise<void>;
}

export interface EntitlementRepository {
  has(userId: string, courseId: string): Promise<boolean>;
  listCourseIds(userId: string): Promise<string[]>;
}

export interface PaymentGateway {
  readonly keyId: string;
  createOrder(amountPaise: number, receipt: string): Promise<{ gatewayOrderId: string }>;
  verifyCheckout(gatewayOrderId: string, gatewayPaymentId: string, signature: string): Promise<boolean>;
  verifyWebhook(rawBody: string, signature: string): Promise<boolean>;
}

// ── Reading ──

export interface ProgressRepository {
  get(userId: string, fileId: string): Promise<ReadingProgress | null>;
  set(userId: string, fileId: string, page: number): Promise<void>;
  latest(userId: string, limit: number): Promise<ReadingProgress[]>;
}

export interface AccessLog {
  /** Adds pages to today's row and returns the user's total pages today. */
  addPages(userId: string, fileId: string, pages: number, ipHash: string, userAgent: string): Promise<number>;
  pagesToday(userId: string): Promise<number>;
}

export interface ObjectStore {
  /** Every object under the prefix (recursively, all pages). */
  list(prefix: string): Promise<StoredObject[]>;
  /** A bounded page for long-running admin inventory scans. Cursor is provider opaque. */
  listPage(
    prefix: string,
    cursor?: string,
    limit?: number,
  ): Promise<{
    objects: StoredObject[];
    nextCursor: string | null;
  }>;
  get(key: string): Promise<{
    body: ReadableStream | ArrayBuffer | Uint8Array;
    contentType: string;
    /** Object version metadata lets audits reject a source changed between list and read. */
    etag?: string;
    size?: number;
  } | null>;
  /** Delete generated objects only under one exact, caller-validated prefix. */
  deletePrefix(prefix: string): Promise<void>;
  /** Delete one exact object key; never infer or expand a prefix. */
  delete(key: string): Promise<void>;
}

export interface ConversionJob {
  fileId: string;
  sourceKey: string;
  queueId?: string;
  queuePosition?: number;
  queueTotal?: number;
}

export interface ConversionQueue {
  enqueue(jobs: ConversionJob[]): Promise<void>;
  health?(): Promise<{
    status: 'ready' | 'not-configured' | 'error';
    provider: string;
    message: string;
    queuedJobs: number | null;
    deadLetterJobs: number | null;
  }>;
}

// ── Cross-cutting ──

export interface AuthVerifier {
  verify(bearerToken: string): Promise<Principal>;
}

export interface TokenSigner {
  sign(payload: Record<string, unknown>, ttlSeconds: number): Promise<string>;
  verify<T extends Record<string, unknown>>(token: string): Promise<T | null>;
}

/** Derives the secret tile seed for a page; the converter uses the same derivation. */
export interface TileSeeder {
  seedFor(fileId: string, pageNo: number): Promise<string>;
}

export interface RateLimiter {
  /** true = allowed */
  allow(key: string): Promise<boolean>;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}
