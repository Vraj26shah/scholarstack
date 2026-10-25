import { z } from 'zod';

// ───────────────────────── Catalogue ─────────────────────────

export const FileFormat = z.enum(['pdf', 'pptx', 'docx', 'image']);
export type FileFormat = z.infer<typeof FileFormat>;

export const ConversionStatus = z.enum(['pending', 'ready', 'failed']);
export type ConversionStatus = z.infer<typeof ConversionStatus>;

/** What a course sub-folder holds. "reference" (publishers' textbooks) is hidden by default. */
export const UnitKind = z.enum([
  'module',
  'pyq',
  'syllabus',
  'lab',
  'revision',
  'notes',
  'reference',
  'other',
]);
export type UnitKind = z.infer<typeof UnitKind>;

export interface BatchDto {
  year: number;
  label: string; // "2nd year"
  semesters: string; // "Sem 3–4"
}

export interface BranchDto {
  slug: string; // "cse-core"
  name: string; // "CSE Core"
  code: string; // "CSE"
  isCommon: boolean; // first-year shared branch
  shortName: string;
  tagline: string;
  description: string;
  courseCodes: string[];
}

export interface CourseCardDto {
  id: string;
  slug: string;
  title: string;
  courseCode: string | null;
  callNo: string; // "S3 · CSE · 01"
  batchYear: number;
  branchSlug: string;
  semester: number;
  fileCount: number;
  pageCount: number;
  formats: FileFormat[];
  pricePaise: number;
  /** Page one of the first unit that has a preview: the card's cover. */
  previewFileId: string | null;
}

export interface CourseFileDto {
  id: string;
  name: string;
  format: FileFormat;
  pageCount: number;
  sizeBytes: number;
  status: ConversionStatus;
}

export const ConversionStage = z.enum([
  'queued',
  'downloading_source',
  'validating_source',
  'rendering_pages',
  'clearing_previous_pages',
  'writing_preview',
  'writing_pages',
  'verifying_r2',
  'saving_manifest',
  'complete',
  'failed',
]);
export type ConversionStage = z.infer<typeof ConversionStage>;

/** Internal callback from the sequential converter; never exposed as a public endpoint. */
export const ConversionProgressReport = z.object({
  fileId: z.string().min(1),
  queueId: z.string().uuid(),
  queuePosition: z.number().int().min(1),
  queueTotal: z.number().int().min(1),
  stage: ConversionStage,
  current: z.number().int().min(0),
  total: z.number().int().min(0),
});
export type ConversionProgressReport = z.infer<typeof ConversionProgressReport>;

export interface CourseUnitDto {
  key: string; // "unit-3"
  label: string; // "UNIT 3"
  title: string; // "Normalisation"
  kind: UnitKind;
  fileCount: number;
  pageCount: number;
  files: CourseFileDto[];
  /** File whose first page anyone can preview (the unit's first ready file), if any. */
  previewFileId: string | null;
}

export interface ReadingItemDto {
  title: string;
  /** The unit it was filed under ("Reference Books", "Notes"). */
  unit: string;
  /** A search for a legal copy (library or bookshop). */
  findUrl: string;
}

export interface CourseDetailDto extends CourseCardDto {
  description: string;
  branchName: string;
  units: CourseUnitDto[];
  /** Books from the course folder that are not sold here: titles and where to find a copy. */
  readingList: ReadingItemDto[];
  owned: boolean;
  /** Term end: a purchase made now gives access until this moment. Null = no end. */
  accessUntil: string | null;
  /** How long a purchase lasts, from the day it is bought. */
  accessMonths: number;
  /** Name of that term, e.g. "Sem 5 · Winter 2026" (empty when not named). */
  termLabel: string;
  /** For an owner: when their own access ends (null = no end). */
  yourAccessUntil: string | null;
  /** Live bundles that include this course, best saving first. */
  bundles: BundleCardDto[];
}

// ───────────────────────── Bundles ─────────────────────────

export interface BundleCardDto {
  id: string;
  slug: string;
  title: string;
  description: string;
  batchYear: number | null;
  courseCount: number;
  fileCount: number;
  pageCount: number;
  pricePaise: number;
  /** Sum of the courses' own prices. */
  listPricePaise: number;
  savePercent: number;
  /** Covers of the first few courses in the bundle. */
  coverFileIds: string[];
}

export interface BundleDetailDto extends BundleCardDto {
  courses: (CourseCardDto & { owned: boolean })[];
  /** What this buyer pays: the bundle price scaled to the courses they don't own yet. */
  yourPricePaise: number;
  ownedCount: number;
}

export interface CatalogueIndexDto {
  batches: BatchDto[];
  branches: BranchDto[];
  /** Live library totals for the home page (reader-ready files only). */
  stats?: { courses: number; files: number; pages: number; subjects: string[] };
}

// ───────────────────────── Students & access (admin) ─────────────────────────

export interface AdminStudentAccessDto {
  userId: string;
  email: string;
  fullName: string | null;
  grantedAt: string;
  expiresAt: string | null;
  /** disputed = taken back by a lost bank dispute; an admin cannot restore it. */
  state: 'active' | 'ended' | 'blocked' | 'disputed';
  /** purchase: paid. admin: given by an admin (no payment). */
  source: 'purchase' | 'admin';
}

export interface AdminCourseAccessDto {
  course: {
    id: string;
    title: string;
    batchYear: number;
    semester: number;
    accessUntil: string | null;
    termLabel: string;
  };
  students: AdminStudentAccessDto[];
}

const isoOrNull = z.string().datetime({ offset: true }).nullable();

export const AccessChangeBody = z.object({
  courseId: z.string().uuid().or(z.string().min(1).max(64)),
  userIds: z.array(z.string().min(1).max(64)).min(1).max(1000),
  /** block: stop access now (kept for history). restore: undo an admin block.
   *  until: set when access ends (null = no end); also how "end now" and "extend" work. */
  action: z.enum(['block', 'restore', 'until']),
  until: isoOrNull.optional(),
});
export type AccessChangeInput = z.infer<typeof AccessChangeBody>;

