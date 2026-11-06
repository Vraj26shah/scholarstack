import { z } from 'zod';
import type { ZipLayout } from './zip-layout';

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
  /** Public names of students who contributed the current source for this file. */
  contributors?: string[];
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
  /** Set when every current file in this unit has contributor attribution. */
  contributors?: string[];
  /** File whose pages anyone can preview (the admin's choice, else the first ready file), if any. */
  previewFileId: string | null;
  /** Which of that file's pages are public (page 1 unless the admin chose others). */
  previewPages?: number[];
}

/** The admin's free-preview choice for one unit. A null file goes back to the default. */
export const UnitPreviewBody = z.object({
  fileId: z.string().min(1).max(64).nullable(),
  pages: z.array(z.number().int().min(1).max(2000)).min(1).max(5),
});
export type UnitPreviewInput = z.infer<typeof UnitPreviewBody>;

export interface ReadingItemDto {
  title: string;
  /** Author, when the admin gave one; otherwise the unit it was found under. */
  unit: string;
  /** The admin's link, or a search for a legal copy (library or bookshop). */
  findUrl: string;
  /** Short name of where the link goes ("amazon.in"), for the link's label. */
  linkLabel?: string;
}

/** A recommended book an admin added to a course: its name and where to get it. */
export interface CourseBookDto {
  id: string;
  title: string;
  author: string;
  url: string;
}

/** Books on a course, plus textbook titles spotted in its folder that are not on the list yet. */
export interface AdminCourseBooksDto {
  books: CourseBookDto[];
  found: { title: string; unit: string; sourceKeys: string[] }[];
}

