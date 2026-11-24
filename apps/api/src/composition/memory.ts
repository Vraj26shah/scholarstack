import type { ConversionProgressReport } from '@ss/contracts';
import { DEMO_DHABA_EXTRAS, SEED_MESSES } from '../application/campus-seed';
import type { AppConfig } from '../application/config';
import type { Clock, ConversionJob, IdGenerator } from '../domain/ports';
import type { Container } from '../http/container';
import { DemoAuth } from '../infrastructure/auth';
import {
  MemoryChatReports,
  MemoryLiveSignal,
  MemoryMessBlocks,
  MemoryMessOrders,
  MemoryMessReports,
  MemoryMesses,
  MemoryOrderChat,
  MemoryPush,
} from '../infrastructure/campus-memory';
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
  MemoryContributions,
  MemoryCourseBooks,
  MemoryDb,
  MemoryDevices,
  MemoryDiscounts,
  MemoryFeatures,
  MemoryHousekeeping,
  MemoryInsights,
  MemoryLeases,
  MemoryMailer,
  MemoryObjectStore,
  MemoryOffers,
  MemoryOrders,
  MemoryProblems,
  MemoryProfiles,
  MemoryPromoCodes,
  MemoryQuota,
  MemoryReading,
  MemoryRecipients,
  MemorySessions,
  MemorySettings,
} from '../infrastructure/memory';
import {
  MemoryAcademic,
  MemoryAdmins,
  MemoryCourseUpdates,
  MemoryDeliveries,
  MemoryEarnings,
  MemoryPeople,
  MemorySignInStrikes,
  MemorySupport,
} from '../infrastructure/memory-ledgers';
import { DemoGateway } from '../infrastructure/payments';
import { MemoryPushSender } from '../infrastructure/web-push';
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
  /**
   * Demo only: when set, queued files convert in the background one at a time, walking the
   * real stages with per-page progress (ms per page), so the admin progress bars can be seen.
   */
  conversionPageMs?: number;
  seed?: boolean;
  clock?: Clock;
  ids?: IdGenerator;
  config?: Partial<AppConfig>;
  /** Produces page images on demand (demo renders + scrambles them). */
  pageProducer?: (key: string) => Promise<Uint8Array | null>;
}

/** Composition root for demo mode and tests: every port backed by memory. */
/** Demo only (its private half is not kept anywhere): lets the demo site's browser subscribe. */
const DEMO_VAPID_PUBLIC_KEY =
  'BICNDUiEPxTD88UiCkrCpmmEhr7eMk5H65dTe2wF4edmb_EQz7ec0WQ4FmZ5vB1PAkAPWqNpnoleWqq3praHimE';