export const AccessGrantBody = z.object({
  courseId: z.string().min(1).max(64),
  /** Student emails, exactly as they sign in. Up to 200 at once. */
  emails: z.array(z.string().max(254)).min(1).max(200),
  /** When this access ends. Leave out to use the course's term end; null = no end. */
  until: isoOrNull.optional(),
});
export type AccessGrantInput = z.infer<typeof AccessGrantBody>;

export interface AdminGrantResultDto extends AdminCourseAccessDto {
  granted: string[];
  /** Of the granted, who was emailed about it (all, unless email is off or today's limit is used up). */
  emailed: string[];
  /** Valid college addresses that have never signed in: saved, and given the moment they sign up. */
  notFound: string[];
  /** Not an exact @college address (typo, "+tag", look-alike letters…). */
  invalid: string[];
}

export const SearchQuery = z.object({ q: z.string().trim().min(1).max(80) });

/** Everything live that matches a search, across every batch and programme. */
export interface CatalogueSearchDto {
  query: string;
  courses: CourseCardDto[];
  bundles: BundleCardDto[];
}

export const CatalogueQuery = z.object({
  batch: z.coerce.number().int().min(2000).max(2100),
  branch: z.string().min(1).max(64),
});

// ───────────────────────── Account & sessions ─────────────────────────

export interface DeviceDto {
  id: string;
  label: string;
  lastSeenAt: string;
  current: boolean;
}

export interface MeDto {
  id: string;
  email: string;
  fullName: string | null;
  isAdmin: boolean;
  emailOptIn: boolean;
  devices: DeviceDto[];
}

export const EmailPrefsBody = z.object({ emailOptIn: z.boolean() });

export const ClaimDeviceBody = z.object({
  label: z.string().min(1).max(80),
});

export const UpdateProfileBody = z.object({
  fullName: z.string().trim().min(2).max(80),
});

// ───────────────────────── Shelf ─────────────────────────

export type AccessState = 'active' | 'ended' | 'blocked';

export interface ShelfItemDto {
  course: CourseCardDto;
  lastRead: { fileId: string; fileName: string; page: number; pageCount: number } | null;
  /** active: readable (until `until`, or forever when null). ended/blocked: kept on the shelf to
   *  explain why it no longer opens, with a way to buy it again. */
  access: { state: AccessState; until: string | null; endedAt: string | null; termLabel: string };
}

// ───────────────────────── Checkout ─────────────────────────

export const StartCheckoutBody = z.union([
  z.object({ courseId: z.string().min(1) }),
  z.object({ bundleId: z.string().min(1) }),
]);

export interface StartCheckoutDto {
  orderId: string;
  gatewayOrderId: string;
  amountPaise: number;
  currency: 'INR';
  keyId: string;
  /** What the payment window shows: the course or bundle title. */
  courseTitle: string;
  email: string;
}

export const VerifyPaymentBody = z.object({
  orderId: z.string().min(1),
  gatewayOrderId: z.string().min(1),
  gatewayPaymentId: z.string().min(1),
  signature: z.string().min(1),
});

export const OrderStatus = z.enum(['created', 'paid', 'failed', 'disputed']);
export type OrderStatus = z.infer<typeof OrderStatus>;

export interface OrderDto {
  id: string;
  /** First course in the order (the course itself, or the first of a bundle). */
  courseId: string;
  bundleId: string | null;
  courseIds: string[];
  status: OrderStatus;
  amountPaise: number;
}

// ───────────────────────── Reader ─────────────────────────

export const OpenReaderBody = z.object({
  fileId: z.string().min(1),
});

export interface OpenReaderDto {
  fileId: string;
  fileName: string;
  courseId: string;
  courseTitle: string;
  unitLabel: string;
  pageCount: number;
  lastPage: number;
  viewerToken: string;
  expiresAt: string;
  watermark: string;
}

export const HeartbeatBody = z.object({
  fileId: z.string().min(1),
  page: z.number().int().min(1),
  pagesViewed: z.number().int().min(0).max(500),
});

export interface HeartbeatDto {
  viewerToken: string;
  expiresAt: string;
}

// ───────────────────────── Admin & converter ─────────────────────────

export interface AdminCourseDto extends CourseCardDto {
  status: 'draft' | 'live' | 'archived';
  /** Term end for new purchases (null = no end). */
  accessUntil: string | null;
  /** Name of that term shown to students. */
  termLabel: string;
  branchSlugs: string[];
  description: string;
  r2Prefix: string;
  pendingFiles: number;
  failedFiles: number;
  previewCount: number;
  unitCount: number;
  /** Units and files kept off the site (reference books, duplicates…). */
  hiddenUnits: number;
  hiddenFiles: number;
}

export interface AdminFileDto {
  id: string;
  /** Original R2 key; admin endpoints use it for exact source reconciliation. */
  sourceKey: string;
  name: string;
  format: FileFormat;
  sizeBytes: number;
  pageCount: number;
  status: ConversionStatus;
  error: string | null;
  hidden: boolean;
}

/** A course's sub-folder as the admin sees it, hidden or not. */
export interface AdminUnitDto {
  key: string;
  label: string;
  title: string;
  kind: UnitKind;
  hidden: boolean;
  files: AdminFileDto[];
}

export type InventoryObjectStatus =
  | 'registered'
  | 'changed-in-r2'
  | 'unmapped'
  | 'unsupported'
  | 'ignored'
  | 'folder-marker'
  | 'missing-in-r2';

