import type { AppConfig } from '../application/config';

/** Every variable the Worker reads. Mirrors section B of .env.example. */
export interface WorkerEnv {
  APP_ENV?: string;
  APP_URL?: string;
  ALLOWED_EMAIL_DOMAIN?: string;
  ADMIN_EMAILS?: string;
  CURRENT_INTAKE_YEAR?: string;
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
  SUPABASE_LEGACY_JWT_SECRET?: string;
  RAZORPAY_KEY_ID: string;
  RAZORPAY_KEY_SECRET: string;
  RAZORPAY_WEBHOOK_SECRET: string;
  VIEWER_TOKEN_SECRET: string;
  DEVICE_COOKIE_SECRET: string;
  TILE_SEED_SECRET: string;
  CONVERTER_CALLBACK_SECRET: string;
  CONVERTER_CALLBACK_URL?: string;
  MAX_DEVICES?: string;
  VIEWER_TOKEN_TTL_SECONDS?: string;
  PAGES_PER_MINUTE?: string;
  PAGES_PER_DAY?: string;
  IMPORT_ROOT?: string;
  BREVO_API_KEY?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  EMAIL_DAILY_LIMIT?: string;
  EMAIL_RESERVE?: string;
  NOTES: R2Bucket;
  PAGE_LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> };
  ASSETS?: Fetcher;
}

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== '' ? n : fallback;
};

const normaliseRoot = (r: string) => {
  const trimmed = r.replace(/^\/+/, '');
  return trimmed === '' || trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
};

/** Academic intake year: a new batch joins each July. */
export function intakeYear(now: Date): number {
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

export function buildConfig(env: Partial<Record<keyof WorkerEnv, unknown>>, now = new Date()): AppConfig {
  const s = (k: keyof WorkerEnv) => (typeof env[k] === 'string' ? (env[k] as string) : undefined);
  return {
    allowedDomain: s('ALLOWED_EMAIL_DOMAIN') ?? 'vitbhopal.ac.in',
    // Several admins: separate addresses with commas (spaces, semicolons or new lines also work).
    adminEmails: [
      ...new Set(
        (s('ADMIN_EMAILS') ?? '')
          .split(/[\s,;]+/)
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean),
      ),
    ],
    currentIntakeYear: num(s('CURRENT_INTAKE_YEAR'), intakeYear(now)),
    maxDevices: num(s('MAX_DEVICES'), 2),
    viewerTokenTtlSeconds: num(s('VIEWER_TOKEN_TTL_SECONDS'), 120),
    pagesPerDay: num(s('PAGES_PER_DAY'), 600),
    leaseSeconds: 150,
    importRoot: normaliseRoot(s('IMPORT_ROOT') ?? 'drive-imports/'),
    appUrl: (s('APP_URL') ?? 'http://localhost:5173').replace(/\/+$/, ''),
    emailDailyLimit: num(s('EMAIL_DAILY_LIMIT'), 250),
    // Room kept every day for receipts, answers and reminders, so news never crowds them out.
    emailReserve: Math.min(num(s('EMAIL_RESERVE'), 20), Math.floor(num(s('EMAIL_DAILY_LIMIT'), 250) / 2)),
  };
}

/** Fails fast at startup with a readable list instead of a confusing runtime error. */
export function assertWorkerEnv(env: Partial<WorkerEnv>): void {
  const required: (keyof WorkerEnv)[] = [
    'SUPABASE_URL',
    'SUPABASE_SECRET_KEY',
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
    'VIEWER_TOKEN_SECRET',
    'DEVICE_COOKIE_SECRET',
    'TILE_SEED_SECRET',
    'CONVERTER_CALLBACK_SECRET',
  ];
  const missing: string[] = required.filter((k) => !env[k]);
  if (!env.NOTES) missing.push('NOTES (R2 binding)');
  if (missing.length > 0) throw new Error(`Missing environment: ${missing.join(', ')}. See .env.example.`);
  // Secrets we sign or compare with must be long enough that they cannot be guessed.
  const weak = (
    ['VIEWER_TOKEN_SECRET', 'DEVICE_COOKIE_SECRET', 'TILE_SEED_SECRET', 'CONVERTER_CALLBACK_SECRET'] as const
  ).filter((k) => (env[k] ?? '').length < 32);
  if (weak.length > 0) throw new Error(`Secrets too short (need 32+ characters): ${weak.join(', ')}.`);
}
