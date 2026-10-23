import type { AccountService } from '../application/account-service';
import type { AdminService } from '../application/admin-service';
import type { AnnouncementService } from '../application/announcement-service';
import type { CatalogueService } from '../application/catalogue-service';
import type { CheckoutService } from '../application/checkout-service';
import type { AppConfig } from '../application/config';
import type { ReaderService } from '../application/reader-service';
import type { ShelfService } from '../application/shelf-service';
import type { OutgoingEmail } from '../domain/entities';
import type { AuthVerifier } from '../domain/ports';
import type { DemoAuth } from '../infrastructure/auth';
import type { DeviceCookie } from '../infrastructure/crypto';
import type { DemoGateway } from '../infrastructure/payments';

/** Everything the routes need, already wired. Built by a composition root. */
export interface Container {
  config: AppConfig;
  auth: AuthVerifier;
  deviceCookie: DeviceCookie;
  secureCookies: boolean;
  converterSecret: string;
  catalogue: CatalogueService;
  account: AccountService;
  checkout: CheckoutService;
  reader: ReaderService;
  shelf: ShelfService;
  admin: AdminService;
  announcements: AnnouncementService;
  /** Present only in demo mode. */
  demo?: { auth: DemoAuth; gateway: DemoGateway; newId: () => string; outbox: () => OutgoingEmail[] };
}