/** Point-in-time reconciliation of every object and folder under one course's R2 prefix. */
export interface CourseInventoryDto {
  courseId: string;
  prefix: string;
  checkedAt: string;
  complete: boolean;
  totals: {
    objects: number;
    files: number;
    folders: number;
    registered: number;
    changed: number;
    unmapped: number;
    unsupported: number;
    ignored: number;
    missingInR2: number;
    pending: number;
    failed: number;
    ready: number;
    pageAssetsMissing: number;
    invalidSources: number;
    pageMappingsInvalid: number;
  };
  folders: Array<{
    path: string;
    explicitMarker: boolean;
    fileCount: number;
    registeredCount: number;
    unmappedCount: number;
    unsupportedCount: number;
    missingCount: number;
    empty: boolean;
  }>;
  objects: Array<{
    key: string;
    name: string;
    sizeBytes: number;
    status: InventoryObjectStatus;
    fileId: string | null;
    unitKey: string | null;
    unit: string | null;
    conversionStatus: ConversionStatus | null;
    conversionError: string | null;
    conversionErrorStage: ConversionStage | 'dispatch' | null;
    conversionStage: ConversionStage | null;
    conversionProgressCurrent: number;
    conversionProgressTotal: number;
    conversionQueueId: string | null;
    conversionQueuePosition: number;
    conversionQueueTotal: number;
    conversionUpdatedAt: string | null;
    pageCount: number | null;
    pageAssetsComplete: boolean | null;
    pageAssetsFound: number | null;
    missingPageNumbers: number[] | null;
    previewPresent: boolean | null;
    sourceIssue?: string | null;
    pageMappingIssues?: string[];
    hidden: boolean;
    fileHidden?: boolean;
    unitHidden: boolean;
    orphanPageObjects?: string[];
  }>;
}

/** Full read-only reconciliation of the configured R2 import tree and converted pages. */
export interface StorageAuditDto {
  checkedAt: string;
  importRoot: string;
  totals: {
    sourceObjects: number;
    bucketObjects: number;
    outsideImportRoot: number;
    sourceFiles: number;
    folders: number;
    registered: number;
    changed: number;
    unimported: number;
    unsupported: number;
    ignored: number;
    missingSource: number;
    databaseFiles: number;
    pending: number;
    failed: number;
    ready: number;
    pageAssetsExpected: number;
    pageAssetsFound: number;
    missingPageAssets: number;
    missingPreviews: number;
    orphanPageObjects: number;
    invalidSources?: number;
    invalidPageMappings?: number;
  };
  folders: Array<{ path: string; explicitMarker: boolean; files: number; inImportRoot: boolean }>;
  files: Array<{
    key: string;
    name: string;
    sizeBytes: number;
    courseId: string | null;
    courseTitle: string | null;
    courseSlug: string | null;
    fileId: string | null;
    unitKey: string | null;
    unit: string | null;
    conversionStatus: ConversionStatus | null;
    conversionError: string | null;
    conversionErrorStage: ConversionStage | 'dispatch' | null;
    conversionStage: ConversionStage | null;
    conversionProgressCurrent: number;
    conversionProgressTotal: number;
    conversionQueueId: string | null;
    conversionQueuePosition: number;
    conversionQueueTotal: number;
    conversionUpdatedAt: string | null;
    pageCount: number | null;
    pageAssetsFound: number;
    pageAssetsExpected: number;
    missingPageNumbers: number[];
    previewPresent: boolean;
    sourceIssue?: string | null;
    pageMappingIssues?: string[];
    status: 'registered' | 'changed' | 'unimported' | 'unsupported' | 'ignored' | 'missing-source';
    inImportRoot: boolean;
    hidden: boolean;
    fileHidden: boolean;
    unitHidden: boolean;
  }>;
  orphanPageObjects: string[];
  outsideImportRootObjects: string[];
}

/** One bounded page from an admin R2 inventory scan. Prefix and cursor are exact/opaque. */
export interface StorageInventoryPageDto {
  checkedAt: string;
  /** Exact R2 prefix being scanned. Empty string means the entire bucket. */
  scopePrefix: string;
  importRoot: string;
  objects: Array<{
    key: string;
    sizeBytes: number;
    etag: string;
    kind: 'source' | 'folder' | 'page' | 'system';
    unregisteredStatus: 'unimported' | 'unsupported' | 'ignored' | null;
    /** Bounded byte-signature check for supported source files. */
    sourceIssue: string | null;
  }>;
  nextCursor: string | null;
  complete: boolean;
  courses?: Array<{ id: string; title: string; slug: string; prefix: string }>;
  /** Present only on the first page: every Supabase file record, including missing R2 sources. */
  records?: Array<{
    fileId: string;
    sourceKey: string;
    sourceEtag: string;
    sizeBytes: number;
    courseId: string;
    courseTitle: string;
    courseSlug: string;
    coursePrefix: string;
    unitKey: string;
    unit: string;
    conversionStatus: ConversionStatus;
    conversionError: string | null;
    conversionErrorStage: ConversionStage | 'dispatch' | null;
    conversionStage: ConversionStage | null;
    conversionProgressCurrent: number;
    conversionProgressTotal: number;
    conversionQueueId: string | null;
    conversionQueuePosition: number;
    conversionQueueTotal: number;
    conversionUpdatedAt: string | null;
    pageCount: number;
    previewKey: string | null;
    hidden: boolean;
    fileHidden: boolean;
    unitHidden: boolean;
    pageMappingIssues: string[];
  }>;
}

/** Separate live probes for the three systems used by an admin R2 reconciliation. */
export interface AdminSyncHealthDto {
  checkedAt: string;
  r2: {
    status: 'connected' | 'error';
    message: string;
    sampleObjects: number | null;
  };
  supabase: {
    status: 'connected' | 'error';
    message: string;
    courses: number | null;
    fileRecords: number | null;
  };
  conversion: {
    status: 'ready' | 'not-configured' | 'error';
    provider: string;
    message: string;
    queuedJobs: number | null;
    deadLetterJobs: number | null;
  };
  payments: {
    status: 'connected' | 'error';
    mode: 'test' | 'live' | 'demo';
    message: string;
  };
}

export const SetHiddenBody = z.object({ hidden: z.boolean() });