export const CourseBookBody = z.object({
  title: z.string().trim().min(2, 'Give the book a name').max(200),
  author: z.string().trim().max(120).default(''),
  url: z
    .string()
    .trim()
    .max(500)
    .url('Paste the full link, starting with https://')
    .refine((v) => /^https?:\/\//i.test(v), 'Paste the full link, starting with https://'),
});
export type CourseBookInput = z.infer<typeof CourseBookBody>;

export const CourseBookOrderBody = z.object({ ids: z.array(z.string().min(1).max(64)).max(40) });

export interface CourseDetailDto extends CourseCardDto {
  /** An admin is looking at a course students can't see yet (draft or archived). */
  preview?: boolean;
  description: string;
  branchName: string;
  /** Set when one accepted whole-subject upload supplies every current course file. */
  wholeCourseContributors: string[];
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
  /** An admin is looking at a bundle students can't see yet. */
  preview?: boolean;
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
  /** The admin's reason for the last change, shown to the student too. */
  note?: string | null;
  noteAt?: string | null;
}

/** One student and every course they have or had: the admin's student directory. */
export interface AdminStudentDto {
  userId: string;
  email: string;
  fullName: string | null;
  /** From a college email like name.23bce10001@…: the intake year and branch code, when it has them. */
  batchYear: number | null;
  branchCode: string | null;
  courses: Array<{
    courseId: string;
    title: string;
    state: AdminStudentAccessDto['state'];
    source: 'purchase' | 'admin';
    grantedAt: string;
    expiresAt: string | null;
    note: string | null;
    noteAt: string | null;
  }>;
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
  /** Why: saved with the access and sent to the student in the email. */
  reason: z.string().trim().max(300).optional(),
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
  removalAt: string | null;
}

export interface MeDto {
  id: string;
  email: string;
  fullName: string | null;
  isAdmin: boolean;
  emailOptIn: boolean;
  devices: DeviceDto[];
  deviceCooldownUntil: string | null;
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
  access: {
    state: AccessState;
    until: string | null;
    endedAt: string | null;
    termLabel: string;
    /** Ended or blocked courses stay on the shelf this long, then leave it. */
    leavesShelfAt?: string | null;
    /** The library's reason for the last change to this access, if it gave one. */
    note?: string | null;
  };
}

/** How long an ended or blocked course stays on the shelf to explain itself. */
export const SHELF_GRACE_HOURS = 48;

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

/** One batch and programme a course is offered to. */
export interface CourseOffering {
  batchYear: number;
  branchSlug: string;
}

/** Where an offering comes from: set by an admin, the term's course list, or how the course was filed. */
export type OfferingSource = 'admin' | 'list' | 'filed';

export interface AdminCourseDto extends CourseCardDto {
  /** Every batch and programme whose drawer shows this course now, with why. */
  offerings: (CourseOffering & { source: OfferingSource })[];
  /** Set by an admin: exactly these drawers (null = follow the course list and filing). */
  offeredTo: CourseOffering[] | null;
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
  /** What students see free from this unit now; `chosen` = the admin picked it. */
  preview?: { fileId: string | null; pages: number[]; chosen: boolean };
}

export type InventoryObjectStatus =
  | 'registered'
  | 'changed-in-r2'
  | 'unmapped'
  | 'unsupported'
  | 'ignored'
  | 'folder-marker'
  | 'missing-in-r2';

/** One step of the publish checklist. Steps run in order; a step is open only when the ones before it pass. */
export type PublishStepKey = 'storage' | 'structure' | 'sources' | 'pages' | 'details';
export type PublishFileState =
  | 'ready'
  | 'not-picked-up'
  | 'changed'
  | 'gone'
  | 'bad-source'
  | 'needs-pages'
  | 'working'
  | 'failed'
  | 'pages-missing'
  | 'broken-map';

/**
 * Everything that has to be true before a course goes on sale, as steps in order. The server runs
 * the same check when the course is published, so the button can never skip a step.
 */
export interface PublishCheckDto {
  courseId: string;
  title: string;
  status: 'draft' | 'live' | 'archived';
  checkedAt: string;
  steps: Array<{
    key: PublishStepKey;
    title: string;
    done: boolean;
    /** What is left, in plain words ("3 files still need pages"). */
    detail: string;
  }>;
  /** Every file in the course folder that students would see (hidden ones left out). */
  files: Array<{
    key: string;
    name: string;
    unit: string | null;
    fileId: string | null;
    state: PublishFileState;
    /** Pages saved / pages the file has, when known. */
    pagesFound: number | null;
    pageCount: number | null;
    problem: string | null;
  }>;
  /** Hidden files and files that can't be pages (ZIPs, system files): listed, never blocking. */
  skipped: Array<{ name: string; why: string }>;
  ready: boolean;
}

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
  /** The site's own emails (access, uploads, replies). Sign-in emails go through Supabase. */
  email?: {
    status: 'connected' | 'error';
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
  // No longer picked by an admin: the server works it out from the folder path, defaulting to 1.
  semester: z.number().int().min(1).max(10).optional(),
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
  /** Exactly which batches and programmes see the course; null goes back to the course list. */
  offeredTo: z
    .array(
      z.object({ batchYear: z.number().int().min(2000).max(2100), branchSlug: z.string().min(1).max(64) }),
    )
    .max(80)
    .nullable()
    .optional(),
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

export type ConversionBoardState =
  | 'waiting'
  | 'queued'
  | 'working'
  | 'paused'
  | 'stalled'
  | 'failed'
  | 'ready';

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

/** One to many files, for the page-jobs board's pause / resume / cancel actions. */
export const ConversionJobIdsBody = z.object({
  fileIds: z.array(z.string().min(1).max(64)).min(1).max(200),
});
export type ConversionJobIdsInput = z.infer<typeof ConversionJobIdsBody>;

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
export const BoardScopeBody = z.object({ scopes: R2Scopes });

// ── Admin "Today" (what needs the admin now) ──────────────────────────────────

export type TodayKey = 'questions' | 'uploads' | 'publish' | 'files' | 'rewards' | 'emails' | 'problems';

export interface TodayItemDto {
  key: TodayKey;
  /** How many need attention; null when that part couldn't be checked just now. */
  count: number | null;
  /** Money involved, for rewards. */
  amountPaise?: number;
}

export interface AdminTodayDto {
  checkedAt: string;
  items: TodayItemDto[];
}

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
  /** One whole group from the unused report (re-checked when deleting). */
  z.object({
    what: z.literal('unused'),
    group: z.enum([
      'leftovers',
      'uploads-orphan',
      'uploads-finished',
      'support-orphan',
      'courses-off-sale',
      'missing-files',
    ]),
    /** Only inside this folder (e.g. one course's), for clearing storage a scope at a time. */
    prefix: z.string().max(400).optional(),
  }),
  z.object({
    what: z.literal('unused-object'),
    group: z.enum([
      'pages',
      'leftovers',
      'uploads-orphan',
      'uploads-finished',
      'support-orphan',
      'courses-off-sale',
      'missing-files',
    ]),
    key: z.string().min(1).max(1024),
  }),
]);

