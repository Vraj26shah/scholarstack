/**
 * Scholars Stack operations, against the real Supabase project and R2 bucket in .env.
 *
 *   pnpm ops check                       every connection, and what is still missing
 *   pnpm ops db:apply                    run pending migrations + configure Auth (needs SUPABASE_ACCESS_TOKEN)
 *   pnpm ops db:bundle                   write supabase/apply-all.sql to paste into the SQL Editor
 *   pnpm ops import ["23 Batch"]         import every subject folder of a batch as draft courses
 *   pnpm ops convert [--limit N]         convert pending pages on this computer
 *   pnpm ops publish [--price 99]        publish drafts whose pages are all ready
 *   pnpm ops status                      courses, pages, previews and sales at a glance
 *   pnpm ops serve                       the real site on http://localhost:8787 against live data
 *   pnpm ops qa [--out file.json]        live QA: database, security, admin, purchase and reader
 *   pnpm ops broken > broken.csv         files whose R2 copy is a web page / empty: re-upload these
 *   pnpm ops admins:sync                 copy ADMIN_EMAILS into the database admin list (sign-up check)
 */
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import type { AdminCourseDto, ImportFolderDto } from '@ss/contracts';
import { BRANCH_CATALOG, isWellFormedEmail, normaliseEmail } from '@ss/contracts';
import { createClient } from '@supabase/supabase-js';
import { Hono } from 'hono';
import { type SupabaseEnv, supabaseCatalogue, supabaseContainer } from '../composition/supabase-container';
import { isVisible } from '../domain/entities';
import { createApp } from '../http/app';
import { SECURITY_HEADERS } from '../http/security-headers';
import { S3ObjectStore } from '../infrastructure/s3';
import { isPlaceholder, loadEnv } from './env';
import { LocalConversionQueue, LocalConverter } from './local-converter';
import { SupabaseManagement } from './management';
import { applyPending, bundleSql } from './migrator';
import { runQa, saveResults } from './qa';

const ROOT = resolve(import.meta.dirname, '../../../..');
const env = loadEnv();
const args = process.argv.slice(2);
const command = args[0] ?? 'help';
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? '') : undefined;
};
const positional = args.slice(1).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));

const ok = (s: string) => console.log(`  ✓ ${s}`);
const bad = (s: string) => console.log(`  ✗ ${s}`);
const warn = (s: string) => console.log(`  ! ${s}`);

function store() {
  return new S3ObjectStore({
    accountId: env.R2_ACCOUNT_ID!,
    accessKeyId: env.R2_ACCESS_KEY_ID!,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    bucket: env.R2_BUCKET || 'scholarstack',
  });
}
const projectRef = () =>
  env.SUPABASE_PROJECT_REF && !isPlaceholder(env.SUPABASE_PROJECT_REF)
    ? env.SUPABASE_PROJECT_REF
    : (/https:\/\/([a-z0-9]+)\.supabase\.co/.exec(env.SUPABASE_URL ?? '')?.[1] ?? '');

function management(): SupabaseManagement | null {
  if (isPlaceholder(env.SUPABASE_ACCESS_TOKEN)) return null;
  return new SupabaseManagement(env.SUPABASE_ACCESS_TOKEN!, projectRef());
}

/**
 * `inline`: convert queued files in this process (the local live server). Otherwise files just
 * stay "pending" until the local converter or deployed GitHub Actions poller picks them up.
 */
function container(inline = false) {
  const s = store();
  // Late-bound: the converter reports through the same AdminService checks as the HTTPS
  // callbacks, so local conversions update the admin progress bars live.
  let built: ReturnType<typeof supabaseContainer> | null = null;
  const converter = new LocalConverter(s, supabaseCatalogue(env as never), env.TILE_SEED_SECRET!, () =>
    built
      ? {
          report: (r) => built!.admin.applyConversion(r),
          progress: (p) => built!.admin.recordConversionProgress(p),
        }
      : null,
  );
  built = supabaseContainer(env as unknown as SupabaseEnv, {
    store: s,
    queue: inline ? new LocalConversionQueue(converter) : { enqueue: async () => {} },
  });
  return built;
}

// ── check ──

