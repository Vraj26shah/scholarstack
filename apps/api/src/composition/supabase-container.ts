import type { ConversionQueue, ObjectStore, RateLimiter, UploadStore } from '../domain/ports';
import type { Container } from '../http/container';
import { SupabaseJwtVerifier } from '../infrastructure/auth';
import { MemoryRateLimiter } from '../infrastructure/cloudflare';
import {
  DeviceCookie,
  HmacTileSeeder,
  HmacTokenSigner,
  RandomIds,
  SystemClock,
} from '../infrastructure/crypto';
import { BrevoMailer, NoMailer } from '../infrastructure/mail';
import { RazorpayGateway } from '../infrastructure/payments';
import {
  SupabaseAnnouncements,
  SupabaseBundles,
  SupabaseCatalogue,
  SupabaseContributions,
  SupabaseDevices,
  SupabaseFeatures,
  SupabaseHousekeeping,
  SupabaseLeases,
  SupabaseOrders,
  SupabaseProblems,
  SupabaseProfiles,
  SupabaseQuota,
  SupabaseReading,
  SupabaseRecipients,
  SupabaseSessions,
  SupabaseSettings,
  supabaseClient,
} from '../infrastructure/supabase';
import {
  SupabaseAcademic,
  SupabaseAdmins,
  SupabaseCourseUpdates,
  SupabaseDeliveries,
  SupabaseEarnings,
  SupabasePeople,
  SupabaseSignInStrikes,
  SupabaseSupport,
} from '../infrastructure/supabase-ledgers';
import { type WorkerEnv, buildConfig } from './config';
import { buildServices } from './services';

/** What differs between the Cloudflare Worker and Node: where files live and how pages get converted. */
export interface RuntimeAdapters {
  /** The R2 bucket: read by the catalogue, written for student uploads. */
  store: ObjectStore & UploadStore;
  queue: ConversionQueue;
  limiter?: RateLimiter;
}

export type SupabaseEnv = Omit<WorkerEnv, 'NOTES' | 'PAGE_LIMITER' | 'ASSETS'>;

/** Supabase + Razorpay + Brevo wiring shared by the Worker and the local live server. */
export function supabaseContainer(env: SupabaseEnv, runtime: RuntimeAdapters): Container {
  const config = buildConfig(env as never);
  const clock = new SystemClock();
  const db = supabaseClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
  const catalogue = new SupabaseCatalogue(db);
  const orders = new SupabaseOrders(db);
  const reading = new SupabaseReading(db);
  const services = buildServices(
    {
      catalogueReader: catalogue,
      catalogueWriter: catalogue,
      bundles: new SupabaseBundles(db),
      features: new SupabaseFeatures(db),
      announcements: new SupabaseAnnouncements(db),
      recipients: new SupabaseRecipients(db),
      mailer: env.BREVO_API_KEY
        ? new BrevoMailer(env.BREVO_API_KEY, {
            email: env.EMAIL_FROM ?? 'hello@example.com',
            name: env.EMAIL_FROM_NAME ?? 'Scholars Stack',
          })
        : new NoMailer(),
      emailQuota: new SupabaseQuota(db),
      problems: new SupabaseProblems(db),
      contributions: new SupabaseContributions(db),
      settings: new SupabaseSettings(db),
      earnings: new SupabaseEarnings(db),
      deliveries: new SupabaseDeliveries(db),
      courseUpdates: new SupabaseCourseUpdates(db),
      signInStrikes: new SupabaseSignInStrikes(db),
      admins: new SupabaseAdmins(db),
      academic: new SupabaseAcademic(db),
      people: new SupabasePeople(db),
      support: new SupabaseSupport(db),
      uploads: runtime.store,
      housekeeping: new SupabaseHousekeeping(db),
      unsubscribeSigner: new HmacTokenSigner(`${env.VIEWER_TOKEN_SECRET}:unsubscribe`, clock),
      profiles: new SupabaseProfiles(db),
      devices: new SupabaseDevices(db),
      sessions: new SupabaseSessions(db),
      leases: new SupabaseLeases(db),
      orders,
      entitlements: orders,
      progress: reading,
      accessLog: reading,
      sources: runtime.store,
      pages: runtime.store,
      queue: runtime.queue,
      gateway: new RazorpayGateway(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET, env.RAZORPAY_WEBHOOK_SECRET),
      signer: new HmacTokenSigner(env.VIEWER_TOKEN_SECRET, clock),
      seeder: new HmacTileSeeder(env.TILE_SEED_SECRET),
      limiter: runtime.limiter ?? new MemoryRateLimiter(Number(env.PAGES_PER_MINUTE ?? 40)),
      ids: new RandomIds(),
      clock,
    },
    config,
  );
  return {
    config,
    auth: new SupabaseJwtVerifier(
      env.SUPABASE_URL,
      env.SUPABASE_LEGACY_JWT_SECRET ?? '',
      config.allowedDomain,
      (email) => services.admins.isAdmin(email),
    ),
    deviceCookie: new DeviceCookie(env.DEVICE_COOKIE_SECRET),
    secureCookies: env.APP_ENV !== 'development',
    converterSecret: env.CONVERTER_CALLBACK_SECRET,
    ...services,
  };
}

/** The catalogue adapter on its own (ops CLI, local converter). */
export function supabaseCatalogue(env: Pick<SupabaseEnv, 'SUPABASE_URL' | 'SUPABASE_SECRET_KEY'>) {
  return new SupabaseCatalogue(supabaseClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY));
}
