import { AccountService } from '../application/account-service';
import { AdminService } from '../application/admin-service';
import { AnnouncementService } from '../application/announcement-service';
import { CatalogueService } from '../application/catalogue-service';
import { CheckoutService } from '../application/checkout-service';
import type { AppConfig } from '../application/config';
import { ReaderService } from '../application/reader-service';
import { ShelfService } from '../application/shelf-service';
import type {
  AccessLog,
  AnnouncementRepository,
  BundleRepository,
  CatalogueReader,
  CatalogueWriter,
  Clock,
  ConversionQueue,
  DeviceRepository,
  EmailQuota,
  EntitlementRepository,
  FeatureRepository,
  IdGenerator,
  LeaseRepository,
  Mailer,
  ObjectStore,
  OrderRepository,
  PaymentGateway,
  ProfileRepository,
  ProgressRepository,
  RateLimiter,
  RecipientSource,
  SessionRegistry,
  TileSeeder,
  TokenSigner,
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
  sources: ObjectStore;
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
  return {
    catalogue: new CatalogueService(p.catalogueReader, p.bundles, p.entitlements, p.pages, config),
    account: new AccountService(p.profiles, p.devices, p.sessions, config),
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
    admin: new AdminService(
      p.catalogueReader,
      p.catalogueWriter,
      p.bundles,
      p.sources,
      p.pages,
      p.queue,
      config,
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
    ),
  };
}
