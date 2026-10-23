import type {
  AnnouncementStatus,
  ConversionStage,
  ConversionStatus,
  FeatureStatus,
  FileFormat,
  OrderStatus,
  UnitKind,
} from '@ss/contracts';

/** Who is calling, as proven by a verified access token. */
export interface Principal {
  userId: string;
  email: string;
  sessionId: string;
  accessToken: string;
}

export interface Batch {
  year: number;
}

export interface Branch {
  slug: string;
  name: string;
  code: string;
  isCommon: boolean;
  sort: number;
  shortName: string;
  tagline: string;
  description: string;
  courseCodes: string[];
  isActive: boolean;
}

export type CourseStatus = 'draft' | 'live' | 'archived';

export interface Course {
  id: string;
  slug: string;
  title: string;
  courseCode: string | null;
  description: string;
  batchYear: number;
  branchSlug: string;
  semester: number;
  seq: number;
  r2Prefix: string;
  pricePaise: number;
  status: CourseStatus;
}

export interface CourseFile {
  id: string;
  courseId: string;
  unitKey: string;
  unitTitle: string;
  unitKind: UnitKind;
  /** Order of the unit inside its course (natural folder order). */
  unitSort: number;
  /** The whole unit is kept off the site. */
  unitHidden: boolean;
  /** This file is kept off the site. */
  hidden: boolean;
  name: string;
  format: FileFormat;
  sizeBytes: number;
  pageCount: number;
  sourceKey: string;
  sourceEtag: string;
  /** Timestamp of the last complete R2 sync that found this source missing. */
  sourceMissingAt?: string | null;
  conversionStatus: ConversionStatus;
  conversionError: string | null;
  conversionErrorStage?: ConversionStage | 'dispatch' | null;
  conversionStage?: ConversionStage | null;
  conversionProgressCurrent?: number;
  conversionProgressTotal?: number;
  conversionQueueId?: string | null;
  conversionQueuePosition?: number;
  conversionQueueTotal?: number;
  conversionUpdatedAt?: string | null;
  sort: number;
  /** Watermarked, unscrambled page 1 (public preview). */
  previewKey: string | null;
}

export interface Bundle {
  id: string;
  slug: string;
  title: string;
  description: string;
  batchYear: number | null;
  pricePaise: number;
  status: CourseStatus;
  courseIds: string[];
}

export interface Profile {
  id: string;
  email: string;
  fullName: string | null;
  emailOptIn: boolean;
}

export interface Feature {
  key: string;
  title: string;
  blurb: string;
  status: FeatureStatus;
  sort: number;
}

export interface Announcement {
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
  cursorId: string | null;
  error: string | null;
  createdAt: Date;
  sentAt: Date | null;
}

export interface Recipient {
  id: string;
  email: string;
  fullName: string | null;
}

export interface OutgoingEmail {
  to: { email: string; name?: string };
  subject: string;
  html: string;
  text: string;
}

export interface Device {
  id: string;
  userId: string;
  label: string;
  createdAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
}

export interface ActiveSession {
  userId: string;
  sessionId: string;
  deviceId: string;
}

/** Raised by the database when concurrent registrations exceed the device cap. */
export class DeviceLimitReached extends Error {}

export interface ViewerLease {
  userId: string;
  leaseId: string;
  deviceId: string;
  fileId: string;
  expiresAt: Date;
}

export interface Order {
  id: string;
  userId: string;
  /** Set for a single-course order. */
  courseId: string | null;
  /** Set for a bundle order. */
  bundleId: string | null;
  /** Everything this order grants (snapshot at purchase time). */
  courseIds: string[];
  amountPaise: number;
  gatewayOrderId: string;
  gatewayPaymentId: string | null;
  status: OrderStatus;
}

export interface ReadingProgress {
  userId: string;
  fileId: string;
  page: number;
  updatedAt: Date;
}

export interface StoredObject {
  key: string;
  size: number;
  etag: string;
}

/** Shown to students: neither the file nor its unit is hidden. */
export const isVisible = (f: Pick<CourseFile, 'hidden' | 'unitHidden' | 'sourceMissingAt'>): boolean =>
  !f.hidden && !f.unitHidden && !f.sourceMissingAt;

/** Files included in public course counts and the reader must have valid converted pages. */
export const isReaderReady = (
  f: Pick<CourseFile, 'hidden' | 'unitHidden' | 'conversionStatus' | 'pageCount'>,
): boolean => isVisible(f) && f.conversionStatus === 'ready' && f.pageCount > 0;

/** What the importer writes for each file found in R2. */
export interface FileUpsert {
  courseId: string;
  unitKey: string;
  unitTitle: string;
  unitKind: UnitKind;
  unitSort: number;
  /** Applied only when the unit is first created; the admin's later choice wins. */
  unitHiddenIfNew: boolean;
  /** Applied only when the file is first created. */
  hiddenIfNew: boolean;
  name: string;
  format: FileFormat;
  sizeBytes: number;
  sourceKey: string;
  sourceEtag: string;
  sort: number;
}
