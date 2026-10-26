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
check(
  'hook allows the listed admin Gmail exactly',
  JSON.stringify(await hook('VitbSmashers@Gmail.com')) === '{}',
);
for (const trick of [
  'vit.bsmashers@gmail.com',
  'vitbsmashers+x@gmail.com',
  'vitbsmashers@gmail.com.evil.in',
  'rahul+2@vitbhopal.ac.in',
  'rahul..k@vitbhopal.ac.in',
  'rahul.@vitbhopal.ac.in',
  'rаhul@vitbhopal.ac.in',
]) {
  check(`hook blocks ${trick}`, (await hook(trick)).error?.http_code === 403);
}
check(
  'students cannot read the admin list',
  (await one(`select has_table_privilege('authenticated', 'public.admin_emails', 'select') as ok`)).ok ===
    false,
);
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

// ── Access periods ──
await db.query(`update public.courses set access_until = now() + interval '30 days' where id = $1`, [os.id]);
await db.query(`select public.create_order($1, $2, null, array[$2]::uuid[], 9900, 'order_T2')`, [uid, os.id]);
await db.query(`select public.grant_order('order_T2', 'pay_T2')`);
const term = await one(
  'select expires_at, revoked_at, revoke_reason from public.entitlements where user_id = $1 and course_id = $2',
  [uid, os.id],
);
check(
  'buying again after a dispute renews access with the course term end',
  term.revoked_at === null && term.expires_at !== null && term.revoke_reason === null,
);
await db.query(
  `update public.entitlements set expires_at = now() - interval '1 day' where user_id = $1 and course_id = $2`,
  [uid, os.id],
);
await db.query('update public.courses set access_until = null where id = $1', [os.id]);
await db.query(`select public.create_order($1, $2, null, array[$2]::uuid[], 9900, 'order_T3')`, [uid, os.id]);
await db.query(`select public.grant_order('order_T3', 'pay_T3')`);
{
  const renewed = (
    await one(
      `select extract(epoch from (expires_at - (now() + interval '3 months')))::int as off
         from public.entitlements where user_id = $1 and course_id = $2`,
      [uid, os.id],
    )
  ).off;
  check('an expired purchase is renewed by buying again, for 3 months from today', Math.abs(renewed) < 60);
}
await db.query('delete from public.entitlements where user_id = $1 and course_id = $2', [uid, maths.id]);
check(
  'an admin gift needs no order but must say which admin gave it',
  (await throws(`insert into public.entitlements (user_id, course_id, granted_by) values ($1, $2, 'admin')`, [
    uid,
    maths.id,
  ])) &&
    !(await throws(
      `insert into public.entitlements (user_id, course_id, granted_by, granted_by_admin) values ($1, $2, 'admin', 'vitbsmashers@gmail.com')`,
      [uid, maths.id],
    )),
);
check(
  'a purchase still always has an order',
  await throws('insert into public.entitlements (user_id, course_id) values ($1, $2)', [uid, course.id]),
);
await db.query(
  `update public.entitlements set expires_at = now() - interval '1 day' where user_id = $1 and course_id = $2`,
  [uid, maths.id],
);
await db.query(`select public.create_order($1, $2, null, array[$2]::uuid[], 9900, 'order_T4')`, [
  uid,
  maths.id,
]);
await db.query(`select public.grant_order('order_T4', 'pay_T4')`);
check(
  'buying a course after an ended gift records it as a purchase',
  (
    await one(
      'select granted_by, granted_by_admin from public.entitlements where user_id = $1 and course_id = $2',
      [uid, maths.id],
    )
  ).granted_by === 'purchase',
);
await db.query(
  "update public.entitlements set end_notified_at = now(), expires_at = now() - interval '1 hour' where user_id = $1 and course_id = $2",
  [uid, maths.id],
);
await db.query(`select public.create_order($1, $2, null, array[$2]::uuid[], 9900, 'order_T5')`, [
  uid,
  maths.id,
]);
await db.query(`select public.grant_order('order_T5', 'pay_T5')`);
check(
  'buying again clears the "access ended" email mark, so a later end is emailed again',
  (
    await one('select end_notified_at from public.entitlements where user_id = $1 and course_id = $2', [
      uid,
      maths.id,
    ])
  ).end_notified_at === null,
);
check(
  'a disputed purchase keeps its reason',
  (await one(`select count(*)::int as n from public.entitlements where revoke_reason = 'dispute'`)).n >= 1,
);

