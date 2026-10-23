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

export interface ShelfItemDto {
  course: CourseCardDto;
  lastRead: { fileId: string; fileName: string; page: number; pageCount: number } | null;
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
});

export interface EmailStatusDto {
  provider: 'brevo' | 'demo' | 'none';
  dailyLimit: number;
  usedToday: number;
  optedIn: number;
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