export function memoryContainer(options: MemoryContainerOptions = {}) {
  const clock = options.clock ?? new SystemClock();
  const ids = options.ids ?? new RandomIds();
  const config: AppConfig = {
    ...buildConfig({
      ADMIN_EMAILS:
        'admin@vitbhopal.ac.in,librarian@vitbhopal.ac.in,reviewer@vitbhopal.ac.in,keeper@vitbhopal.ac.in,registrar@vitbhopal.ac.in,planner@vitbhopal.ac.in,owner.demo@gmail.com',
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
  if (options.seed !== false) seedDemo(db, sources, pages);
  const messOrders = new MemoryMessOrders(() => clock.now());
  const campus = {
    messes: new MemoryMesses(() => clock.now()),
    messReports: new MemoryMessReports(() => clock.now()),
    messOrders,
    orderChat: new MemoryOrderChat(messOrders, () => clock.now()),
    messBlocks: new MemoryMessBlocks(() => clock.now()),
    chatReports: new MemoryChatReports(() => clock.now()),
    live: new MemoryLiveSignal(),
    push: new MemoryPush(() => clock.now()),
    // A real (demo-only) key, so a browser on the demo site can subscribe; nothing is sent.
    pushSender: new MemoryPushSender(DEMO_VAPID_PUBLIC_KEY),
  };
  if (options.seed !== false)
    SEED_MESSES.forEach((m, sort) => {
      const row = { ...structuredClone(m), sort, updatedAt: clock.now() };
      // The demo gets a sample à la carte list (not in the live seed: no invented prices there).
      if (m.kind === 'restaurant') {
        row.order = [...row.order, ...structuredClone(DEMO_DHABA_EXTRAS)];
        // A demo owner (sign in as dhaba.demo@gmail.com) and orders switched on, to try it end to end.
        row.ownerEmails = ['dhaba.demo@gmail.com'];
        row.ordersOpen = true;
      }
      campus.messes.rows.set(m.slug, row);
    });

  const catalogue = new MemoryCatalogue(db);
  const orders = new MemoryOrders(db);
  const reading = new MemoryReading(db);
  const auth = new DemoAuth(DEMO_SECRETS.jwt, config.allowedDomain);
  const gateway = new DemoGateway(DEMO_SECRETS.razorpayKey, DEMO_SECRETS.razorpayWebhook);
  const seeder = new HmacTileSeeder(DEMO_SECRETS.tiles);

  // Demo "converter": every queued file becomes ready with generated pages.
  const convertOne = async (job: ConversionJob) => {
    const { fileId } = job;
    const file = db.files.get(fileId);
    if (!file) return;
    const pace = options.conversionPageMs ?? 0;
    const step = async (stage: ConversionProgressReport['stage'], current = 0, total = 0, wait = pace) => {
      if (!pace || !job.queueId) return;
      const live = db.files.get(fileId);
      if (live?.conversionQueueId && live.conversionQueueId !== job.queueId) return;
      await catalogue.updateConversionProgress({
        fileId,
        queueId: job.queueId,
        queuePosition: job.queuePosition ?? 1,
        queueTotal: job.queueTotal ?? 1,
        stage,
        current,
        total,
      });
      await new Promise((resolve) => setTimeout(resolve, wait));
    };
    if (file.name.endsWith('.heic')) {
      await step('downloading_source');
      await step('validating_source');
      await catalogue.applyConversion({
        fileId,
        ...(job.queueId ? { queueId: job.queueId } : {}),
        status: 'failed',
        error: 'Unsupported image format',
        errorStage: 'validating_source',
        pages: [],
      });
      return;
    }
    const count = pace ? Math.max(4, Math.min(file.pageCount || 12, 40)) : 6;
    await step('downloading_source', 0, 0, pace * 3);
    await step('validating_source');
    await step('rendering_pages', 0, count, pace * 2);
    await step('clearing_previous_pages');
    await step('writing_preview', 1, 1);
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
      await step('writing_pages', page.pageNo, count);
    }
    pages.put(`pages/${fileId}/preview.webp`, new Uint8Array([1, 1, 3]), 'image/webp');
    await step('verifying_r2', count + 1, count + 1);
    await step('saving_manifest', 1, 1);
    await catalogue.applyConversion({
      fileId,
      ...(job.queueId ? { queueId: job.queueId } : {}),
      status: 'ready',
      pages: pagesOut,
      previewKey: `pages/${fileId}/preview.webp`,
    });
  };
  let backlog: Promise<unknown> = Promise.resolve();
  const queue = new InstantConversionQueue(async (jobs) => {
    if (!options.conversionPageMs) {
      for (const job of jobs) await convertOne(job);
      return;
    }
    // Like the real worker: return at once, convert one file at a time in the background.
    backlog = backlog
      .then(async () => {
        for (const job of jobs) await convertOne(job);
      })
      .catch((error) => console.error('demo conversion error', error));
  });

  const mailer = new MemoryMailer(db);
  const services = buildServices(
    {
      catalogueReader: catalogue,
      catalogueWriter: catalogue,
      bundles: new MemoryBundles(db),
      offers: new MemoryOffers(db),
      promoCodes: new MemoryPromoCodes(db),
      discounts: new MemoryDiscounts(db),
      insights: new MemoryInsights(db),
      features: new MemoryFeatures(db),
      announcements: new MemoryAnnouncements(db),
      recipients: new MemoryRecipients(db),
      mailer,
      emailQuota: new MemoryQuota(db),
      problems: new MemoryProblems(db),
      contributions: new MemoryContributions(db),
      settings: new MemorySettings(db),
      earnings: new MemoryEarnings(db),
      deliveries: new MemoryDeliveries(db),
      books: new MemoryCourseBooks(db),
      ...campus,
      courseUpdates: new MemoryCourseUpdates(db),
      signInStrikes: new MemorySignInStrikes(() => clock.now().getTime()),
      admins: new MemoryAdmins(db),
      academic: new MemoryAcademic(db),
      people: new MemoryPeople(db),
      support: new MemorySupport(db),
      uploads: sources,
      housekeeping: new MemoryHousekeeping(db),
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
  auth.allowAdmins((email) => container.outsideAllowed(email));
  return { container, db, sources, pages, gateway, auth, seeder, mailer, campus };
}