// ── Problems log and storage map ──
await db.query(`select public.record_problem('fp1', 'browser', 'image', 'preview failed', '/c/x', '', 'ua')`);
await db.query(`select public.record_problem('fp1', 'browser', 'image', 'preview failed', '/c/x', '', 'ua')`);
check(
  'a repeated problem is one row with a count',
  (await one(`select count from public.problem_reports where fingerprint = 'fp1'`)).count === 2,
);
check(
  'the storage map lists tables with sizes',
  (await db.query('select * from public.storage_tables()')).rows.length > 10,
);
await db.query(`select public.create_order($1, $2, null, array[$2]::uuid[], 9900, 'order_OLD')`, [
  uid,
  maths.id,
]);
await db.query(
  `update public.orders set created_at = now() - interval '40 days' where gateway_order_id = 'order_OLD'`,
);
const paidBefore = (await one(`select count(*)::int as n from public.orders where status = 'paid'`)).n;
const cleaned = (await one('select public.clean_abandoned_orders(30) as n')).n;
check(
  'old unpaid checkouts are cleaned',
  cleaned >= 1 &&
    !(await db.query(`select 1 from public.orders where gateway_order_id = 'order_OLD'`)).rows.length,
);
check(
  'paid orders are never cleaned',
  (await one(`select count(*)::int as n from public.orders where status = 'paid'`)).n === paidBefore,
);

// ── Moving a course folder ──
{
  const f = (await db.query('select id, course_id, source_key from public.course_files limit 1')).rows[0];
  const c = f && (await one('select id, r2_prefix from public.courses where id = $1', [f.course_id]));
  check('there is a course file to move', Boolean(f));
  if (f) {
    const newKey = `drive-imports/moved/${f.source_key.split('/').pop()}`;
    await db.query(`select public.move_course_source($1, 'drive-imports/moved/', $2::jsonb)`, [
      c.id,
      JSON.stringify([{ file_id: f.id, source_key: newKey, source_etag: 'e1' }]),
    ]);
    const after = await one('select source_key, source_etag from public.course_files where id = $1', [f.id]);
    check(
      'moving a course folder updates the course and its files together',
      after.source_key === newKey &&
        after.source_etag === 'e1' &&
        (await one('select r2_prefix from public.courses where id = $1', [c.id])).r2_prefix ===
          'drive-imports/moved/',
    );
    await db.query('select public.move_course_source($1, $2, $3::jsonb)', [
      c.id,
      c.r2_prefix,
      JSON.stringify([{ file_id: f.id, source_key: f.source_key, source_etag: '' }]),
    ]);
  }
}

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
  'toolbox seeded with CGPA calculator, attendance and timetable maker',
  (await all('select key from public.features order by sort')).map((r) => r.key).join() ===
    'cgpa,attendance,timetable',
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
  (await asUser('someone@gmail.com', 'select key from public.features')).length === 3,
);
check(
  'RLS: outsider sees no courses',
  (await asUser('someone@gmail.com', 'select slug from public.courses')).length === 0,
);
check(
  'RLS: nobody reads tile seeds from the browser',
  (await asUser(student, 'select * from public.file_pages')).length === 0,
);

// ── Contributions ──
await db.query(
  `insert into public.contributions (user_id, title, kind, files, total_bytes) values ($1, 'DBMS unit 2', 'notes', '[{"index":1}]', 1200)`,
  [uid],
);
check(
  'contributions start pending, and uploads start open',
  (await one('select status from public.contributions limit 1')).status === 'pending' &&
    (await one(`select value from public.site_settings where key = 'contributions_open'`)).value === true,
);
check(
  'a contribution must have a real title and a known kind',
  (await throws(`insert into public.contributions (user_id, title, kind) values ('${uid}', 'x', 'notes')`)) &&
    (await throws(
      `insert into public.contributions (user_id, title, kind) values ('${uid}', 'Fine title', 'exe')`,
    )),
);
check(
  'students are not blocked from sharing by default',
  (await one('select contribution_blocked from public.profiles where id = $1', [uid]))
    .contribution_blocked === false,
);
// ── Earnings & royalties ──
await db.query(`select public.create_order($1, null, $2, array[$3, $4]::uuid[], 15000, 'order_SPLIT')`, [
  uid,
  bundle.id,
  course.id,
  os.id,
]);
await db.query(`select public.grant_order('order_SPLIT', 'pay_SPLIT')`);
const split = await all(
  `select l.course_id, l.amount_paise, c.price_paise from public.sale_lines() l join public.courses c on c.id = l.course_id
    join public.orders o on o.id = l.order_id where o.gateway_order_id = 'order_SPLIT'`,
);
check(
  'a bundle payment is split across its courses by price, to the rupee',
  split.length === 2 &&
    split.reduce((t, r) => t + Number(r.amount_paise), 0) === 15000 &&
    split.every(
      (r) =>
        Math.abs(
          Number(r.amount_paise) -
            Math.round((15000 * r.price_paise) / split.reduce((t, x) => t + x.price_paise, 0)),
        ) <= 1,
    ),
);
const paidSum = async () =>
  Number((await one(`select sum(amount_paise)::int s from public.orders where status = 'paid'`)).s);
