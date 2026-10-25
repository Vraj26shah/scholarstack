#!/usr/bin/env node
// Pushes the Worker's secrets from your local .env to Cloudflare with `wrangler secret put`.
//   pnpm secrets:push              → production
//   pnpm secrets:push -- staging   → staging
// Values are piped through stdin, never printed or passed on the command line.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PLACEHOLDER, WORKER_SECRETS, readEnv } from './env-lib.mjs';

const target = process.argv[2] ?? 'production';
if (!['production', 'staging'].includes(target)) {
  console.error('Usage: pnpm secrets:push [-- production|staging]');
  process.exit(1);
}
const env = readEnv(process.argv[3] ?? '.env');
const environmentKey = target.toUpperCase();
const appUrl = env.get(`APP_URL_${environmentKey}`) ?? env.get('APP_URL');
let parsedAppUrl;
try {
  parsedAppUrl = new URL(appUrl ?? '');
} catch {
  parsedAppUrl = null;
}
if (
  !parsedAppUrl ||
  parsedAppUrl.protocol !== 'https:' ||
  /^(localhost|127\.0\.0\.1)$/.test(parsedAppUrl.hostname)
) {
  console.error(
    `Set APP_URL_${environmentKey} (or APP_URL) to the deployed https site URL before pushing ${target} secrets.`,
  );
  process.exit(1);
}
const callbackUrl =
  env.get(`CONVERTER_CALLBACK_URL_${environmentKey}`) ?? `${parsedAppUrl.origin}/api/internal/conversion`;
let parsedCallbackUrl;
try {
  parsedCallbackUrl = new URL(callbackUrl);
} catch {
  parsedCallbackUrl = null;
}
if (
  !parsedCallbackUrl ||
  parsedCallbackUrl.protocol !== 'https:' ||
  /^(localhost|127\.0\.0\.1)$/.test(parsedCallbackUrl.hostname)
) {
  console.error(
    `Set CONVERTER_CALLBACK_URL_${environmentKey} to the deployed https callback URL before pushing ${target} secrets.`,
  );
  process.exit(1);
}
let pushed = 0;
const skipped = [];
for (const key of WORKER_SECRETS) {
  // Keep the local auth callback on localhost while giving each deployed environment
  // its real public origin for payment returns and server-generated links.
  const value = key === 'APP_URL' ? appUrl : key === 'CONVERTER_CALLBACK_URL' ? callbackUrl : env.get(key);
  if (!value || PLACEHOLDER.test(value)) {
    skipped.push(key);
    continue;
  }
  const r = spawnSync(
    process.execPath,
    [resolve('apps/api/node_modules/wrangler/bin/wrangler.js'), 'secret', 'put', key, '--env', target],
    {
      cwd: 'apps/api',
      input: value,
      stdio: ['pipe', 'ignore', 'inherit'],
    },
  );
  if (r.status !== 0) {
    console.error(`✗ ${key} failed. Are you logged in? Run: pnpm --filter @ss/api exec wrangler login`);
    process.exit(1);
  }
  console.log(`✓ ${key}`);
  pushed++;
}
console.log(`\nPushed ${pushed} secrets to ${target}.`);
if (skipped.length) console.log(`Skipped (empty/placeholder): ${skipped.join(', ')}`);