async function check() {
  console.log('\nConfiguration (.env)');
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SECRET_KEY',
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'VIEWER_TOKEN_SECRET',
    'DEVICE_COOKIE_SECRET',
    'TILE_SEED_SECRET',
    'CONVERTER_CALLBACK_SECRET',
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'ADMIN_EMAILS',
  ];
  for (const k of required)
    (isPlaceholder(env[k]) ? bad : ok)(`${k}${isPlaceholder(env[k]) ? ' — not set' : ''}`);
  for (const k of ['RAZORPAY_WEBHOOK_SECRET', 'BREVO_API_KEY', 'VITE_TURNSTILE_SITE_KEY'])
    (isPlaceholder(env[k]) ? warn : ok)(
      `${k}${isPlaceholder(env[k]) ? ' — not set (optional for now)' : ''}`,
    );
  if (/@(gmail|yahoo|outlook|hotmail)\./i.test(env.EMAIL_FROM ?? ''))
    warn(
      `EMAIL_FROM is a ${env.EMAIL_FROM?.split('@')[1]} address: announcements from it land in spam. Use an address on your own domain.`,
    );
  for (const k of ['SUPABASE_ACCESS_TOKEN', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'])
    (isPlaceholder(env[k]) ? warn : ok)(
      `${k}${isPlaceholder(env[k]) ? ' — not set (needed for db:apply / deploy)' : ''}`,
    );

  console.log('\nSupabase');
  const db = createClient(env.SUPABASE_URL!, env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const probe = await db.from('programmes').select('slug');
  if (probe.error)
    bad(
      `schema not applied yet (${probe.error.message}) → pnpm ops db:apply, or paste supabase/apply-all.sql`,
    );
  else {
    ok(`schema present: ${probe.data.length} programmes`);
    const courses = await db.from('courses').select('status');
    const by = (s: string) => (courses.data ?? []).filter((c) => c.status === s).length;
    ok(`${courses.data?.length ?? 0} courses (${by('live')} live, ${by('draft')} draft)`);
  }
  const jwks = await fetch(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`).then(
    (r) => r.ok,
    () => false,
  );
  (jwks ? ok : bad)('Auth signing keys reachable');
  const mgmt = management();
  if (mgmt) {
    try {
      const cfg = await mgmt.authConfig();
      (cfg.hook_before_user_created_enabled ? ok : warn)(
        `college-only sign-up hook ${cfg.hook_before_user_created_enabled ? 'on' : 'off → pnpm ops db:apply turns it on'}`,
      );
    } catch (e) {
      bad(`management API: ${(e as Error).message}`);
    }
  }

  console.log('\nR2');
  try {
    const objs = await store().list(env.IMPORT_ROOT || 'drive-imports/');
    const subjects = new Set(
      objs.filter((o) => o.key.split('/').length >= 4).map((o) => o.key.split('/').slice(0, 3).join('/')),
    );
    ok(
      `bucket "${env.R2_BUCKET}" readable: ${objs.length} files under ${env.IMPORT_ROOT}, ${subjects.size} subject folders`,
    );
    const pages = await store().list('pages/');
    ok(`${pages.length} converted page images in pages/`);
  } catch (e) {
    bad(`R2: ${(e as Error).message}`);
  }

  console.log('\nEmail (Brevo)');
  if (isPlaceholder(env.BREVO_API_KEY)) warn('no BREVO_API_KEY');
  else {
    const r = await fetch('https://api.brevo.com/v3/account', { headers: { 'api-key': env.BREVO_API_KEY! } });
    const body = (await r.json().catch(() => ({}))) as { code?: string; plan?: { type?: string }[] };
    if (r.ok) ok(`Brevo key works (plan: ${body.plan?.map((p) => p.type).join(', ') || 'unknown'})`);
    else if (body.code === 'permission_denied')
      ok('Brevo key is valid (restricted key: make sure "Transactional emails" is allowed for it)');
    else if (r.status === 401)
      bad(
        `Brevo rejected the key (${body.code ?? r.status}) — if it says "unrecognised IP", allow all IPs in Brevo → Security`,
      );
    else bad(`Brevo error ${r.status} ${body.code ?? ''}`);
  }

  console.log('\nPayments (Razorpay)');
  const mode = env.RAZORPAY_KEY_ID?.startsWith('rzp_live_') ? 'LIVE' : 'test';
  const rz = await fetch('https://api.razorpay.com/v1/orders?count=1', {
    headers: {
      authorization: `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}`,
    },
  }).then(
    (r) => r.status,
    () => 0,
  );
  (rz === 200 ? ok : bad)(`Razorpay ${mode} keys ${rz === 200 ? 'work' : `rejected (${rz})`}`);
  console.log('');
}

// ── database ──

async function dbApply() {
  const mgmt = management();
  if (!mgmt) {
    const out = bundleSql(join(ROOT, 'supabase/apply-all.sql'));
    console.log(
      `SUPABASE_ACCESS_TOKEN is not set, so I can't run SQL for you.\nPaste ${out} into Supabase → SQL Editor → Run, then run: pnpm ops check`,
    );
    process.exitCode = 1;
    return;
  }
  const { applied, skipped } = await applyPending(mgmt);
  console.log(`Migrations: ${applied.length} applied, ${skipped.length} already there.`);
  await configureAuth(mgmt);
  await mgmt.query("notify pgrst, 'reload schema';");
}

