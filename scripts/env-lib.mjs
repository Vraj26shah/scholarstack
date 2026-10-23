// Tiny .env parser shared by env-sync and secrets-push (no dependencies).
import { readFileSync } from 'node:fs';

export function parseEnv(text) {
  const out = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    out.set(key, value);
  }
  return out;
}

export function readEnv(path = '.env') {
  try {
    return parseEnv(readFileSync(path, 'utf8'));
  } catch {
    console.error(`No ${path} found. Run: cp .env.example .env  and fill it in (see SETUP.md).`);
    process.exit(1);
  }
}

/** Keys that belong to the Worker (section B). */
export const WORKER_KEYS = [
  'APP_ENV',
  'APP_URL',
  'IMPORT_ROOT',
  'BREVO_API_KEY',
  'EMAIL_FROM',
  'EMAIL_FROM_NAME',
  'EMAIL_DAILY_LIMIT',
  'ALLOWED_EMAIL_DOMAIN',
  'ADMIN_EMAILS',
  'CURRENT_INTAKE_YEAR',
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_LEGACY_JWT_SECRET',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'VIEWER_TOKEN_SECRET',
  'DEVICE_COOKIE_SECRET',
  'TILE_SEED_SECRET',
  'CONVERTER_CALLBACK_SECRET',
  'CONVERTER_CALLBACK_URL',
  'MAX_DEVICES',
  'DEVICE_SWAP_COOLDOWN_DAYS',
  'VIEWER_TOKEN_TTL_SECONDS',
  'PAGES_PER_MINUTE',
  'PAGES_PER_DAY',
];

/** Worker keys pushed with `wrangler secret put`; config-bound vars stay in wrangler.jsonc. */
export const WORKER_SECRETS = [
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_LEGACY_JWT_SECRET',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'VIEWER_TOKEN_SECRET',
  'DEVICE_COOKIE_SECRET',
  'TILE_SEED_SECRET',
  'CONVERTER_CALLBACK_SECRET',
  'CONVERTER_CALLBACK_URL',
  'ADMIN_EMAILS',
  'CURRENT_INTAKE_YEAR',
  'APP_URL',
  'BREVO_API_KEY',
  'EMAIL_FROM',
  'EMAIL_FROM_NAME',
];

export const PLACEHOLDER = /x{6,}|YOUR-PROJECT-REF|choose-a-long-random-string|you@|your-domain\.in/;