export interface SyncResultDto {
  coursesCreated: number;
  filesAdded: number;
  filesChanged: number;
  /** Supabase records retired from the public catalogue because their R2 source is gone. */
  filesRetired: number;
  /** Generated page/preview objects removed because they no longer have a valid source mapping. */
  pageObjectsRemoved: number;
  conversionQueued: number;
  skipped: string[];
}

export const PublishBody = z.object({
  pricePaise: z.number().int().min(100).max(1_000_000),
});

/** One folder in the import root, as the admin sees it. */
export interface ImportFolderDto {
  /** Full R2 prefix, ending in "/". */
  prefix: string;
  name: string;
  depth: number;
  /** Files anywhere below this folder. */
  fileCount: number;
  supportedCount: number;
  ignoredCount: number;
  sizeBytes: number;
  /** Sub-folders directly inside (become units if this folder is a course). */
  childNames: string[];
  /** Files directly inside. */
  looseFiles: number;
  /** Every direct file, including ignored and unsupported objects. */
  looseObjects: ImportObjectDto[];
  /** Already imported as this course. */
  course: {
    id: string;
    title: string;
    courseCode: string | null;
    description: string;
    batchYear: number;
    branchSlugs: string[];
    semester: number;
    pricePaise: number;
    bundleId: string | null;
    status: 'draft' | 'live' | 'archived';
  } | null;
  /** Guesses for the import form. */
  suggested: {
    title: string;
    batchYear: number | null;
    semester: number | null;
    courseCode: string | null;
    branchSlugs: string[];
  };
  children: ImportFolderDto[];
}

export interface ImportObjectDto {
  key: string;
  name: string;
  sizeBytes: number;
  classification: 'supported' | 'unsupported' | 'ignored';
}

export interface ImportTreeDto {
  root: string;
  rootFiles: ImportObjectDto[];
  folders: ImportFolderDto[];
  totalFiles: number;
  changeToken: string;
}

export const ImportCourseInput = z.object({
  prefix: z.string().min(2).max(512),
  title: z.string().trim().min(2).max(120),
  courseCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,23}$/)
    .or(z.literal(''))
    .default(''),
  description: z.string().trim().max(600).default(''),
  batchYear: z.number().int().min(2000).max(2100),
  branchSlugs: z.array(z.string().min(1).max(64)).min(1).max(12),
  semester: z.number().int().min(1).max(10),
  pricePaise: z.number().int().min(100).max(1_000_000),
  bundleId: z.string().min(1).nullable().optional(),
});
export type ImportCourseInput = z.infer<typeof ImportCourseInput>;

export const ImportBody = z.object({ courses: z.array(ImportCourseInput).min(1).max(100) });

export const UpdateCourseBody = z.object({
  title: z.string().trim().min(2).max(120).optional(),
  courseCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,23}$/)
    .nullable()
    .optional(),
  description: z.string().trim().max(600).optional(),
  batchYear: z.number().int().min(2000).max(2100).optional(),
  branchSlugs: z.array(z.string().min(1).max(64)).min(1).max(12).optional(),
  /** Backward compatible with existing admin clients. */
  branchSlug: z.string().min(1).max(64).optional(),
  semester: z.number().int().min(1).max(10).optional(),
  pricePaise: z.number().int().min(100).max(1_000_000).optional(),
  status: z.enum(['draft', 'live', 'archived']).optional(),
});

export interface AdminBundleDto extends BundleCardDto {
  status: 'draft' | 'live' | 'archived';
  courseIds: string[];
}

export const SaveBundleBody = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(600).default(''),
  batchYear: z.number().int().min(2000).max(2100).nullable(),
  courseIds: z.array(z.string().min(1)).min(2).max(60),
  pricePaise: z.number().int().min(100).max(5_000_000),
  status: z.enum(['draft', 'live', 'archived']),
});

// ───────────────────────── Toolbox & announcements ─────────────────────────

export const FeatureStatus = z.enum(['soon', 'live', 'hidden']);
export type FeatureStatus = z.infer<typeof FeatureStatus>;

/** A free tool on the home page (CGPA calculator, timetable maker, …). No sign-in needed. */
export interface FeatureDto {
  key: string;
  title: string;
  blurb: string;
  status: FeatureStatus;
  path: string;
}

export const SaveFeatureBody = z.object({
  title: z.string().trim().min(2).max(60),
  blurb: z.string().trim().max(200),
  status: FeatureStatus,
});

/** A new tool added from Admin. The key becomes its address: /tools/<key>. */
export const CreateFeatureBody = SaveFeatureBody.extend({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes, like "attendance".')
    .min(2)
    .max(30),
  status: FeatureStatus.default('soon'),
});
export type CreateFeatureBody = z.infer<typeof CreateFeatureBody>;

export const AnnouncementStatus = z.enum(['draft', 'sending', 'sent', 'failed']);
export type AnnouncementStatus = z.infer<typeof AnnouncementStatus>;

export interface AnnouncementDto {
  id: string;
  subject: string;
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  featureKey: string | null;
  status: AnnouncementStatus;
  recipients: number;
  sent: number;
  /** Opted-in students who haven't had it yet (sent on the next days within the limit). */
  waiting: number;
  /** Set when it goes only to the students of one course (e.g. "new notes added"). */
  course: { id: string; title: string } | null;
  /** When the last of them should have it, at the current daily limit (null when none wait). */
  finishesOn: string | null;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
}

export const SaveAnnouncementBody = z.object({
  id: z.string().optional(),
  subject: z.string().trim().min(3).max(120),
  heading: z.string().trim().min(2).max(120),
  body: z.string().trim().min(10).max(4000),
  ctaLabel: z.string().trim().max(40).default(''),
  /** Path on this site ("/tools/cgpa") or a full https URL. */
  ctaUrl: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === '' || v.startsWith('/') || v.startsWith('https://'), 'Use a /path or https:// link')
    .default(''),
  featureKey: z.string().max(40).nullable().default(null),
  /** Send only to the students who have this course now (null = everyone opted in). */
  courseId: z.string().max(64).nullable().default(null),
});

