import { AcademicService } from '../application/academic-service';
import { AccessMailService } from '../application/access-mail';
import { AccountService } from '../application/account-service';
import { AdminAccess } from '../application/admin-access';
import { AdminService } from '../application/admin-service';
import { AnnouncementService } from '../application/announcement-service';
import { appsSummary } from '../application/apps-summary';
import { BookService } from '../application/book-service';
import { cachedBundles, cachedCatalogue } from '../application/cached-catalogue';
import { MessService, ReminderService } from '../application/campus-service';
import { CatalogueService } from '../application/catalogue-service';
import { CheckoutService } from '../application/checkout-service';
import type { AppConfig } from '../application/config';
import { ContributionReviewService } from '../application/contributions/contribution-review-service';
import { ContributionService } from '../application/contributions/contribution-service';
import { ContributorStatsService } from '../application/contributions/contributor-stats';
import { ContributionFilingService } from '../application/contributions/filing';
import { FiledCourses } from '../application/contributions/pipeline';
import { DiscountReportService } from '../application/discount-report';
import { EarningsService } from '../application/earnings/earnings-service';
import { FeeService } from '../application/fee-service';
import { InsightsService } from '../application/insights-service';
import { StudentMailer } from '../application/notify/student-mailer';
import { OfferService } from '../application/offer-service';
import { ChatService } from '../application/order-chat';
import { OrderEvents } from '../application/order-events';
import { OrderService } from '../application/order-service';
import { PackService } from '../application/packs';
import { PartnerLoginService } from '../application/partner-login';
import { PhoneService } from '../application/phone-service';
import { PreviewService } from '../application/preview-service';
import { PriceBook } from '../application/price-book';
import { ProblemService } from '../application/problems';
import { PromoCodeService } from '../application/promo-service';
import { ReaderService } from '../application/reader-service';
import { ShelfService } from '../application/shelf-service';
import { SignInGuard } from '../application/signin-guard';
import { StorageIndex } from '../application/storage-index';
import { StorageMapService } from '../application/storage-map';
import { StorageTreeService } from '../application/storage-tree';
import { SupportDeskService } from '../application/support/support-desk-service';
import { SupportService } from '../application/support/support-service';
import type {
  ChatReportRepository,
  FeeRepository,
  LiveSignal,
  MessBlockRepository,
  MessOrderRepository,
  MessReportRepository,
  MessRepository,
  MessViewRepository,
  OrderChatRepository,
  OwnerLoginRepository,
  PhoneRepository,
  PresenceRepository,
  PushQueue,
  PushRepository,
  PushSender,
  SessionMinter,
  SmsVerifier,
  TiffinMarkRepository,
} from '../domain/campus-ports';
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
  CourseBookRepository,
  CourseUpdateSource,
  DatabaseHousekeeping,
  DeliveryLog,
  DeviceRepository,
  DiscountLedger,
  EarningsRepository,
  EmailQuota,
  EntitlementRepository,
  FeatureRepository,
  IdGenerator,
  InsightsRepository,
  LeaseRepository,
  Mailer,
  ObjectStore,
  OfferRepository,
  OrderRepository,
  PaymentGateway,
  PeopleDirectory,
  ProblemLog,
  ProfileRepository,
  ProgressRepository,
  PromoCodeRepository,
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
  offers: OfferRepository;
  promoCodes: PromoCodeRepository;
  discounts: DiscountLedger;
  /** Page-view counters and the Insights report. */
  insights: InsightsRepository;
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
  /** Recommended books per course. */
  books: CourseBookRepository;
  /** Mess menus, students' corrections, and push reminders. */
  messes: MessRepository;
  messReports: MessReportRepository;
  messOrders: MessOrderRepository;
  /** The chat on each order, blocks, and reports from chats. */
  orderChat: OrderChatRepository;
  messBlocks: MessBlockRepository;
  chatReports: ChatReportRepository;
  /** "Something changed" pings to open pages (Supabase Realtime). */
  live: LiveSignal;
  push: PushRepository;
  pushSender: PushSender;
  /** Optional: without it, each run sends only what fits (pushPerRun). */
  pushQueue?: PushQueue;
  /** Students' checked mobile numbers, and the SMS service that sends the codes. */
  phones: PhoneRepository;
  sms: SmsVerifier;
  /** Restaurant owners' mobile + PIN sign-in, the session maker it uses, and the PIN pepper ('' = off). */
  ownerLogins: OwnerLoginRepository;
  sessionMinter: SessionMinter;
  ownerPinPepper: string;
  /** The site's WhatsApp number for free phone checks ('' = off). */
  whatsappNumber?: string;
  /** Opens of each restaurant page per day (owner insights). */
  messViews: MessViewRepository;
  /** Tiffin meals marked delivered or missed. */
  tiffinMarks: TiffinMarkRepository;
  /** Who has an order screen open (optional: without it every notification is sent). */
  presence?: PresenceRepository;
  /** Restaurant fees: rules, the append-only ledger, closed months. */
  fees: FeeRepository;
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
  // The public catalogue reads through a shared, briefly remembered copy of the database reads.
  const publicReader = cachedCatalogue(p.catalogueReader);
  const publicBundles = cachedBundles(p.bundles);
  const prices = new PriceBook(p.offers, publicReader, config, () => p.clock.now());
  const promoCodes = new PromoCodeService(p.promoCodes, () => p.clock.now());
  const announcements = new AnnouncementService(
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
  );
  const discounts = new DiscountReportService(p.discounts, p.promoCodes, p.catalogueReader, p.bundles, () =>
    p.clock.now(),
  );
  const catalogue = new CatalogueService(
    publicReader,
    publicBundles,
    p.entitlements,
    p.pages,
    config,
    p.books,
    p.contributions,
    prices,
  );
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
    prices,
  );
  const admins = new AdminAccess(p.admins, config.adminEmails);
  const orderEvents = new OrderEvents(
    p.messOrders,
    p.orderChat,
    p.push,
    p.pushSender,
    p.live,
    p.clock,
    p.presence,
  );
  const phones = new PhoneService(p.phones, p.sms, p.clock, p.profiles, p.whatsappNumber ?? '');
  const fees = new FeeService(p.fees, p.messes, p.messOrders, p.clock);
  const orders = new OrderService(p.messes, p.messOrders, p.features, p.clock, p.uploads, {
    fees,
    events: orderEvents,
    phones,
    views: p.messViews,
    tiffinMarks: p.tiffinMarks,
    blocks: p.messBlocks,
    chat: p.orderChat,
  });
  const chats = new ChatService(
    p.messes,
    p.messOrders,
    p.orderChat,
    p.messBlocks,
    p.chatReports,
    orderEvents,
    orders,
    p.clock,
    p.uploads,
  );
  /** Admins, and restaurant owners, may sign in with an address outside the college domain. */
  const outsideAllowed = async (email: string) =>
    (await admins.isAdmin(email)) || (await orders.isOwner(email).catch(() => false));
  const studentMail = new StudentMailer(p.mailer, p.emailQuota, p.unsubscribeSigner, p.clock, config);
  const earnings = new EarningsService(
    p.earnings,
    p.catalogueWriter,
    p.catalogueReader,
    p.people,
    p.profiles,
    p.clock,
    p.contributions,
    p.bundles,
  );
  const filedCourses = new FiledCourses(p.catalogueReader, p.catalogueWriter);
  const storageIndex = new StorageIndex(p.sources, p.pages);
  return {
    conversionQueue: p.queue,
    /** The email provider itself, for the admin's health check. */
    mailer: p.mailer,
    storageIndex,
    limiter: p.limiter,
    earnings,
    academic: new AcademicService(p.academic, config.currentIntakeYear),
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
      p.clock,
      config.importRoot,
      config.currentIntakeYear,
    ),
    contributorStats: new ContributorStatsService(p.contributions, filedCourses, earnings),
    contributionReview: new ContributionReviewService(
      p.contributions,
      p.uploads,
      p.catalogueReader,
      p.entitlements,
      p.settings,
      p.earnings,
      studentMail,
      p.clock,
      filedCourses,
    ),
    catalogue,
    packs: new PackService(catalogue, p.bundles, p.settings),
    prices,
    offers: new OfferService(
      p.offers,
      p.bundles,
      p.catalogueReader,
      prices,
      discounts,
      () => p.clock.now(),
      announcements,
    ),
    promoCodes,
    discounts,
    insights: new InsightsService(p.insights, () => p.clock.now()),
    books: new BookService(p.catalogueReader, p.books),
    mess: new MessService(p.messes, p.messReports, p.features),
    orders,
    fees,
    phones,
    partnerLogin: new PartnerLoginService(
      p.ownerLogins,
      p.messes,
      p.sessionMinter,
      p.clock,
      p.ownerPinPepper,
      undefined,
      () => orders.forgetOwners(),
    ),
    appsSummary: () =>
      appsSummary({
        messes: p.messes,
        orders: p.messOrders,
        owners: p.ownerLogins,
        push: p.push,
        clock: p.clock,
      }),
    chats,
    outsideAllowed,
    reminders: new ReminderService(
      p.push,
      p.messes,
      p.pushSender,
      p.features,
      p.clock,
      config.pushPerRun,
      p.profiles,
      p.pushQueue,
      config.pushPerBatch,
    ),
    housekeeping: p.housekeeping,
    previews: new PreviewService(p.catalogueReader, p.catalogueWriter, p.pages, p.seeder, p.limiter),
    admins,
    account: new AccountService(p.profiles, p.devices, p.sessions, config, admins, p.clock, orders),
    checkout: new CheckoutService(
      p.catalogueReader,
      p.bundles,
      p.orders,
      p.entitlements,
      p.profiles,
      p.gateway,
      prices,
      promoCodes,
      p.discounts,
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
    storageTree: new StorageTreeService(
      p.catalogueWriter,
      p.entitlements,
      p.sources,
      p.pages,
      config.importRoot,
      storageIndex,
    ),
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
      storageIndex,
    ),
    announcements,
    courseUpdates: p.courseUpdates,
    signInGuard: new SignInGuard(p.signInStrikes, admins, config, orders),
    signInStrikes: p.signInStrikes,
  };
}