/** College-only gate, short access tokens and refresh-token rotation (SETUP.md step 3). */
async function configureAuth(mgmt: SupabaseManagement) {
  const steps: [string, Record<string, unknown>][] = [
    [
      'college-only sign-up hook',
      {
        hook_before_user_created_enabled: true,
        hook_before_user_created_uri: 'pg-functions://postgres/public/hook_vit_only',
      },
    ],
    ['1-hour access tokens', { jwt_exp: 3600 }],
    // A new address must click its emailed link (or come from Google) before it can sign in.
    ['confirm email before sign-in', { mailer_autoconfirm: false }],
    [
      'refresh-token rotation',
      { refresh_token_rotation_enabled: true, security_refresh_token_reuse_interval: 10 },
    ],
  ];
  if (!isPlaceholder(env.APP_URL) && !/localhost/.test(env.APP_URL ?? '')) {
    steps.push(['site URL', { site_url: env.APP_URL }]);
  }
  for (const [label, patch] of steps) {
    try {
      await mgmt.updateAuthConfig(patch);
      ok(label);
    } catch (e) {
      warn(`${label}: ${(e as Error).message.slice(0, 160)} — set it in the dashboard (SETUP.md step 3)`);
    }
  }
}

// ── import ──

function semesterFromCode(code: string | null): number {
  const level = Number(/[A-Z]{3}(\d)/.exec(code ?? '')?.[1]);
  return level >= 1 && level <= 4 ? level * 2 - 1 : 1;
}

async function importBatch() {
  const c = container();
  const tree = await c.admin.browse();
  const batchName = positional[0] ?? '23 Batch';
  const batch = tree.folders.find((f) => f.name === batchName);
  if (!batch)
    throw new Error(
      `No "${batchName}" folder under ${tree.root}. Found: ${tree.folders.map((f) => f.name).join(', ')}`,
    );
  const year = batch.suggested.batchYear;
  if (!year) throw new Error(`Can't tell the batch year from "${batchName}".`);
  const price = Math.round(Number(flag('price') ?? 99) * 100);
  const subjects = batch.children.filter((f: ImportFolderDto) => f.supportedCount > 0);
  // The programme curriculum is the source of truth. An unmapped folder must
  // never be cross-listed to every programme by default.
  const allSections = args.includes('--all-sections');
  const onlyCourse = flag('course')?.toUpperCase();
  const mappedSubjects = subjects.filter((f) => f.suggested.branchSlugs.length > 0);
  const unmappedSubjects = subjects.filter((f) => f.suggested.branchSlugs.length === 0);
  const fresh = mappedSubjects.filter((f) => !f.course);
  // Explicitly requested shared courses may already exist as drafts with no placements.
  const selected = onlyCourse
    ? subjects.filter((f) => f.suggested.courseCode?.toUpperCase() === onlyCourse)
    : allSections
      ? [...fresh, ...unmappedSubjects]
      : fresh;
  if (onlyCourse && selected.length === 0) throw new Error(`No folder found for course ${onlyCourse}.`);
  console.log(
    `${subjects.length} subject folders in ${batchName} (${fresh.length} new mapped, ${mappedSubjects.length - fresh.length} already imported, ${unmappedSubjects.length} unmapped${allSections ? '; including the unmapped folders in this import' : ''}).`,
  );
  if (unmappedSubjects.length)
    console.log(
      `  Unmapped folders left out of the public catalogue: ${unmappedSubjects.map((f) => f.name).join(', ')}`,
    );
  const inputs = selected.map((f) => ({
    prefix: f.prefix,
    title: f.suggested.title,
    courseCode: f.suggested.courseCode ?? '',
    description: '',
    batchYear: year,
    branchSlugs: allSections ? BRANCH_CATALOG.map((branch) => branch.slug) : f.suggested.branchSlugs,
    semester: f.suggested.semester ?? semesterFromCode(f.suggested.courseCode),
    pricePaise: price,
  }));
  if (args.includes('--dry')) {
    for (const i of inputs)
      console.log(`  ${i.courseCode.padEnd(8)} ${i.title} → sem ${i.semester}, ${i.branchSlugs.join('/')}`);
    return;
  }
  const result = inputs.length ? await c.admin.importFolders(inputs) : await c.admin.rescan();
  console.log(
    `Courses created: ${result.coursesCreated}, files added: ${result.filesAdded}, changed: ${result.filesChanged}, queued for pages: ${result.conversionQueued}`,
  );
  const hidden = result.skipped.filter((s) => s.includes('kept off the site'));
  const unsupported = result.skipped.filter((s) => !s.includes('kept off the site'));
  if (hidden.length)
    console.log(
      `\nKept off the site (reference books / textbooks): ${hidden.length}\n${hidden.map((s) => `  · ${s.replace(tree.root, '')}`).join('\n')}`,
    );
  if (unsupported.length)
    console.log(
      `\nSkipped (unsupported type): ${unsupported.length}\n${unsupported.map((s) => `  · ${s.replace(tree.root, '')}`).join('\n')}`,
    );
  console.log('\nNext: pnpm ops convert   (then pnpm ops publish)');
}

