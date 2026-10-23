import type { AppConfig } from '../application/config';
import type { Clock, IdGenerator } from '../domain/ports';
import type { Container } from '../http/container';
import { DemoAuth } from '../infrastructure/auth';
import { InstantConversionQueue, MemoryRateLimiter } from '../infrastructure/cloudflare';
import {
  DeviceCookie,
  HmacTileSeeder,
  HmacTokenSigner,
  RandomIds,
  SystemClock,
} from '../infrastructure/crypto';
import {
  MemoryAnnouncements,
  MemoryBundles,
  MemoryCatalogue,
  MemoryDb,
  MemoryDevices,
  MemoryFeatures,
  MemoryLeases,
  MemoryMailer,
  MemoryObjectStore,
  MemoryOrders,
  MemoryProfiles,
  MemoryQuota,
  MemoryReading,
  MemoryRecipients,
  MemorySessions,
} from '../infrastructure/memory';
import { DemoGateway } from '../infrastructure/payments';
import { buildConfig } from './config';
import { DEMO_IMPORT_ROOT, seedDemo } from './demo-seed';
import { buildServices } from './services';

export const DEMO_SECRETS = {
  jwt: 'demo-jwt-secret-not-for-production',
  viewer: 'demo-viewer-secret-not-for-production',
  device: 'demo-device-secret-not-for-production',
  tiles: 'demo-tile-secret-not-for-production',
  converter: 'demo-converter-secret',
  razorpayKey: 'demo-razorpay-key-secret',
  razorpayWebhook: 'demo-razorpay-webhook-secret',
};

export interface MemoryContainerOptions {
  seed?: boolean;
  clock?: Clock;
  ids?: IdGenerator;
  config?: Partial<AppConfig>;
  /** Produces page images on demand (demo renders + scrambles them). */
  pageProducer?: (key: string) => Promise<Uint8Array | null>;
}

/** Composition root for demo mode and tests: every port backed by memory. */
export function memoryContainer(options: MemoryContainerOptions = {}) {
  const clock = options.clock ?? new SystemClock();
  const ids = options.ids ?? new RandomIds();
  const config: AppConfig = {
    ...buildConfig({
      ADMIN_EMAILS: 'admin@vitbhopal.ac.in,librarian@vitbhopal.ac.in',
      CURRENT_INTAKE_YEAR: '2026',
      IMPORT_ROOT: DEMO_IMPORT_ROOT,
      APP_URL: 'http://localhost:5173',
      EMAIL_DAILY_LIMIT: '300',
    }),
    ...options.config,
  };
  const db = new MemoryDb(ids, clock);
  const sources = new MemoryObjectStore();
  const pages = new MemoryObjectStore(options.pageProducer);
  if (options.seed !== false) seedDemo(db, sources);

  const catalogue = new MemoryCatalogue(db);
  const orders = new MemoryOrders(db);
  const reading = new MemoryReading(db);
  const auth = new DemoAuth(DEMO_SECRETS.jwt, config.allowedDomain);
  const gateway = new DemoGateway(DEMO_SECRETS.razorpayKey, DEMO_SECRETS.razorpayWebhook);
  const seeder = new HmacTileSeeder(DEMO_SECRETS.tiles);

  // Demo "converter": every queued file becomes ready with a few generated pages.
  const queue = new InstantConversionQueue(async (jobs) => {
    for (const { fileId } of jobs) {
      const file = db.files.get(fileId);
      if (!file) continue;
      if (file.name.endsWith('.heic')) {
        await catalogue.applyConversion({
          fileId,
          status: 'failed',
          error: 'Unsupported image format',
          pages: [],
        });
        continue;
      }
      const count = 6;
      const pagesOut = await Promise.all(
        Array.from({ length: count }, async (_, i) => ({
          pageNo: i + 1,
          imageKey: `pages/${fileId}/${i + 1}.webp`,
          tileSeed: await seeder.seedFor(fileId, i + 1),
        })),
      );
      // Keep the in-memory adapter representative of R2: a ready report is
      // only valid when its page and preview objects have actually been stored.
      for (const page of pagesOut) {
        pages.put(page.imageKey, new Uint8Array([1, page.pageNo, 3]), 'image/webp');
      }
      pages.put(`pages/${fileId}/preview.webp`, new Uint8Array([1, 1, 3]), 'image/webp');
      await catalogue.applyConversion({
        fileId,
        status: 'ready',
        pages: pagesOut,
        previewKey: `pages/${fileId}/preview.webp`,
      });
    }
  });

  const mailer = new MemoryMailer(db);
  const services = buildServices(
    {
      catalogueReader: catalogue,
      catalogueWriter: catalogue,
      bundles: new MemoryBundles(db),
      features: new MemoryFeatures(db),
      announcements: new MemoryAnnouncements(db),
      recipients: new MemoryRecipients(db),
      mailer,
      emailQuota: new MemoryQuota(db),
      unsubscribeSigner: new HmacTokenSigner(`${DEMO_SECRETS.viewer}:unsubscribe`, clock),
      profiles: new MemoryProfiles(db),
      devices: new MemoryDevices(db),
      sessions: new MemorySessions(db),
      leases: new MemoryLeases(db),
      orders,
      entitlements: orders,
      progress: reading,
      accessLog: reading,
      sources,
      pages,
      queue,
      gateway,
      signer: new HmacTokenSigner(DEMO_SECRETS.viewer, clock),
      seeder,
      limiter: new MemoryRateLimiter(40, () => clock.now().getTime()),
      ids,
      clock,
    },
    config,
  );

  const container: Container = {
    config,
    auth,
    deviceCookie: new DeviceCookie(DEMO_SECRETS.device),
    secureCookies: false,
    converterSecret: DEMO_SECRETS.converter,
    ...services,
    demo: { auth, gateway, newId: () => ids.next(), outbox: () => db.outbox },
  };
  return { container, db, sources, pages, gateway, auth, seeder, mailer };
}