/** Kinds of stored objects nothing on the site uses. */
export type UnusedGroupKey =
  | 'pages'
  | 'leftovers'
  | 'uploads-orphan'
  | 'uploads-finished'
  | 'support-orphan'
  /** Draft or archived courses: their database rows, notes and pages (R2 + Supabase). */
  | 'courses-off-sale'
  /** File records whose note is gone from storage: their rows and pages. */
  | 'missing-files';

export interface UnusedGroupDto {
  key: UnusedGroupKey;
  objects: number;
  bytes: number;
  /** Every unused object (page entries represent a whole orphan file folder). */
  items: { key: string; bytes: number; label?: string; note?: string; rows?: number }[];
  /** Database rows these items hold (courses and file records). */
  rows?: number;
}

/** Everything stored that nothing uses, by kind, plus folders still waiting to be imported. */
export interface StorageUnusedDto {
  scannedAt: string;
  groups: UnusedGroupDto[];
  /** Folders in no course yet: not unused, just not imported (never deleted from here). */
  notImported: { folder: string; objects: number; bytes: number }[];
}
export type StorageCleanInput = z.infer<typeof StorageCleanBody>;

export interface StorageCleanResultDto {
  removedObjects: number;
  removedBytes: number;
  removedRows: number;
}

// ── Restructuring stored notes: move and rename, keeping pages ──────────────

/** Move files or folders into another folder (a unit of the same or another course). */
export const StorageMoveBody = z.object({
  paths: z.array(z.string().min(1).max(1024)).min(1).max(200),
  /** The folder they go into, e.g. "drive-imports/23 Batch/DBMS/Unit 3/". */
  toFolder: z.string().trim().min(1).max(1024),
  dryRun: z.boolean().default(true),
});
export type StorageMoveInput = z.infer<typeof StorageMoveBody>;

/** Rename one file or folder where it is. */
export const StorageRenameBody = z.object({
  path: z.string().min(1).max(1024),
  newName: z.string().trim().min(1).max(120),
  dryRun: z.boolean().default(true),
});
export type StorageRenameInput = z.infer<typeof StorageRenameBody>;

export interface StorageMovePlanDto {
  moves: {
    from: string;
    to: string;
    /** The site file this storage file is (null: stored but not on the site). */
    file: { name: string; fromCourse: string; toCourse: string } | null;
  }[];
  /** Why it can't be done as asked (nothing is changed then). */
  blocked: string | null;
  /** After a real run. */
  done?: { moved: number; files: number; leftovers: number; coursesUnpublished: number };
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
  /** For a course file: whether its pages are made, waiting or failed, and how many there are.
   *  Kept for existing filter/count logic; `board` below is the same state Page jobs shows. */
  conversion?: 'ready' | 'pending' | 'failed' | null;
  pageCount?: number;
  hidden?: boolean;
  /** The same rich state "Page jobs" shows (working/queued/paused/stalled/…), so Folders and Page
   *  jobs never disagree about what a file is doing. */
  board?: ConversionBoardState | null;
  current?: number;
  total?: number;
  queuePosition?: number;
  queueTotal?: number;
  error?: string | null;
}

export interface StorageTreeDto {
  scannedAt: string;
  entries: StorageEntryDto[];
  courses: {
    id: string;
    title: string;
    status: string;
    r2Prefix: string;
    /** For finding a course when adding notes to it. */
    courseCode?: string | null;
    batchYear?: number;
  }[];
  totals: { objects: number; bytes: number; pageBytes: number; unused: number; missing: number };
}