// ── convert ──

async function convert() {
  const catalogue = supabaseCatalogue(env as never);
  const s = store();
  const courses = (await catalogue.listAllCourses()).filter((c) => c.status !== 'archived');
  const only = flag('course');
  const chosen = only ? courses.filter((c) => c.slug === only || c.r2Prefix.includes(only)) : courses;
  const files = (await catalogue.listAllFiles(chosen.map((c) => c.id)))
    .filter(
      (f) =>
        isVisible(f) &&
        (f.conversionStatus === 'pending' || (args.includes('--retry') && f.conversionStatus === 'failed')),
    )
    // Page-one previews first: the first file of every unit, then everything else; small before big.
    .map((f, _i, all) => ({
      f,
      lead: !all.some((g) => g.courseId === f.courseId && g.unitKey === f.unitKey && g.sort < f.sort),
    }))
    .sort((a, b) => Number(b.lead) - Number(a.lead) || a.f.sizeBytes - b.f.sizeBytes)
    .map((x) => x.f);
  const limit = Number(flag('limit') ?? files.length);
  const jobs = files.slice(0, limit).map((f) => ({ fileId: f.id, sourceKey: f.sourceKey }));
  const mb = files.slice(0, limit).reduce((n, f) => n + f.sizeBytes, 0) / 1e6;
  console.log(
    `Converting ${jobs.length} of ${files.length} pending files (${mb.toFixed(0)} MB), smallest first…`,
  );
  const started = Date.now();
  const res = await new LocalConverter(s, catalogue, env.TILE_SEED_SECRET!).run(
    jobs,
    (job, r, i) => {
      const name = job.sourceKey.slice((env.IMPORT_ROOT ?? '').length);
      console.log(
        `[${i + 1}/${jobs.length}] ${r.status === 'ready' ? '✓' : '✗'} ${name} → ${r.pages.length} pages${r.error ? ` (${r.error})` : ''}`,
      );
    },
    Number(flag('concurrency') ?? 2),
  );
  console.log(
    `\nDone in ${Math.round((Date.now() - started) / 1000)}s: ${res.ready} ready, ${res.failed} failed.`,
  );
}

// ── publish ──