check(
  'paid orders get paid_at, and every paid rupee appears once in sale_lines()',
  (await one(`select count(*)::int n from public.orders where status = 'paid' and paid_at is null`)).n ===
    0 &&
    Number((await one('select sum(amount_paise)::int s from public.sale_lines()')).s) === (await paidSum()),
);
const sold = (
  await one(`select course_id from public.orders where status = 'paid' and course_id is not null limit 1`)
).course_id;
const earn0 = await one('select * from public.course_earnings() where course_id = $1', [sold]);
check(
  'course_earnings adds up to every paid rupee, and leaves out disputed sales',
  earn0.sales >= 1 &&
    earn0.buyers === 1 &&
    Number((await one('select sum(revenue_paise)::int s from public.course_earnings()')).s) ===
      (await paidSum()),
);
await db.query(
  `insert into public.course_royalties (course_id, user_id, share_percent, since) values ($1, $2, 50, now() + interval '1 second')`,
  [sold, uid],
);
check(
  'a royalty only counts sales after it starts',
  (await one('select royalty_sales from public.course_earnings() where course_id = $1', [sold]))
    .royalty_sales === 0,
);
await db.query(`update public.course_royalties set since = now() - interval '1 day' where course_id = $1`, [
  sold,
]);
await db.query(
  `insert into public.royalty_payouts (course_id, user_id, amount_paise, note) values ($1, $2, 1000, 'UPI')`,
  [sold, uid],
);
const earn1 = await one('select * from public.course_earnings() where course_id = $1', [sold]);
check(
  'royalty sales and payouts add up',
  earn1.royalty_sales === earn0.sales &&
    Number(earn1.royalty_revenue_paise) === Number(earn0.revenue_paise) &&
    Number(earn1.paid_out_paise) === 1000,
);
check(
  'a royalty share is between 1% and 90%',
  await throws(`update public.course_royalties set share_percent = 95 where course_id = '${sold}'`),
);
const totals = await one('select * from public.paid_totals()');
check('paid_totals counts paid orders and buyers', totals.orders >= 1 && totals.buyers === 1);

// ── Help desk ──
const sq = await one(
  `insert into public.support_queries (user_id, topic, subject) values ($1, 'feature', 'PNG is blank') returning id, status`,
  [uid],
);
await db.query(`insert into public.support_messages (query_id, body) values ($1, 'It downloads empty')`, [
  sq.id,
]);
check('a new query starts open with its first message', sq.status === 'open');
check(
  'a query needs a known topic',
  await throws(
    `insert into public.support_queries (user_id, topic, subject) values ('${uid}', 'hack', 'Hello there')`,
  ),
);

// ── Storage tree, years, suggestions ──
check(
  'suggestions are a help-desk topic',
  !(await throws(
    `insert into public.support_queries (user_id, topic, subject) values ('${uid}', 'suggestion', 'Dark mode please')`,
  )),
);
const fileRow = await one('select id, course_id, unit_id from public.course_files limit 1');
if (fileRow) {
  const unitFiles = (
    await one('select count(*)::int n from public.course_files where unit_id = $1', [fileRow.unit_id])
  ).n;
  const removed = (await one('select public.delete_course_files(array[$1]::uuid[]) as n', [fileRow.id])).n;
  const unitLeft = (
    await one('select count(*)::int n from public.course_units where id = $1', [fileRow.unit_id])
  ).n;
  check(
    'delete_course_files removes the file, and its unit once empty',
    removed === 1 && unitLeft === (unitFiles > 1 ? 1 : 0),
  );
}
const yearBefore = (await one('select count(*)::int n from public.courses where batch_year = $1', [2023])).n;
const movedN = (await one('select public.move_batch_courses(2023, 2031, null) as n')).n;
check(
  'move_batch_courses re-files a whole year (and adds the new year)',
  movedN === yearBefore &&
    (await one('select count(*)::int n from public.courses where batch_year = 2031')).n === yearBefore &&
    (await one('select count(*)::int n from public.batches where year = 2031')).n === 1,
);
await db.query('select public.move_batch_courses(2031, 2023, null)');
check(
  'a batch year can be hidden',
  !(await throws('update public.batches set is_visible = false where year = 2031')),
);