export const StoragePathBody = z.object({ path: z.string().trim().min(3).max(500) });
/** One path, or several (a whole selection, or every unused file in a folder). */
export const StoragePathsBody = z
  .object({
    path: z.string().trim().min(1).max(500).optional(),
    paths: z.array(z.string().trim().min(1).max(500)).min(1).max(500).optional(),
  })
  .refine((b) => !!b.path || !!b.paths?.length, 'Pick something to delete.')
  .transform((b) => [...new Set(b.paths ?? [b.path!])]);
export const StorageDeleteBody = z
  .object({ confirm: z.literal('DELETE') })
  .passthrough()
  .transform((b, ctx) => {
    const r = StoragePathsBody.safeParse(b);
    if (!r.success) {
      ctx.addIssue({ code: 'custom', message: 'Pick something to delete.' });
      return z.NEVER;
    }
    return r.data;
  });

export interface StorageDeletePreviewDto {
  /** The first path picked (kept for one-item deletes). */
  path: string;
  /** Every path picked. */
  paths: string[];
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
export const DEFAULT_ROYALTY_PERCENT = 30;

/**
 * The payment provider's cut of every sale (2% plus 18% GST on it), in hundredths of a percent.
 * Royalties are a share of what a sale actually brings in, so this comes off first.
 */
export const PAYMENT_FEE_BPS = 236;

/** What a sale brings in after the payment fee, in whole paise. */
export function netOfFees(paise: number) {
  return Math.floor((paise * (10_000 - PAYMENT_FEE_BPS)) / 10_000);
}

/** Partner of the year: a bonus of this share of their year's royalties, up to the cap. */
export const YEARLY_BONUS_PERCENT = 25;
export const YEARLY_BONUS_CAP_RUPEES = 10_000;

/** The yearly bonus for a given year's royalties, in paise. */
export function yearlyBonusPaise(earnedPaise: number) {
  return Math.min(Math.floor((earnedPaise * YEARLY_BONUS_PERCENT) / 100), YEARLY_BONUS_CAP_RUPEES * 100);
}

/** Every purchase gives this many months of access, counted from the day it is bought. */
export const ACCESS_MONTHS = 3;

export const CONTRIBUTION_KINDS = ['notes', 'pyq', 'slides', 'lab', 'other'] as const;
export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number];

/** The limits, shared so the page can tell students before they hit them. */
export const CONTRIBUTION_LIMITS = {
  filesPerSubmission: 10,
  // Keep the established contribution limits while leaving room for multipart overhead.
  bytesPerFile: 60 * 1024 * 1024,
  bytesPerSubmission: 80 * 1024 * 1024,
  archiveEntries: 300,
  archiveUnpackedBytes: 200 * 1024 * 1024,
  archiveEntryBytes: 40 * 1024 * 1024,
  submissionsPerDay: 3,
  pendingAtOnce: 5,
  /**
   * What can be uploaded (checked by extension and by the file's actual contents): up to ten
   * PDFs, Word/PowerPoint documents, plain text notes, images, or ZIP archives per submission.
   */
  extensions: [
    'zip',
    'pdf',
    'ppt',
    'pptx',
    'pps',
    'ppsx',
    'odp',
    'doc',
    'docx',
    'odt',
    'txt',
    'jpg',
    'jpeg',
    'png',
  ],
} as const;