export interface EmailStatusDto {
  provider: 'brevo' | 'demo' | 'none';
  dailyLimit: number;
  usedToday: number;
  optedIn: number;
  /** Kept back every day for personal emails (receipts, answers, access ending). */
  reserved: number;
  /** Announcement emails that can still go today. */
  leftToday: number;
  /** The days ahead and how many announcement emails each will send. */
  plan: { date: string; count: number }[];
}

export interface DeliveryDto {
  announcementId: string;
  sent: number;
  waiting: number;
  finishesOn: string | null;
  /** Sent and still to go per student batch (read from the college email: name.23bce… = 2023). */
  byBatch: { batch: string; sent: number; waiting: number }[];
  recipients: { email: string; name: string | null; sentAt: string | null }[];
}

export const UnsubscribeBody = z.object({ token: z.string().min(10).max(600) });
/** Conversion errors caused by the file itself (e.g. a Google sign-in page saved as a PDF). */
export const BROKEN_SOURCE = 'Broken source:';

export const ConversionReport = z
  .object({
    fileId: z.string().min(1),
    queueId: z.string().uuid().optional(),
    queuePosition: z.number().int().min(1).optional(),
    queueTotal: z.number().int().min(1).optional(),
    status: z.enum(['ready', 'failed']),
    error: z.string().max(500).optional(),
    errorStage: z
      .enum([
        'downloading_source',
        'validating_source',
        'rendering_pages',
        'clearing_previous_pages',
        'writing_preview',
        'writing_pages',
        'verifying_r2',
        'saving_manifest',
        'dispatch',
      ])
      .optional(),
    /** Unscrambled, watermarked first page shown on the public course page. */
    previewKey: z.string().min(1).optional(),
    pages: z
      .array(
        z.object({
          pageNo: z.number().int().min(1),
          imageKey: z.string().min(1),
          tileSeed: z.string().min(8),
        }),
      )
      .default([]),
  })
  .superRefine((report, ctx) => {
    if (report.status === 'ready') {
      if (report.pages.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pages'],
          message: 'A ready file must contain at least one page.',
        });
      }
      if (!report.previewKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['previewKey'],
          message: 'A ready file must have a preview image.',
        });
      } else if (report.previewKey !== `pages/${report.fileId}/preview.webp`) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['previewKey'],
          message: 'The preview image key must belong to this file.',
        });
      }
      report.pages.forEach((page, index) => {
        if (page.pageNo !== index + 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['pages', index, 'pageNo'],
            message: 'Page numbers must be contiguous and ordered starting at 1.',
          });
        }
        if (page.imageKey !== `pages/${report.fileId}/${index + 1}.webp`) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['pages', index, 'imageKey'],
            message: 'Each page image key must match its file and page number.',
          });
        }
      });
    } else if (report.pages.length > 0 || report.previewKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pages'],
        message: 'A failed conversion must not expose partial pages or a preview.',
      });
    }
  });
export type ConversionReport = z.infer<typeof ConversionReport>;

// ───────────────────────── Razorpay webhook (subset we use) ─────────────────────────

export const RazorpayWebhook = z.object({
  event: z.string(),
  payload: z.object({
    payment: z
      .object({
        entity: z.object({
          id: z.string(),
          order_id: z.string().nullable(),
          amount: z.number(),
        }),
      })
      .optional(),
    dispute: z
      .object({
        entity: z.object({
          payment_id: z.string(),
        }),
      })
      .optional(),
  }),
});
export type RazorpayWebhook = z.infer<typeof RazorpayWebhook>;

// ── Admin step-by-step workflow ──────────────────────────────────────────────

/** Make pages for one course, optionally one unit or a hand-picked set of files. */
export const ConvertScopeBody = z.object({
  courseId: z.string().min(1).max(64),
  unitKey: z.string().min(1).max(200).optional(),
  fileIds: z.array(z.string().min(1).max(64)).min(1).max(200).optional(),
  /** waiting = never converted / pages missing; failed = retry failures; both = either. */
  include: z.enum(['waiting', 'failed', 'both']).default('both'),
});
export type ConvertScopeInput = z.infer<typeof ConvertScopeBody>;

export interface ConvertScopeResultDto {
  queued: number;
  /** Plain-language reasons a file in scope was left alone. */
  skipped: string[];
}

export type ConversionBoardState = 'waiting' | 'queued' | 'working' | 'stalled' | 'failed' | 'ready';

/** Live page-making status, polled by the admin "Make pages" step. */
export interface ConversionBoardDto {
  checkedAt: string;
  totals: Record<ConversionBoardState, number> & { offSite: number };
  files: Array<{
    fileId: string;
    courseId: string;
    courseTitle: string;
    unitKey: string;
    unit: string;
    name: string;
    sourceKey: string;
    state: ConversionBoardState;
    offSite: boolean;
    stage: ConversionStage | null;
    current: number;
    total: number;
    queuePosition: number;
    queueTotal: number;
    error: string | null;
    errorStage: ConversionStage | 'dispatch' | null;
    pageCount: number;
    updatedAt: string | null;
  }>;
}

/** R2 is the source of truth: what Supabase would have to change to match it. */
export interface StorageCompareDto {
  checkedAt: string;
  totals: { courses: number; inSync: number; newInR2: number; changedInR2: number; missingFromR2: number };
  courses: Array<{
    courseId: string;
    title: string;
    slug: string;
    prefix: string;
    status: 'draft' | 'live' | 'archived';
    r2Files: number;
    supabaseFiles: number;
    newInR2: string[];
    changedInR2: string[];
    missingFromR2: string[];
    error: string | null;
  }>;
  /** Supported R2 files in the selection that belong to no course yet (import them first). */
  unassigned?: { count: number; keys: string[] };
  /** The selection this comparison covered. */
  scopes?: string[];
}

/** Counts that drive the step chips on the admin home. Supabase only, so it is cheap. */
export interface AdminOverviewDto {
  checkedAt: string;
  courses: { total: number; draft: number; live: number; archived: number; readyToPublish: number };
  files: {
    total: number;
    waiting: number;
    working: number;
    failed: number;
    ready: number;
    offSite: number;
    missingSource: number;
  };
  bundles: { total: number; live: number };
}

