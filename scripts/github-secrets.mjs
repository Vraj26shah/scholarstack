#!/usr/bin/env node
// Copies what GitHub Actions needs from your local .env into the repository's Actions
// secrets and variables, using the GitHub CLI (https://cli.github.com, then `gh auth login`).
//   pnpm github:secrets                → the repo of this folder's git remote
//   pnpm github:secrets -- owner/repo  → a specific repo
// Values go through stdin and are never printed.
import { spawnSync } from 'node:child_process';
import { readEnv } from './env-lib.mjs';

const repo = process.argv[2];
const env = readEnv('.env');
const site = env.get('APP_URL_PRODUCTION') ?? 'https://scholarstack.campusnotes.workers.dev';

/** Private values → Actions secrets. */
const SECRETS = [
  // deploy
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_SECRET_KEY',
  'ADMIN_EMAILS',
  // page converter
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
  'TILE_SEED_SECRET',
  'CONVERTER_CALLBACK_SECRET',
  // nightly backup (optional)
  'SUPABASE_DB_URL',
];
/** Public values → Actions variables (they end up in the website anyway). */
const VARIABLES = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_RAZORPAY_KEY_ID',
  'VITE_TURNSTILE_SITE_KEY',
];

const extra = { CONVERTER_CALLBACK_URL: `${site.replace(/\/+$/, '')}/api/internal/conversion` };
const repoArgs = repo ? ['--repo', repo] : [];

function gh(kind, name, value) {
  const r = spawnSync('gh', [kind, 'set', name, ...repoArgs], {
    input: value,
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  if (r.error?.code === 'ENOENT') {
    console.error(
      'The GitHub CLI is not installed. Get it from https://cli.github.com, run `gh auth login`, then try again.',
    );
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`✗ ${name}: ${r.stderr.toString().trim().split('\n')[0]}`);
    return false;
  }
  console.log(`✓ ${kind} ${name}`);
  return true;
}

let failed = 0;
const skipped = [];
for (const name of SECRETS) {
  const value = env.get(name);
  if (!value) skipped.push(name);
  else if (!gh('secret', name, value)) failed++;
}
if (!gh('secret', 'CONVERTER_CALLBACK_URL', extra.CONVERTER_CALLBACK_URL)) failed++;
for (const name of VARIABLES) {
  const value = env.get(name);
  if (!value) skipped.push(name);
  else if (!gh('variable', name, value)) failed++;
}
if (!gh('variable', 'SITE_URL', site)) failed++;
if (skipped.length) console.log(`Skipped (not in .env): ${skipped.join(', ')}`);
process.exit(failed ? 1 : 0);
