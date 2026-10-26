import { AcademicService } from '../application/academic-service';
import { AccessMailService } from '../application/access-mail';
import { AccountService } from '../application/account-service';
import { AdminAccess } from '../application/admin-access';
import { AdminService } from '../application/admin-service';
import { AnnouncementService } from '../application/announcement-service';
import { CatalogueService } from '../application/catalogue-service';
import { CheckoutService } from '../application/checkout-service';
import type { AppConfig } from '../application/config';
import { ContributionReviewService } from '../application/contributions/contribution-review-service';
import { ContributionService } from '../application/contributions/contribution-service';
import { ContributorStatsService } from '../application/contributions/contributor-stats';
import { ContributionFilingService } from '../application/contributions/filing';
import { FiledCourses } from '../application/contributions/pipeline';
import { EarningsService } from '../application/earnings/earnings-service';
import { StudentMailer } from '../application/notify/student-mailer';
import { ProblemService } from '../application/problems';
import { ReaderService } from '../application/reader-service';
import { ShelfService } from '../application/shelf-service';
import { SignInGuard } from '../application/signin-guard';
import { StorageMapService } from '../application/storage-map';
import { StorageTreeService } from '../application/storage-tree';
import { SupportDeskService } from '../application/support/support-desk-service';
import { SupportService } from '../application/support/support-service';
import type {
  AcademicRepository,
  AccessLog,
  AdminDirectory,
  AnnouncementRepository,
  BundleRepository,
  CatalogueReader,
  CatalogueWriter,
  Clock,
  ContributionRepository,
  ConversionQueue,
  CourseUpdateSource,
  DatabaseHousekeeping,
  DeliveryLog,
  DeviceRepository,
  EarningsRepository,
  EmailQuota,
  EntitlementRepository,
  FeatureRepository,
  IdGenerator,
  LeaseRepository,
  Mailer,
  ObjectStore,
  OrderRepository,
  PaymentGateway,
  PeopleDirectory,
  ProblemLog,
  ProfileRepository,
  ProgressRepository,
  RateLimiter,
  RecipientSource,
  SessionRegistry,
  SettingsRepository,
  SignInStrikes,
  SupportRepository,
  TileSeeder,
  TokenSigner,
  UploadStore,
} from '../domain/ports';

/** The full set of ports. Any adapter family (Supabase, memory, …) that fills this gets every use case. */
export interface Ports {
  catalogueReader: CatalogueReader;
  catalogueWriter: CatalogueWriter;
  bundles: BundleRepository;
  features: FeatureRepository;
  announcements: AnnouncementRepository;
  recipients: RecipientSource;
  mailer: Mailer;
  emailQuota: EmailQuota;
  problems: ProblemLog;
  housekeeping: DatabaseHousekeeping;
  contributions: ContributionRepository;
  settings: SettingsRepository;
  earnings: EarningsRepository;
  deliveries: DeliveryLog;
  courseUpdates: CourseUpdateSource;
  signInStrikes: SignInStrikes;
  admins: AdminDirectory;
  academic: AcademicRepository;
  people: PeopleDirectory;
  support: SupportRepository;
  /** Where student uploads are written (the R2 bucket in production). */
  uploads: UploadStore;
  /** Signs one-click unsubscribe links (separate key from viewer tokens). */
  unsubscribeSigner: TokenSigner;
  profiles: ProfileRepository;
  devices: DeviceRepository;
  sessions: SessionRegistry;
  leases: LeaseRepository;
  orders: OrderRepository;
  entitlements: EntitlementRepository;
  progress: ProgressRepository;
  accessLog: AccessLog;
  /** The notes bucket: read for syncing, written when an upload is filed into a course. */
  sources: ObjectStore & UploadStore;
  pages: ObjectStore;
  queue: ConversionQueue;
  gateway: PaymentGateway;
  signer: TokenSigner;
  seeder: TileSeeder;
  limiter: RateLimiter;
  ids: IdGenerator;
  clock: Clock;
}