/**
 * A free-form R2 selection: "" = everything under the import root, "a/b/" = that folder and
 * everything inside it, "a/b/c.pdf" = exactly that file. Mix as many as you like.
 */
export const R2Scopes = z.array(z.string().max(1024)).min(1).max(500);
export const CompareScopeBody = z.object({ scopes: R2Scopes });
export const ConvertSelectionBody = z.object({
  scopes: R2Scopes,
  include: z.enum(['waiting', 'failed', 'both']).default('both'),
});
export type ConvertSelectionInput = z.infer<typeof ConvertSelectionBody>;
export const BoardScopeBody = z.object({ scopes: R2Scopes });

// ── Problems log (admin) ─────────────────────────────────────────────────────

/** What a student's browser reports when something unexpected goes wrong. Never shown to them. */
export const ClientProblemBody = z.object({
  kind: z.enum(['crash', 'unhandled', 'api', 'image', 'blocked', 'chunk', 'payment']),
  message: z.string().trim().min(1).max(500),
  path: z.string().max(300).default(''),
  detail: z.string().max(2000).default(''),
});
export type ClientProblemInput = z.infer<typeof ClientProblemBody>;

export interface ProblemDto {
  fingerprint: string;
  source: 'browser' | 'server';
  kind: string;
  message: string;
  path: string;
  detail: string;
  /** Short browser/OS label, e.g. "Chrome on Android". */
  device: string;
  count: number;
  firstAt: string;
  lastAt: string;
}

export const ClearProblemsBody = z.object({
  fingerprints: z.array(z.string().min(1).max(80)).max(500).optional(),
});

// ── Storage map (admin) ──────────────────────────────────────────────────────

export interface StorageFolderDto {
  /** Folder of uploaded notes in R2, e.g. "drive-imports/23 Batch/DBMS/Module 1/". */
  folder: string;
  /** The course this folder belongs to, if any. */
  course: { id: string; title: string; status: string } | null;
  objects: number;
  bytes: number;
  /** Files here that no course file points at (safe to delete). */
  unusedObjects: number;
  unusedBytes: number;
}

export interface StorageMapDto {
  scannedAt: string;
  r2: {
    notes: { objects: number; bytes: number; unusedObjects: number; unusedBytes: number };
    pages: { files: number; objects: number; bytes: number; unusedObjects: number; unusedBytes: number };
  };
  folders: StorageFolderDto[];
  /** Generated page folders whose file no longer exists (pages/<file-id>/). */
  unusedPageFolders: { folder: string; objects: number; bytes: number }[];
  database: { table: string; purpose: string; rows: number; bytes: number }[];
  abandonedOrders: number;
}

export const StorageCleanBody = z.discriminatedUnion('what', [
  z.object({ what: z.literal('notes'), folders: z.array(z.string().min(1).max(400)).min(1).max(500) }),
  z.object({ what: z.literal('pages') }),
  z.object({ what: z.literal('orders'), olderThanDays: z.number().int().min(7).max(3650).default(30) }),
]);
export type StorageCleanInput = z.infer<typeof StorageCleanBody>;

export interface StorageCleanResultDto {
  removedObjects: number;
  removedBytes: number;
  removedRows: number;
}

// ── Storage tree: every notes file in R2 and what it belongs to ──────────────

export interface StorageEntryDto {
  /** Full R2 key, e.g. "drive-imports/23 Batch/DBMS/Unit 1/notes.pdf". */
  key: string;
  size: number;
  /** used: a course file points at it · unused: nothing does · missing: the database still has it, R2 doesn't. */
  state: 'used' | 'unused' | 'missing';
  fileId: string | null;
  courseId: string | null;
  /** Generated reader pages for this file (pages/<file-id>/). */
  pageObjects: number;
  pageBytes: number;
}

export interface StorageTreeDto {
  scannedAt: string;
  entries: StorageEntryDto[];
  courses: { id: string; title: string; status: string; r2Prefix: string }[];
  totals: { objects: number; bytes: number; pageBytes: number; unused: number; missing: number };
}

export const StoragePathBody = z.object({ path: z.string().trim().min(3).max(500) });
export const StorageDeleteBody = StoragePathBody.extend({ confirm: z.literal('DELETE') });

export interface StorageDeletePreviewDto {
  path: string;
  r2Objects: number;
  r2Bytes: number;
  pageObjects: number;
  pageBytes: number;
  /** Course files (database rows) that go. */
  files: number;
  courses: { id: string; title: string; status: string; students: number; whole: boolean }[];
  /** Why it can't be deleted right now (null when it can). */
  blocked: string | null;
}

export interface StorageDeleteResultDto {
  removedObjects: number;
  removedBytes: number;
  removedPageObjects: number;
  removedFiles: number;
  deletedCourses: number;
  /** Courses kept (archived, emptied) because students bought them: the sales history stays. */
  archivedCourses: number;
}

/** Delete an archived course for good. `deleteNotes` also removes its uploaded files from R2. */
export const DeleteCourseBody = z.object({ deleteNotes: z.boolean().default(false) });
export interface DeleteCourseResultDto {
  deleted: true;
  pageFoldersRemoved: number;
  notesRemoved: number;
  /** Uploaded files kept because another course uses the same file. */
  notesShared: number;
}

/** Move or rename a course's folder in R2 without re-making its pages. */
export const MoveCourseFolderBody = z.object({
  courseId: z.string().min(1).max(64),
  newFolder: z.string().trim().min(3).max(400),
});
export type MoveCourseFolderInput = z.infer<typeof MoveCourseFolderBody>;

export interface MoveCourseFolderResultDto {
  from: string;
  to: string;
  movedObjects: number;
  movedFiles: number;
  /** Old copies that could not be deleted (they show as unused in the storage map). */
  leftovers: number;
}