async function publish() {
  const c = container();
  const price = flag('price');
  const only = flag('course')
    ?.split(',')
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
  const chosen = (await c.admin.listCourses()).filter(
    (x) =>
      x.status === 'draft' &&
      (!only ||
        only.some((code) => x.courseCode?.toUpperCase() === code || x.r2Prefix.toUpperCase().includes(code))),
  );
  const drafts = chosen.filter((x) => x.branchSlugs.length > 0);
  for (const course of chosen.filter((x) => x.branchSlugs.length === 0)) {
    console.log(`  … ${course.title}: no programme mapping`);
  }
  let n = 0;
  for (const d of drafts) {
    if (d.fileCount === 0 || d.pendingFiles > 0 || d.failedFiles > 0) {
      console.log(
        `  … ${d.title}: ${d.fileCount === 0 ? 'no visible files' : `${d.pendingFiles} pending, ${d.failedFiles} failed`}`,
      );
      continue;
    }
    await c.admin.updateCourse(d.id, {
      status: 'live',
      branchSlugs: d.branchSlugs,
      ...(price ? { pricePaise: Math.round(Number(price) * 100) } : {}),
    });
    console.log(`  ✓ ${d.title} is live at ₹${price ?? d.pricePaise / 100}`);
    n++;
  }
  console.log(`${n} published.`);
}

/** Align imported courses to the curriculum and publish only mapped, ready courses. */
async function syncCurriculum() {
  const c = container();
  const courses = await c.admin.listCourses();
  const changes: { course: AdminCourseDto; next: AdminCourseDto['status'] }[] = courses.map((course) => ({
    course,
    next:
      course.branchSlugs.length > 0
        ? course.status === 'live' ||
          (course.fileCount > 0 && course.pendingFiles === 0 && course.failedFiles === 0)
          ? 'live'
          : course.status
        : course.status === 'live'
          ? 'draft'
          : course.status,
  }));
  const actionable = changes.filter(
    ({ course, next }) => next !== course.status || (course.branchSlugs.length > 0 && next === 'live'),
  );
  console.log(`Curriculum sync: ${actionable.length} courses to reconcile (${courses.length} total).`);
  for (const { course, next } of actionable) {
    if (args.includes('--dry')) {
      console.log(
        `  ${course.courseCode ?? '(no code)'} ${course.status} → ${next}; ${course.branchSlugs.join('/') || '(unmapped)'}`,
      );
      continue;
    }
    await c.admin.updateCourse(course.id, {
      status: next,
      ...(course.branchSlugs.length > 0 ? { branchSlugs: course.branchSlugs } : {}),
    });
    console.log(
      `  ✓ ${course.courseCode ?? course.title}: ${next}; ${course.branchSlugs.join('/') || 'unmapped'}`,
    );
  }
}

// ── status ──

async function status() {
  const db = createClient(env.SUPABASE_URL!, env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const rows = (await db.from('course_overview').select('*').order('batch_year').order('title')).data ?? [];
  console.log(
    `${'COURSE'.padEnd(52)} ${'STATUS'.padEnd(8)} FILES  PAGES  PREVIEWS  PENDING  HIDDEN  BUYERS  PROGRAMMES`,
  );
  for (const r of rows) {
    console.log(
      `${`${r.subject_code ?? ''} ${r.title}`.slice(0, 52).padEnd(52)} ${String(r.status).padEnd(8)} ${String(r.visible_files).padStart(5)}  ${String(r.pages).padStart(5)}  ${String(r.previews).padStart(8)}  ${String(r.pending_files).padStart(7)}  ${String(r.hidden_units).padStart(6)}  ${String(r.buyers).padStart(6)}  ${Array.isArray(r.programmes) ? r.programmes.join(',') : ''}`,
    );
  }
  const sales = (await db.from('sales_daily').select('*')).data ?? [];
  const revenue = sales.reduce((n, s) => n + Number(s.revenue_paise), 0);
  console.log(
    `\n${rows.length} courses · ${sales.reduce((n, s) => n + Number(s.orders), 0)} paid orders · ₹${revenue / 100}`,
  );
}

// ── serve ──

function serveLive() {
  const c = container(true);
  const root = new Hono();
  root.route(
    '/',
    createApp(() => c),
  );
  const webDist = resolve(ROOT, process.env.WEB_DIST ?? 'apps/web/dist');
  if (existsSync(webDist)) {
    const types: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
      '.json': 'application/json',
      '.woff2': 'font/woff2',
      '.webmanifest': 'application/manifest+json',
    };
    root.get('*', (ctx) => {
      const path = decodeURIComponent(new URL(ctx.req.url).pathname);
      const candidate = join(webDist, path);
      const file =
        candidate.startsWith(webDist) && existsSync(candidate) && extname(candidate)
          ? candidate
          : join(webDist, 'index.html');
      return new Response(readFileSync(file), {
        headers: { ...SECURITY_HEADERS, 'content-type': types[extname(file)] ?? 'application/octet-stream' },
      });
    });
  }
  const port = Number(process.env.PORT ?? 8787);
  serve({ fetch: root.fetch, port }, () => {
    console.log(`Scholars Stack (live data) on http://localhost:${port}`);
    console.log(
      existsSync(webDist)
        ? `Website from ${webDist}`
        : 'API only: run pnpm --filter @ss/web build for the site',
    );
  });
}