export function buildServices(p: Ports, config: AppConfig) {
  const accessMail = new AccessMailService(
    p.entitlements,
    p.mailer,
    p.emailQuota,
    p.unsubscribeSigner,
    p.clock,
    config,
    p.features,
  );
  const admin = new AdminService(
    p.catalogueReader,
    p.catalogueWriter,
    p.bundles,
    p.sources,
    p.pages,
    p.queue,
    config,
    p.gateway,
    p.entitlements,
    p.profiles,
    accessMail,
  );
  const admins = new AdminAccess(p.admins, config.adminEmails);
  const studentMail = new StudentMailer(p.mailer, p.emailQuota, p.unsubscribeSigner, p.clock, config);
  const earnings = new EarningsService(
    p.earnings,
    p.catalogueWriter,
    p.catalogueReader,
    p.people,
    p.profiles,
    p.clock,
    p.contributions,
  );
  const filedCourses = new FiledCourses(p.catalogueReader, p.catalogueWriter);
  return {
    limiter: p.limiter,
    earnings,
    academic: new AcademicService(p.academic),
    support: new SupportService(p.support, p.uploads, p.profiles, p.clock),
    supportDesk: new SupportDeskService(p.support, p.uploads, p.people, studentMail),
    accessMail,
    problems: new ProblemService(p.problems),
    contributions: new ContributionService(
      p.contributions,
      p.uploads,
      p.settings,
      p.profiles,
      earnings,
      p.clock,
      filedCourses,
    ),
    contributionFiling: new ContributionFilingService(
      p.contributions,
      p.sources,
      p.catalogueReader,
      p.catalogueWriter,
      (courseId, prefix) => admin.rescanFolder(courseId, prefix, { keepLiveForNewFiles: true }),
      p.clock,
    ),
    contributorStats: new ContributorStatsService(p.contributions, filedCourses, earnings),
    contributionReview: new ContributionReviewService(
      p.contributions,
      p.uploads,
      p.sources,
      p.catalogueReader,
      p.entitlements,
      p.settings,
      p.earnings,
      studentMail,
      p.clock,
      filedCourses,
    ),
    catalogue: new CatalogueService(p.catalogueReader, p.bundles, p.entitlements, p.pages, config),
    admins,
    account: new AccountService(p.profiles, p.devices, p.sessions, config, admins),
    checkout: new CheckoutService(
      p.catalogueReader,
      p.bundles,
      p.orders,
      p.entitlements,
      p.profiles,
      p.gateway,
    ),
    reader: new ReaderService(
      p.catalogueReader,
      p.entitlements,
      p.profiles,
      p.leases,
      p.progress,
      p.accessLog,
      p.pages,
      p.signer,
      p.seeder,
      p.limiter,
      p.ids,
      p.clock,
      config,
    ),
    shelf: new ShelfService(p.catalogueReader, p.entitlements, p.progress),
    admin,
    storageTree: new StorageTreeService(p.catalogueWriter, p.entitlements, p.sources, p.pages),
    storageMap: new StorageMapService(
      p.catalogueWriter,
      p.sources,
      p.pages,
      p.housekeeping,
      () => admin.cleanOrphanPageObjects(),
      config.importRoot,
      {
        uploads: async () => {
          const list = await p.contributions.list('all', 10_000);
          const all = new Set(list.flatMap((c) => c.files.map((f) => f.key)));
          const finished = new Set(
            list.filter((c) => c.completedAt && c.filed).flatMap((c) => c.files.map((f) => f.key)),
          );
          return { all, finished };
        },
        support: async () =>
          new Set((await p.support.list('all', 10_000)).flatMap((q) => q.files.map((f) => f.key))),
      },
    ),
    announcements: new AnnouncementService(
      p.announcements,
      p.features,
      p.recipients,
      p.profiles,
      p.mailer,
      p.emailQuota,
      p.unsubscribeSigner,
      p.clock,
      config,
      p.deliveries,
      p.catalogueReader,
    ),
    courseUpdates: p.courseUpdates,
    signInGuard: new SignInGuard(p.signInStrikes, admins, config),
    signInStrikes: p.signInStrikes,
  };
}