// ── Contributions (students share their notes) ───────────────────────────────

/** What a contributor gets of every sale of a course built on their notes. */
export const DEFAULT_ROYALTY_PERCENT = 50;

/** Every purchase gives this many months of access, counted from the day it is bought. */
export const ACCESS_MONTHS = 3;

export const CONTRIBUTION_KINDS = ['notes', 'pyq', 'slides', 'lab', 'other'] as const;
export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number];

/** The limits, shared so the page can tell students before they hit them. */
export const CONTRIBUTION_LIMITS = {
  filesPerSubmission: 5,
  bytesPerFile: 25 * 1024 * 1024,
  bytesPerSubmission: 60 * 1024 * 1024,
  submissionsPerDay: 3,
  pendingAtOnce: 5,
  /** What can be uploaded (checked by extension and by the file's actual contents). */
  extensions: ['pdf', 'ppt', 'pptx', 'doc', 'docx', 'zip', 'jpg', 'jpeg', 'png'],
} as const;

export const ContributionMetaBody = z.object({
  title: z.string().trim().min(3).max(120),
  courseHint: z.string().trim().max(120).default(''),
  kind: z.enum(CONTRIBUTION_KINDS),
  description: z.string().trim().max(1000).default(''),
  /** The student confirms the notes are theirs to share. */
  ownWork: z.literal(true),
});
export type ContributionMetaInput = z.infer<typeof ContributionMetaBody>;

export type ContributionStatus = 'pending' | 'approved' | 'rejected';

export type ContributionReward =
  | { type: 'none' }
  | { type: 'thanks' }
  | { type: 'course'; courseId: string; courseTitle: string }
  | { type: 'cash'; amountRupees: number }
  /** The contributor earns a share of every sale of this course from now on. */
  | { type: 'royalty'; courseId: string; courseTitle: string; sharePercent: number };

export interface ContributionFileDto {
  index: number;
  name: string;
  size: number;
  type: string;
}

/** What a student sees about their own contribution. */
export interface MyContributionDto {
  id: string;
  title: string;
  courseHint: string;
  kind: ContributionKind;
  files: ContributionFileDto[];
  totalBytes: number;
  status: ContributionStatus;
  reviewNote: string;
  reward: ContributionReward | null;
  /** For a cash reward: when it was paid (null = not paid yet). */
  rewardPaidAt: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface ContributionStatusDto {
  open: boolean;
  /** This student may not upload (blocked by the admin). */
  blocked: boolean;
  pending: number;
  todayLeft: number;
  limits: typeof CONTRIBUTION_LIMITS;
  mine: MyContributionDto[];
  /** Courses this student earns a share of. */
  royalties: MyRoyaltyDto[];
}

/** What the admin sees: everything a student sees plus who sent it. */
export interface AdminContributionDto extends MyContributionDto {
  description: string;
  contributor: { id: string; email: string; name: string | null; blocked: boolean; approvedBefore: number };
  reviewedBy: string | null;
}

export const ContributionReviewBody = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(1000).default(''),
  reward: z
    .discriminatedUnion('type', [
      z.object({ type: z.literal('none') }),
      z.object({ type: z.literal('thanks') }),
      z.object({ type: z.literal('course'), courseId: z.string().min(1).max(64) }),
      z.object({ type: z.literal('cash'), amountRupees: z.number().int().min(1).max(100000) }),
      z.object({
        type: z.literal('royalty'),
        courseId: z.string().min(1).max(64),
        sharePercent: z.number().int().min(1).max(90).default(DEFAULT_ROYALTY_PERCENT),
      }),
    ])
    .default({ type: 'none' }),
  /** Email the student about the decision. */
  notify: z.boolean().default(true),
});
export type ContributionReviewInput = z.infer<typeof ContributionReviewBody>;

export const ContributionCopyBody = z.object({
  /** An R2 folder such as "drive-imports/24 Batch/DBMS/Unit 2/". */
  folder: z.string().trim().min(3).max(300),
});

export const ContributionSettingsBody = z.object({ open: z.boolean() });
export const ContributorBlockBody = z.object({ userId: z.string().min(1).max(64), blocked: z.boolean() });

// ── Earnings & royalties ────────────────────────────────────────────────────

export interface RoyaltyDto {
  contributorId: string;
  email: string;
  name: string | null;
  sharePercent: number;
  /** Sales from this moment on count towards the royalty. */
  since: string;
  contributionId: string | null;
  /** Paid sales of this course since `since`. */
  sales: number;
  earnedPaise: number;
  paidPaise: number;
  owedPaise: number;
}

export interface CourseEarningDto {
  courseId: string;
  title: string;
  slug: string;
  status: 'draft' | 'live' | 'archived';
  pricePaise: number;
  /** Paid orders that included this course (single or in a bundle). */
  sales: number;
  /** Different students who paid for it. */
  buyers: number;
  /** Given free by an admin (contributors, scholarships). */
  freeAccess: number;
  /** Students who can open it right now. */
  readingNow: number;
  /** What this course brought in. Bundle payments are split by the courses' prices. */
  revenuePaise: number;
  lastSaleAt: string | null;
  royalty: RoyaltyDto | null;
}

export interface RoyaltyPayoutDto {
  id: string;
  courseId: string;
  courseTitle: string;
  contributorId: string;
  email: string;
  amountPaise: number;
  note: string;
  paidAt: string;
  recordedBy: string;
}

export interface CashRewardDto {
  contributionId: string;
  title: string;
  contributorId: string;
  email: string;
  name: string | null;
  amountRupees: number;
  approvedAt: string | null;
  paidAt: string | null;
  note: string;
}

/** The contributors whose notes sold most in the last 12 months; the first gets the yearly bonus. */
export interface TopContributorDto {
  contributorId: string;
  email: string;
  name: string | null;
  courses: number;
  sales: number;
  /** Royalty earned in the last 12 months. */
  earnedPaise: number;
  /** The bonus: the same amount again. */
  bonusPaise: number;
  /** When this year's bonus was paid to them (null = not yet). */
  bonusPaidAt: string | null;
}