async function qa() {
  const results = await runQa(
    env,
    (adminEmails) =>
      supabaseContainer({ ...env, ADMIN_EMAILS: adminEmails } as unknown as SupabaseEnv, {
        store: store(),
        queue: { enqueue: async () => {} },
      }),
    store(),
  );
  if (saveResults(results, flag('out'))) process.exitCode = 1;
}

/** Files whose R2 copy can't be converted (e.g. a Google sign-in page saved as a PDF). */
async function broken() {
  const catalogue = supabaseCatalogue(env as never);
  const courses = await catalogue.listAllCourses();
  const files = (await catalogue.listAllFiles(courses.map((c) => c.id))).filter((f) =>
    f.conversionError?.startsWith('Broken source:'),
  );
  const title = new Map(courses.map((c) => [c.id, c.title]));
  console.log('Course,Folder,File,R2 key,Problem');
  for (const f of files.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey))) {
    const cells = [
      title.get(f.courseId) ?? '',
      f.unitTitle,
      f.name,
      f.sourceKey,
      f.conversionError!.replace('Broken source: ', ''),
    ];
    console.log(cells.map((v) => `"${v.replace(/"/g, '""')}"`).join(','));
  }
  console.error(
    `\n${files.length} files need a fresh copy in R2. Upload over the same name, then: pnpm ops import "23 Batch" && pnpm ops convert`,
  );
}

// ── admins ──

/**
 * Make the database admin list match ADMIN_EMAILS. The live site reads admins from this list
 * (within a minute), and so does the sign-up check, so this is all a change needs. Addresses
 * added by hand in the database (source = 'manual') are left alone.
 */
async function adminsSync() {
  const list = [
    ...new Set(
      (env.ADMIN_EMAILS ?? '')
        .split(/[\s,;]+/)
        .map(normaliseEmail)
        .filter(Boolean),
    ),
  ];
  const bad = list.filter((e) => !isWellFormedEmail(e));
  if (bad.length) throw new Error(`ADMIN_EMAILS has addresses that are not valid: ${bad.join(', ')}`);
  if (list.length === 0) throw new Error('ADMIN_EMAILS is empty: add at least one admin before syncing.');
  const db = createClient(env.SUPABASE_URL!, env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
  const up = await db.from('admin_emails').upsert(
    list.map((email) => ({ email, source: 'github' })),
    { onConflict: 'email' },
  );
  if (up.error)
    throw new Error(`Could not update the admin list: ${up.error.message} (run pnpm ops db:apply first)`);
  const gone = await db
    .from('admin_emails')
    .delete()
    .eq('source', 'github')
    .not('email', 'in', `(${list.map((e) => `"${e}"`).join(',')})`)
    .select('email');
  if (gone.error) throw new Error(`Could not remove old admins: ${gone.error.message}`);
  console.log('\nAdmin list');
  for (const e of list) ok(e);
  for (const r of gone.data ?? []) warn(`removed ${r.email}`);
}

const commands: Record<string, () => Promise<void> | void> = {
  'admins:sync': adminsSync,
  broken,
  qa,
  check,
  'db:apply': dbApply,
  'db:bundle': () => console.log(`Wrote ${bundleSql(join(ROOT, 'supabase/apply-all.sql'))}`),
  import: importBatch,
  convert,
  publish,
  'curriculum:sync': syncCurriculum,
  status,
  serve: serveLive,
};

const run = commands[command];
if (!run) {
  console.log(
    readFileSync(import.meta.filename, 'utf8')
      .split('*/')[0]!
      .replace(/^\/\*\*|^ \* ?/gm, ''),
  );
} else {
  Promise.resolve(run()).catch((e) => {
    console.error(`\n✗ ${(e as Error).message}`);
    process.exit(1);
  });
}
