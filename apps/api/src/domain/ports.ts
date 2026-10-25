/**
 * Ports: the only things use cases know about the outside world.
 * Each is small and single-purpose (interface segregation). Infrastructure adapters
 * implement them; use cases receive them through their constructors (dependency inversion).
 */
import type { ConversionProgressReport, ConversionReport } from '@ss/contracts';
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
  CourseEarningRow,
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
  Recipient,
  RoyaltyPayout,
  StoredObject,
  SupportQuery,
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
  /** Points a course at a new R2 folder and its files at their new keys, all at once. */
  moveCourseSource(
    courseId: string,
    newPrefix: string,
    files: { fileId: string; sourceKey: string; sourceEtag: string }[],
  ): Promise<void>;
  /** Removes a course and everything under it. Refused ('sold') when anyone bought or was given it. */
  deleteCourse(courseId: string): Promise<'deleted' | 'sold' | 'not-found'>;
  /** Removes these files for good (page index, progress and empty units go with them). */
  deleteFiles(fileIds: string[]): Promise<number>;
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
  /** Accounts for these exact (lower-case) addresses; addresses with no account are left out. */
  findByEmails(emails: string[]): Promise<{ id: string; email: string }[]>;
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
    a: Pick<Announcement, 'subject' | 'heading' | 'body' | 'ctaLabel' | 'ctaUrl' | 'featureKey'> & {
      courseId?: string | null;
    },
  ): Promise<Announcement>;
  update(id: string, patch: Partial<Omit<Announcement, 'id' | 'createdAt'>>): Promise<Announcement>;
  listSending(): Promise<Announcement[]>;
}

/** Signed-in students who still want feature emails, in a stable order for resumable sends. */
export interface RecipientSource {
  count(): Promise<number>;
  after(cursorId: string | null, limit: number): Promise<Recipient[]>;
}

/** Who has each announcement. Sending works from this, so late opt-ins are never skipped. */
export interface DeliveryLog {
  record(announcementId: string, userIds: string[]): Promise<void>;
  /** Opted-in students who haven't had it yet. */
  pending(announcementId: string, limit: number): Promise<Recipient[]>;
  progress(announcementId: string): Promise<{ sent: number; waiting: number }>;
  /** Sent and waiting per student batch (from the college email). */
  batches(announcementId: string): Promise<{ batch: string; sent: number; waiting: number }[]>;
  /** Those who got it (with when), then those still waiting. */
  recipients(
    announcementId: string,
    limit: number,
  ): Promise<{ email: string; fullName: string | null; sentAt: Date | null }[]>;
}

/** Refused sign-in attempts per network (hashed IP), and blocks. */
export interface SignInStrikes {
  blockedUntil(ipHash: string): Promise<Date | null>;
  /** Count one refusal; returns when the block ends once the limit is reached. */
  strike(ipHash: string, limit: number, hours: number): Promise<Date | null>;
  prune(): Promise<number>;
}

/** Live courses whose students haven't been told about newly added notes. */
export interface CourseUpdateSource {
  coursesWithNewFiles(): Promise<{ courseId: string; title: string; slug: string; fileNames: string[] }[]>;
  markFilesNotified(courseId: string): Promise<void>;
}

/** The admin list as stored in the database. */
export interface AdminDirectory {
  list(): Promise<{ email: string; source: 'github' | 'manual'; addedAt: Date }[]>;
}

export interface Mailer {
  readonly provider: 'brevo' | 'demo' | 'none';
  /** Sends each message individually addressed. Throws if the provider rejects the batch. */
  sendBatch(messages: OutgoingEmail[]): Promise<void>;
}

/** A problem reported by a student's browser or by the server, grouped by fingerprint. */
export interface ProblemReport {
  fingerprint: string;
  source: 'browser' | 'server';
  kind: string;
  message: string;
  path: string;
  detail: string;
  userAgent: string;
  count: number;
  firstAt: Date;
  lastAt: Date;
}

export interface ProblemLog {
  record(p: Omit<ProblemReport, 'count' | 'firstAt' | 'lastAt'>): Promise<void>;
  list(limit: number): Promise<ProblemReport[]>;
  clear(fingerprints?: string[]): Promise<number>;
}