export interface EarningsDto {
  totals: {
    revenuePaise: number;
    sales: number;
    buyers: number;
    royaltyOwedPaise: number;
    royaltyPaidPaise: number;
    /** Cash rewards for contributions not paid yet. */
    cashOwedPaise: number;
  };
  courses: CourseEarningDto[];
  payouts: RoyaltyPayoutDto[];
  cashRewards: CashRewardDto[];
  topContributors: TopContributorDto[];
  /** The bonus year (the 12 months up to now are counted). */
  bonusYear: number;
}

export const RewardPaidBody = z.object({ note: z.string().trim().max(300).default('') });

export const BonusPaidBody = z.object({
  userId: z.string().min(1).max(64),
  year: z.number().int().min(2025).max(2100),
  amountRupees: z.number().int().min(1).max(1000000),
  note: z.string().trim().max(300).default(''),
});
export type BonusPaidInput = z.infer<typeof BonusPaidBody>;

/** What a contributor sees about a course they earn from. */
export interface MyRoyaltyDto {
  courseId: string;
  courseTitle: string;
  sharePercent: number;
  since: string;
  sales: number;
  earnedPaise: number;
  paidPaise: number;
  owedPaise: number;
}

export const SetRoyaltyBody = z.object({
  courseId: z.string().min(1).max(64),
  /** The contributor's college email (they must have signed in once). */
  email: z.string().trim().toLowerCase().email().max(200),
  sharePercent: z.number().int().min(1).max(90).default(DEFAULT_ROYALTY_PERCENT),
});
export type SetRoyaltyInput = z.infer<typeof SetRoyaltyBody>;

export const RoyaltyPayoutBody = z.object({
  courseId: z.string().min(1).max(64),
  amountRupees: z.number().int().min(1).max(1000000),
  note: z.string().trim().max(300).default(''),
});
export type RoyaltyPayoutInput = z.infer<typeof RoyaltyPayoutBody>;

// ── Help desk (students ask, the admin answers) ─────────────────────────────

export const SUPPORT_TOPICS = [
  'feature',
  'notes',
  'payment',
  'contribute',
  'account',
  'suggestion',
  'other',
] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];
export type SupportStatus = 'open' | 'answered' | 'closed';

export const SUPPORT_LIMITS = {
  /** Screenshots or a PDF showing what went wrong. */
  filesPerQuery: 3,
  bytesPerFile: 5 * 1024 * 1024,
  openAtOnce: 5,
  newPerDay: 5,
  messagesPerQuery: 40,
} as const;

export const SupportCreateBody = z.object({
  topic: z.enum(SUPPORT_TOPICS),
  subject: z.string().trim().min(3).max(140),
  message: z.string().trim().min(5).max(4000),
  /** The page they were on, so the admin can see the problem. */
  page: z
    .string()
    .trim()
    .max(300)
    .regex(/^(\/[^\s]*)?$/)
    .default(''),
});
export type SupportCreateInput = z.infer<typeof SupportCreateBody>;

export const SupportReplyBody = z.object({ body: z.string().trim().min(1).max(4000) });
export const AdminSupportReplyBody = SupportReplyBody.extend({
  /** Close the query with this answer. */
  close: z.boolean().default(false),
  notify: z.boolean().default(true),
});
export const SupportStatusBody = z.object({ status: z.enum(['open', 'answered', 'closed']) });

export interface SupportMessageDto {
  id: string;
  fromAdmin: boolean;
  /** "Scholars Stack" for the admin, the student's name for them. */
  author: string;
  body: string;
  createdAt: string;
}

export interface SupportQueryDto {
  id: string;
  topic: SupportTopic;
  subject: string;
  page: string;
  status: SupportStatus;
  files: ContributionFileDto[];
  messages: SupportMessageDto[];
  createdAt: string;
  updatedAt: string;
}

export interface MySupportDto {
  limits: typeof SUPPORT_LIMITS;
  open: number;
  todayLeft: number;
  queries: SupportQueryDto[];
}

export interface AdminSupportQueryDto extends SupportQueryDto {
  student: { id: string; email: string; name: string | null };
}

// ── Years & branches (edited from Admin) ────────────────────────────────────

export interface AcademicYearDto {
  year: number;
  visible: boolean;
  /** Courses filed under this batch year, and how many are on sale. */
  courses: number;
  live: number;
}

export interface AcademicBranchDto {
  slug: string;
  code: string;
  name: string;
  shortName: string;
  isCommon: boolean;
  isActive: boolean;
  sort: number;
  courses: number;
}

export interface AcademicDto {
  years: AcademicYearDto[];
  branches: AcademicBranchDto[];
}

export const YearBody = z.object({ year: z.number().int().min(2000).max(2100) });
export const YearVisibleBody = z.object({ visible: z.boolean() });

export const BranchSaveBody = z.object({
  /** Leave out to add a new branch (made from the code). */
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .optional(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,12}$/, 'Use 2–12 letters or digits, like CSE or BAI.'),
  name: z.string().trim().min(2).max(120),
  shortName: z.string().trim().max(40).default(''),
  isCommon: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sort: z.number().int().min(0).max(1000).default(100),
});
export type BranchSaveInput = z.infer<typeof BranchSaveBody>;

export const MoveYearBody = z.object({
  fromYear: z.number().int().min(2000).max(2100),
  toYear: z.number().int().min(2000).max(2100),
  /** Only this branch's courses; leave out for the whole year (bundles move too). */
  branchSlug: z.string().max(60).optional(),
});
export type MoveYearInput = z.infer<typeof MoveYearBody>;

// ── Admins (the list lives in Supabase; GitHub's ADMIN_EMAILS keeps it in step) ──

export interface AdminListDto {
  admins: { email: string; source: 'github' | 'manual'; addedAt: string }[];
  /** Where the list is read from: the database, or the Worker secret when the database is empty. */
  readFrom: 'database' | 'worker-secret';
}
