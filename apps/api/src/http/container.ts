import type { AcademicService } from '../application/academic-service';
import type { AccessMailService } from '../application/access-mail';
import type { AccountService } from '../application/account-service';
import type { AdminAccess } from '../application/admin-access';
import type { AdminService } from '../application/admin-service';
import type { AnnouncementService } from '../application/announcement-service';
import type { BookService } from '../application/book-service';
import type { CatalogueService } from '../application/catalogue-service';
import type { CheckoutService } from '../application/checkout-service';
import type { AppConfig } from '../application/config';
import type { ContributionReviewService } from '../application/contributions/contribution-review-service';
import type { ContributionService } from '../application/contributions/contribution-service';
import type { ContributorStatsService } from '../application/contributions/contributor-stats';
import type { ContributionFilingService } from '../application/contributions/filing';
import type { EarningsService } from '../application/earnings/earnings-service';
import type { PreviewService } from '../application/preview-service';
import type { ProblemService } from '../application/problems';
import type { ReaderService } from '../application/reader-service';
import type { ShelfService } from '../application/shelf-service';
import type { SignInGuard } from '../application/signin-guard';
import type { StorageIndex } from '../application/storage-index';
import type { StorageMapService } from '../application/storage-map';
import type { StorageTreeService } from '../application/storage-tree';
import type { SupportDeskService } from '../application/support/support-desk-service';
import type { SupportService } from '../application/support/support-service';
import type { OutgoingEmail } from '../domain/entities';
import type { ConversionQueue, DatabaseHousekeeping } from '../domain/ports';
import type { AuthVerifier, CourseUpdateSource, Mailer, RateLimiter, SignInStrikes } from '../domain/ports';
import type { DemoAuth } from '../infrastructure/auth';
import type { DeviceCookie } from '../infrastructure/crypto';
import type { DemoGateway } from '../infrastructure/payments';

/** Everything the routes need, already wired. Built by a composition root. */
export interface Container {
  config: AppConfig;
  mailer: Mailer;
  auth: AuthVerifier;
  deviceCookie: DeviceCookie;
  secureCookies: boolean;
  converterSecret: string;
  conversionQueue: ConversionQueue;
  /** Per-key request budget (Cloudflare rate-limit binding in production). */
  limiter: RateLimiter;
  catalogue: CatalogueService;
  books: BookService;
  /** Daily trims of history tables (cron). */
  housekeeping: DatabaseHousekeeping;
  previews: PreviewService;
  account: AccountService;
  checkout: CheckoutService;
  reader: ReaderService;
  shelf: ShelfService;
  admin: AdminService;
  announcements: AnnouncementService;
  accessMail: AccessMailService;
  /** Problems log the admin reads (browser and server errors). */
  problems: ProblemService;
  /** Students sharing their notes. */
  contributions: ContributionService;
  /** The admin reviewing and rewarding shared notes. */
  contributionReview: ContributionReviewService;
  /** Turning an accepted upload into course files (our layout), ready for pages. */
  contributionFiling: ContributionFilingService;
  /** How each contributor is doing. */
  contributorStats: ContributorStatsService;
  earnings: EarningsService;
  storageTree: StorageTreeService;
  /** Shared, short-lived bucket listing; cleared after admin changes and conversions. */
  storageIndex: StorageIndex;
  academic: AcademicService;
  admins: AdminAccess;
  courseUpdates: CourseUpdateSource;
  signInGuard: SignInGuard;
  signInStrikes: SignInStrikes;
  support: SupportService;
  supportDesk: SupportDeskService;
  /** Map of R2 and database storage, with safe clean-up. */
  storageMap: StorageMapService;
  /** Present only in demo mode. */
  demo?: { auth: DemoAuth; gateway: DemoGateway; newId: () => string; outbox: () => OutgoingEmail[] };
}