/** Database size facts and safe clean-ups for the admin's storage map. */
export interface DatabaseHousekeeping {
  tables(): Promise<{ table: string; rows: number; bytes: number }[]>;
  /** Orders started but never paid (no payment id, nothing granted) older than `days`. */
  countAbandonedOrders(days: number): Promise<number>;
  cleanAbandonedOrders(days: number): Promise<number>;
}

/** Writes and reads uploaded files (kept apart from ObjectStore: only uploads need writing). */
export interface UploadStore {
  save(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(
    key: string,
  ): Promise<{ body: ReadableStream | ArrayBuffer | Uint8Array; contentType: string; size?: number } | null>;
  delete(key: string): Promise<void>;
}

export interface ContributionRepository {
  create(
    c: Omit<Contribution, 'reviewNote' | 'reward' | 'reviewedBy' | 'reviewedAt' | 'createdAt' | 'status'>,
  ): Promise<Contribution>;
  find(id: string): Promise<Contribution | null>;
  listForUser(userId: string): Promise<Contribution[]>;
  list(status: Contribution['status'] | 'all', limit: number): Promise<Contribution[]>;
  /** Submissions by this student since the given time, and how many are still pending. */
  counts(userId: string, since: Date): Promise<{ recent: number; pending: number; approved: number }>;
  review(
    id: string,
    patch: Pick<Contribution, 'status' | 'reviewNote' | 'reward' | 'reviewedBy'>,
  ): Promise<Contribution | null>;
  remove(id: string): Promise<void>;
  /** Email, name, upload block and approved count for each contributor. */
  contributors(
    userIds: string[],
  ): Promise<Map<string, { email: string; name: string | null; blocked: boolean; approved: number }>>;
  isBlocked(userId: string): Promise<boolean>;
  setBlocked(userId: string, blocked: boolean): Promise<void>;
  /** Accepted contributions with a cash reward, newest first. */
  cashRewards(): Promise<Contribution[]>;
  markRewardPaid(id: string, note: string): Promise<void>;
}

/** Batch years and branches as the admin manages them (hidden and retired ones included). */
export interface AcademicRepository {
  years(): Promise<{ year: number; visible: boolean; courses: number; live: number }[]>;
  saveYear(year: number, visible: boolean): Promise<void>;
  deleteYear(year: number): Promise<void>;
  branches(): Promise<
    {
      slug: string;
      code: string;
      name: string;
      shortName: string;
      isCommon: boolean;
      isActive: boolean;
      sort: number;
      courses: number;
    }[]
  >;
  saveBranch(b: {
    slug?: string;
    code: string;
    name: string;
    shortName: string;
    isCommon: boolean;
    isActive: boolean;
    sort: number;
  }): Promise<void>;
  /** Re-file courses of one year under another; returns how many moved. */
  moveCourses(fromYear: number, toYear: number, branchSlug: string | null): Promise<number>;
}

/** Names and emails of students, for admin screens and emails. */
export interface PeopleDirectory {
  byIds(userIds: string[]): Promise<Map<string, { email: string; name: string | null }>>;
}

/** What each course sold, and who earns a share of it. */
export interface EarningsRepository {
  courseEarnings(): Promise<CourseEarningRow[]>;
  /** Paid orders and the different students who paid, across the whole site. */
  paidTotals(): Promise<{ orders: number; buyers: number }>;
  royalties(): Promise<CourseRoyalty[]>;
  royaltiesForUser(userId: string): Promise<CourseRoyalty[]>;
  /** Create or replace the royalty on a course. */
  setRoyalty(r: CourseRoyalty): Promise<void>;
  removeRoyalty(courseId: string): Promise<void>;
  addPayout(p: Omit<RoyaltyPayout, 'id' | 'paidAt'>): Promise<RoyaltyPayout>;
  payouts(limit: number): Promise<RoyaltyPayout[]>;
  /** Royalty sales and revenue per contributor and course since this moment. */
  royaltyEarningsSince(
    since: Date,
  ): Promise<
    { userId: string; courseId: string; sharePercent: number; sales: number; revenuePaise: number }[]
  >;
  bonuses(year: number): Promise<{ userId: string; amountPaise: number; paidAt: Date }[]>;
  addBonus(b: {
    userId: string;
    year: number;
    amountPaise: number;
    note: string;
    recordedBy: string;
  }): Promise<void>;
}

/** Questions and problem reports from students, with the conversation. */
export interface SupportRepository {
  create(
    q: Omit<SupportQuery, 'status' | 'messages' | 'createdAt' | 'updatedAt'>,
    firstMessage: {
      author: string;
      body: string;
    },
  ): Promise<SupportQuery>;
  find(id: string): Promise<SupportQuery | null>;
  listForUser(userId: string): Promise<SupportQuery[]>;
  list(status: SupportQuery['status'] | 'all', limit: number): Promise<SupportQuery[]>;
  /** Add a message; an admin message marks the query answered, a student one re-opens it. */
  addMessage(queryId: string, m: { fromAdmin: boolean; author: string; body: string }): Promise<void>;
  setStatus(id: string, status: SupportQuery['status']): Promise<void>;
  /** Open queries now, and queries started since the given time. */
  counts(userId: string, since: Date): Promise<{ open: number; recent: number }>;
  remove(id: string): Promise<void>;
}

/** Small admin switches, stored as JSON values. */
export interface SettingsRepository {
  get<T>(key: string, fallback: T): Promise<T>;
  set<T>(key: string, value: T): Promise<void>;
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
  /** Can read now: not blocked and not past its end. */
  has(userId: string, courseId: string): Promise<boolean>;
  /** Courses this student can read now. */
  listCourseIds(userId: string): Promise<string[]>;
  /** Everything this student ever had, ended and blocked included (for the shelf). */
  listForUser(userId: string): Promise<AccessRecord[]>;
  /** Every student who ever had this course, with their state. */
  listForCourse(courseId: string): Promise<AccessRecord[]>;
  /** Block, restore (admin blocks only; disputes stay) or set the end date. Returns rows changed. */
  changeAccess(courseId: string, userIds: string[], change: AccessChange): Promise<number>;
  /** Set the end date for everyone who currently has this course (not blocked). */
  applyTerm(courseId: string, until: Date | null): Promise<number>;
  /** Ended accesses (not blocked) not yet emailed, oldest end first. */
  listEndedUnnotified(limit: number): Promise<EndedAccess[]>;
  /** Mark these ended accesses as emailed. */
  markEndNotified(items: { userId: string; courseId: string }[]): Promise<void>;
  /** Accesses ending before this moment (and not yet ended) whose reminder hasn't gone out. */
  listEndingSoon(before: Date, limit: number): Promise<EndingAccess[]>;
  markEndingNotified(items: { userId: string; courseId: string }[]): Promise<void>;
  /** Save a gift for a college email with no account yet; it is applied when they sign up. */
  addPendingGrants(courseId: string, emails: string[], until: Date | null, adminEmail: string): Promise<void>;
  /** Give these students the course without payment (or renew it), recording which admin did it. */
  grantByAdmin(courseId: string, userIds: string[], until: Date | null, adminEmail: string): Promise<number>;
}

/** Where a payment stands at the gateway, after we've tried to capture it. */
export type PaymentState = 'captured' | 'pending' | 'failed';

export interface PaymentGateway {
  readonly keyId: string;
  createOrder(amountPaise: number, receipt: string): Promise<{ gatewayOrderId: string }>;
  verifyCheckout(gatewayOrderId: string, gatewayPaymentId: string, signature: string): Promise<boolean>;
  verifyWebhook(rawBody: string, signature: string): Promise<boolean>;
  /**
   * Make sure the money is actually ours before granting: looks the payment up at the gateway,
   * checks it belongs to this order and amount, and captures it if it is only authorised
   * (netbanking and UPI payments can sit in "authorised" when auto-capture is off).
   * pending = the bank hasn't confirmed yet; failed = it will never complete.
   */
  confirmPayment(
    gatewayOrderId: string,
    gatewayPaymentId: string,
    amountPaise: number,
  ): Promise<PaymentState>;
  /**
   * Asks the gateway whether any attempt on this order succeeded (captured or capturable).
   * Used when the student's browser never came back (closed tab, slow netbanking redirect) and
   * as a safety net when the webhook is late or not set up. Returns the payment id, or null.
   */
  findPaidPayment(gatewayOrderId: string, amountPaise: number): Promise<string | null>;
  /** Admin health: do the API keys work? Never charges anything. */
  checkKeys(): Promise<{ ok: boolean; mode: 'test' | 'live' | 'demo'; message: string }>;
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
  /** Copy one object to a new key (same bytes and content type). Returns the copy's etag and size. */
  copy(fromKey: string, toKey: string): Promise<{ etag: string; size: number }>;
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