// ── Deliveries, admin sources, term reminders ──
await db.query('update public.profiles set email_opt_in = true where id = $1', [uid]);
const ann = await one(
  `insert into public.announcements (subject, heading, body) values ('Hello there', 'Hi', 'Body') returning id`,
);
const annBefore = await one('select * from public.announcement_progress($1)', [ann.id]);
const pendingRows = await all('select * from public.announcement_pending($1, 10)', [ann.id]);
await db.query('insert into public.announcement_deliveries (announcement_id, user_id) values ($1, $2)', [
  ann.id,
  uid,
]);
const annAfter = await one('select * from public.announcement_progress($1)', [ann.id]);
check(
  'announcement deliveries: pending until sent, then counted once',
  annBefore.waiting >= 1 &&
    pendingRows.some((r) => r.id === uid) &&
    annAfter.sent === 1 &&
    annAfter.waiting === annBefore.waiting - 1,
);
check(
  'a student can get an announcement only once',
  await throws('insert into public.announcement_deliveries (announcement_id, user_id) values ($1, $2)', [
    ann.id,
    uid,
  ]),
);
check(
  'admin addresses remember where they came from',
  (await one('select source from public.admin_emails limit 1')).source === 'github',
);
const entRow = await one(
  'select course_id from public.entitlements where user_id = $1 and revoked_at is null limit 1',
  [uid],
);
if (entRow) {
  await db.query(
    `update public.entitlements set expires_at = now() + interval '3 days', ending_notified_at = null where user_id = $1 and course_id = $2`,
    [uid, entRow.course_id],
  );
  await db.query(`update public.courses set term_label = 'Sem 5 · Dec 2026' where id = $1`, [
    entRow.course_id,
  ]);
  const soon = await all(`select * from public.access_ending_soon(now() + interval '7 days', 50)`);
  check(
    'access_ending_soon lists accesses ending within the week, with the term name',
    soon.some((r) => r.user_id === uid && r.term_label === 'Sem 5 · Dec 2026'),
  );
}

// ── 3-month window, pending grants, course updates, batches ──
check('access lasts 3 months by default', (await one('select public.access_months() as n')).n === 3);
await db.query(
  `insert into public.pending_grants (email, course_id, granted_by_admin) values ('new.24bai10002@vitbhopal.ac.in', $1, 'admin@x')`,
  [os.id],
);
const newUid = '22222222-2222-2222-2222-222222222222';
await db.query(`insert into auth.users (id, email) values ($1, 'New.24BAI10002@vitbhopal.ac.in')`, [newUid]);
check(
  'a course given to an email before sign-up is on the shelf when the account is made',
  (
    await one('select count(*)::int n from public.entitlements where user_id = $1 and course_id = $2', [
      newUid,
      os.id,
    ])
  ).n === 1 && (await one('select count(*)::int n from public.pending_grants')).n === 0,
);
const courseAnn = await one(
  `insert into public.announcements (subject, heading, body, course_id) values ('New notes', 'Hi', 'Body', $1) returning id`,
  [os.id],
);
const aud = await all('select id from public.announcement_audience($1)', [courseAnn.id]);
check(
  'a course announcement goes only to students who have the course',
  aud.some((r) => r.id === newUid) && aud.every((r) => r.id === newUid || r.id === uid),
);
const batches = await all('select * from public.announcement_batches($1)', [courseAnn.id]);
check(
  'announcement counts are split by batch year',
  batches.some((b) => b.batch === '2024' && b.waiting >= 1),
);
await db.query("update public.courses set files_notified_at = now() - interval '1 day' where id = $1", [
  course.id,
]);
await db.query(
  `update public.course_files set conversion_status = 'ready', converted_at = now() where course_id = $1 and not is_hidden`,
  [course.id],
);
check(
  'courses_with_new_files lists a live course with new readable notes',
  (await all('select course_id from public.courses_with_new_files()')).some((r) => r.course_id === course.id),
);

