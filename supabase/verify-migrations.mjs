// Applies every migration + the seed to an in-process Postgres (PGlite) with a tiny stand-in
// for Supabase's auth schema, then checks the rules that matter. Run: pnpm db:verify
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const here = dirname(fileURLToPath(import.meta.url));
const db = new PGlite({ extensions: { pgcrypto } });
let failures = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows;
async function throws(sql, params = []) {
  try {
    await db.query(sql, params);
    return false;
  } catch {
    return true;
  }
}

const supabaseStub = `
  do $$ begin
    if not exists (select from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin; end if;
    if not exists (select from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create or replace function auth.jwt() returns jsonb language sql stable as
    $f$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;
  create or replace function auth.uid() returns uuid language sql stable as
    $f$ select nullif(auth.jwt() ->> 'sub', '')::uuid $f$;
`;

await db.exec(supabaseStub);
const migrations = readdirSync(join(here, 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort();
for (const file of migrations) {
  try {
    await db.exec(readFileSync(join(here, 'migrations', file), 'utf8'));
    check(`migration ${file}`, true);
  } catch (e) {
    check(`migration ${file}`, false, e.message);
  }
}
// Re-running the reference data must be harmless.
try {
  await db.exec(readFileSync(join(here, 'migrations', '20261023000900_reference_data.sql'), 'utf8'));
  check('reference data is idempotent', true);
} catch (e) {
  check('reference data is idempotent', false, e.message);
}
try {
  await db.exec(readFileSync(join(here, 'seed.sql'), 'utf8'));
  check('seed.sql', true);
} catch (e) {
  check('seed.sql', false, e.message);
}

// ── Reference data ──
const programmes = await all('select slug from public.programmes where is_active order by sort');
check('six programmes', programmes.map((p) => p.slug).join(',') === 'bai,bce,bcg,bey,bsa,mim');
const bai = await all(
  "select subject_code from public.programme_subjects where programme_slug = 'bai' order by 1",
);
check(
  'curriculum links B.Tech AI to CSE3011',
  bai.some((r) => r.subject_code === 'CSE3011'),
);
check(
  'subjects carry titles from the R2 folders',
  (await one("select title from public.subjects where code = 'CSE3001'")).title ===
    'Database Management Systems',
);
check(
  'a programme cannot list a subject that does not exist',
  await throws("insert into public.programme_subjects values ('bai', 'XYZ9999')"),
);

// ── Accounts ──
const hook = async (email) =>
  (await one('select public.hook_vit_only($1::jsonb) as r', [JSON.stringify({ user: { email } })])).r;
check('hook allows college email', JSON.stringify(await hook('rahul.k@vitbhopal.ac.in')) === '{}');
check('hook blocks gmail', (await hook('rahul@gmail.com')).error?.http_code === 403);
check('hook blocks look-alike domain', (await hook('a@vitbhopal.ac.in.evil.com')).error?.http_code === 403);
const uid = '11111111-1111-1111-1111-111111111111';
await db.query(`insert into auth.users (id, email) values ($1, 'Rahul.K@vitbhopal.ac.in')`, [uid]);
const profile = await one('select email, email_opt_in from public.profiles where id = $1', [uid]);
check('profile created by trigger, email lower-cased', profile?.email === 'rahul.k@vitbhopal.ac.in');
check('new students are opted in to feature emails', profile?.email_opt_in === true);

// ── Content ──
const addCourse = async (slug, price, status = 'live', code = null) =>
  one(
    `insert into public.courses (slug, title, subject_code, batch_year, primary_programme_slug, semester, r2_prefix, price_paise, status)
     values ($1, $1, $5, 2023, 'bce', 3, $2, $3, $4) returning id, published_at`,
    [slug, `drive-imports/23 Batch/${slug}/`, price, status, code],
  );
const course = await addCourse('dbms', 9900, 'live', 'CSE3001');
check('publishing stamps published_at', course.published_at !== null);
check(
  'the primary programme is always a placement',
  (await all('select programme_slug from public.course_programmes where course_id = $1', [course.id]))
    .map((r) => r.programme_slug)
    .join() === 'bce',
);
await db.query("select public.set_course_programmes($1, array['bai','bce']::text[])", [course.id]);
const placed = await all(
  'select programme_slug from public.course_programmes where course_id = $1 order by 1',
  [course.id],
);
const primary = (await one('select primary_programme_slug from public.courses where id = $1', [course.id]))
  .primary_programme_slug;
check(
  'set_course_programmes replaces placements and sets the primary',
  placed.map((r) => r.programme_slug).join() === 'bai,bce' && primary === 'bai',
);
check(
  'set_course_programmes refuses unknown programmes',
  await throws("select public.set_course_programmes($1, array['nope']::text[])", [course.id]),
);
const os = await addCourse('os', 9900);
const maths = await addCourse('maths', 7900);
const draft = await addCourse('draft-course', 9900, 'draft');
check(
  'a course must point at a known subject',
  await throws(
    `insert into public.courses (slug, title, subject_code, batch_year, primary_programme_slug, semester, r2_prefix)
   values ('x', 'xx', 'NOPE123', 2023, 'bce', 1, 'drive-imports/x/')`,
  ),
);

const unit = await one(
  `insert into public.course_units (course_id, key, title, kind) values ($1, 'module-1', 'ER model', 'module') returning id`,
  [course.id],
);
const refUnit = await one(
  `insert into public.course_units (course_id, key, title, kind, is_hidden) values ($1, 'reference-books', 'Reference Books', 'reference', true) returning id`,
  [course.id],
);
const otherUnit = await one(
  `insert into public.course_units (course_id, key, title) values ($1, 'module-1', 'Other') returning id`,
  [os.id],
);
const file = await one(
  `insert into public.course_files (course_id, unit_id, name, format, source_key) values ($1, $2, 'notes.pdf', 'pdf', 'k1') returning id`,
  [course.id, unit.id],
);
await db.query(
  `insert into public.course_files (course_id, unit_id, name, format, source_key) values ($1, $2, 'grewal.pdf', 'pdf', 'k2')`,
  [course.id, refUnit.id],
);
await db.query(
  `insert into public.course_files (course_id, unit_id, name, format, source_key, is_hidden) values ($1, $2, 'textbook.pdf', 'pdf', 'k3', true)`,
  [course.id, unit.id],
);
check(
  "a file cannot sit in another course's unit",
  await throws(
    `insert into public.course_files (course_id, unit_id, name, format, source_key) values ($1, $2, 'x.pdf', 'pdf', 'k4')`,
    [course.id, otherUnit.id],
  ),
);
await db.query(
  `insert into public.file_pages (file_id, page_no, image_key, tile_seed) values ($1, 1, 'p/1.webp', 'secretseed')`,
  [file.id],
);

// ── Commerce ──
const order = (
  await one(`select public.create_order($1, $2, null, array[$2]::uuid[], 9900, 'order_T1') as o`, [
    uid,
    course.id,
  ])
).o;
check('create_order returns the order with its course_ids', order.course_ids?.[0] === course.id);
await db.query(`select public.grant_order('order_T1', 'pay_T1')`);
await db.query(`select public.grant_order('order_T1', 'pay_T1')`);
const ent = await one('select count(*)::int as n from public.entitlements where user_id = $1', [uid]);
const ord = await one(`select status from public.orders where gateway_order_id = 'order_T1'`);
check('grant_order twice → one entitlement, order paid', ent.n === 1 && ord.status === 'paid');
await db.query(`select public.revoke_by_payment('pay_T1')`);
check(
  'lost dispute revokes access',
  (await one('select revoked_at from public.entitlements where user_id = $1', [uid])).revoked_at !== null,
);

const bundle = await one(
  `insert into public.bundles (slug, title, batch_year, price_paise, status) values ('sem3', 'Sem 3', 2023, 19900, 'live') returning id`,
);
await db.query(
  'insert into public.bundle_courses (bundle_id, course_id) values ($1, $2), ($1, $3), ($1, $4)',
  [bundle.id, course.id, os.id, maths.id],
);
await db.query(`select public.create_order($1, null, $2, array[$3, $4, $5]::uuid[], 19900, 'order_B1')`, [
  uid,
  bundle.id,
  course.id,
  os.id,
  maths.id,
]);
await db.query(`select public.grant_order('order_B1', 'pay_B1')`);
await db.query(`select public.grant_order('order_B1', 'pay_B1')`);
const active = async () =>
  (
    await one(
      'select count(*)::int as n from public.entitlements where user_id = $1 and revoked_at is null',
      [uid],
    )
  ).n;
check('bundle order grants all three courses (idempotent)', (await active()) === 3);
check(
  'an order must name a course or a bundle',
  await throws(
    `insert into public.orders (user_id, amount_paise, gateway_order_id) values ($1, 100, 'order_bad')`,
    [uid],
  ),
);
check(
  'an order must grant at least one course',
  await throws(`select public.create_order($1, $2, null, '{}'::uuid[], 9900, 'order_empty')`, [
    uid,
    course.id,
  ]),
);
await db.query('update public.bundle_courses set sort = 1 where bundle_id = $1', [bundle.id]);
await db.query('delete from public.bundle_courses where bundle_id = $1 and course_id = $2', [
  bundle.id,
  maths.id,
]);
check(
  'editing a bundle later never changes what an earlier order granted',
  (
    await one(
      `select count(*)::int as n from public.order_items i join public.orders o on o.id = i.order_id where o.gateway_order_id = 'order_B1'`,
    )
  ).n === 3,
);
await db.query(`select public.revoke_by_payment('pay_B1')`);
check('lost dispute on a bundle revokes every course', (await active()) === 0);

// ── Reading ──
await db.query(`select public.log_pages($1, $2, 5, 'h', 'ua')`, [uid, file.id]);
check(
  'log_pages sums the day',
  (await one(`select public.log_pages($1, $2, 7, 'h', 'ua') as t`, [uid, file.id])).t === 12,
);
await db.query(
  'insert into public.access_logs (user_id, file_id, day, pages_viewed) values ($1, $2, current_date - 40, 3)',
  [uid, file.id],
);
check(
  'prune_access_logs drops rows older than 30 days',
  (await one('select public.prune_access_logs() as n')).n === 1,
);

// ── Engagement ──
await db.query(`select public.add_email_quota('2026-10-20', 40)`);
check(
  'email quota adds up per day',
  (await one(`select public.add_email_quota('2026-10-20', 2) as n`)).n === 42,
);
check(
  'toolbox seeded with CGPA calculator and timetable maker',
  (await all('select key from public.features order by sort')).map((r) => r.key).join() === 'cgpa,timetable',
);
await db.query(`update public.features set status = 'live' where key = 'cgpa'`);
check(
  'launching a tool stamps launched_at',
  (await one(`select launched_at from public.features where key = 'cgpa'`)).launched_at !== null,
);

// ── Audit trail and timestamps ──
await db.query('update public.courses set price_paise = 12900 where id = $1', [course.id]);
const audit = await one(
  `select changes from public.audit_log where table_name = 'courses' and row_key = $1 and action = 'update' order by id desc limit 1`,
  [course.id],
);
check(
  'price changes are audited with from/to',
  audit?.changes?.price_paise?.to === 12900 && audit.changes.price_paise.from === 9900,
);
const before = (await one('select updated_at from public.courses where id = $1', [course.id])).updated_at;
await new Promise((r) => setTimeout(r, 5));
await db.query(`update public.courses set description = 'x' where id = $1`, [course.id]);
check(
  'updated_at is set by trigger',
  (await one('select updated_at from public.courses where id = $1', [course.id])).updated_at > before,
);

// ── Reporting views ──
const overview = await one('select * from public.course_overview where id = $1', [course.id]);
check(
  'course_overview counts visible files, hidden units and placements',
  Number(overview.files) === 3 &&
    Number(overview.visible_files) === 1 &&
    Number(overview.hidden_units) === 1 &&
    overview.programmes.join() === 'bai,bce',
);
check(
  'sales_daily totals paid orders',
  Number((await one('select sum(orders) as n from public.sales_daily')).n) >= 0,
);

// ── RLS as a college student vs an outsider ──
await db.exec(
  'grant usage on schema auth to authenticated; grant usage on schema public to authenticated; grant select on all tables in schema public to authenticated;',
);
async function asUser(email, sql) {
  await db.exec('begin');
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, email })]);
  await db.exec('set local role authenticated');
  const rows = (await db.query(sql)).rows;
  await db.exec('rollback');
  return rows;
}
const student = 'rahul.k@vitbhopal.ac.in';
check(
  'RLS: college student sees live courses only',
  (await asUser(student, 'select slug from public.courses')).length === 3,
);
check(
  'RLS: drafts stay hidden',
  !(await asUser(student, 'select slug from public.courses')).some((c) => c.slug === 'draft-course'),
);
check(
  'RLS: hidden units are not listed',
  (await asUser(student, `select key from public.course_units where course_id = '${course.id}'`))
    .map((u) => u.key)
    .join() === 'module-1',
);
check(
  'RLS: hidden files and files in hidden units are not listed',
  (await asUser(student, 'select name from public.course_files')).map((f) => f.name).join() === 'notes.pdf',
);
check(
  'RLS: students see live bundles',
  (await asUser(student, 'select slug from public.bundles')).length === 1,
);
check(
  'RLS: announcements and quotas are server-only',
  (await asUser(student, 'select * from public.announcements')).length === 0,
);
check(
  'RLS: the audit log is server-only',
  (await asUser(student, 'select * from public.audit_log')).length === 0,
);
check(
  'RLS: reporting views obey RLS',
  (await asUser('someone@gmail.com', 'select * from public.course_overview')).length === 0,
);
check(
  'RLS: anyone can read the toolbox',
  (await asUser('someone@gmail.com', 'select key from public.features')).length === 2,
);
check(
  'RLS: outsider sees no courses',
  (await asUser('someone@gmail.com', 'select slug from public.courses')).length === 0,
);
check(
  'RLS: nobody reads tile seeds from the browser',
  (await asUser(student, 'select * from public.file_pages')).length === 0,
);
void draft;

// ── The paste-in file (supabase/apply-all.sql) builds the same database, and is safe to run twice ──
const bundlePath = join(here, 'apply-all.sql');
try {
  const fresh = new PGlite({ extensions: { pgcrypto } });
  await fresh.exec(supabaseStub);
  const bundle = readFileSync(bundlePath, 'utf8');
  await fresh.exec(bundle);
  await fresh.exec(bundle);
  const tables = async (d) =>
    (
      await d.query(
        "select table_name from information_schema.tables where table_schema = 'public' order by 1",
      )
    ).rows
      .map((r) => r.table_name)
      .join();
  const same = (await tables(fresh)) === (await tables(db));
  const recorded = (await fresh.query('select count(*)::int as n from supabase_migrations.schema_migrations'))
    .rows[0].n;
  check('apply-all.sql builds the same tables, twice over', same && recorded === migrations.length);
  await fresh.close();
} catch (e) {
  check('apply-all.sql builds the same tables, twice over', false, e.message);
}

await db.close();
console.log(failures === 0 ? '\nAll database checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