export const ContributionMetaBody = z.object({
  title: z.string().trim().min(3).max(120),
  /** Public attribution name, stored on the contributor profile when provided. */
  contributorName: z.string().trim().min(2).max(80).optional(),
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

/** What the automatic check found in one uploaded file. */
export interface FileCheckDto {
  format: 'pdf' | 'word' | 'powerpoint' | 'image' | 'zip' | 'other';
  /** e.g. "PDF · about 24 pages", "ZIP · 6 files, 5 usable" */
  label: string;
  /** Can be turned into pages as it is (a zip: at least one usable file inside). */
  ok: boolean;
  /** Why not, in words the admin can pass on to the student. */
  problem?: string;
  /** For a zip: what's inside and whether each can become pages. */
  entries?: { path: string; size: number; ok: boolean; reason?: string }[];
  /** For a zip: its folders, and whether it is a whole subject (30% of every sale). */
  layout?: ZipLayout;
}

export interface ContributionFileDto {
  index: number;
  name: string;
  size: number;
  type: string;
  /** Missing for files uploaded before checks existed (the admin can run it). */
  check?: FileCheckDto;
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
  /** Where it stands, in the student's words: in review → accepted → in a course → live. */
  progress: {
    step: 'review' | 'accepted' | 'filed' | 'live' | 'rejected';
    courseTitle: string | null;
    courseSlug: string | null;
  };
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

/** Where an upload is in the pipeline, step by step. */
export type PipelineStep = 'decide' | 'file' | 'reward' | 'pages' | 'finish' | 'done' | 'rejected';

export interface FiledFileDto {
  key: string;
  name: string;
  /** Uses the same queue state as Page jobs, plus hidden/missing source states. */
  status: ConversionBoardState | 'hidden' | 'missing';
  pages: number;
}

export interface ContributionPipelineDto {
  step: PipelineStep;
  filed: {
    courseId: string;
    courseTitle: string;
    courseSlug: string;
    courseStatus: 'draft' | 'live' | 'archived';
    folder: string;
    at: string;
    files: FiledFileDto[];
  } | null;
  completedAt: string | null;
}

/** What the admin sees: everything a student sees plus who sent it. */
export interface AdminContributionDto extends MyContributionDto {
  description: string;
  contributor: { id: string; email: string; name: string | null; blocked: boolean; approvedBefore: number };
  reviewedBy: string | null;
  pipeline: ContributionPipelineDto;
}

/** File an upload into a course: the unit folder name is ours ("Unit 2 - SQL"). */
export const FileContributionBody = z.object({
  courseId: z.string().min(1).max(64),
  /**
   * The unit folder for the upload. A whole-subject ZIP brings its own unit folders, so this is
   * only where its loose files go and may be left empty ("Notes").
   */
  unit: z
    .string()
    .trim()
    .max(80)
    .refine((u) => !/[\\/]|\.\./.test(u), 'A unit name cannot contain slashes.'),
  /** Keep the directories inside ZIP files as course units, even without a syllabus folder. */
  preserveFolders: z.boolean().default(false),
  /** Replace the contents of the selected destination unit with this upload. */
  replaceFolder: z.boolean().default(false),
  /** true = only show what would happen. */
  dryRun: z.boolean().default(true),
  /**
   * Per-file choices, keyed by the plan's `from` (an uploaded file, or "archive.zip › inner/path").
   * unit: put this one in another unit folder · name: its new file name · skip: leave it out.
   */
  files: z
    .array(
      z.object({
        from: z.string().min(1).max(600),
        unit: z.string().trim().max(80).optional(),
        name: z.string().trim().max(120).optional(),
        skip: z.boolean().optional(),
        replace: z.boolean().optional(),
      }),
    )
    .max(300)
    .default([]),
});
export type FileContributionInput = z.infer<typeof FileContributionBody>;

/** Metadata for a new, unpublished course created directly from an accepted upload. */
export const ContributionCourseBody = z.object({
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
  /** Chosen automatically from the intake year; older clients may still send it. */
  semester: z.number().int().min(1).max(10).optional(),
  pricePaise: z.number().int().min(100).max(1_000_000),
});
export type ContributionCourseInput = z.input<typeof ContributionCourseBody>;

export interface FilePlanDto {
  course: { id: string; title: string; status: 'draft' | 'live' | 'archived' };
  /** The unit folder, relative to the course ("Unit 2 - SQL/"); "" for a whole subject. */
  folder: string;
  /** The course's existing unit folders, to pick from. */
  units: string[];
  /**
   * A whole-subject ZIP (Syllabus, Unit 1…, PYQs): its folders become the course's units as they
   * are, instead of all going inside one unit.
   */
  wholeSubject?: boolean;
  /** The archive's directories will be kept as course units. */
  preservedFolders?: boolean;
  /** Files removed/overwritten if this destination folder is replaced. */
  folderReplacement?: { folder: string; removed: string[]; overwritten: string[] };
  files: {
    /** Where it came from: the uploaded file, or "archive.zip › inner/path.pdf". */
    from: string;
    /** Its name in the course, relative to the course folder. */
    to: string;
    status: 'new' | 'exists' | 'replace' | 'skipped';
    reason?: string;
    /** Left out by the admin (can be put back), as opposed to unusable. */
    leftOut?: boolean;
    /** The archive entry can be included if the admin gives it a supported file name. */
    canRename?: boolean;
  }[];
  /** After a real run: pages queued. */
  queued?: number;
}

export const CompleteContributionBody = z.object({
  done: z.boolean(),
  /** Email the student that their notes are live. */
  notify: z.boolean().default(true),
});

/** How one contributor is doing, for the admin. */
export interface ContributorStatsDto {
  userId: string;
  email: string;
  name: string | null;
  blocked: boolean;
  uploads: number;
  accepted: number;
  rejected: number;
  waiting: number;
  /** Files of theirs that students can read now, and their pages. */
  filesLive: number;
  pagesLive: number;
  /** Courses they earn a royalty on, and the sales counted for it. */
  royaltyCourses: number;
  royaltySales: number;
  earnedPaise: number;
  paidPaise: number;
  owedPaise: number;
  lastUploadAt: string;
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
  /** The payment provider's cut of this course's sales. */
  feesPaise: number;
  /** What partners earn from it: the royalty earned plus cash rewards for uploads filed into it. */
  partnerPaise: number;
  /** What is left for us: revenue − fees − partner earnings. Below zero is a loss. */
  profitPaise: number;
  /** Partner uploads filed into this course: who, what, and where in storage. */
  partnerUploads: { contributionId: string; title: string; email: string; folder: string; files: number }[];
}

/** One bundle's sales: orders, different buyers and money in (before fees). */
export interface BundleEarningDto {
  bundleId: string;
  title: string;
  status: 'draft' | 'live' | 'archived';
  pricePaise: number;
  sales: number;
  buyers: number;
  revenuePaise: number;
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
  /** What this year's perk was, once given: cash or a gift, and its note. */
  perk?: { kind: 'cash' | 'gift'; amountPaise: number; note: string } | null;
}

export interface EarningsDto {
  totals: {
    revenuePaise: number;
    sales: number;
    buyers: number;
    feesPaise: number;
    partnerPaise: number;
    profitPaise: number;
    freeAccess: number;
    royaltyOwedPaise: number;
    royaltyPaidPaise: number;
    /** Cash rewards for contributions not paid yet. */
    cashOwedPaise: number;
  };
  courses: CourseEarningDto[];
  bundles: BundleEarningDto[];
  payouts: RoyaltyPayoutDto[];
  cashRewards: CashRewardDto[];
  topContributors: TopContributorDto[];
  /** The bonus year (the 12 months up to now are counted). */
  bonusYear: number;
}

export const RewardPaidBody = z.object({ note: z.string().trim().max(300).default('') });

export const BonusPaidBody = z
  .object({
    userId: z.string().min(1).max(64),
    year: z.number().int().min(2025).max(2100),
    /** cash: money by UPI. gift: a prize, voucher or merchandise (say what in the note). */
    kind: z.enum(['cash', 'gift']).default('cash'),
    amountRupees: z.number().int().min(0).max(1000000),
    note: z.string().trim().max(300).default(''),
  })
  .refine((b) => b.kind === 'gift' || b.amountRupees >= 1, 'Enter the amount paid.')
  .refine((b) => b.kind === 'cash' || b.note.length >= 2, 'Say what the gift was.');
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
/** Several questions at once: close, re-open or delete everything ticked (a pile-up of spam, say). */
export const SupportBulkBody = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(500),
  action: z.enum(['delete', 'close', 'open']),
});
export type SupportBulkBody = z.infer<typeof SupportBulkBody>;

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
  /** "3rd year", "Starts next intake" or "Graduated": where this batch is today. */
  label: string;
  /** True when students can see this year: visible and one of the four current batches. */
  shown: boolean;
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