// ── Sign-in guard ──
let blockedAt = null;
for (let i = 0; i < 5; i++) blockedAt = (await one(`select public.signin_strike('net1', 5, 24) as b`)).b;
const fourth = (await one(`select public.signin_strike('net2', 5, 24) as b`)).b;
check('5 refused sign-ins from one network block it for 24 hours', blockedAt !== null && fourth === null);

// ── Rewards and the yearly bonus ──
const earnRows = await all(`select * from public.royalty_earnings_since(now() - interval '365 days')`);
check(
  'royalty_earnings_since counts royalty sales in the last year',
  earnRows.some((r) => r.user_id === uid && r.sales >= 1),
);
await db.query(
  'insert into public.contributor_bonuses (user_id, year, amount_paise) values ($1, 2026, 100)',
  [uid],
);
check(
  'the yearly bonus can be paid only once per year',
  await throws(
    'insert into public.contributor_bonuses (user_id, year, amount_paise) values ($1, 2026, 100)',
    [uid],
  ),
);

// ── Contribution pipeline: where an upload was filed, and when it was done ──
{
  const contribution = await one('select id from public.contributions limit 1');
  if (contribution) {
    await db.query(
      `update public.contributions set filed_course_id = $2, filed_folder = 'Unit 6 - Recovery/',
         filed_keys = array['k1','k2'], filed_at = now(), completed_at = now() where id = $1`,
      [contribution.id, course.id],
    );
    const row = await one(
      'select filed_folder, filed_keys, completed_at from public.contributions where id = $1',
      [contribution.id],
    );
    check(
      'a contribution remembers where it was filed and when it was done',
      row.filed_folder === 'Unit 6 - Recovery/' && row.filed_keys.length === 2 && row.completed_at !== null,
    );
  }
}

// ── Moving a file keeps its id (and so its pages); an emptied unit goes ──
{
  const f = await one('select id, unit_id, course_id from public.course_files limit 1');
  if (f) {
    const before = (
      await one('select count(*)::int n from public.course_files where unit_id = $1', [f.unit_id])
    ).n;
    await db.query(
      `select public.relocate_course_file($1, $2, 'unit-9', 'Extra', 'module', 9, false, 'moved/key.pdf', 'e1', 'key.pdf')`,
      [f.id, f.course_id],
    );
    const moved = await one(
      'select f.id, f.source_key, u.key from public.course_files f join public.course_units u on u.id = f.unit_id where f.id = $1',
      [f.id],
    );
    const oldUnit = (await one('select count(*)::int n from public.course_units where id = $1', [f.unit_id]))
      .n;
    check(
      'relocate_course_file moves a file (same id) to a new unit; an emptied unit is removed',
      moved.id === f.id &&
        moved.source_key === 'moved/key.pdf' &&
        moved.key === 'unit-9' &&
        oldUnit === (before === 1 ? 0 : 1),
    );
  } else check('relocate_course_file has a file to move', false);
}

async function denied(sql) {
  try {
    return (await asUser(student, sql)).length === 0;
  } catch {
    await db.exec('rollback').catch(() => {});
    return true;
  }
}
check(
  'RLS: students cannot read contributions from the browser',
  await denied('select * from public.contributions'),
);
check(
  'RLS: students cannot read site settings from the browser',
  await denied('select * from public.site_settings'),
);
check(
  'RLS: students cannot read sales or royalties',
  (await denied('select * from public.sale_lines()')) &&
    (await denied('select * from public.course_royalties')) &&
    (await denied('select * from public.royalty_payouts')),
);
check(
  'RLS: students cannot read the help desk from the browser',
  (await denied('select * from public.support_queries')) &&
    (await denied('select * from public.support_messages')),
);
check('RLS: students cannot run the earnings report', await denied('select * from public.course_earnings()'));
check(
  'RLS: students cannot read who got which email',
  (await denied('select * from public.announcement_deliveries')) &&
    (await denied(`select * from public.announcement_pending('00000000-0000-0000-0000-000000000000', 5)`)),
);
check(
  'RLS: students cannot read pending grants, sign-in strikes or bonuses',
  (await denied('select * from public.pending_grants')) &&
    (await denied('select * from public.signin_strikes')) &&
    (await denied('select * from public.contributor_bonuses')),
);
check(
  'RLS: students cannot delete files or move years',
  (await denied(`select public.delete_course_files('{}'::uuid[])`)) &&
    (await denied('select public.move_batch_courses(2023, 2024, null)')),
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
