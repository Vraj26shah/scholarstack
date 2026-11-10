-- Scholars Stack: full database setup. Paste into Supabase → SQL Editor → Run.
-- Safe to run again: migrations already applied are skipped.

create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);

-- ═══ 20261022205642_conversion_progress_remote ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261022205642') then
    raise notice 'skip 20261022205642';
    return;
  end if;
  execute $m$-- This migration version was applied to production through Supabase's Management API.
-- The ordered local migration at 20261023001200 contains the reproducible schema change.
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261022205642', 'conversion_progress_remote');
end $migration$;

-- ═══ 20261022205753_r2_source_reconciliation_remote ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261022205753') then
    raise notice 'skip 20261022205753';
    return;
  end if;
  execute $m$-- This migration version was applied to production through Supabase's Management API.
-- The ordered local migration at 20261023001300 contains the reproducible schema change.
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261022205753', 'r2_source_reconciliation_remote');
end $migration$;

-- ═══ 20261023000100_foundation ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261023000100') then
    raise notice 'skip 20261023000100';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- 0100 · Foundation
-- Shared building blocks used by every later migration: extensions, the
-- updated_at trigger, the "is this a college user" check and the audit trail.
--
-- Conventions (see DATABASE.md):
--   • snake_case, plural table names; primary keys are `id uuid` unless a natural
--     key exists (batch year, programme slug, subject code, feature key).
--   • Every mutable table has created_at / updated_at; updated_at is set by trigger.
--   • Status-like columns are text + CHECK (easy to extend in a later migration).
--   • RLS is ON for every table. The API uses the server (secret) key and filters
--     by user itself; policies only exist for what a signed-in browser may read.
--   • Functions are SECURITY DEFINER with a pinned search_path, and EXECUTE is
--     revoked from anon/authenticated unless the browser genuinely needs it.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── updated_at ──────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
comment on function public.set_updated_at() is 'BEFORE UPDATE trigger: stamps updated_at.';

-- ── Who may read the catalogue straight from the browser ───────────────────
create or replace function public.is_vit_user()
returns boolean language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', '') ilike '%@vitbhopal.ac.in'
$$;
comment on function public.is_vit_user() is 'True when the caller''s JWT carries a @vitbhopal.ac.in email.';

-- ── Audit trail ─────────────────────────────────────────────────────────────
-- Admin-managed tables (prices, publishing, programmes, bundles, tools) record
-- every insert/update/delete here, so "who changed the price and when" always
-- has an answer. High-churn tables (pages, logs) are deliberately not audited.
create table public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  table_name  text not null,
  row_key     text not null,
  action      text not null check (action in ('insert', 'update', 'delete')),
  -- Only the columns that changed (update) or the whole row (insert/delete).
  changes     jsonb not null default '{}'::jsonb,
  actor       text not null default current_user
);
create index audit_log_row_idx on public.audit_log (table_name, row_key, at desc);
create index audit_log_at_idx on public.audit_log (at desc);
alter table public.audit_log enable row level security; -- server only
comment on table public.audit_log is 'Append-only change history for admin-managed tables.';

-- TG_ARGV[0] names the key column (id, slug, code, key…).
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  key_col  text := coalesce(tg_argv[0], 'id');
  old_row  jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  new_row  jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  diff     jsonb := '{}'::jsonb;
  k        text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(new_row) loop
      if k <> 'updated_at' and (old_row -> k) is distinct from (new_row -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_object('from', old_row -> k, 'to', new_row -> k));
      end if;
    end loop;
    if diff = '{}'::jsonb then
      return new; -- nothing but updated_at changed
    end if;
  end if;
  insert into public.audit_log (table_name, row_key, action, changes)
  values (
    tg_table_name,
    coalesce(new_row ->> key_col, old_row ->> key_col, '?'),
    lower(tg_op),
    case tg_op when 'UPDATE' then diff when 'INSERT' then new_row else old_row end
  );
  return coalesce(new, old);
end $$;
revoke execute on function public.audit_row() from public, anon, authenticated;
comment on function public.audit_row() is 'AFTER trigger that writes the change set to audit_log.';
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261023000100', 'foundation');
end $migration$;

-- ═══ 20261023000200_academic ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261023000200') then
    raise notice 'skip 20261023000200';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- 0200 · Academic reference data
-- The university's own structure, independent of anything we sell: batches
-- (intake years), programmes (shown as branch tabs) and subjects (course codes
-- like CSE3001). Future tools (CGPA calculator, timetable maker, faculty or
-- club pages) build on these same tables.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Batches: one per intake year ("23 Batch" → 2023) ───────────────────────
create table public.batches (
  year        int primary key check (year between 2000 and 2100),
  created_at  timestamptz not null default now()
);
comment on table public.batches is 'Intake years. A batch is a drawer in the catalogue.';

-- ── Programmes (B.Tech AI, B.Tech CE, …) ────────────────────────────────────
create table public.programmes (
  slug         text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  code         text not null unique check (code ~ '^[A-Z0-9]{2,12}$'),
  name         text not null check (length(name) between 2 and 120),
  short_name   text not null default '',
  tagline      text not null default '',
  description  text not null default '',
  -- A shared tab whose courses show under every programme (e.g. first-year common).
  is_common    boolean not null default false,
  -- Retired programmes keep their history but disappear from the site.
  is_active    boolean not null default true,
  sort         int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger programmes_updated_at before update on public.programmes
  for each row execute function public.set_updated_at();
create trigger programmes_audit after insert or update or delete on public.programmes
  for each row execute function public.audit_row('slug');
comment on table public.programmes is 'Degree programmes. Shown as branch tabs inside each batch drawer.';

-- ── Subjects: the official course-code catalogue ────────────────────────────
create table public.subjects (
  code         text primary key check (code ~ '^[A-Z0-9][A-Z0-9._/-]{0,23}$'),
  title        text not null default '',
  -- Filled in when known; the CGPA calculator reads it.
  credits      numeric(3, 1) check (credits between 0 and 30),
  description  text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger subjects_updated_at before update on public.subjects
  for each row execute function public.set_updated_at();
create trigger subjects_audit after insert or update or delete on public.subjects
  for each row execute function public.audit_row('code');
comment on table public.subjects is 'University subjects keyed by course code (CSE3001). One subject can be taught to many programmes.';

-- ── Which programmes study which subject ───────────────────────────────────
-- Replaces a text[] of codes on the programme: a real join table is indexable,
-- enforces that the subject exists, and can carry the semester later.
create table public.programme_subjects (
  programme_slug  text not null references public.programmes(slug) on update cascade on delete cascade,
  subject_code    text not null references public.subjects(code) on update cascade on delete cascade,
  semester        int check (semester between 1 and 10),
  is_core         boolean not null default true,
  created_at      timestamptz not null default now(),
  primary key (programme_slug, subject_code)
);
create index programme_subjects_subject_idx on public.programme_subjects (subject_code);
comment on table public.programme_subjects is 'Curriculum: subject X is part of programme Y. Used to pre-select programmes on import.';

alter table public.batches enable row level security;
alter table public.programmes enable row level security;
alter table public.subjects enable row level security;
alter table public.programme_subjects enable row level security;
create policy "vit users read batches" on public.batches for select using (public.is_vit_user());
create policy "vit users read active programmes" on public.programmes
  for select using (public.is_vit_user() and is_active);
create policy "vit users read subjects" on public.subjects for select using (public.is_vit_user());
create policy "vit users read curriculum" on public.programme_subjects for select using (public.is_vit_user());
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261023000200', 'academic');
end $migration$;

-- ═══ 20261023000300_content ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261023000300') then
    raise notice 'skip 20261023000300';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- 0300 · Content: what we sell and what the reader shows
--   courses            one R2 folder (drive-imports/23 Batch/DBMS (CSE3001)/)
--   course_programmes  which programme tabs a course appears under
--   course_units       its sub-folders (Module 1, PYQs, Syllabus, Reference Books…)
--   course_files       every file, its conversion state and page-one preview
--   file_pages         converted page images + secret tile seeds (server only)
-- ════════════════════════════════════════════════════════════════════════════

create table public.courses (
  id                      uuid primary key default gen_random_uuid(),
  slug                    text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title                   text not null check (length(title) between 2 and 120),
  description             text not null default '',
  subject_code            text references public.subjects(code) on update cascade on delete set null,
  batch_year              int not null references public.batches(year) on update cascade,
  -- The programme used in call numbers and URLs; always also in course_programmes.
  primary_programme_slug  text not null references public.programmes(slug) on update cascade,
  semester                int not null check (semester between 1 and 10),
  seq                     int not null default 1 check (seq >= 1),
  r2_prefix               text not null unique check (r2_prefix like '%/'),
  price_paise             int not null default 9900 check (price_paise between 100 and 1000000),
  status                  text not null default 'draft' check (status in ('draft', 'live', 'archived')),
  published_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index courses_batch_status_idx on public.courses (batch_year, status);
create index courses_subject_idx on public.courses (subject_code);
create index courses_primary_programme_idx on public.courses (primary_programme_slug);
create trigger courses_updated_at before update on public.courses
  for each row execute function public.set_updated_at();
create trigger courses_audit after insert or update or delete on public.courses
  for each row execute function public.audit_row('id');
comment on table public.courses is 'A sellable course: one folder in R2. Draft until the admin publishes it.';
comment on column public.courses.r2_prefix is 'Folder in the scholarstack bucket, ending in "/". Source of truth for its files.';

-- Stamp published_at the first time a course goes live.
create or replace function public.stamp_published_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'live' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end $$;
create trigger courses_published_at before insert or update of status on public.courses
  for each row execute function public.stamp_published_at();

-- ── Placement in programme tabs ─────────────────────────────────────────────
create table public.course_programmes (
  course_id       uuid not null references public.courses(id) on delete cascade,
  programme_slug  text not null references public.programmes(slug) on update cascade on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (course_id, programme_slug)
);
create index course_programmes_programme_idx on public.course_programmes (programme_slug, course_id);
comment on table public.course_programmes is 'A course is stored once and listed under every programme here.';

-- The primary programme is always one of the placements.
create or replace function public.keep_primary_programme()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.course_programmes (course_id, programme_slug)
  values (new.id, new.primary_programme_slug)
  on conflict do nothing;
  return new;
end $$;
create trigger courses_primary_programme after insert or update of primary_programme_slug on public.courses
  for each row execute function public.keep_primary_programme();

-- Replace a course's placements in one transaction; the first slug becomes primary.
create or replace function public.set_course_programmes(p_course_id uuid, p_programme_slugs text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(cardinality(p_programme_slugs), 0) < 1 then
    raise exception 'Select at least one programme' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_programme_slugs) s(slug)
    left join public.programmes p on p.slug = s.slug and p.is_active
    where p.slug is null
  ) then
    raise exception 'One or more programmes are unavailable' using errcode = '22023';
  end if;
  update public.courses set primary_programme_slug = p_programme_slugs[1] where id = p_course_id;
  if not found then
    raise exception 'Course not found' using errcode = 'P0002';
  end if;
  delete from public.course_programmes
   where course_id = p_course_id and programme_slug <> all (p_programme_slugs);
  insert into public.course_programmes (course_id, programme_slug)
  select p_course_id, s.slug from unnest(p_programme_slugs) s(slug)
  on conflict do nothing;
end $$;
revoke execute on function public.set_course_programmes(uuid, text[]) from public, anon, authenticated;

-- ── Units: the sub-folders of a course ──────────────────────────────────────
create table public.course_units (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses(id) on delete cascade,
  key         text not null check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title       text not null,
  -- What kind of folder this is. "reference" (publishers' textbooks) is hidden by default.
  kind        text not null default 'other'
              check (kind in ('module', 'pyq', 'syllabus', 'lab', 'revision', 'notes', 'reference', 'other')),
  -- Hidden units are never listed, previewed, sold or converted.
  is_hidden   boolean not null default false,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (course_id, key),
  unique (id, course_id) -- target of the composite FK below
);
create trigger course_units_updated_at before update on public.course_units
  for each row execute function public.set_updated_at();
create trigger course_units_audit after update of is_hidden, title, kind on public.course_units
  for each row execute function public.audit_row('id');
comment on table public.course_units is 'Sub-folders of a course: modules, PYQs, syllabus, lab files, reference books.';

-- ── Files ───────────────────────────────────────────────────────────────────
create table public.course_files (
  id                 uuid primary key default gen_random_uuid(),
  course_id          uuid not null,
  unit_id            uuid not null,
  name               text not null,
  format             text not null check (format in ('pdf', 'pptx', 'docx', 'image')),
  size_bytes         bigint not null default 0 check (size_bytes >= 0),
  page_count         int not null default 0 check (page_count >= 0),
  source_key         text not null unique,
  source_etag        text not null default '',
  conversion_status  text not null default 'pending' check (conversion_status in ('pending', 'ready', 'failed')),
  conversion_error   text,
  converted_at       timestamptz,
  -- Watermarked, unscrambled page 1 in R2 (public preview).
  preview_key        text,
  is_hidden          boolean not null default false,
  sort               int not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- The unit must belong to the same course (no cross-course mix-ups).
  foreign key (unit_id, course_id) references public.course_units(id, course_id) on delete cascade
);
create index course_files_course_idx on public.course_files (course_id, sort);
create index course_files_unit_idx on public.course_files (unit_id, sort);
create index course_files_pending_idx on public.course_files (course_id) where conversion_status = 'pending';
create trigger course_files_updated_at before update on public.course_files
  for each row execute function public.set_updated_at();
create trigger course_files_audit after update of is_hidden on public.course_files
  for each row execute function public.audit_row('id');
comment on table public.course_files is 'Every file of a course, mirrored from R2 by the importer.';

-- ── Page images (server only: tile seeds are secret) ────────────────────────
create table public.file_pages (
  file_id     uuid not null references public.course_files(id) on delete cascade,
  page_no     int not null check (page_no >= 1),
  image_key   text not null,
  tile_seed   text not null,
  created_at  timestamptz not null default now(),
  primary key (file_id, page_no)
);
comment on table public.file_pages is 'Scrambled page images in R2 and their tile seeds. No browser policy: server only.';

-- ── Row-level security ──────────────────────────────────────────────────────
alter table public.courses enable row level security;
alter table public.course_programmes enable row level security;
alter table public.course_units enable row level security;
alter table public.course_files enable row level security;
alter table public.file_pages enable row level security;

create policy "vit users read live courses" on public.courses
  for select using (public.is_vit_user() and status = 'live');
create policy "vit users read live placements" on public.course_programmes
  for select using (
    public.is_vit_user()
    and exists (select 1 from public.courses c where c.id = course_id and c.status = 'live')
  );
create policy "vit users read visible units" on public.course_units
  for select using (
    public.is_vit_user() and not is_hidden
    and exists (select 1 from public.courses c where c.id = course_id and c.status = 'live')
  );
create policy "vit users read visible files" on public.course_files
  for select using (
    public.is_vit_user() and not is_hidden
    and exists (select 1 from public.course_units u where u.id = unit_id and not u.is_hidden)
    and exists (select 1 from public.courses c where c.id = course_id and c.status = 'live')
  );
-- file_pages: RLS on, no policy.
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261023000300', 'content');
end $migration$;

-- ═══ 20261023000400_accounts ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261023000400') then
    raise notice 'skip 20261023000400';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- 0400 · Accounts: profiles, the college-only gate, devices, per-device sessions,
-- one open reader.
-- ════════════════════════════════════════════════════════════════════════════

create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text not null unique check (email = lower(email)),
  full_name        text check (full_name is null or length(full_name) <= 80),
  email_opt_in     boolean not null default true,
  unsubscribed_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index profiles_mailable_idx on public.profiles (id) where email_opt_in;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
comment on table public.profiles is 'One row per signed-in student, created by the auth trigger.';

-- Before User Created hook (Authentication → Hooks): keeps non-college emails out.
create or replace function public.hook_vit_only(event jsonb)
returns jsonb language plpgsql as $$
declare
  email text := lower(coalesce(event -> 'user' ->> 'email', ''));
begin
  if email !~ '^[a-z0-9._%+-]+@vitbhopal\.ac\.in$' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Please sign in with your @vitbhopal.ac.in email.'));
  end if;
  return '{}'::jsonb;
end $$;
grant execute on function public.hook_vit_only(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_vit_only(jsonb) from authenticated, anon, public;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(new.email), new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Devices (the API enforces MAX_DEVICES, default 2) ───────────────────────
create table public.devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  label         text not null check (length(label) <= 80),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz
);
create index devices_user_active_idx on public.devices (user_id) where revoked_at is null;
create index devices_user_revoked_idx on public.devices (user_id, revoked_at desc) where revoked_at is not null;

-- One live session per device; a later migration makes (user_id, device_id) the key.
create table public.active_sessions (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  session_id  text not null,
  device_id   uuid not null references public.devices(id) on delete cascade,
  updated_at  timestamptz not null default now()
);

-- Exactly one open reader per student.
create table public.viewer_leases (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  lease_id    text not null,
  device_id   uuid not null references public.devices(id) on delete cascade,
  file_id     uuid not null references public.course_files(id) on delete cascade,
  expires_at  timestamptz not null
);

alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.active_sessions enable row level security;
alter table public.viewer_leases enable row level security;
create policy "users read own profile" on public.profiles for select using (id = auth.uid());
create policy "users read own devices" on public.devices for select using (user_id = auth.uid());
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261023000400', 'accounts');
end $migration$;

-- ═══ 20261023000500_commerce ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261023000500') then
    raise notice 'skip 20261023000500';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- 0500 · Commerce: bundles, orders (one course or one bundle), what each order
-- grants (order_items), and access (entitlements). All sales are final; a lost
-- bank dispute is the only thing that removes access.
-- ════════════════════════════════════════════════════════════════════════════

create table public.bundles (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title         text not null check (length(title) between 2 and 120),
  description   text not null default '',
  batch_year    int references public.batches(year) on update cascade,
  price_paise   int not null check (price_paise between 100 and 5000000),
  status        text not null default 'draft' check (status in ('draft', 'live', 'archived')),
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger bundles_updated_at before update on public.bundles
  for each row execute function public.set_updated_at();
create trigger bundles_published_at before insert or update of status on public.bundles
  for each row execute function public.stamp_published_at();
create trigger bundles_audit after insert or update or delete on public.bundles
  for each row execute function public.audit_row('id');

create table public.bundle_courses (
  bundle_id  uuid not null references public.bundles(id) on delete cascade,
  course_id  uuid not null references public.courses(id) on delete cascade,
  sort       int not null default 0,
  primary key (bundle_id, course_id)
);
create index bundle_courses_course_idx on public.bundle_courses (course_id);

-- ── Orders ──────────────────────────────────────────────────────────────────
create table public.orders (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  -- Exactly what was bought: a course or a bundle.
  course_id           uuid references public.courses(id),
  bundle_id           uuid references public.bundles(id),
  amount_paise        int not null check (amount_paise > 0),
  currency            text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  gateway             text not null default 'razorpay',
  gateway_order_id    text not null unique,
  gateway_payment_id  text unique,
  status              text not null default 'created' check (status in ('created', 'paid', 'failed', 'disputed')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (num_nonnulls(course_id, bundle_id) >= 1)
);
create index orders_user_idx on public.orders (user_id, created_at desc);
create index orders_paid_idx on public.orders (created_at) where status = 'paid';
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

-- What an order grants, frozen at purchase time: editing a bundle later never
-- changes what an earlier buyer received.
create table public.order_items (
  order_id   uuid not null references public.orders(id) on delete cascade,
  course_id  uuid not null references public.courses(id),
  primary key (order_id, course_id)
);
create index order_items_course_idx on public.order_items (course_id);

create table public.entitlements (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  course_id   uuid not null references public.courses(id),
  order_id    uuid not null references public.orders(id),
  granted_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  primary key (user_id, course_id)
);
create index entitlements_course_idx on public.entitlements (course_id) where revoked_at is null;
create index entitlements_order_idx on public.entitlements (order_id);

-- ── Functions ───────────────────────────────────────────────────────────────
-- Create an order and its items atomically. Returns the order with course_ids.
create or replace function public.create_order(
  p_user_id uuid,
  p_course_id uuid,
  p_bundle_id uuid,
  p_course_ids uuid[],
  p_amount_paise int,
  p_gateway_order_id text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if coalesce(cardinality(p_course_ids), 0) < 1 then
    raise exception 'An order must grant at least one course' using errcode = '22023';
  end if;
  insert into public.orders (user_id, course_id, bundle_id, amount_paise, gateway_order_id)
  values (p_user_id, p_course_id, p_bundle_id, p_amount_paise, p_gateway_order_id)
  returning * into o;
  insert into public.order_items (order_id, course_id)
  select o.id, c from unnest(p_course_ids) c
  on conflict do nothing;
  return to_jsonb(o) || jsonb_build_object('course_ids', to_jsonb(p_course_ids));
end $$;

-- Mark paid and grant every course in one transaction. Safe to call twice
-- (checkout callback and webhook can both arrive): the second call changes nothing.
create or replace function public.grant_order(p_gateway_order_id text, p_gateway_payment_id text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  select * into o from public.orders where gateway_order_id = p_gateway_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if o.status <> 'paid' then
    update public.orders set status = 'paid', gateway_payment_id = p_gateway_payment_id where id = o.id;
  end if;
  insert into public.entitlements (user_id, course_id, order_id)
  select o.user_id, i.course_id, o.id from public.order_items i where i.order_id = o.id
  on conflict (user_id, course_id) do update
    set revoked_at = null, order_id = excluded.order_id, granted_at = now()
    where public.entitlements.revoked_at is not null;
  return o.id;
end $$;

-- A lost bank dispute removes what that payment granted.
create or replace function public.revoke_by_payment(p_gateway_payment_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.orders set status = 'disputed' where gateway_payment_id = p_gateway_payment_id;
  update public.entitlements e set revoked_at = now()
    from public.orders o
   where o.gateway_payment_id = p_gateway_payment_id and e.order_id = o.id and e.revoked_at is null;
end $$;

revoke execute on function public.create_order(uuid, uuid, uuid, uuid[], int, text) from public, anon, authenticated;
revoke execute on function public.grant_order(text, text) from public, anon, authenticated;
revoke execute on function public.revoke_by_payment(text) from public, anon, authenticated;

alter table public.bundles enable row level security;
alter table public.bundle_courses enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.entitlements enable row level security;
create policy "vit users read live bundles" on public.bundles
  for select using (public.is_vit_user() and status = 'live');
create policy "vit users read live bundle contents" on public.bundle_courses
  for select using (
    public.is_vit_user()
    and exists (select 1 from public.bundles b where b.id = bundle_id and b.status = 'live')
  );
create policy "buyers read own orders" on public.orders for select using (user_id = auth.uid());
create policy "buyers read own order items" on public.order_items
  for select using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()));
create policy "buyers read own entitlements" on public.entitlements for select using (user_id = auth.uid());
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261023000500', 'commerce');
end $migration$;

-- ═══ 20261023000600_reading ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261023000600') then
    raise notice 'skip 20261023000600';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- 0600 · Reading: where each student stopped, and a daily page log that backs
-- the per-day page limit and sharing investigations.
-- ════════════════════════════════════════════════════════════════════════════

create table public.reading_progress (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  file_id     uuid not null references public.course_files(id) on delete cascade,
  page        int not null check (page >= 1),
  updated_at  timestamptz not null default now(),
  primary key (user_id, file_id)
);
create index reading_progress_recent_idx on public.reading_progress (user_id, updated_at desc);

-- One row per student, file and day. Prune rows older than 30 days (see DATABASE.md).
create table public.access_logs (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  file_id       uuid not null references public.course_files(id) on delete cascade,
  day           date not null default current_date,
  pages_viewed  int not null default 0 check (pages_viewed >= 0),
  ip_hash       text,
  user_agent    text,
  primary key (user_id, file_id, day)
);
create index access_logs_user_day_idx on public.access_logs (user_id, day);
create index access_logs_day_idx on public.access_logs (day);

-- Add pages to today's row and return the student's total for today.
create or replace function public.log_pages(p_user uuid, p_file uuid, p_pages int, p_ip_hash text, p_ua text)
returns int language plpgsql security definer set search_path = public as $$
declare
  total int;
begin
  insert into public.access_logs (user_id, file_id, day, pages_viewed, ip_hash, user_agent)
  values (p_user, p_file, current_date, p_pages, p_ip_hash, p_ua)
  on conflict (user_id, file_id, day)
  do update set pages_viewed = public.access_logs.pages_viewed + excluded.pages_viewed,
                ip_hash = excluded.ip_hash, user_agent = excluded.user_agent;
  select coalesce(sum(pages_viewed), 0) into total
    from public.access_logs where user_id = p_user and day = current_date;
  return total;
end $$;
revoke execute on function public.log_pages(uuid, uuid, int, text, text) from public, anon, authenticated;

-- Housekeeping, safe to run any time (a GitHub Action or pg_cron can call it).
create or replace function public.prune_access_logs(p_keep_days int default 30)
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  delete from public.access_logs where day < current_date - p_keep_days;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.prune_access_logs(int) from public, anon, authenticated;

alter table public.reading_progress enable row level security;
alter table public.access_logs enable row level security;
create policy "readers read own progress" on public.reading_progress for select using (user_id = auth.uid());
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261023000600', 'reading');
end $migration$;

-- ═══ 20261023000700_engagement ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261023000700') then
    raise notice 'skip 20261023000700';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- 0700 · Engagement: the free toolbox and feature-announcement emails.
-- ════════════════════════════════════════════════════════════════════════════

create table public.features (
  key         text primary key check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title       text not null check (length(title) between 2 and 60),
  blurb       text not null default '' check (length(blurb) <= 200),
  status      text not null default 'soon' check (status in ('soon', 'live', 'hidden')),
  sort        int not null default 0,
  launched_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger features_updated_at before update on public.features
  for each row execute function public.set_updated_at();
create trigger features_audit after insert or update or delete on public.features
  for each row execute function public.audit_row('key');

create or replace function public.stamp_launched_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'live' and new.launched_at is null then
    new.launched_at := now();
  end if;
  return new;
end $$;
create trigger features_launched_at before insert or update of status on public.features
  for each row execute function public.stamp_launched_at();
comment on table public.features is 'Free tools on the home page (/tools/<key>). Open to everyone.';

create table public.announcements (
  id           uuid primary key default gen_random_uuid(),
  subject      text not null check (length(subject) between 3 and 140),
  heading      text not null,
  body         text not null,
  cta_label    text not null default '',
  cta_url      text not null default '',
  feature_key  text references public.features(key) on update cascade on delete set null,
  status       text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'failed')),
  recipients   int not null default 0 check (recipients >= 0),
  sent         int not null default 0 check (sent >= 0),
  -- Last profile id already mailed: sending resumes after it (daily quota, retries).
  cursor_id    uuid,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  sent_at      timestamptz
);
create index announcements_sending_idx on public.announcements (created_at) where status = 'sending';
create trigger announcements_updated_at before update on public.announcements
  for each row execute function public.set_updated_at();

-- Emails sent per day across all announcements (provider's daily cap).
create table public.email_quota (
  day   date primary key,
  sent  int not null default 0 check (sent >= 0)
);

create or replace function public.add_email_quota(p_day date, p_count int)
returns int language plpgsql security definer set search_path = public as $$
declare
  total int;
begin
  insert into public.email_quota (day, sent) values (p_day, p_count)
  on conflict (day) do update set sent = public.email_quota.sent + excluded.sent
  returning sent into total;
  return total;
end $$;
revoke execute on function public.add_email_quota(date, int) from public, anon, authenticated;

alter table public.features enable row level security;
alter table public.announcements enable row level security; -- server only
alter table public.email_quota enable row level security;   -- server only
create policy "anyone reads visible features" on public.features for select using (status <> 'hidden');
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261023000700', 'engagement');
end $migration$;

-- ═══ 20261023000800_reporting ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261023000800') then
    raise notice 'skip 20261023000800';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- 0800 · Reporting views
-- Read-only views for the admin, the Supabase table editor and future
-- dashboards. security_invoker = on, so they obey the caller's RLS: the
-- browser sees nothing extra, the server (secret key) sees everything.
-- ════════════════════════════════════════════════════════════════════════════

-- One row per course: size, conversion progress and sales.
create view public.course_overview with (security_invoker = on) as
select
  c.id,
  c.slug,
  c.title,
  c.subject_code,
  c.batch_year,
  c.primary_programme_slug,
  c.status,
  c.price_paise,
  c.published_at,
  coalesce(f.files, 0)        as files,
  coalesce(f.visible_files, 0) as visible_files,
  coalesce(f.pages, 0)        as pages,
  coalesce(f.pending, 0)      as pending_files,
  coalesce(f.failed, 0)       as failed_files,
  coalesce(f.previews, 0)     as previews,
  coalesce(u.units, 0)        as units,
  coalesce(u.hidden_units, 0) as hidden_units,
  coalesce(e.buyers, 0)       as buyers,
  coalesce(p.programmes, '{}') as programmes
from public.courses c
left join lateral (
  select count(*) as files,
         count(*) filter (where not cf.is_hidden and not cu.is_hidden) as visible_files,
         sum(cf.page_count) filter (where not cf.is_hidden and not cu.is_hidden) as pages,
         count(*) filter (where cf.conversion_status = 'pending' and not cf.is_hidden and not cu.is_hidden) as pending,
         count(*) filter (where cf.conversion_status = 'failed' and not cf.is_hidden and not cu.is_hidden) as failed,
         count(cf.preview_key) as previews
    from public.course_files cf join public.course_units cu on cu.id = cf.unit_id
   where cf.course_id = c.id
) f on true
left join lateral (
  select count(*) as units, count(*) filter (where is_hidden) as hidden_units
    from public.course_units where course_id = c.id
) u on true
left join lateral (
  select count(*) as buyers from public.entitlements where course_id = c.id and revoked_at is null
) e on true
left join lateral (
  select array_agg(programme_slug order by programme_slug) as programmes
    from public.course_programmes where course_id = c.id
) p on true;
comment on view public.course_overview is 'Per-course health and sales at a glance.';

-- Paid revenue per day (IST), split into single courses and bundles.
create view public.sales_daily with (security_invoker = on) as
select
  (o.created_at at time zone 'Asia/Kolkata')::date as day,
  count(*)                                        as orders,
  count(*) filter (where o.bundle_id is not null) as bundle_orders,
  sum(o.amount_paise)                             as revenue_paise
from public.orders o
where o.status = 'paid'
group by 1;
comment on view public.sales_daily is 'Paid orders and revenue per IST day.';
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261023000800', 'reporting');
end $migration$;

-- ═══ 20261023000900_reference_data ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261023000900') then
    raise notice 'skip 20261023000900';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- 0900 · Reference data the site needs to work in production.
-- Idempotent: re-running updates names and adds missing rows, never deletes.
-- Change programmes and curricula here (new migration) or in the table editor.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.programmes (slug, code, name, short_name, tagline, description, sort) values
  ('bai', 'BAI', 'B.Tech Artificial Intelligence', 'B.Tech AI', 'AI, Data Science & Machine Learning',
   'Complete semester study pack for B.Tech AI students at VIT Bhopal.', 0),
  ('bce', 'BCE', 'B.Tech Computer Engineering', 'B.Tech CE', 'Systems, Electronics & Core CS',
   'Complete semester study pack for B.Tech CE students at VIT Bhopal.', 1),
  ('bcg', 'BCG', 'B.Tech CS (Game Development)', 'B.Tech CG', 'Game Development & CS Fundamentals',
   'Complete semester study pack for B.Tech CG students at VIT Bhopal.', 2),
  ('bey', 'BEY', 'B.Tech ECY', 'B.Tech ECY', 'Electronics, Computer Science & Yield',
   'Complete semester study pack for B.Tech ECY students at VIT Bhopal.', 3),
  ('bsa', 'BSA', 'B.Tech Computational Sciences', 'B.Tech SA', 'Data, Cloud & Applied Computing',
   'Complete semester study pack for B.Tech SA students at VIT Bhopal.', 4),
  ('mim', 'MIM', 'M.Tech Integrated Management', 'M.Tech IM', 'Management, CS & Business Analytics',
   'Complete semester study pack for M.Tech IM students at VIT Bhopal.', 5)
on conflict (slug) do update set
  code = excluded.code, name = excluded.name, short_name = excluded.short_name,
  tagline = excluded.tagline, description = excluded.description, sort = excluded.sort;

-- Subjects. Titles come from the folder names in R2 (drive-imports/23 Batch/…);
-- codes without a folder yet keep an empty title until they are imported.
insert into public.subjects (code, title) values
  ('CHY1005', 'Introduction to Computational Chemistry'),
  ('CHY1006', 'Environmental Sustainability'),
  ('CSD1001', 'Principles of Digital Forensics'),
  ('CSD3009', 'Data Structures and Analysis of Algorithms'),
  ('CSE1021', 'Introduction to Problem Solving and Programming'),
  ('CSE2001', 'Object Oriented Programming with C++'),
  ('CSE2003', 'Computer Architecture and Organization'),
  ('CSE2006', 'Programming in Java'),
  ('CSE3001', 'Database Management Systems'),
  ('CSE3003', 'Operating Systems'),
  ('CSE3004', 'Design and Analysis of Algorithms'),
  ('CSE3011', 'Python Programming'),
  ('ECE2002', 'Digital Logic Design'),
  ('ECE2003', 'Signals and Systems'),
  ('EEE1001', 'Electric Circuits and Systems'),
  ('ENG2005', 'Advanced Technical Communication'),
  ('HUM1002', 'Emotional Intelligence'),
  ('MAT1001', 'Calculus and Laplace Transforms'),
  ('MAT2001', 'Differential and Difference Equations'),
  ('MAT2002', 'Discrete Mathematics and Graph Theory'),
  ('MAT3002', 'Applied Linear Algebra'),
  ('MAT3003', 'Probability, Statistics and Reliability'),
  ('MEE2014', 'Engineering Design and Modelling'),
  ('MGT2003', 'Technology Entrepreneurship'),
  ('PHY1003', 'Introduction to Computational Physics'),
  ('SST1003', 'Professional Communication Skills for Engineers'),
  ('CCA2002', ''), ('CDS3005', ''), ('CSA2001', ''), ('CSE2002', ''), ('CSG2006', ''),
  ('ECE3004', ''), ('MAT2003', ''), ('MGT1002', ''), ('PHY1005', '')
on conflict (code) do update set
  title = case when public.subjects.title = '' then excluded.title else public.subjects.title end;

-- Curriculum: which programme studies which subject (pre-selects tabs on import).
insert into public.programme_subjects (programme_slug, subject_code)
select p, s from (values
  ('bai', array['CSE2001','CSD3009','MAT3002','MAT3003','CSE3003','CDS3005','CSE3011','CSE3001','PHY1003','CSD1001']),
  ('bce', array['CSE2001','CSE2002','CSE2006','CSA2001','CSE3001','ECE2002','MEE2014','CSE2003','MAT3002']),
  ('bcg', array['CSG2006','PHY1005','CSE2002','CSE3003','CSE3004','MAT3002','SST1003','ECE2002']),
  ('bey', array['ECE2002','ECE2003','CSE2002','CSE2006','CSE3001','MAT2003','CHY1006','EEE1001','ECE3004']),
  ('bsa', array['MAT2002','CCA2002','CSE3003','CSD3009','SST1003','CDS3005','CSE3001']),
  ('mim', array['MAT2002','CSE2002','CSA2001','SST1003','MGT1002','MGT2003','CSE3004'])
) as m(p, codes), unnest(m.codes) as s
on conflict do nothing;

insert into public.features (key, title, blurb, status, sort) values
  ('cgpa', 'CGPA calculator', 'Add your grades and credits, see your CGPA and what you need next semester.', 'soon', 1),
  ('timetable', 'Timetable maker', 'Pick your slots and get a clash-free weekly timetable you can save.', 'soon', 2)
on conflict (key) do nothing;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261023000900', 'reference_data');
end $migration$;

-- ═══ 20261023001000_crosslist_23_batch_courses ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261023001000') then
    raise notice 'skip 20261023001000';
    return;
  end if;
  execute $m$-- The owner requested that these six 23 Batch courses appear under every
-- active programme section. Keep this curriculum in sync with branch-catalog.ts.
insert into public.programme_subjects (programme_slug, subject_code)
select p.slug, s.code
from public.programmes p
cross join (values
  ('ENG2005'),
  ('MAT1001'),
  ('MAT2001'),
  ('HUM1002'),
  ('CHY1005'),
  ('CSE1021')
) as s(code)
where p.is_active
on conflict (programme_slug, subject_code) do nothing;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261023001000', 'crosslist_23_batch_courses');
end $migration$;

-- ═══ 20261023001100_two_device_sessions ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261023001100') then
    raise notice 'skip 20261023001100';
    return;
  end if;
  execute $m$-- Keep one current Supabase auth session for each of the account's registered devices.
-- The device table remains the source of truth for the two-device account limit.
alter table public.active_sessions drop constraint active_sessions_pkey;
alter table public.active_sessions
  add constraint active_sessions_pkey primary key (user_id, device_id);

create index active_sessions_user_idx on public.active_sessions (user_id);
create unique index active_sessions_user_session_idx on public.active_sessions (user_id, session_id);

-- Serialize new-device registration by locking the owning profile. The application
-- also checks MAX_DEVICES for a friendly response; this database guard closes races.
create or replace function public.enforce_two_device_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from public.profiles where id = new.user_id for update;
  if (
    select count(*)
    from public.devices
    where user_id = new.user_id
      and (revoked_at is null or revoked_at > now())
  ) >= 2 then
    raise exception 'SS_DEVICE_LIMIT' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger devices_two_device_limit
before insert on public.devices
for each row execute function public.enforce_two_device_limit();
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261023001100', 'two_device_sessions');
end $migration$;

-- ═══ 20261023001200_conversion_progress ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261023001200') then
    raise notice 'skip 20261023001200';
    return;
  end if;
  execute $m$-- Persist the converter's current phase so the admin audit can distinguish queued,
-- running, R2 verification and Supabase registration for every file.
alter table public.course_files
  add column if not exists conversion_stage text
    check (conversion_stage in (
      'queued', 'downloading_source', 'validating_source', 'rendering_pages',
      'clearing_previous_pages', 'writing_preview', 'writing_pages', 'verifying_r2', 'saving_manifest',
      'complete', 'failed'
    )),
  add column if not exists conversion_error_stage text
    check (conversion_error_stage in (
      'downloading_source', 'validating_source', 'rendering_pages',
      'clearing_previous_pages', 'writing_preview', 'writing_pages', 'verifying_r2', 'saving_manifest', 'dispatch'
    )),
  add column if not exists conversion_progress_current int not null default 0 check (conversion_progress_current >= 0),
  add column if not exists conversion_progress_total int not null default 0 check (conversion_progress_total >= 0),
  add column if not exists conversion_queue_id uuid,
  add column if not exists conversion_queue_position int not null default 0 check (conversion_queue_position >= 0),
  add column if not exists conversion_queue_total int not null default 0 check (conversion_queue_total >= 0),
  add column if not exists conversion_updated_at timestamptz;

create index if not exists course_files_conversion_queue_idx
  on public.course_files (conversion_queue_id, conversion_queue_position)
  where conversion_queue_id is not null;

comment on column public.course_files.conversion_stage is
  'Most recent sequential R2 conversion stage reported to the admin audit.';
comment on column public.course_files.conversion_error_stage is
  'Exact conversion phase that failed, or dispatch when GitHub could not start the run.';
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261023001200', 'conversion_progress');
end $migration$;

-- ═══ 20261023001300_r2_source_reconciliation ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261023001300') then
    raise notice 'skip 20261023001300';
    return;
  end if;
  execute $m$-- Keep removed source files visible to admins for audit/history while making them
-- unavailable to students. Student reading progress and access logs remain attached.
alter table public.course_files
  add column if not exists source_missing_at timestamptz;

create index if not exists course_files_source_missing_idx
  on public.course_files (course_id, source_missing_at)
  where source_missing_at is not null;

comment on column public.course_files.source_missing_at is
  'Set after a complete scoped R2 scan no longer finds source_key; the file stays hidden for audit and history.';
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261023001300', 'r2_source_reconciliation');
end $migration$;

-- ═══ 20261024000100_admin_email_override ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261024000100') then
    raise notice 'skip 20261024000100';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- 0001 · Allow admin emails (e.g. vitbsmashers@gmail.com) in before-user-created hook
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.hook_vit_only(event jsonb)
returns jsonb language plpgsql as $$
declare
  email text := lower(coalesce(event -> 'user' ->> 'email', ''));
begin
  -- Admin emails bypass the college domain restriction
  if email in ('vitbsmashers@gmail.com') then
    return '{}'::jsonb;
  end if;

  if email !~ '^[a-z0-9._%+-]+@vitbhopal\.ac\.in$' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Please sign in with your @vitbhopal.ac.in email.'));
  end if;
  return '{}'::jsonb;
end $$;

grant execute on function public.hook_vit_only(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_vit_only(jsonb) from authenticated, anon, public;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261024000100', 'admin_email_override');
end $migration$;

-- ═══ 20261024000200_admins_and_access_periods ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261024000200') then
    raise notice 'skip 20261024000200';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- Admin allowlist (replaces the hard-coded address) and course access periods.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Who may sign up without a college address ───────────────────────────────
-- Exact, lower-case addresses only. No policies: only the service role and the
-- sign-up hook (security definer) can read it; students can't see or change it.
create table if not exists public.admin_emails (
  email      text primary key
             check (email = lower(btrim(email))
                    and octet_length(email) = char_length(email)        -- ASCII only
                    and email ~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$'),
  added_at   timestamptz not null default now()
);
alter table public.admin_emails enable row level security;
revoke all on public.admin_emails from anon, authenticated, public;
comment on table public.admin_emails is
  'Exact addresses allowed to sign up outside the college domain (admins). Keep in step with ADMIN_EMAILS.';

insert into public.admin_emails (email) values ('vitbsmashers@gmail.com') on conflict do nothing;

-- Sign-up gate. A college address must be exactly name@vitbhopal.ac.in: ASCII letters, digits,
-- dots, hyphens, underscores; no "+tags", no leading, trailing or doubled dots (so one inbox
-- can't become several accounts). Anything else must be on the admin list, exactly.
create or replace function public.hook_vit_only(event jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(event -> 'user' ->> 'email', '')));
  college boolean :=
    octet_length(v_email) = char_length(v_email)
    and v_email ~ '^[a-z0-9][a-z0-9._-]*@vitbhopal\.ac\.in$'
    and v_email !~ '\.\.'
    and v_email !~ '\.@';
begin
  if college or exists (select 1 from public.admin_emails a where a.email = v_email) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Please sign in with your @vitbhopal.ac.in email.'));
end $$;

grant execute on function public.hook_vit_only(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_vit_only(jsonb) from authenticated, anon, public;

-- ── Access periods ──────────────────────────────────────────────────────────
-- A course may have a term end. New purchases get access until then; null means no end.
alter table public.courses add column if not exists access_until timestamptz;
comment on column public.courses.access_until is
  'Term end for this course. Purchases made while it is set get access until this moment.';

-- Each purchase can end (expires_at) or be blocked by an admin (revoked_at + reason).
alter table public.entitlements add column if not exists expires_at timestamptz;
alter table public.entitlements add column if not exists revoke_reason text
  check (revoke_reason is null or revoke_reason in ('admin', 'dispute'));
create index if not exists entitlements_user_active_idx
  on public.entitlements (user_id) where revoked_at is null;

-- Disputes keep their reason so an admin "restore" never undoes a lost chargeback by accident.
update public.entitlements set revoke_reason = 'dispute'
 where revoked_at is not null and revoke_reason is null;

-- Paying grants (or renews) access: an ended or blocked purchase becomes active again with the
-- course's current term end. An active one is left alone, so the callback and webhook can both
-- arrive safely.
create or replace function public.grant_order(p_gateway_order_id text, p_gateway_payment_id text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  select * into o from public.orders where gateway_order_id = p_gateway_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if o.status <> 'paid' then
    update public.orders set status = 'paid', gateway_payment_id = p_gateway_payment_id where id = o.id;
  end if;
  insert into public.entitlements (user_id, course_id, order_id, expires_at)
  select o.user_id, i.course_id, o.id,
         case when c.access_until > now() then c.access_until end
    from public.order_items i join public.courses c on c.id = i.course_id
   where i.order_id = o.id
  on conflict (user_id, course_id) do update
    set revoked_at = null, revoke_reason = null, order_id = excluded.order_id,
        granted_at = now(), expires_at = excluded.expires_at
    where public.entitlements.revoked_at is not null
       or (public.entitlements.expires_at is not null and public.entitlements.expires_at <= now());
  return o.id;
end $$;

create or replace function public.revoke_by_payment(p_gateway_payment_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.orders set status = 'disputed' where gateway_payment_id = p_gateway_payment_id;
  update public.entitlements e set revoked_at = now(), revoke_reason = 'dispute'
    from public.orders o
   where o.gateway_payment_id = p_gateway_payment_id and e.order_id = o.id and e.revoked_at is null;
end $$;

revoke execute on function public.grant_order(text, text) from public, anon, authenticated;
revoke execute on function public.revoke_by_payment(text) from public, anon, authenticated;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261024000200', 'admins_and_access_periods');
end $migration$;

-- ═══ 20261024000300_admin_grants ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261024000300') then
    raise notice 'skip 20261024000300';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- An admin can give a course to a student directly (no payment). Such access has no order,
-- and records who gave it, so the history always says where every access came from.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.entitlements alter column order_id drop not null;
alter table public.entitlements add column if not exists granted_by text not null default 'purchase'
  check (granted_by in ('purchase', 'admin'));
alter table public.entitlements add column if not exists granted_by_admin text;
alter table public.entitlements drop constraint if exists entitlements_source_chk;
alter table public.entitlements add constraint entitlements_source_chk check (
  (granted_by = 'purchase' and order_id is not null)
  or (granted_by = 'admin' and granted_by_admin is not null)
);
comment on column public.entitlements.granted_by is 'purchase: paid order. admin: given by an admin (granted_by_admin).';

-- A purchase (re)activates access and records that it was bought.
create or replace function public.grant_order(p_gateway_order_id text, p_gateway_payment_id text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  select * into o from public.orders where gateway_order_id = p_gateway_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if o.status <> 'paid' then
    update public.orders set status = 'paid', gateway_payment_id = p_gateway_payment_id where id = o.id;
  end if;
  insert into public.entitlements (user_id, course_id, order_id, expires_at, granted_by)
  select o.user_id, i.course_id, o.id,
         case when c.access_until > now() then c.access_until end, 'purchase'
    from public.order_items i join public.courses c on c.id = i.course_id
   where i.order_id = o.id
  on conflict (user_id, course_id) do update
    set revoked_at = null, revoke_reason = null, order_id = excluded.order_id,
        granted_at = now(), expires_at = excluded.expires_at,
        granted_by = 'purchase', granted_by_admin = null
    where public.entitlements.revoked_at is not null
       or (public.entitlements.expires_at is not null and public.entitlements.expires_at <= now());
  return o.id;
end $$;

revoke execute on function public.grant_order(text, text) from public, anon, authenticated;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261024000300', 'admin_grants');
end $migration$;

-- ═══ 20261024000400_access_notices ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261024000400') then
    raise notice 'skip 20261024000400';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- "Your access has ended" emails: each ended access is emailed once. Renewing access
-- (buying again, an admin extending or giving it) clears the mark, so a later end is
-- announced again.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.entitlements add column if not exists end_notified_at timestamptz;
create index if not exists entitlements_ended_unnotified_idx
  on public.entitlements (expires_at)
  where revoked_at is null and end_notified_at is null and expires_at is not null;

create or replace function public.grant_order(p_gateway_order_id text, p_gateway_payment_id text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  select * into o from public.orders where gateway_order_id = p_gateway_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if o.status <> 'paid' then
    update public.orders set status = 'paid', gateway_payment_id = p_gateway_payment_id where id = o.id;
  end if;
  insert into public.entitlements (user_id, course_id, order_id, expires_at, granted_by)
  select o.user_id, i.course_id, o.id,
         case when c.access_until > now() then c.access_until end, 'purchase'
    from public.order_items i join public.courses c on c.id = i.course_id
   where i.order_id = o.id
  on conflict (user_id, course_id) do update
    set revoked_at = null, revoke_reason = null, order_id = excluded.order_id,
        granted_at = now(), expires_at = excluded.expires_at,
        granted_by = 'purchase', granted_by_admin = null, end_notified_at = null
    where public.entitlements.revoked_at is not null
       or (public.entitlements.expires_at is not null and public.entitlements.expires_at <= now());
  return o.id;
end $$;

revoke execute on function public.grant_order(text, text) from public, anon, authenticated;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261024000400', 'access_notices');
end $migration$;

-- ═══ 20261025000100_problem_reports ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261025000100') then
    raise notice 'skip 20261025000100';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- Problems the admin should know about: unexpected errors in students' browsers (a page that
-- crashed, an image or page that would not load, a blocked script) and on the server. Grouped by
-- a fingerprint so a repeating problem is one row with a count, not thousands of rows.
-- Only the server (service role) reads or writes this table.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.problem_reports (
  fingerprint text primary key,
  source text not null check (source in ('browser', 'server')),
  kind text not null,
  message text not null,
  path text not null default '',
  detail text not null default '',
  user_agent text not null default '',
  count integer not null default 1,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now()
);
create index if not exists problem_reports_last_idx on public.problem_reports (last_at desc);
alter table public.problem_reports enable row level security;
revoke all on public.problem_reports from anon, authenticated;

create or replace function public.record_problem(
  p_fingerprint text, p_source text, p_kind text, p_message text, p_path text, p_detail text, p_user_agent text
) returns void language sql security definer set search_path = public as $$
  insert into public.problem_reports (fingerprint, source, kind, message, path, detail, user_agent)
  values (p_fingerprint, p_source, p_kind, left(p_message, 500), left(p_path, 300), left(p_detail, 2000), left(p_user_agent, 300))
  on conflict (fingerprint) do update
    set count = public.problem_reports.count + 1, last_at = now(),
        path = excluded.path, detail = excluded.detail, user_agent = excluded.user_agent;
  -- Keep the table small: at most 500 kinds of problem.
  delete from public.problem_reports
   where fingerprint in (select fingerprint from public.problem_reports order by last_at desc offset 500);
$$;
revoke execute on function public.record_problem(text, text, text, text, text, text, text) from public, anon, authenticated;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261025000100', 'problem_reports');
end $migration$;

-- ═══ 20261025000200_storage_map ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261025000200') then
    raise notice 'skip 20261025000200';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- Storage map for the admin: how big each table is, and a safe clean-up for checkouts that were
-- started but never paid (no money moved; Razorpay keeps its own record either way).
-- Both run only for the server (service role).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.storage_tables()
returns table (table_name text, row_count bigint, total_bytes bigint)
language sql security definer set search_path = public, pg_catalog as $$
  select c.relname::text,
         greatest(c.reltuples, 0)::bigint,
         pg_total_relation_size(c.oid)::bigint
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
   order by 3 desc;
$$;
revoke execute on function public.storage_tables() from public, anon, authenticated;

create or replace function public.clean_abandoned_orders(p_days integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  with gone as (
    delete from public.orders o
     where o.status in ('created', 'failed')
       and o.gateway_payment_id is null
       and o.created_at < now() - make_interval(days => greatest(p_days, 7))
       and not exists (select 1 from public.entitlements e where e.order_id = o.id)
    returning o.id
  )
  select count(*) into n from gone;
  return n;
end $$;
revoke execute on function public.clean_abandoned_orders(integer) from public, anon, authenticated;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261025000200', 'storage_map');
end $migration$;

-- ═══ 20261025000300_delete_course ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261025000300') then
    raise notice 'skip 20261025000300';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- Delete a course for good (admin). Refused when anyone bought or was given it: those rows are
-- the sales and access history. Checkouts that were started for it but never paid go with it.
-- Units, files, the page index, branch listings and bundle entries are removed by cascade.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.delete_course(p_course_id uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.courses where id = p_course_id) then
    return 'not-found';
  end if;
  if exists (select 1 from public.entitlements where course_id = p_course_id)
     or exists (
       select 1 from public.order_items i join public.orders o on o.id = i.order_id
        where i.course_id = p_course_id and (o.status = 'paid' or o.gateway_payment_id is not null))
     or exists (
       select 1 from public.orders o where o.course_id = p_course_id
          and (o.status = 'paid' or o.gateway_payment_id is not null)) then
    return 'sold';
  end if;
  delete from public.orders o
   where o.course_id = p_course_id
      or o.id in (select order_id from public.order_items where course_id = p_course_id);
  delete from public.courses where id = p_course_id;
  return 'deleted';
end $$;
revoke execute on function public.delete_course(uuid) from public, anon, authenticated;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261025000300', 'delete_course');
end $migration$;

-- ═══ 20261025000400_move_course_folder ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261025000400') then
    raise notice 'skip 20261025000400';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- Moving or renaming a course's folder in R2 from the admin panel. The files are copied first,
-- then this updates the course folder and every file's R2 path in one go, so the site never
-- points at a half-moved course. Generated pages are keyed by file id, so nothing is re-made.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.move_course_source(p_course_id uuid, p_prefix text, p_files jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_prefix !~ '/$' then
    raise exception 'folder must end with /' using errcode = '22023';
  end if;
  update public.courses set r2_prefix = p_prefix where id = p_course_id;
  if not found then
    raise exception 'course not found' using errcode = 'P0002';
  end if;
  update public.course_files f
     set source_key = x.source_key, source_etag = x.source_etag
    from jsonb_to_recordset(p_files) as x(file_id uuid, source_key text, source_etag text)
   where f.id = x.file_id and f.course_id = p_course_id;
end $$;
revoke execute on function public.move_course_source(uuid, text, jsonb) from public, anon, authenticated;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261025000400', 'move_course_folder');
end $migration$;

-- ═══ 20261025000500_attendance_tool ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261025000500') then
    raise notice 'skip 20261025000500';
    return;
  end if;
  execute $m$-- The attendance calculator joins the toolbox. It starts as "coming soon"; launch it from
-- Admin → Features & email when you're ready (that also emails students who asked).
insert into public.features (key, title, blurb, status, sort) values
  ('attendance', 'Attendance calculator', 'See if you can sit the exam, how many classes you can miss, and your attendance marks.', 'soon', 2)
on conflict (key) do nothing;
update public.features set sort = 3 where key = 'timetable' and sort = 2;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261025000500', 'attendance_tool');
end $migration$;

-- ═══ 20261025000600_contributions ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261025000600') then
    raise notice 'skip 20261025000600';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- Contributions: students upload their own notes (PDF, slides, documents, zip, photos) for the
-- admin to review. Files live in R2 under contributions/<user>/<id>/ and are never public; only
-- the admin can download them. Approving can reward the student (a free course, cash paid
-- outside the site, or a thank-you).
-- Only the server (service role) reads or writes these tables.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(title) between 3 and 120),
  course_hint text not null default '' check (length(course_hint) <= 120),
  kind text not null check (kind in ('notes', 'pyq', 'slides', 'lab', 'other')),
  description text not null default '' check (length(description) <= 1000),
  files jsonb not null default '[]'::jsonb,
  total_bytes bigint not null default 0,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text not null default '' check (length(review_note) <= 1000),
  reward jsonb,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists contributions_user_idx on public.contributions (user_id, created_at desc);
create index if not exists contributions_status_idx on public.contributions (status, created_at desc);
alter table public.contributions enable row level security;
revoke all on public.contributions from anon, authenticated;

-- Admin switches (contributions open or paused, and later others).
create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.site_settings enable row level security;
revoke all on public.site_settings from anon, authenticated;
insert into public.site_settings (key, value) values ('contributions_open', 'true'::jsonb)
on conflict (key) do nothing;

-- Someone who misuses uploads can be stopped from uploading without touching their courses.
alter table public.profiles add column if not exists contribution_blocked boolean not null default false;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261025000600', 'contributions');
end $migration$;

-- ═══ 20261026000100_earnings_royalties ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261026000100') then
    raise notice 'skip 20261026000100';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- Earnings per course, and royalties for students whose notes became a course.
--   • orders.paid_at: when the money arrived (royalties count sales from a date).
--   • sale_lines(): one row per paid course sale. A bundle payment is split across its
--     courses by their prices, so every rupee is counted once.
--   • course_royalties: who earns a share of a course's sales, from when, and how much (50%).
--   • royalty_payouts: what the admin has paid each contributor (paid outside the site).
-- Only the server (service role) reads these.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.orders add column if not exists paid_at timestamptz;
update public.orders set paid_at = updated_at where status = 'paid' and paid_at is null;

create or replace function public.stamp_paid_at() returns trigger language plpgsql as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    new.paid_at := coalesce(new.paid_at, now());
  end if;
  return new;
end $$;
drop trigger if exists orders_paid_at on public.orders;
create trigger orders_paid_at before update on public.orders
  for each row execute function public.stamp_paid_at();

create or replace function public.sale_lines()
returns table (order_id uuid, user_id uuid, course_id uuid, paid_at timestamptz, amount_paise bigint)
language sql stable security definer set search_path = public as $$
  select
    o.id,
    o.user_id,
    i.course_id,
    coalesce(o.paid_at, o.updated_at),
    case
      when count(*) over (partition by o.id) = 1 then o.amount_paise::bigint
      else round(
        o.amount_paise::numeric * greatest(c.price_paise, 1)
          / sum(greatest(c.price_paise, 1)) over (partition by o.id)
      )::bigint
    end
  from public.orders o
  join public.order_items i on i.order_id = o.id
  join public.courses c on c.id = i.course_id
  where o.status = 'paid';
$$;
revoke execute on function public.sale_lines() from public, anon, authenticated;

create table if not exists public.course_royalties (
  course_id uuid primary key references public.courses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  share_percent int not null default 50 check (share_percent between 1 and 90),
  since timestamptz not null default now(),
  contribution_id uuid references public.contributions(id) on delete set null,
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists course_royalties_user_idx on public.course_royalties (user_id);
alter table public.course_royalties enable row level security;
revoke all on public.course_royalties from anon, authenticated;

create table if not exists public.royalty_payouts (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount_paise int not null check (amount_paise > 0),
  note text not null default '' check (length(note) <= 300),
  paid_at timestamptz not null default now(),
  recorded_by text not null default ''
);
create index if not exists royalty_payouts_course_idx on public.royalty_payouts (course_id, user_id);
alter table public.royalty_payouts enable row level security;
revoke all on public.royalty_payouts from anon, authenticated;

-- Everything the Earnings screen needs, one row per course, in one query.
create or replace function public.course_earnings()
returns table (
  course_id uuid,
  sales int,
  buyers int,
  revenue_paise bigint,
  last_sale_at timestamptz,
  free_access int,
  reading_now int,
  royalty_sales int,
  royalty_revenue_paise bigint,
  paid_out_paise bigint
) language sql stable security definer set search_path = public as $$
  select
    c.id,
    coalesce(s.sales, 0)::int,
    coalesce(s.buyers, 0)::int,
    coalesce(s.revenue, 0)::bigint,
    s.last_sale_at,
    coalesce(e.free_access, 0)::int,
    coalesce(e.reading_now, 0)::int,
    coalesce(r.sales, 0)::int,
    coalesce(r.revenue, 0)::bigint,
    coalesce(p.paid, 0)::bigint
  from public.courses c
  left join (
    select l.course_id, count(*) as sales, count(distinct l.user_id) as buyers,
           sum(l.amount_paise) as revenue, max(l.paid_at) as last_sale_at
      from public.sale_lines() l group by l.course_id
  ) s on s.course_id = c.id
  left join (
    select en.course_id,
           count(*) filter (where en.granted_by = 'admin' and en.revoked_at is null) as free_access,
           count(*) filter (where en.revoked_at is null and (en.expires_at is null or en.expires_at > now())) as reading_now
      from public.entitlements en group by en.course_id
  ) e on e.course_id = c.id
  left join public.course_royalties cr on cr.course_id = c.id
  left join lateral (
    select count(*) as sales, sum(l.amount_paise) as revenue
      from public.sale_lines() l
     where l.course_id = c.id and cr.course_id is not null and l.paid_at >= cr.since
  ) r on true
  left join lateral (
    select sum(rp.amount_paise) as paid
      from public.royalty_payouts rp
     where rp.course_id = c.id and rp.user_id = cr.user_id
  ) p on true;
$$;
revoke execute on function public.course_earnings() from public, anon, authenticated;

create or replace function public.paid_totals()
returns table (orders int, buyers int) language sql stable security definer set search_path = public as $$
  select count(*)::int, count(distinct user_id)::int from public.orders where status = 'paid';
$$;
revoke execute on function public.paid_totals() from public, anon, authenticated;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261026000100', 'earnings_royalties');
end $migration$;

-- ═══ 20261026000200_support_queries ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261026000200') then
    raise notice 'skip 20261026000200';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- Help desk: students ask a question or report what's wrong (with screenshots), and the
-- admin answers from Admin → Queries. Screenshots live in R2 under support/<user>/<id>/.
-- Only the server (service role) reads or writes these tables.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.support_queries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  topic text not null check (topic in ('feature', 'notes', 'payment', 'contribute', 'account', 'other')),
  subject text not null check (length(subject) between 3 and 140),
  page text not null default '' check (length(page) <= 300),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  files jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_queries_user_idx on public.support_queries (user_id, created_at desc);
create index if not exists support_queries_status_idx on public.support_queries (status, updated_at desc);
alter table public.support_queries enable row level security;
revoke all on public.support_queries from anon, authenticated;

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  query_id uuid not null references public.support_queries(id) on delete cascade,
  from_admin boolean not null default false,
  author text not null default '',
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists support_messages_query_idx on public.support_messages (query_id, created_at);
alter table public.support_messages enable row level security;
revoke all on public.support_messages from anon, authenticated;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261026000200', 'support_queries');
end $migration$;

-- ═══ 20261026000300_storage_tree_and_suggestions ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261026000300') then
    raise notice 'skip 20261026000300';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- 1. delete_course_files: remove notes files from the database for good (when their R2
--    files are deleted from Admin → Storage). Their page index, reading progress and read
--    counts go with them by cascade; units left with no files are removed too.
-- 2. Suggestions: students can send ideas through the help desk.
-- 3. Batch years can be hidden; 4. a whole year's courses move to another year in one step.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.delete_course_files(p_file_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
  affected uuid[];
begin
  select array_agg(distinct course_id) into affected from public.course_files where id = any(p_file_ids);
  delete from public.course_files where id = any(p_file_ids);
  get diagnostics n = row_count;
  delete from public.course_units u
   where u.course_id = any(coalesce(affected, '{}'))
     and not exists (select 1 from public.course_files f where f.unit_id = u.id);
  return n;
end $$;
revoke execute on function public.delete_course_files(uuid[]) from public, anon, authenticated;

alter table public.support_queries drop constraint if exists support_queries_topic_check;
alter table public.support_queries add constraint support_queries_topic_check
  check (topic in ('feature', 'notes', 'payment', 'contribute', 'account', 'suggestion', 'other'));

-- 3. Years you can hide from the catalogue without touching their courses.
alter table public.batches add column if not exists is_visible boolean not null default true;

-- 4. Move every course (and bundle) of one batch year to another in one step, optionally for
--    one branch only. Returns how many courses moved.
create or replace function public.move_batch_courses(p_from int, p_to int, p_programme text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.batches (year) values (p_to) on conflict (year) do nothing;
  update public.courses c set batch_year = p_to
   where c.batch_year = p_from
     and (p_programme is null or c.primary_programme_slug = p_programme
          or exists (select 1 from public.course_programmes cp where cp.course_id = c.id and cp.programme_slug = p_programme));
  get diagnostics n = row_count;
  if p_programme is null then
    update public.bundles set batch_year = p_to where batch_year = p_from;
  end if;
  return n;
end $$;
revoke execute on function public.move_batch_courses(int, int, text) from public, anon, authenticated;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261026000300', 'storage_tree_and_suggestions');
end $migration$;

-- ═══ 20261026000400_deliveries_admins_terms ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261026000400') then
    raise notice 'skip 20261026000400';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- 1. announcement_deliveries: who got each announcement, and when. With the daily email
--    limit an announcement goes out over several days; this is how the admin sees exactly
--    who has it and who is still waiting.
-- 2. admin_emails.source: GitHub (synced from the ADMIN_EMAILS variable) or added in the
--    database by hand. The Worker now reads admins from this table, so a change made in
--    GitHub reaches production as soon as the sync runs, without a redeploy.
-- 3. Terms students can see: a course's term has a name ("Sem 5 · Winter 2026"), and each
--    access remembers whether its "ending soon" reminder went out.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.announcement_deliveries (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);
create index if not exists announcement_deliveries_sent_idx on public.announcement_deliveries (sent_at);
alter table public.announcement_deliveries enable row level security;
revoke all on public.announcement_deliveries from anon, authenticated;

alter table public.admin_emails add column if not exists source text not null default 'github'
  check (source in ('github', 'manual'));

alter table public.courses add column if not exists term_label text not null default ''
  check (length(term_label) <= 60);
comment on column public.courses.term_label is 'Name of the term access_until ends, shown to students (e.g. "Sem 5 · Winter 2026").';

alter table public.entitlements add column if not exists ending_notified_at timestamptz;

-- Opted-in students who haven't had this announcement yet, in a stable order. Students who opt
-- in while an email is going out are included, wherever their id falls.
create or replace function public.announcement_pending(p_announcement uuid, p_limit int)
returns table (id uuid, email text, full_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.full_name from public.profiles p
   where p.email_opt_in
     and not exists (select 1 from public.announcement_deliveries d
                      where d.announcement_id = p_announcement and d.user_id = p.id)
   order by p.id
   limit greatest(1, least(p_limit, 1000));
$$;

create or replace function public.announcement_progress(p_announcement uuid)
returns table (sent int, waiting int)
language sql stable security definer set search_path = public as $$
  select
    (select count(*)::int from public.announcement_deliveries d where d.announcement_id = p_announcement),
    (select count(*)::int from public.profiles p
      where p.email_opt_in
        and not exists (select 1 from public.announcement_deliveries d
                         where d.announcement_id = p_announcement and d.user_id = p.id));
$$;

-- Everyone who got it, then everyone still waiting (for the admin's list).
create or replace function public.announcement_recipients(p_announcement uuid, p_limit int)
returns table (id uuid, email text, full_name text, sent_at timestamptz)
language sql stable security definer set search_path = public as $$
  (select p.id, p.email, p.full_name, d.sent_at
     from public.announcement_deliveries d join public.profiles p on p.id = d.user_id
    where d.announcement_id = p_announcement)
  union all
  (select p.id, p.email, p.full_name, null::timestamptz
     from public.profiles p
    where p.email_opt_in
      and not exists (select 1 from public.announcement_deliveries d
                       where d.announcement_id = p_announcement and d.user_id = p.id))
  order by sent_at nulls last, email
  limit greatest(1, least(p_limit, 5000));
$$;

-- Accesses whose term ends within the window and whose reminder hasn't gone out yet.
create or replace function public.access_ending_soon(p_before timestamptz, p_limit int)
returns table (user_id uuid, email text, full_name text, course_id uuid, course_title text, course_slug text,
               expires_at timestamptz, term_label text)
language sql stable security definer set search_path = public as $$
  select e.user_id, p.email, p.full_name, c.id, c.title, c.slug, e.expires_at, c.term_label
    from public.entitlements e
    join public.profiles p on p.id = e.user_id
    join public.courses c on c.id = e.course_id
   where e.revoked_at is null and e.ending_notified_at is null
     and e.expires_at > now() and e.expires_at <= p_before
   order by e.expires_at
   limit greatest(1, least(p_limit, 1000));
$$;

revoke execute on function public.announcement_pending(uuid, int) from public, anon, authenticated;
revoke execute on function public.announcement_progress(uuid) from public, anon, authenticated;
revoke execute on function public.announcement_recipients(uuid, int) from public, anon, authenticated;
revoke execute on function public.access_ending_soon(timestamptz, int) from public, anon, authenticated;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261026000400', 'deliveries_admins_terms');
end $migration$;

-- ═══ 20261026000500_access_window_pending_grants ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261026000500') then
    raise notice 'skip 20261026000500';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- 1. Every purchase is a fixed window from the day it is bought (3 months, the
--    'access_months' setting), not a date per course: the same course is bought by
--    different branches on different timelines.
-- 2. Pending grants: the admin can give a course to a college email that hasn't signed in
--    yet; it lands on their shelf the moment their account is created.
-- 3. Course update notices: students who have a course hear when new notes are added.
-- 4. Announcement counts per batch (from the college email, e.g. name.23bce… = 2023).
-- ════════════════════════════════════════════════════════════════════════════

insert into public.site_settings (key, value) values ('access_months', '3'::jsonb)
on conflict (key) do nothing;

create or replace function public.access_months() returns int language sql stable
security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from public.site_settings where key = 'access_months'), 3);
$$;

create or replace function public.grant_order(p_gateway_order_id text, p_gateway_payment_id text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
  window_end timestamptz := now() + make_interval(months => public.access_months());
begin
  select * into o from public.orders where gateway_order_id = p_gateway_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if o.status <> 'paid' then
    update public.orders set status = 'paid', gateway_payment_id = p_gateway_payment_id where id = o.id;
  end if;
  insert into public.entitlements (user_id, course_id, order_id, expires_at, granted_by)
  select o.user_id, i.course_id, o.id, window_end, 'purchase'
    from public.order_items i
   where i.order_id = o.id
  on conflict (user_id, course_id) do update
    set revoked_at = null, revoke_reason = null, order_id = excluded.order_id,
        granted_at = now(), expires_at = excluded.expires_at,
        granted_by = 'purchase', granted_by_admin = null, end_notified_at = null
    where public.entitlements.revoked_at is not null
       or (public.entitlements.expires_at is not null and public.entitlements.expires_at <= now());
  return o.id;
end $$;
revoke execute on function public.grant_order(text, text) from public, anon, authenticated;

create table if not exists public.pending_grants (
  email text not null check (email = lower(btrim(email))),
  course_id uuid not null references public.courses(id) on delete cascade,
  expires_at timestamptz,
  granted_by_admin text not null,
  created_at timestamptz not null default now(),
  primary key (email, course_id)
);
alter table public.pending_grants enable row level security;
revoke all on public.pending_grants from anon, authenticated;

-- When a student's account is created, anything an admin gave their email is waiting for them.
create or replace function public.apply_pending_grants() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.entitlements (user_id, course_id, expires_at, granted_by, granted_by_admin)
  select new.id, g.course_id, g.expires_at, 'admin', g.granted_by_admin
    from public.pending_grants g where g.email = lower(new.email)
  on conflict (user_id, course_id) do nothing;
  delete from public.pending_grants where email = lower(new.email);
  return new;
end $$;
drop trigger if exists profiles_pending_grants on public.profiles;
create trigger profiles_pending_grants after insert on public.profiles
  for each row execute function public.apply_pending_grants();

alter table public.courses add column if not exists files_notified_at timestamptz;
update public.courses set files_notified_at = now() where files_notified_at is null;

-- An announcement can go to one course's students (e.g. "new notes in DBMS") instead of every
-- opted-in student. Those are about something they bought, so they go even if news is off.
alter table public.announcements add column if not exists course_id uuid references public.courses(id) on delete cascade;

create or replace function public.announcement_audience(p_announcement uuid)
returns table (id uuid, email text, full_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.full_name
    from public.profiles p, public.announcements a
   where a.id = p_announcement
     and case when a.course_id is null then p.email_opt_in
              else exists (select 1 from public.entitlements e
                            where e.user_id = p.id and e.course_id = a.course_id and e.revoked_at is null
                              and (e.expires_at is null or e.expires_at > now())) end;
$$;

create or replace function public.announcement_pending(p_announcement uuid, p_limit int)
returns table (id uuid, email text, full_name text)
language sql stable security definer set search_path = public as $$
  select r.id, r.email, r.full_name from public.announcement_audience(p_announcement) r
   where not exists (select 1 from public.announcement_deliveries d
                      where d.announcement_id = p_announcement and d.user_id = r.id)
   order by r.id
   limit greatest(1, least(p_limit, 1000));
$$;

create or replace function public.announcement_progress(p_announcement uuid)
returns table (sent int, waiting int)
language sql stable security definer set search_path = public as $$
  select
    (select count(*)::int from public.announcement_deliveries d where d.announcement_id = p_announcement),
    (select count(*)::int from public.announcement_audience(p_announcement) r
      where not exists (select 1 from public.announcement_deliveries d
                         where d.announcement_id = p_announcement and d.user_id = r.id));
$$;

create or replace function public.announcement_recipients(p_announcement uuid, p_limit int)
returns table (id uuid, email text, full_name text, sent_at timestamptz)
language sql stable security definer set search_path = public as $$
  (select p.id, p.email, p.full_name, d.sent_at
     from public.announcement_deliveries d join public.profiles p on p.id = d.user_id
    where d.announcement_id = p_announcement)
  union all
  (select r.id, r.email, r.full_name, null::timestamptz
     from public.announcement_audience(p_announcement) r
    where not exists (select 1 from public.announcement_deliveries d
                       where d.announcement_id = p_announcement and d.user_id = r.id))
  order by sent_at nulls last, email
  limit greatest(1, least(p_limit, 5000));
$$;

create or replace function public.announcement_batches(p_announcement uuid)
returns table (batch text, sent int, waiting int)
language sql stable security definer set search_path = public as $$
  with people as (
    select d.user_id as id, true as got from public.announcement_deliveries d
     where d.announcement_id = p_announcement
    union all
    select r.id, false from public.announcement_audience(p_announcement) r
     where not exists (select 1 from public.announcement_deliveries d
                        where d.announcement_id = p_announcement and d.user_id = r.id)
  )
  select coalesce('20' || substring(p.email from '(\d{2})[a-z]{3}\d+@'), 'Other') as batch,
         count(*) filter (where people.got)::int,
         count(*) filter (where not people.got)::int
    from people join public.profiles p on p.id = people.id
   group by 1 order by 1 desc;
$$;
revoke execute on function public.announcement_batches(uuid) from public, anon, authenticated;
revoke execute on function public.announcement_audience(uuid) from public, anon, authenticated;
revoke execute on function public.announcement_pending(uuid, int) from public, anon, authenticated;
revoke execute on function public.announcement_progress(uuid) from public, anon, authenticated;
revoke execute on function public.announcement_recipients(uuid, int) from public, anon, authenticated;
revoke execute on function public.access_months() from public, anon, authenticated;

-- Live courses with notes made readable since their students were last told.
create or replace function public.courses_with_new_files()
returns table (course_id uuid, title text, slug text, file_names text[])
language sql stable security definer set search_path = public as $$
  select c.id, c.title, c.slug, array_agg(f.name order by f.name)
    from public.courses c
    join public.course_files f on f.course_id = c.id
    join public.course_units u on u.id = f.unit_id
   where c.status = 'live'
     and f.conversion_status = 'ready' and not f.is_hidden and not u.is_hidden
     and f.converted_at > coalesce(c.files_notified_at, c.created_at)
   group by c.id, c.title, c.slug;
$$;
revoke execute on function public.courses_with_new_files() from public, anon, authenticated;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261026000500', 'access_window_pending_grants');
end $migration$;

-- ═══ 20261026000600_signin_guard ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261026000600') then
    raise notice 'skip 20261026000600';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- Sign-in guard. Before a sign-in link is sent, the Worker checks the address: an exact
-- @vitbhopal.ac.in address, or an address on the admin list. Each refused address counts
-- against the network (IP, stored only as a hash); 5 refusals within 24 hours block that
-- network from asking for links for 24 hours.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.signin_strikes (
  ip_hash text primary key,
  strikes int not null default 0,
  first_at timestamptz not null default now(),
  blocked_until timestamptz
);
alter table public.signin_strikes enable row level security;
revoke all on public.signin_strikes from anon, authenticated;

-- Count one refusal; returns when the block ends (null = not blocked).
create or replace function public.signin_strike(p_ip text, p_limit int, p_hours int)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare r public.signin_strikes;
begin
  insert into public.signin_strikes as s (ip_hash, strikes, first_at)
  values (p_ip, 1, now())
  on conflict (ip_hash) do update
    set strikes = case when s.first_at < now() - make_interval(hours => p_hours) then 1 else s.strikes + 1 end,
        first_at = case when s.first_at < now() - make_interval(hours => p_hours) then now() else s.first_at end
  returning * into r;
  if r.strikes >= p_limit and (r.blocked_until is null or r.blocked_until < now()) then
    update public.signin_strikes set blocked_until = now() + make_interval(hours => p_hours)
     where ip_hash = p_ip returning * into r;
  end if;
  return case when r.blocked_until > now() then r.blocked_until end;
end $$;
revoke execute on function public.signin_strike(text, int, int) from public, anon, authenticated;

-- Old rows are useless after a day; the hourly job clears them.
create or replace function public.prune_signin_strikes() returns int
language sql security definer set search_path = public as $$
  with gone as (
    delete from public.signin_strikes
     where first_at < now() - interval '48 hours' and (blocked_until is null or blocked_until < now())
    returning 1)
  select count(*)::int from gone;
$$;
revoke execute on function public.prune_signin_strikes() from public, anon, authenticated;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261026000600', 'signin_guard');
end $migration$;

-- ═══ 20261026000700_rewards_bonus ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261026000700') then
    raise notice 'skip 20261026000700';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- 1. Cash rewards for contributions: when you've paid one, mark it paid (it shows as owed
--    in Earnings until then, and the student sees "paid" on their Contribute page).
-- 2. Yearly top-contributor bonus: the contributor whose notes sold most in the last
--    12 months gets what they earned again. contributor_bonuses records each payment.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.contributions add column if not exists reward_paid_at timestamptz;
alter table public.contributions add column if not exists reward_paid_note text not null default ''
  check (length(reward_paid_note) <= 300);

create table if not exists public.contributor_bonuses (
  user_id uuid not null references public.profiles(id) on delete cascade,
  year int not null check (year between 2025 and 2100),
  amount_paise int not null check (amount_paise > 0),
  note text not null default '' check (length(note) <= 300),
  paid_at timestamptz not null default now(),
  recorded_by text not null default '',
  primary key (user_id, year)
);
alter table public.contributor_bonuses enable row level security;
revoke all on public.contributor_bonuses from anon, authenticated;

-- Royalty sales and revenue per contributor and course since a moment (counting each course
-- only from when its royalty began).
create or replace function public.royalty_earnings_since(p_since timestamptz)
returns table (user_id uuid, course_id uuid, share_percent int, sales int, revenue_paise bigint)
language sql stable security definer set search_path = public as $$
  select cr.user_id, cr.course_id, cr.share_percent, count(l.*)::int, coalesce(sum(l.amount_paise), 0)::bigint
    from public.course_royalties cr
    left join public.sale_lines() l
      on l.course_id = cr.course_id and l.paid_at >= greatest(cr.since, p_since)
   group by cr.user_id, cr.course_id, cr.share_percent;
$$;
revoke execute on function public.royalty_earnings_since(timestamptz) from public, anon, authenticated;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261026000700', 'rewards_bonus');
end $migration$;

-- ═══ 20261027000100_contribution_pipeline ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261027000100') then
    raise notice 'skip 20261027000100';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- Contribution pipeline: where the admin filed a student's upload (course, folder, the storage
-- keys written), and when the whole job was marked done. The automatic file checks live inside
-- the existing `files` json (one `check` per file), so they need no column.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.contributions add column if not exists filed_course_id uuid
  references public.courses(id) on delete set null;
alter table public.contributions add column if not exists filed_folder text not null default ''
  check (length(filed_folder) <= 600);
alter table public.contributions add column if not exists filed_keys text[] not null default '{}';
alter table public.contributions add column if not exists filed_at timestamptz;
alter table public.contributions add column if not exists completed_at timestamptz;

create index if not exists contributions_filed_course_idx on public.contributions (filed_course_id)
  where filed_course_id is not null;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261027000100', 'contribution_pipeline');
end $migration$;

-- ═══ 20261027000200_relocate_file ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261027000200') then
    raise notice 'skip 20261027000200';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- Move or rename one notes file without re-making its pages: point the file row at its new
-- storage key, unit (created if new) and, if needed, another course, all in one step. Page rows
-- and reading progress are keyed by the file id, so they follow it. A unit left empty is removed.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.relocate_course_file(
  p_file_id uuid,
  p_course_id uuid,
  p_unit_key text,
  p_unit_title text,
  p_unit_kind text,
  p_unit_sort int,
  p_unit_hidden boolean,
  p_source_key text,
  p_source_etag text,
  p_name text
) returns void language plpgsql security definer set search_path = public as $$
declare
  old_unit uuid;
  new_unit uuid;
begin
  select unit_id into old_unit from public.course_files where id = p_file_id for update;
  if not found then
    raise exception 'file not found' using errcode = 'P0002';
  end if;
  insert into public.course_units (course_id, key, title, kind, sort, is_hidden)
  values (p_course_id, p_unit_key, p_unit_title, p_unit_kind, p_unit_sort, p_unit_hidden)
  on conflict (course_id, key) do nothing;
  select id into new_unit from public.course_units where course_id = p_course_id and key = p_unit_key;
  update public.course_files
     set course_id = p_course_id, unit_id = new_unit, source_key = p_source_key,
         source_etag = p_source_etag, name = p_name, source_missing_at = null
   where id = p_file_id;
  if old_unit is distinct from new_unit
     and not exists (select 1 from public.course_files where unit_id = old_unit) then
    delete from public.course_units where id = old_unit;
  end if;
end $$;
revoke execute on function public.relocate_course_file(uuid, uuid, text, text, text, int, boolean, text, text, text)
  from public, anon, authenticated;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261027000200', 'relocate_file');
end $migration$;

-- ═══ 20261028000100_course_books ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261028000100') then
    raise notice 'skip 20261028000100';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- Recommended books per course: a name, an optional author and a link, chosen by an admin.
-- Only the link is kept, so publishers' textbooks never need to sit in the notes bucket.
-- Read and written by the server only (service role); students get them inside the course page.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.course_books (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses(id) on delete cascade,
  title       text not null check (length(title) between 2 and 200),
  author      text not null default '' check (length(author) <= 120),
  url         text not null check (length(url) <= 500 and url ~* '^https?://'),
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists course_books_course_idx on public.course_books (course_id, sort);

drop trigger if exists course_books_updated_at on public.course_books;
create trigger course_books_updated_at before update on public.course_books
  for each row execute function public.set_updated_at();

alter table public.course_books enable row level security; -- server only

comment on table public.course_books is
  'Recommended books per course (name, author, link). Shown on the course page; no files.';
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261028000100', 'course_books');
end $migration$;

-- ═══ 20261031000100_partner_terms ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261031000100') then
    raise notice 'skip 20261031000100';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- Partner terms from 31 Oct 2026: a whole-subject royalty is 30% (of what each sale brings in
-- after the payment fee). Only the default changes; royalties already agreed keep their share.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.course_royalties alter column share_percent set default 30;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261031000100', 'partner_terms');
end $migration$;

-- ═══ 20261031000200_unit_previews ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261031000200') then
    raise notice 'skip 20261031000200';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- Free preview chosen by the admin, per unit: which file, and which of its pages (1 to 5).
-- No choice (or a file that is no longer readable) falls back to page 1 of the unit's first
-- readable file, so a preview never breaks when files change.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.course_units add column if not exists preview_file_id uuid
  references public.course_files(id) on delete set null;
alter table public.course_units add column if not exists preview_pages smallint[] not null default '{1}';

alter table public.course_units drop constraint if exists course_units_preview_pages_chk;
alter table public.course_units add constraint course_units_preview_pages_chk check (
  cardinality(preview_pages) between 1 and 5 and 0 < all(preview_pages)
);
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261031000200', 'unit_previews');
end $migration$;

-- ═══ 20261031000300_access_notes ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261031000300') then
    raise notice 'skip 20261031000300';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- The admin's reason for the last change to a student's access (block, restore, end, renew),
-- shown to the student on their shelf and in the email, and to admins in Students.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.entitlements add column if not exists admin_note text
  check (admin_note is null or length(admin_note) <= 300);
alter table public.entitlements add column if not exists admin_note_at timestamptz;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261031000300', 'access_notes');
end $migration$;

-- ═══ 20261031000400_partner_perks ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261031000400') then
    raise notice 'skip 20261031000400';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- Partner of the year: the perk can be cash or a gift (a prize, a voucher, merchandise), with
-- what it was. One perk per person per year, as before. A gift may have no rupee value.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.contributor_bonuses add column if not exists kind text not null default 'cash'
  check (kind in ('cash', 'gift'));
alter table public.contributor_bonuses drop constraint if exists contributor_bonuses_amount_paise_check;
alter table public.contributor_bonuses add constraint contributor_bonuses_amount_paise_check check (amount_paise >= 0);
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261031000400', 'partner_perks');
end $migration$;

-- ═══ 20261031000500_housekeeping ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261031000500') then
    raise notice 'skip 20261031000500';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- Daily housekeeping, so the tables that only grow don't cost more over time. Kept:
--   audit_log (change history)          180 days
--   access_logs (pages read per day)     60 days   (only today's count matters for limits)
--   email_quota (emails sent per day)    60 days
--   problem_reports (last seen)          90 days
--   unpaid checkouts (never paid)        14 days   (the existing clean_abandoned_orders rules)
-- Paid orders, access, reading progress and royalties are never touched.
-- ════════════════════════════════════════════════════════════════════════════

create index if not exists access_logs_day_idx on public.access_logs (day);

create or replace function public.prune_history()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a int; l int; q int; p int; o int;
begin
  delete from public.audit_log where at < now() - interval '180 days';
  get diagnostics a = row_count;
  delete from public.access_logs where day < current_date - 60;
  get diagnostics l = row_count;
  delete from public.email_quota where day < current_date - 60;
  get diagnostics q = row_count;
  delete from public.problem_reports where last_at < now() - interval '90 days';
  get diagnostics p = row_count;
  o := public.clean_abandoned_orders(14);
  return jsonb_build_object('audit', a, 'accessLogs', l, 'emailQuota', q, 'problems', p, 'unpaidOrders', o);
end $$;
revoke execute on function public.prune_history() from public, anon, authenticated;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261031000500', 'housekeeping');
end $migration$;

-- ═══ 20261103000100_cse_name ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261103000100') then
    raise notice 'skip 20261103000100';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- 20261103 · BCE is B.Tech Computer Science and Engineering (its official name).
-- ════════════════════════════════════════════════════════════════════════════

update public.programmes
set name = 'B.Tech Computer Science and Engineering',
    short_name = 'B.Tech CSE',
    description = 'Complete semester study pack for B.Tech CSE students at VIT Bhopal.'
where slug = 'bce';
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261103000100', 'cse_name');
end $migration$;

-- ═══ 20261103000200_vit_programmes ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261103000200') then
    raise notice 'skip 20261103000200';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- 20261103 · Every VIT Bhopal B.Tech programme, so every student lands in their own drawer.
-- The code is the three letters in the college email (vraj.23BCE11796 → BCE). Codes and names
-- can be corrected in the admin (Courses → Years & branches) without a migration.
-- Adds only what is missing; never changes or removes a programme the admin already has.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.programmes (slug, code, name, short_name, tagline, description, sort)
select v.slug, v.code, v.name, v.short_name, v.tagline, v.description, v.sort
from (values
  ('bcy', 'BCY', 'B.Tech CSE (Cyber Security and Digital Forensics)', 'B.Tech CSE CS', 'Security, forensics and core CS',
   'Semester notes for B.Tech CSE (Cyber Security and Digital Forensics) students at VIT Bhopal.', 6),
  ('bhi', 'BHI', 'B.Tech CSE (Health Informatics)', 'B.Tech CSE HI', 'Health data and core CS',
   'Semester notes for B.Tech CSE (Health Informatics) students at VIT Bhopal.', 7),
  ('boe', 'BOE', 'B.Tech CSE (Education Technology)', 'B.Tech CSE ET', 'Learning technology and core CS',
   'Semester notes for B.Tech CSE (Education Technology) students at VIT Bhopal.', 8),
  ('bec', 'BEC', 'B.Tech Electronics and Communication Engineering', 'B.Tech ECE', 'Circuits, signals and communication',
   'Semester notes for B.Tech ECE students at VIT Bhopal.', 9),
  ('bac', 'BAC', 'B.Tech ECE (AI and Cybernetics)', 'B.Tech ECE AIC', 'Electronics, AI and control',
   'Semester notes for B.Tech ECE (AI and Cybernetics) students at VIT Bhopal.', 10),
  ('bme', 'BME', 'B.Tech Mechanical Engineering', 'B.Tech ME', 'Design, thermal and manufacturing',
   'Semester notes for B.Tech Mechanical Engineering students at VIT Bhopal.', 11),
  ('bmr', 'BMR', 'B.Tech Mechanical Engineering (AI and Robotics)', 'B.Tech ME AIR', 'Mechanics, AI and robotics',
   'Semester notes for B.Tech Mechanical (AI and Robotics) students at VIT Bhopal.', 12),
  ('bas', 'BAS', 'B.Tech Aerospace Engineering', 'B.Tech AE', 'Aerodynamics, structures and propulsion',
   'Semester notes for B.Tech Aerospace Engineering students at VIT Bhopal.', 13)
) as v(slug, code, name, short_name, tagline, description, sort)
where not exists (select 1 from public.programmes p where p.slug = v.slug or p.code = v.code);

-- The official names of two existing programmes.
update public.programmes set name = 'B.Tech CSE (AI and Machine Learning)', short_name = 'B.Tech CSE AIML'
where slug = 'bai' and name = 'B.Tech Artificial Intelligence';
update public.programmes set name = 'B.Tech CSE (Gaming Technology)', short_name = 'B.Tech CSE GT'
where slug = 'bcg' and name = 'B.Tech CS (Game Development)';
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261103000200', 'vit_programmes');
end $migration$;

-- ═══ 20261104000100_conversion_held ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261104000100') then
    raise notice 'skip 20261104000100';
    return;
  end if;
  execute $m$-- The admin can now pause a file's page-making job. Held files are skipped by the queue and
-- any result the converter sends back for them while held is ignored.
alter table public.course_files
  add column if not exists conversion_held boolean not null default false;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261104000100', 'conversion_held');
end $migration$;

-- ═══ 20261104000200_bba_programme ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261104000200') then
    raise notice 'skip 20261104000200';
    return;
  end if;
  execute $m$-- ════════════════════════════════════════════════════════════════════════════
-- 20261104 · BBA, from the official Winter 2026-27 FFCS course list. Codes and names
-- can be corrected in the admin (Courses → Years & branches) without a migration.
-- Adds only what is missing; never changes or removes a programme the admin already has.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.programmes (slug, code, name, short_name, tagline, description, sort)
select v.slug, v.code, v.name, v.short_name, v.tagline, v.description, v.sort
from (values
  ('bba', 'BBA', 'Bachelor of Business Administration', 'BBA', 'Management, marketing and business strategy',
   'Semester notes for Bachelor of Business Administration students at VIT Bhopal.', 14)
) as v(slug, code, name, short_name, tagline, description, sort)
where not exists (select 1 from public.programmes p where p.slug = v.slug or p.code = v.code);
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261104000200', 'bba_programme');
end $migration$;

-- ═══ 20261104000300_winter_2026_27_curriculum ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261104000300') then
    raise notice 'skip 20261104000300';
    return;
  end if;
  execute $m$-- Curriculum relationships transcribed from the supplied Winter Semester 2026-27 FFCS course list.
-- Existing programme labels remain as configured; add the missing codes represented in the document.
insert into public.programmes (slug, code, name, short_name, tagline, description, sort)
select v.slug, v.code, v.name, v.short_name, v.tagline, v.description, v.sort
from (values
  ('bet', 'BET', 'B.Tech CSE (E-Commerce Technology)', 'B.Tech CSE E-Commerce', 'E-Commerce technology and computing', 'Winter 2026-27 course-list programme at VIT Bhopal.', 15),
  ('mei', 'MEI', 'Integrated M.Tech CSE (Cyber Security)', 'M.Tech CSE Cyber Security', 'Cyber security and digital forensics', 'Integrated M.Tech programme listed in the Winter 2026-27 course list.', 16),
  ('mib', 'MIB', 'Integrated M.Tech AI and Bioinformatics', 'M.Tech AI and Bioinformatics', 'AI, chemistry and bioinformatics', 'Integrated programme listed in the Winter 2026-27 course list.', 17),
  ('mip', 'MIP', 'Integrated M.Tech CSE (Computational and Data Science)', 'M.Tech CSE Data Science', 'Computational and data science', 'Integrated programme listed in the Winter 2026-27 course list.', 18),
  ('msi', 'MSI', 'Integrated Science Programme (MSI)', 'MSI', 'Life sciences and biology', 'Programme code and course set transcribed from the supplied Winter 2026-27 course list.', 19)
) as v(slug, code, name, short_name, tagline, description, sort)
where not exists (select 1 from public.programmes p where p.slug = v.slug or p.code = v.code);

insert into public.subjects (code, title) values
  ('ASE2003', 'Mechanisms and Machine Theory'),
  ('ASE2004', 'AIRCRAFT MANUFACTURING TECHNOLOGY'),
  ('ASE2005', 'AEROSPACE STRUCTURES'),
  ('ASE2007', 'COMPUTER AIDED AIRCRAFT DRAWING'),
  ('ASE2009', 'INTRODUCTION TO AEROSPACE ENGINEERING'),
  ('ASE2010', 'GUIDANCE, NAVIGATION & CONTROL'),
  ('ASE2012', 'THERMODYNAMICS FOR AEROSPACE ENGINEERING'),
  ('ASE3007', 'SMART MATERIALS FOR AEROSPACE'),
  ('ASE3010', 'ROCKETS AND MISSILE TECHNOLOGY'),
  ('ASE5001', 'AEROSPACE VEHICLE DESIGN'),
  ('BIA1001', 'Cell Biology & Genetics'),
  ('BIA2001', 'Quantum Chemistry for Biological Systems'),
  ('BIO1001', 'Introduction to Bioengineering'),
  ('BIO1101', 'Physiology of Cells and Tissues'),
  ('BIO2002', 'Molecular Biology and Genetic Engineering'),
  ('BIO2006', 'Medical Electronics'),
  ('BIO3002', 'Immune Engineering'),
  ('BIO3003', 'Tissue Engineering'),
  ('BIO3005', 'Medical Imaging Techniques and Data Analysis'),
  ('BIO3014', 'Cancer Biology'),
  ('BIO3017', 'Advanced Biomaterials & Manufacturing Process'),
  ('BIO3020', 'Personalized Medicines'),
  ('BIO3022', 'Stem Cells and Regenerative Medicine'),
  ('BIO3023', 'Biomechanics'),
  ('BIY3005', 'Bioprocess Technology'),
  ('BIY3011', 'Nutrition and Health'),
  ('BMT1002', 'Micro Economics'),
  ('BMT1003', 'Fundamentals of Management'),
  ('BMT1013', 'Human Resource Management'),
  ('BMT1015', 'Indian Knowledge System'),
  ('BMT2005', 'Leadership & Team Building'),
  ('BMT2009', 'Consumer Behaviour'),
  ('BMT2014', 'Securities Analysis and Portfolio Management'),
  ('BMT2016', 'Emotional Intelligence'),
  ('BMT2018', 'Business Policy and Competitive Strategy'),
  ('BMT2021', 'Insurance Management'),
  ('BMT2022', 'Life Skills & Personality Development'),
  ('BMT2025', 'Summer Internship'),
  ('BMT3004', 'Customer Relationship Management'),
  ('BMT3005', 'Digital Marketing'),
  ('BMT3006', 'Basic Insurance Processes'),
  ('BMT3010', 'Talent Management'),
  ('BMT3011', 'Supply Chain Management'),
  ('CCA2001', 'Cloud Computing and Virtualization'),
  ('CCA2002', 'Cloud Architecture and Services'),
  ('CCA3001', 'Cloud Data Management'),
  ('CCA3002', 'Fog and Edge Computing'),
  ('CDS3001', 'Distributed Systems'),
  ('CDS3002', 'Introduction to Scalable Systems'),
  ('CDS4007', 'Machine learning for Large Datasets'),
  ('CDS4011', 'Embedded Computing for IOT'),
  ('CEC2001', 'Introduction to E Commerce'),
  ('CEC3003', 'Warehouse Management'),
  ('CEC3006', 'E-Customer Relationship Management'),
  ('CET3001', 'Educational Data Mining and Learning Analytics'),
  ('CHI1002', 'Security and Privacy Policies and Regulations for Health Care'),
  ('CHI2002', 'Embedded Systems Design Using ARM'),
  ('CHI3001', 'App Development for Healthcare Informatics'),
  ('CHI3003', 'Artificial Intelligence in Health Care'),
  ('CHI3005', 'Wearable Technology and IoT'),
  ('CHI4010', 'Healthcare Data Analytics'),
  ('CHY1001', 'ENGINEERING CHEMISTRY'),
  ('CHY1002', 'Environmental Science'),
  ('CHY1005', 'Introduction to Computational chemistry'),
  ('CHY1006', 'Environmental Sustainability'),
  ('CHY1007', 'Forensic Chemistry & applications'),
  ('CSA2001', 'Fundamentals in AI and ML (Flipped Course)'),
  ('CSA3003', 'Reinforcement Learning'),
  ('CSA3006', 'Data Mining and Warehousing'),
  ('CSA3007', 'Deep Learning'),
  ('CSA3020', 'Generative AI'),
  ('CSA4001', 'Algorithm for Intelligent Systems'),
  ('CSA4002', 'Artificial Neural Networks'),
  ('CSA4008', 'Applied Machine Learning'),
  ('CSA4016', 'Hardware Architecture for Machine Learning'),
  ('CSA4017', 'Optimization Methods in Machine Learning'),
  ('CSA4020', 'Deep Learning'),
  ('CSA4028', 'Natural Language Processing'),
  ('CSD1001', 'Principles of Digital Forensics'),
  ('CSD3004', 'Cyber Threat Analysis'),
  ('CSD3009', 'DATA STRUCTURES AND ANALYSIS OF ALGORITHMS'),
  ('CSD4001', 'Software Vulnerability Testing'),
  ('CSD4002', 'Ethical Hacking'),
  ('CSD4003', 'Network and System Security'),
  ('CSD4012', 'Web Security'),
  ('CSD5002', 'Virtualization Essentials'),
  ('CSD5005', 'Network Analysis, Architecture and Design'),
  ('CSD6005', 'Wireless and Mobile Security'),
  ('CSE0001', 'Digital Literacy'),
  ('CSE0002', 'Open-Source Software (Linux Administration)'),
  ('CSE2001', 'Object Oriented Programming with C++'),
  ('CSE2002', 'Data Structures and Algorithms'),
  ('CSE2003', 'Computer Architecture and Organization'),
  ('CSE2004', 'Theory of Computation and Compiler Design'),
  ('CSE2006', 'Programming in Java'),
  ('CSE3001', 'Database Management Systems'),
  ('CSE3003', 'Operating Systems'),
  ('CSE3004', 'Design and Analysis of Algorithms'),
  ('CSE3005', 'Software Engineering'),
  ('CSE3006', 'Computer Networks'),
  ('CSE3010', 'Computer Vision'),
  ('CSE3011', 'Python Programming'),
  ('CSE3015', 'AWS Cloud Practitioner'),
  ('CSE3016', 'AWS Solution Architect'),
  ('CSE3017', 'Saleforces'),
  ('CSE4001', 'Internet and Web Programming'),
  ('CSG2011', 'Game Design and Programming Using Unreal Engine'),
  ('CSG3004', 'Augmented Reality and Virtual Reality in Gaming'),
  ('CSG3005', 'Gaming in Cloud'),
  ('CSG3006', 'Visual Effects and Computer Graphics'),
  ('CSG3007', 'Design Game using Artificial Intelligence and Machine Learning'),
  ('CSG3008', '3D Modelling and Animation'),
  ('DSN2099', 'Project Exhibition - II'),
  ('DSN5097', 'Comprehensive Exam'),
  ('EAC2002', 'Electromagnetics And Transmission Lines'),
  ('EAC2006', 'Multimedia Signal Processing'),
  ('EAC4001', 'Robot Motion Control'),
  ('EAC4010', 'Autonomous Robotics'),
  ('ECE2002', 'Digital Logic Design'),
  ('ECE2101', 'Analog Circuits'),
  ('ECE3004', 'Microprocessors And Microcontrollers'),
  ('ECE3005', 'Digital Signal Processing'),
  ('ECE3006', 'VLSI Design'),
  ('ECE3010', 'Information theory and Coding'),
  ('ECE4002', 'Antenna and wave propagation'),
  ('ECE4007', 'Wireless sensor networks'),
  ('ECE4008', 'Wireless and optical communication systems'),
  ('ECE4010', 'Embedded Systems'),
  ('EEE1001', 'Electric Circuits and Systems'),
  ('EEE3100', 'Bio signals and Image Processing'),
  ('EEE3101', 'Bio system and Control'),
  ('ENG1004', 'Effective Technical Communication'),
  ('ENG2005', 'Advanced Technical Communication'),
  ('ENG2006', 'Business Communication I'),
  ('HUM1002', 'Emotional Intelligence'),
  ('HUM1014', 'Indian Constitution'),
  ('HUM1108', 'Swatch Bharat'),
  ('HUM2001', 'Behavioral Science'),
  ('MAS5009', 'Application Development using MLOps'),
  ('MAT2002', 'Discrete Mathematics and Graph Theory'),
  ('MAT2003', 'Applied Numerical Methods'),
  ('MAT2004', 'OPERATIONS RESEARCH'),
  ('MAT2005', 'Transform Techniques and Difference Equations'),
  ('MAT2101', 'Applications of Differential Equations'),
  ('MAT3002', 'Applied Linear Algebra'),
  ('MAT3003', 'Probability, Statistics and Reliability'),
  ('MAT3008', 'Computational Game Theory'),
  ('MAT3015', 'Biostatistics'),
  ('MAT3016', 'Stochastic Process'),
  ('MEA2006', 'FOUNDATION TO ROBOTICS'),
  ('MEA3006', 'ROBOTICS PERCEPTION AND PLANNING'),
  ('MEE1002', 'ENGINEERING MECHANICS'),
  ('MEE1003', 'MATERIALS ENGINEERING AND TECHNOLOGY'),
  ('MEE1005', 'FLUID MECHANICS'),
  ('MEE2001', 'MACHINE DRAWING'),
  ('MEE2002', 'STRENGTH OF MATERIALS'),
  ('MEE2004', 'THERMAL ENGINEERING SYSTEMS'),
  ('MEE2009', 'INSTRUMENTATION AND CONTROL ENGINEERING'),
  ('MEE2010', 'KINEMATICS OF MACHINERY'),
  ('MEE2014', 'Engineering Design and Modelling'),
  ('MEE3015', 'MECHATRONICS'),
  ('MEE4001', 'DESIGN OF TRANSMISSION SYSTEMS'),
  ('MGT2003', 'Technology Entrepreneurship'),
  ('PHY1001', 'Engineering Physics'),
  ('PHY1003', 'Introduction to Computational Physics'),
  ('PHY2011', 'Biophysics'),
  ('PHY3001', 'Bio Optics'),
  ('PLA1004', 'Competitive Coding Practice'),
  ('PLA1005', 'Competitive Coding Practice'),
  ('PLA1006', 'Lateral Thinking'),
  ('SST1001', 'Introduction to Soft Skills'),
  ('SST1003', 'Professional Communication Skills for Engineers'),
  ('SST2003', 'Dynamics of Workplace Communication Skills')
on conflict (code) do update set title = case when public.subjects.title = '' then excluded.title else public.subjects.title end;

insert into public.programme_subjects (programme_slug, subject_code)
select p.slug, v.subject_code
from (values
  ('bac', 'CHY1001'),
  ('bac', 'CSA2001'),
  ('bac', 'CSA3003'),
  ('bac', 'CSA4020'),
  ('bac', 'CSE0001'),
  ('bac', 'CSE0002'),
  ('bac', 'CSE2002'),
  ('bac', 'DSN2099'),
  ('bac', 'EAC2002'),
  ('bac', 'EAC2006'),
  ('bac', 'EAC4001'),
  ('bac', 'EAC4010'),
  ('bac', 'ECE2002'),
  ('bac', 'ECE3004'),
  ('bac', 'ECE3006'),
  ('bac', 'ECE4010'),
  ('bac', 'ENG1004'),
  ('bac', 'MAT2005'),
  ('bac', 'MAT3002'),
  ('bac', 'MEE2014'),
  ('bac', 'PHY1001'),
  ('bac', 'PLA1006'),
  ('bac', 'SST2003'),
  ('bai', 'CHY1005'),
  ('bai', 'CSA2001'),
  ('bai', 'CSA3006'),
  ('bai', 'CSA3007'),
  ('bai', 'CSA4002'),
  ('bai', 'CSA4008'),
  ('bai', 'CSA4028'),
  ('bai', 'CSD3009'),
  ('bai', 'CSE0001'),
  ('bai', 'CSE0002'),
  ('bai', 'CSE2001'),
  ('bai', 'CSE2004'),
  ('bai', 'CSE3006'),
  ('bai', 'CSE3015'),
  ('bai', 'DSN2099'),
  ('bai', 'EEE1001'),
  ('bai', 'MAT2005'),
  ('bai', 'PHY1003'),
  ('bai', 'PLA1006'),
  ('bai', 'SST1003'),
  ('bas', 'ASE2003'),
  ('bas', 'ASE2004'),
  ('bas', 'ASE2005'),
  ('bas', 'ASE2007'),
  ('bas', 'ASE2009'),
  ('bas', 'ASE2010'),
  ('bas', 'ASE2012'),
  ('bas', 'ASE3007'),
  ('bas', 'ASE3010'),
  ('bas', 'ASE5001'),
  ('bas', 'CHY1001'),
  ('bas', 'CSE0001'),
  ('bas', 'CSE0002'),
  ('bas', 'CSE2006'),
  ('bas', 'DSN2099'),
  ('bas', 'EEE1001'),
  ('bas', 'MAT2002'),
  ('bas', 'MAT2004'),
  ('bas', 'MAT3003'),
  ('bas', 'MEE1002'),
  ('bas', 'MEE2014'),
  ('bas', 'PHY1001'),
  ('bas', 'PLA1006'),
  ('bba', 'BMT1002'),
  ('bba', 'BMT1003'),
  ('bba', 'BMT1013'),
  ('bba', 'BMT1015'),
  ('bba', 'BMT2005'),
  ('bba', 'BMT2009'),
  ('bba', 'BMT2014'),
  ('bba', 'BMT2016'),
  ('bba', 'BMT2018'),
  ('bba', 'BMT2021'),
  ('bba', 'BMT2022'),
  ('bba', 'BMT2025'),
  ('bba', 'BMT3004'),
  ('bba', 'BMT3005'),
  ('bba', 'BMT3006'),
  ('bba', 'BMT3010'),
  ('bba', 'BMT3011'),
  ('bba', 'CHY1002'),
  ('bba', 'ENG2006'),
  ('bba', 'HUM1014'),
  ('bba', 'HUM1108'),
  ('bba', 'HUM2001'),
  ('bba', 'SST1001'),
  ('bce', 'CSA2001'),
  ('bce', 'CSE0001'),
  ('bce', 'CSE0002'),
  ('bce', 'CSE2001'),
  ('bce', 'CSE2002'),
  ('bce', 'CSE2003'),
  ('bce', 'CSE2006'),
  ('bce', 'CSE3003'),
  ('bce', 'CSE3004'),
  ('bce', 'CSE3005'),
  ('bce', 'CSE3015'),
  ('bce', 'CSE4001'),
  ('bce', 'DSN2099'),
  ('bce', 'ECE3004'),
  ('bce', 'EEE1001'),
  ('bce', 'ENG2005'),
  ('bce', 'MAT2003'),
  ('bce', 'MAT3003'),
  ('bce', 'MGT2003'),
  ('bce', 'PHY1003'),
  ('bce', 'PLA1006'),
  ('bce', 'SST1003'),
  ('bce', 'SST2003'),
  ('bcg', 'CHY1005'),
  ('bcg', 'CSA2001'),
  ('bcg', 'CSE0001'),
  ('bcg', 'CSE0002'),
  ('bcg', 'CSE2001'),
  ('bcg', 'CSE2004'),
  ('bcg', 'CSE2006'),
  ('bcg', 'CSE3003'),
  ('bcg', 'CSE3006'),
  ('bcg', 'CSG2011'),
  ('bcg', 'CSG3005'),
  ('bcg', 'CSG3006'),
  ('bcg', 'CSG3007'),
  ('bcg', 'CSG3008'),
  ('bcg', 'DSN2099'),
  ('bcg', 'EEE1001'),
  ('bcg', 'ENG2005'),
  ('bcg', 'MAT2002'),
  ('bcg', 'MAT2005'),
  ('bcg', 'MAT3008'),
  ('bcg', 'MEE2014'),
  ('bcg', 'PLA1004'),
  ('bcg', 'SST1003'),
  ('bcg', 'SST2003'),
  ('bcy', 'CHY1007'),
  ('bcy', 'CSA2001'),
  ('bcy', 'CSD1001'),
  ('bcy', 'CSD3009'),
  ('bcy', 'CSD4001'),
  ('bcy', 'CSD4002'),
  ('bcy', 'CSE0001'),
  ('bcy', 'CSE0002'),
  ('bcy', 'CSE2006'),
  ('bcy', 'CSE3001'),
  ('bcy', 'CSE3003'),
  ('bcy', 'CSE3006'),
  ('bcy', 'CSE3016'),
  ('bcy', 'CSE4001'),
  ('bcy', 'DSN2099'),
  ('bcy', 'EEE1001'),
  ('bcy', 'ENG2005'),
  ('bcy', 'MAT2003'),
  ('bcy', 'MAT3003'),
  ('bcy', 'PHY1003'),
  ('bcy', 'PLA1004'),
  ('bec', 'CHY1001'),
  ('bec', 'CSA2001'),
  ('bec', 'CSE0001'),
  ('bec', 'CSE0002'),
  ('bec', 'CSE2002'),
  ('bec', 'DSN2099'),
  ('bec', 'EAC2002'),
  ('bec', 'ECE2002'),
  ('bec', 'ECE3004'),
  ('bec', 'ECE3005'),
  ('bec', 'ECE3006'),
  ('bec', 'ECE3010'),
  ('bec', 'ECE4002'),
  ('bec', 'ECE4007'),
  ('bec', 'ECE4008'),
  ('bec', 'ECE4010'),
  ('bec', 'ENG1004'),
  ('bec', 'MAT2005'),
  ('bec', 'MAT3002'),
  ('bec', 'MEE2014'),
  ('bec', 'PHY1001'),
  ('bec', 'PLA1006'),
  ('bec', 'SST2003'),
  ('bet', 'CET3001'),
  ('bet', 'CSA2001'),
  ('bet', 'CSE0001'),
  ('bet', 'CSE0002'),
  ('bet', 'CSE3001'),
  ('bet', 'CSE3016'),
  ('bet', 'CSE4001'),
  ('bet', 'CSG3004'),
  ('bet', 'CSG3008'),
  ('bet', 'DSN2099'),
  ('bet', 'EEE1001'),
  ('bet', 'ENG2005'),
  ('bet', 'MAT2002'),
  ('bet', 'MAT2003'),
  ('bet', 'MAT3002'),
  ('bet', 'MEE2014'),
  ('bet', 'PHY1003'),
  ('bet', 'PLA1004'),
  ('bet', 'SST1003'),
  ('bey', 'CEC2001'),
  ('bey', 'CEC3003'),
  ('bey', 'CEC3006'),
  ('bey', 'CSE3004'),
  ('bey', 'CSE3016'),
  ('bey', 'CSE4001'),
  ('bey', 'PLA1004'),
  ('bhi', 'BIO2006'),
  ('bhi', 'CHI1002'),
  ('bhi', 'CHI2002'),
  ('bhi', 'CHI3001'),
  ('bhi', 'CHI3003'),
  ('bhi', 'CHI3005'),
  ('bhi', 'CHY1002'),
  ('bhi', 'CHY1005'),
  ('bhi', 'CHY1006'),
  ('bhi', 'CSA2001'),
  ('bhi', 'CSE0001'),
  ('bhi', 'CSE0002'),
  ('bhi', 'CSE2001'),
  ('bhi', 'CSE3003'),
  ('bhi', 'CSE3010'),
  ('bhi', 'DSN2099'),
  ('bhi', 'EEE1001'),
  ('bhi', 'MAT2002'),
  ('bhi', 'MAT3003'),
  ('bhi', 'MEE2014'),
  ('bhi', 'PHY2011'),
  ('bhi', 'PLA1004'),
  ('bhi', 'SST1003'),
  ('bme', 'CHY1001'),
  ('bme', 'CHY1006'),
  ('bme', 'CSA2001'),
  ('bme', 'CSE0001'),
  ('bme', 'CSE0002'),
  ('bme', 'CSE2006'),
  ('bme', 'DSN2099'),
  ('bme', 'ENG1004'),
  ('bme', 'MAT2002'),
  ('bme', 'MAT2005'),
  ('bme', 'MEE1002'),
  ('bme', 'MEE1005'),
  ('bme', 'MEE2001'),
  ('bme', 'MEE2002'),
  ('bme', 'MEE2004'),
  ('bme', 'MEE2009'),
  ('bme', 'MEE2010'),
  ('bme', 'MEE3015'),
  ('bme', 'MEE4001'),
  ('bmr', 'CHY1001'),
  ('bmr', 'CHY1006'),
  ('bmr', 'CSA2001'),
  ('bmr', 'CSE0001'),
  ('bmr', 'CSE0002'),
  ('bmr', 'CSE2006'),
  ('bmr', 'DSN2099'),
  ('bmr', 'ENG1004'),
  ('bmr', 'MAT2002'),
  ('bmr', 'MAT3002'),
  ('bmr', 'MEA2006'),
  ('bmr', 'MEA3006'),
  ('bmr', 'MEE1002'),
  ('bmr', 'MEE1003'),
  ('bmr', 'MEE1005'),
  ('bmr', 'MEE2002'),
  ('bmr', 'MEE2009'),
  ('bmr', 'MEE3015'),
  ('bmr', 'SST2003'),
  ('boe', 'BIO1001'),
  ('boe', 'BIO1101'),
  ('boe', 'BIO3002'),
  ('boe', 'BIO3003'),
  ('boe', 'BIO3005'),
  ('boe', 'BIO3014'),
  ('boe', 'BIO3020'),
  ('boe', 'BIO3022'),
  ('boe', 'BIO3023'),
  ('boe', 'CHY1006'),
  ('boe', 'CSA2001'),
  ('boe', 'CSE0001'),
  ('boe', 'CSE0002'),
  ('boe', 'DSN2099'),
  ('boe', 'ECE2101'),
  ('boe', 'EEE3100'),
  ('boe', 'EEE3101'),
  ('boe', 'ENG1004'),
  ('boe', 'MAT2101'),
  ('boe', 'MAT3015'),
  ('boe', 'PHY1001'),
  ('boe', 'PHY3001'),
  ('boe', 'PLA1005'),
  ('boe', 'PLA1006'),
  ('boe', 'SST2003'),
  ('bsa', 'CCA2001'),
  ('bsa', 'CCA2002'),
  ('bsa', 'CCA3001'),
  ('bsa', 'CCA3002'),
  ('bsa', 'CHY1005'),
  ('bsa', 'CSA2001'),
  ('bsa', 'CSE0001'),
  ('bsa', 'CSE0002'),
  ('bsa', 'CSE2001'),
  ('bsa', 'CSE2003'),
  ('bsa', 'CSE2004'),
  ('bsa', 'CSE2006'),
  ('bsa', 'CSE3001'),
  ('bsa', 'CSE3015'),
  ('bsa', 'DSN2099'),
  ('bsa', 'EEE1001'),
  ('bsa', 'ENG2005'),
  ('bsa', 'MAT2005'),
  ('bsa', 'MAT3003'),
  ('bsa', 'MEE2014'),
  ('bsa', 'PLA1004'),
  ('bsa', 'SST1003'),
  ('mei', 'CHY1006'),
  ('mei', 'CHY1007'),
  ('mei', 'CSD1001'),
  ('mei', 'CSD3004'),
  ('mei', 'CSD4001'),
  ('mei', 'CSD4003'),
  ('mei', 'CSD4012'),
  ('mei', 'CSD5002'),
  ('mei', 'CSD5005'),
  ('mei', 'CSD6005'),
  ('mei', 'CSE0001'),
  ('mei', 'CSE0002'),
  ('mei', 'CSE2003'),
  ('mei', 'CSE3001'),
  ('mei', 'CSE3006'),
  ('mei', 'CSE3017'),
  ('mei', 'CSE4001'),
  ('mei', 'DSN2099'),
  ('mei', 'EEE1001'),
  ('mei', 'ENG2005'),
  ('mei', 'MAT2002'),
  ('mei', 'MAT2003'),
  ('mei', 'MAT2005'),
  ('mei', 'MAT3003'),
  ('mei', 'PHY1003'),
  ('mei', 'PLA1006'),
  ('mei', 'SST2003'),
  ('mib', 'BIA1001'),
  ('mib', 'BIA2001'),
  ('mib', 'BIO1001'),
  ('mib', 'BIO2002'),
  ('mib', 'CHY1005'),
  ('mib', 'CHY1006'),
  ('mib', 'CSE0001'),
  ('mib', 'CSE0002'),
  ('mib', 'CSE2001'),
  ('mib', 'CSE2002'),
  ('mib', 'DSN2099'),
  ('mib', 'ENG1004'),
  ('mib', 'MAT2002'),
  ('mib', 'MAT2101'),
  ('mib', 'MAT3003'),
  ('mib', 'SST2003'),
  ('mim', 'CHY1005'),
  ('mim', 'CSA3020'),
  ('mim', 'CSA4001'),
  ('mim', 'CSA4002'),
  ('mim', 'CSA4008'),
  ('mim', 'CSA4016'),
  ('mim', 'CSA4017'),
  ('mim', 'CSE0001'),
  ('mim', 'CSE0002'),
  ('mim', 'CSE2001'),
  ('mim', 'CSE2003'),
  ('mim', 'CSE2004'),
  ('mim', 'CSE2006'),
  ('mim', 'CSE3001'),
  ('mim', 'CSE3003'),
  ('mim', 'CSE3004'),
  ('mim', 'CSE3016'),
  ('mim', 'DSN2099'),
  ('mim', 'EEE1001'),
  ('mim', 'ENG2005'),
  ('mim', 'MAT2002'),
  ('mim', 'MAT3002'),
  ('mim', 'MAT3016'),
  ('mim', 'PHY1003'),
  ('mim', 'PLA1006'),
  ('mim', 'SST2003'),
  ('mip', 'CDS3001'),
  ('mip', 'CDS3002'),
  ('mip', 'CDS4007'),
  ('mip', 'CDS4011'),
  ('mip', 'CHI4010'),
  ('mip', 'CHY1005'),
  ('mip', 'CHY1006'),
  ('mip', 'CSA3007'),
  ('mip', 'CSA4002'),
  ('mip', 'CSE0001'),
  ('mip', 'CSE0002'),
  ('mip', 'CSE2001'),
  ('mip', 'CSE2006'),
  ('mip', 'CSE3001'),
  ('mip', 'CSE3006'),
  ('mip', 'CSE3011'),
  ('mip', 'CSE3016'),
  ('mip', 'DSN2099'),
  ('mip', 'ENG2005'),
  ('mip', 'MAS5009'),
  ('mip', 'MAT2002'),
  ('mip', 'MAT2003'),
  ('mip', 'MAT3002'),
  ('mip', 'MAT3003'),
  ('mip', 'PHY1003'),
  ('mip', 'PLA1006'),
  ('mip', 'SST2003'),
  ('msi', 'BIO3002'),
  ('msi', 'BIO3003'),
  ('msi', 'BIO3017'),
  ('msi', 'BIO3022'),
  ('msi', 'BIY3005'),
  ('msi', 'BIY3011'),
  ('msi', 'DSN5097'),
  ('msi', 'HUM1002'),
  ('msi', 'PHY3001'),
  ('msi', 'PLA1006')
) as v(programme_slug, subject_code)
join public.programmes p on p.slug = v.programme_slug
on conflict (programme_slug, subject_code) do nothing;

-- Keep the six shared 23 Batch materials available to the new programmes too.
insert into public.programme_subjects (programme_slug, subject_code)
select p.slug, s.code
from public.programmes p
cross join (values ('ENG2005'), ('MAT1001'), ('MAT2001'), ('HUM1002'), ('CHY1005'), ('CSE1021')) as s(code)
where p.is_active
on conflict (programme_slug, subject_code) do nothing;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261104000300', 'winter_2026_27_curriculum');
end $migration$;

-- ═══ 20261104000400_organize_23_batch_course_catalogue ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261104000400') then
    raise notice 'skip 20261104000400';
    return;
  end if;
  execute $m$-- The imported course folders are all under drive-imports/23 Batch. Keep the
-- catalogue year aligned with that source folder and reconcile known subject
-- placements to programme_subjects, which was transcribed from the supplied
-- Winter 2026-27 course list. This intentionally leaves publication status,
-- file visibility, hidden units and course content unchanged.

insert into public.batches (year)
values (2023)
on conflict (year) do nothing;

update public.courses
set batch_year = 2023
where r2_prefix like 'drive-imports/23 Batch/%'
  and batch_year <> 2023;

-- Use the same RPC the admin uses so the primary programme stays among the
-- placements. Unmapped legacy subjects retain their current manual placement.
do $$
declare
  course record;
begin
  for course in
    select c.id,
           array_agg(ps.programme_slug order by p.sort, p.slug) as programme_slugs
      from public.courses c
      join public.programme_subjects ps on ps.subject_code = c.subject_code
      join public.programmes p on p.slug = ps.programme_slug and p.is_active
     where c.r2_prefix like 'drive-imports/23 Batch/%'
     group by c.id
  loop
    perform public.set_course_programmes(course.id, course.programme_slugs);
  end loop;
end $$;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261104000400', 'organize_23_batch_course_catalogue');
end $migration$;

-- ═══ 20261104000500_correct_course_years_and_programmes ═══
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261104000500') then
    raise notice 'skip 20261104000500';
    return;
  end if;
  execute $m$-- Reconcile the supplied Winter 2026-27 course map exactly. The app keeps
-- legacy branch placements only for course codes absent from that document.
-- Assign each uploaded course to the intake cohort indicated by its semester:
-- semesters 7-8 are the 2023 cohort, 5-6 are 2024, 3-4 are 2025, and 1-2 are 2026.
-- Publication status and file/unit visibility are intentionally unchanged.

insert into public.batches (year, is_visible)
select distinct case
         when semester between 1 and 2 then 2026
         when semester between 3 and 4 then 2025
         when semester between 5 and 6 then 2024
         when semester between 7 and 8 then 2023
         when semester between 9 and 10 then 2022
       end,
       true
  from public.courses
 where r2_prefix like 'drive-imports/23 Batch/%'
   and semester between 1 and 10
on conflict (year) do update set is_visible = true;

update public.courses
   set batch_year = case
     when semester between 1 and 2 then 2026
     when semester between 3 and 4 then 2025
     when semester between 5 and 6 then 2024
     when semester between 7 and 8 then 2023
     when semester between 9 and 10 then 2022
   end
 where r2_prefix like 'drive-imports/23 Batch/%'
   and semester between 1 and 10;

create temporary table expected_course_programmes (
  programme_slug text not null,
  subject_code text not null,
  primary key (programme_slug, subject_code)
) on commit drop;

insert into expected_course_programmes (programme_slug, subject_code)
values
  ('bai', 'CDS3005'),
  ('bai', 'MAT1001'),
  ('bai', 'MAT2001'),
  ('bai', 'CSE1021'),
  ('bai', 'CHY1005'),
  ('bai', 'CSA2001'),
  ('bai', 'CSA3006'),
  ('bai', 'CSA3007'),
  ('bai', 'CSA4002'),
  ('bai', 'CSA4008'),
  ('bai', 'CSA4028'),
  ('bai', 'CSD3009'),
  ('bai', 'CSE0001'),
  ('bai', 'CSE0002'),
  ('bai', 'CSE2001'),
  ('bai', 'CSE2004'),
  ('bai', 'CSE3006'),
  ('bai', 'CSE3015'),
  ('bai', 'DSN2099'),
  ('bai', 'EEE1001'),
  ('bai', 'MAT2005'),
  ('bai', 'PHY1003'),
  ('bai', 'PLA1006'),
  ('bai', 'SST1003'),
  ('bce', 'MAT1001'),
  ('bce', 'MAT2001'),
  ('bce', 'CSE1021'),
  ('bce', 'CSA2001'),
  ('bce', 'CSE0001'),
  ('bce', 'CSE0002'),
  ('bce', 'CSE2001'),
  ('bce', 'CSE2002'),
  ('bce', 'CSE2003'),
  ('bce', 'CSE2006'),
  ('bce', 'CSE3003'),
  ('bce', 'CSE3004'),
  ('bce', 'CSE3005'),
  ('bce', 'CSE3015'),
  ('bce', 'CSE4001'),
  ('bce', 'DSN2099'),
  ('bce', 'ECE3004'),
  ('bce', 'EEE1001'),
  ('bce', 'ENG2005'),
  ('bce', 'MAT2003'),
  ('bce', 'MAT3003'),
  ('bce', 'MGT2003'),
  ('bce', 'PHY1003'),
  ('bce', 'PLA1006'),
  ('bce', 'SST1003'),
  ('bce', 'SST2003'),
  ('bcg', 'CSG2006'),
  ('bcg', 'PHY1005'),
  ('bcg', 'MAT1001'),
  ('bcg', 'MAT2001'),
  ('bcg', 'CSE1021'),
  ('bcg', 'CHY1005'),
  ('bcg', 'CSA2001'),
  ('bcg', 'CSE0001'),
  ('bcg', 'CSE0002'),
  ('bcg', 'CSE2001'),
  ('bcg', 'CSE2004'),
  ('bcg', 'CSE2006'),
  ('bcg', 'CSE3003'),
  ('bcg', 'CSE3006'),
  ('bcg', 'CSG2011'),
  ('bcg', 'CSG3005'),
  ('bcg', 'CSG3006'),
  ('bcg', 'CSG3007'),
  ('bcg', 'CSG3008'),
  ('bcg', 'DSN2099'),
  ('bcg', 'EEE1001'),
  ('bcg', 'ENG2005'),
  ('bcg', 'MAT2002'),
  ('bcg', 'MAT2005'),
  ('bcg', 'MAT3008'),
  ('bcg', 'MEE2014'),
  ('bcg', 'PLA1004'),
  ('bcg', 'SST1003'),
  ('bcg', 'SST2003'),
  ('bey', 'ECE2003'),
  ('bey', 'MAT1001'),
  ('bey', 'MAT2001'),
  ('bey', 'CSE1021'),
  ('bey', 'CEC2001'),
  ('bey', 'CEC3003'),
  ('bey', 'CEC3006'),
  ('bey', 'CSE3004'),
  ('bey', 'CSE3016'),
  ('bey', 'CSE4001'),
  ('bey', 'PLA1004'),
  ('bsa', 'CDS3005'),
  ('bsa', 'MAT1001'),
  ('bsa', 'MAT2001'),
  ('bsa', 'CSE1021'),
  ('bsa', 'CCA2001'),
  ('bsa', 'CCA2002'),
  ('bsa', 'CCA3001'),
  ('bsa', 'CCA3002'),
  ('bsa', 'CHY1005'),
  ('bsa', 'CSA2001'),
  ('bsa', 'CSE0001'),
  ('bsa', 'CSE0002'),
  ('bsa', 'CSE2001'),
  ('bsa', 'CSE2003'),
  ('bsa', 'CSE2004'),
  ('bsa', 'CSE2006'),
  ('bsa', 'CSE3001'),
  ('bsa', 'CSE3015'),
  ('bsa', 'DSN2099'),
  ('bsa', 'EEE1001'),
  ('bsa', 'ENG2005'),
  ('bsa', 'MAT2005'),
  ('bsa', 'MAT3003'),
  ('bsa', 'MEE2014'),
  ('bsa', 'PLA1004'),
  ('bsa', 'SST1003'),
  ('mim', 'MGT1002'),
  ('mim', 'MAT1001'),
  ('mim', 'MAT2001'),
  ('mim', 'CSE1021'),
  ('mim', 'CHY1005'),
  ('mim', 'CSA3020'),
  ('mim', 'CSA4001'),
  ('mim', 'CSA4002'),
  ('mim', 'CSA4008'),
  ('mim', 'CSA4016'),
  ('mim', 'CSA4017'),
  ('mim', 'CSE0001'),
  ('mim', 'CSE0002'),
  ('mim', 'CSE2001'),
  ('mim', 'CSE2003'),
  ('mim', 'CSE2004'),
  ('mim', 'CSE2006'),
  ('mim', 'CSE3001'),
  ('mim', 'CSE3003'),
  ('mim', 'CSE3004'),
  ('mim', 'CSE3016'),
  ('mim', 'DSN2099'),
  ('mim', 'EEE1001'),
  ('mim', 'ENG2005'),
  ('mim', 'MAT2002'),
  ('mim', 'MAT3002'),
  ('mim', 'MAT3016'),
  ('mim', 'PHY1003'),
  ('mim', 'PLA1006'),
  ('mim', 'SST2003'),
  ('bcy', 'CHY1007'),
  ('bcy', 'CSA2001'),
  ('bcy', 'CSD1001'),
  ('bcy', 'CSD3009'),
  ('bcy', 'CSD4001'),
  ('bcy', 'CSD4002'),
  ('bcy', 'CSE0001'),
  ('bcy', 'CSE0002'),
  ('bcy', 'CSE2006'),
  ('bcy', 'CSE3001'),
  ('bcy', 'CSE3003'),
  ('bcy', 'CSE3006'),
  ('bcy', 'CSE3016'),
  ('bcy', 'CSE4001'),
  ('bcy', 'DSN2099'),
  ('bcy', 'EEE1001'),
  ('bcy', 'ENG2005'),
  ('bcy', 'MAT2003'),
  ('bcy', 'MAT3003'),
  ('bcy', 'PHY1003'),
  ('bcy', 'PLA1004'),
  ('bhi', 'BIO2006'),
  ('bhi', 'CHI1002'),
  ('bhi', 'CHI2002'),
  ('bhi', 'CHI3001'),
  ('bhi', 'CHI3003'),
  ('bhi', 'CHI3005'),
  ('bhi', 'CHY1002'),
  ('bhi', 'CHY1005'),
  ('bhi', 'CHY1006'),
  ('bhi', 'CSA2001'),
  ('bhi', 'CSE0001'),
  ('bhi', 'CSE0002'),
  ('bhi', 'CSE2001'),
  ('bhi', 'CSE3003'),
  ('bhi', 'CSE3010'),
  ('bhi', 'DSN2099'),
  ('bhi', 'EEE1001'),
  ('bhi', 'MAT2002'),
  ('bhi', 'MAT3003'),
  ('bhi', 'MEE2014'),
  ('bhi', 'PHY2011'),
  ('bhi', 'PLA1004'),
  ('bhi', 'SST1003'),
  ('boe', 'BIO1001'),
  ('boe', 'BIO1101'),
  ('boe', 'BIO3002'),
  ('boe', 'BIO3003'),
  ('boe', 'BIO3005'),
  ('boe', 'BIO3014'),
  ('boe', 'BIO3020'),
  ('boe', 'BIO3022'),
  ('boe', 'BIO3023'),
  ('boe', 'CHY1006'),
  ('boe', 'CSA2001'),
  ('boe', 'CSE0001'),
  ('boe', 'CSE0002'),
  ('boe', 'DSN2099'),
  ('boe', 'ECE2101'),
  ('boe', 'EEE3100'),
  ('boe', 'EEE3101'),
  ('boe', 'ENG1004'),
  ('boe', 'MAT2101'),
  ('boe', 'MAT3015'),
  ('boe', 'PHY1001'),
  ('boe', 'PHY3001'),
  ('boe', 'PLA1005'),
  ('boe', 'PLA1006'),
  ('boe', 'SST2003'),
  ('bec', 'CHY1001'),
  ('bec', 'CSA2001'),
  ('bec', 'CSE0001'),
  ('bec', 'CSE0002'),
  ('bec', 'CSE2002'),
  ('bec', 'DSN2099'),
  ('bec', 'EAC2002'),
  ('bec', 'ECE2002'),
  ('bec', 'ECE3004'),
  ('bec', 'ECE3005'),
  ('bec', 'ECE3006'),
  ('bec', 'ECE3010'),
  ('bec', 'ECE4002'),
  ('bec', 'ECE4007'),
  ('bec', 'ECE4008'),
  ('bec', 'ECE4010'),
  ('bec', 'ENG1004'),
  ('bec', 'MAT2005'),
  ('bec', 'MAT3002'),
  ('bec', 'MEE2014'),
  ('bec', 'PHY1001'),
  ('bec', 'PLA1006'),
  ('bec', 'SST2003'),
  ('bac', 'CHY1001'),
  ('bac', 'CSA2001'),
  ('bac', 'CSA3003'),
  ('bac', 'CSA4020'),
  ('bac', 'CSE0001'),
  ('bac', 'CSE0002'),
  ('bac', 'CSE2002'),
  ('bac', 'DSN2099'),
  ('bac', 'EAC2002'),
  ('bac', 'EAC2006'),
  ('bac', 'EAC4001'),
  ('bac', 'EAC4010'),
  ('bac', 'ECE2002'),
  ('bac', 'ECE3004'),
  ('bac', 'ECE3006'),
  ('bac', 'ECE4010'),
  ('bac', 'ENG1004'),
  ('bac', 'MAT2005'),
  ('bac', 'MAT3002'),
  ('bac', 'MEE2014'),
  ('bac', 'PHY1001'),
  ('bac', 'PLA1006'),
  ('bac', 'SST2003'),
  ('bme', 'CHY1001'),
  ('bme', 'CHY1006'),
  ('bme', 'CSA2001'),
  ('bme', 'CSE0001'),
  ('bme', 'CSE0002'),
  ('bme', 'CSE2006'),
  ('bme', 'DSN2099'),
  ('bme', 'ENG1004'),
  ('bme', 'MAT2002'),
  ('bme', 'MAT2005'),
  ('bme', 'MEE1002'),
  ('bme', 'MEE1005'),
  ('bme', 'MEE2001'),
  ('bme', 'MEE2002'),
  ('bme', 'MEE2004'),
  ('bme', 'MEE2009'),
  ('bme', 'MEE2010'),
  ('bme', 'MEE3015'),
  ('bme', 'MEE4001'),
  ('bmr', 'CHY1001'),
  ('bmr', 'CHY1006'),
  ('bmr', 'CSA2001'),
  ('bmr', 'CSE0001'),
  ('bmr', 'CSE0002'),
  ('bmr', 'CSE2006'),
  ('bmr', 'DSN2099'),
  ('bmr', 'ENG1004'),
  ('bmr', 'MAT2002'),
  ('bmr', 'MAT3002'),
  ('bmr', 'MEA2006'),
  ('bmr', 'MEA3006'),
  ('bmr', 'MEE1002'),
  ('bmr', 'MEE1003'),
  ('bmr', 'MEE1005'),
  ('bmr', 'MEE2002'),
  ('bmr', 'MEE2009'),
  ('bmr', 'MEE3015'),
  ('bmr', 'SST2003'),
  ('bas', 'ASE2003'),
  ('bas', 'ASE2004'),
  ('bas', 'ASE2005'),
  ('bas', 'ASE2007'),
  ('bas', 'ASE2009'),
  ('bas', 'ASE2010'),
  ('bas', 'ASE2012'),
  ('bas', 'ASE3007'),
  ('bas', 'ASE3010'),
  ('bas', 'ASE5001'),
  ('bas', 'CHY1001'),
  ('bas', 'CSE0001'),
  ('bas', 'CSE0002'),
  ('bas', 'CSE2006'),
  ('bas', 'DSN2099'),
  ('bas', 'EEE1001'),
  ('bas', 'MAT2002'),
  ('bas', 'MAT2004'),
  ('bas', 'MAT3003'),
  ('bas', 'MEE1002'),
  ('bas', 'MEE2014'),
  ('bas', 'PHY1001'),
  ('bas', 'PLA1006'),
  ('bba', 'BMT1002'),
  ('bba', 'BMT1003'),
  ('bba', 'BMT1013'),
  ('bba', 'BMT1015'),
  ('bba', 'BMT2005'),
  ('bba', 'BMT2009'),
  ('bba', 'BMT2014'),
  ('bba', 'BMT2016'),
  ('bba', 'BMT2018'),
  ('bba', 'BMT2021'),
  ('bba', 'BMT2022'),
  ('bba', 'BMT2025'),
  ('bba', 'BMT3004'),
  ('bba', 'BMT3005'),
  ('bba', 'BMT3006'),
  ('bba', 'BMT3010'),
  ('bba', 'BMT3011'),
  ('bba', 'CHY1002'),
  ('bba', 'ENG2006'),
  ('bba', 'HUM1014'),
  ('bba', 'HUM1108'),
  ('bba', 'HUM2001'),
  ('bba', 'SST1001'),
  ('bet', 'CET3001'),
  ('bet', 'CSA2001'),
  ('bet', 'CSE0001'),
  ('bet', 'CSE0002'),
  ('bet', 'CSE3001'),
  ('bet', 'CSE3016'),
  ('bet', 'CSE4001'),
  ('bet', 'CSG3004'),
  ('bet', 'CSG3008'),
  ('bet', 'DSN2099'),
  ('bet', 'EEE1001'),
  ('bet', 'ENG2005'),
  ('bet', 'MAT2002'),
  ('bet', 'MAT2003'),
  ('bet', 'MAT3002'),
  ('bet', 'MEE2014'),
  ('bet', 'PHY1003'),
  ('bet', 'PLA1004'),
  ('bet', 'SST1003'),
  ('mei', 'CHY1006'),
  ('mei', 'CHY1007'),
  ('mei', 'CSD1001'),
  ('mei', 'CSD3004'),
  ('mei', 'CSD4001'),
  ('mei', 'CSD4003'),
  ('mei', 'CSD4012'),
  ('mei', 'CSD5002'),
  ('mei', 'CSD5005'),
  ('mei', 'CSD6005'),
  ('mei', 'CSE0001'),
  ('mei', 'CSE0002'),
  ('mei', 'CSE2003'),
  ('mei', 'CSE3001'),
  ('mei', 'CSE3006'),
  ('mei', 'CSE3017'),
  ('mei', 'CSE4001'),
  ('mei', 'DSN2099'),
  ('mei', 'EEE1001'),
  ('mei', 'ENG2005'),
  ('mei', 'MAT2002'),
  ('mei', 'MAT2003'),
  ('mei', 'MAT2005'),
  ('mei', 'MAT3003'),
  ('mei', 'PHY1003'),
  ('mei', 'PLA1006'),
  ('mei', 'SST2003'),
  ('mib', 'BIA1001'),
  ('mib', 'BIA2001'),
  ('mib', 'BIO1001'),
  ('mib', 'BIO2002'),
  ('mib', 'CHY1005'),
  ('mib', 'CHY1006'),
  ('mib', 'CSE0001'),
  ('mib', 'CSE0002'),
  ('mib', 'CSE2001'),
  ('mib', 'CSE2002'),
  ('mib', 'DSN2099'),
  ('mib', 'ENG1004'),
  ('mib', 'MAT2002'),
  ('mib', 'MAT2101'),
  ('mib', 'MAT3003'),
  ('mib', 'SST2003'),
  ('mip', 'CDS3001'),
  ('mip', 'CDS3002'),
  ('mip', 'CDS4007'),
  ('mip', 'CDS4011'),
  ('mip', 'CHI4010'),
  ('mip', 'CHY1005'),
  ('mip', 'CHY1006'),
  ('mip', 'CSA3007'),
  ('mip', 'CSA4002'),
  ('mip', 'CSE0001'),
  ('mip', 'CSE0002'),
  ('mip', 'CSE2001'),
  ('mip', 'CSE2006'),
  ('mip', 'CSE3001'),
  ('mip', 'CSE3006'),
  ('mip', 'CSE3011'),
  ('mip', 'CSE3016'),
  ('mip', 'DSN2099'),
  ('mip', 'ENG2005'),
  ('mip', 'MAS5009'),
  ('mip', 'MAT2002'),
  ('mip', 'MAT2003'),
  ('mip', 'MAT3002'),
  ('mip', 'MAT3003'),
  ('mip', 'PHY1003'),
  ('mip', 'PLA1006'),
  ('mip', 'SST2003'),
  ('msi', 'BIO3002'),
  ('msi', 'BIO3003'),
  ('msi', 'BIO3017'),
  ('msi', 'BIO3022'),
  ('msi', 'BIY3005'),
  ('msi', 'BIY3011'),
  ('msi', 'DSN5097'),
  ('msi', 'HUM1002'),
  ('msi', 'PHY3001'),
  ('msi', 'PLA1006');

delete from public.programme_subjects existing
using (select distinct subject_code from expected_course_programmes) mapped
 where existing.subject_code = mapped.subject_code
   and not exists (
     select 1 from expected_course_programmes expected
      where expected.subject_code = existing.subject_code
        and expected.programme_slug = existing.programme_slug
   );

insert into public.programme_subjects (programme_slug, subject_code)
select programme_slug, subject_code
  from expected_course_programmes
on conflict (programme_slug, subject_code) do nothing;

do $$
declare
  course record;
begin
  for course in
    select c.id,
           array_agg(e.programme_slug order by p.sort, p.slug) as programme_slugs
      from public.courses c
      join expected_course_programmes e on e.subject_code = c.subject_code
      join public.programmes p on p.slug = e.programme_slug and p.is_active
     where c.r2_prefix like 'drive-imports/23 Batch/%'
     group by c.id
  loop
    perform public.set_course_programmes(course.id, course.programme_slugs);
  end loop;
end $$;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261104000500', 'correct_course_years_and_programmes');
end $migration$;
-- ═══ 20261106000100_scheduled_device_removal ═══
do $migration$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261106000100') then
    raise notice 'skip 20261106000100';
  else
    execute $m$
      create or replace function public.enforce_two_device_limit()
      returns trigger
      language plpgsql
      security definer
      set search_path = public
      as $$
      begin
        perform 1 from public.profiles where id = new.user_id for update;
        if (
          select count(*)
          from public.devices
          where user_id = new.user_id
            and (revoked_at is null or revoked_at > now())
        ) >= 2 then
          raise exception 'SS_DEVICE_LIMIT' using errcode = '23514';
        end if;
        return new;
      end;
      $$;
    $m$;
    insert into supabase_migrations.schema_migrations (version, name)
      values ('20261106000100', 'scheduled_device_removal');
  end if;
end $migration$;

-- ═══ 20261107000200_course_offered_to ═══
do $migration$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261107000200') then
    raise notice 'skip 20261107000200';
  else
    execute $m$
      -- One course (one set of notes in R2) can be offered to several batches and programmes.
      -- By default a course follows the term's course list by its code (e.g. CSE3003 → 2024 BCE and
      -- 2025 BCY) plus the batch and programmes it was filed under. When an admin picks the drawers
      -- by hand, the choice is kept here as [{"batchYear": 2025, "branchSlug": "bce"}, ...].
      alter table public.courses add column if not exists offered_to jsonb;
      
      do $$
      begin
        if not exists (
          select 1 from pg_constraint where conname = 'courses_offered_to_is_array'
        ) then
          alter table public.courses
            add constraint courses_offered_to_is_array
            check (offered_to is null or jsonb_typeof(offered_to) = 'array');
        end if;
      end $$;
      
      comment on column public.courses.offered_to is
        'Admin-chosen drawers [{batchYear, branchSlug}]; null = follow the course list and filing.';
    $m$;
    insert into supabase_migrations.schema_migrations (version, name)
      values ('20261107000200', 'course_offered_to');
  end if;
end $migration$;

-- === 20261108000100_support_query_minimum_lengths ===
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261108000100') then
    raise notice 'skip 20261108000100';
    return;
  end if;
  execute $m$-- Require useful support requests and replies while preserving existing short threads.
-- The API validates these limits immediately; the cutoff also protects direct DB writes.
alter table public.support_queries
  add constraint support_queries_subject_minimum_check
  check (created_at < timestamptz '2026-11-09 00:00:00+00' or length(btrim(subject)) >= 8)
  not valid;

alter table public.support_messages
  add constraint support_messages_body_minimum_check
  check (created_at < timestamptz '2026-11-09 00:00:00+00' or length(btrim(body)) >= 15)
  not valid;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261108000100', 'support_query_minimum_lengths');
end $migration$;

-- === 20261109000100_flexible_bundles_and_offers ===
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261109000100') then
    raise notice 'skip 20261109000100';
    return;
  end if;
  execute $m$-- Bundles across batches and programmes, and offers (Diwali and other sales).
--
-- One course is often shared by several years and programmes, so a bundle is no longer kept to one
-- batch. Where it shows is its own setting: [{"batchYear": 2025, "branchSlug": "bce"}, ...], where
-- "*" means every programme of that batch. Null keeps the automatic rule: every drawer that shows
-- two or more of its courses (and, for an old bundle with batch_year set, only that batch).
alter table public.bundles add column if not exists offered_to jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bundles_offered_to_is_array') then
    alter table public.bundles
      add constraint bundles_offered_to_is_array
      check (offered_to is null or jsonb_typeof(offered_to) = 'array');
  end if;
end $$;

comment on column public.bundles.offered_to is
  'Admin-chosen drawers [{batchYear, branchSlug}] ("*" = whole batch); null = automatic.';

-- An offer takes a percentage off while it runs. It never changes the stored prices, so when it
-- ends the old price simply comes back. When two offers cover the same thing the bigger one wins.
create table if not exists public.offers (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(btrim(title)) between 2 and 60),
  percent_off  int  not null check (percent_off between 1 and 90),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  status       text not null default 'draft' check (status in ('draft', 'live')),
  everything   boolean not null default false,
  course_ids   uuid[] not null default '{}',
  bundle_ids   uuid[] not null default '{}',
  drawers      jsonb not null default '[]'::jsonb check (jsonb_typeof(drawers) = 'array'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists offers_window_idx on public.offers (status, ends_at);

drop trigger if exists offers_updated_at on public.offers;
create trigger offers_updated_at before update on public.offers
  for each row execute function public.set_updated_at();
drop trigger if exists offers_audit on public.offers;
create trigger offers_audit after insert or update or delete on public.offers
  for each row execute function public.audit_row('id');

-- Only the server (service role) reads and writes offers; students see prices through the API.
alter table public.offers enable row level security;
revoke all on public.offers from anon, authenticated;
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261109000100', 'flexible_bundles_and_offers');
end $migration$;

-- === 20261109000200_drawer_packs ===
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261109000200') then
    raise notice 'skip 20261109000200';
    return;
  end if;
  execute $m$-- Drawer packs: one bundle per drawer (batch × programme) holding every course that drawer shows,
-- priced on a fixed ladder (5 courses for ₹349, and so on). The pack builder keeps each pack's
-- courses and price in step with its drawer; "2025:bce" says which drawer a pack belongs to.
-- Null for bundles made by hand.
alter table public.bundles add column if not exists auto_drawer text;

create unique index if not exists bundles_auto_drawer_key
  on public.bundles (auto_drawer) where auto_drawer is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bundles_auto_drawer_shape') then
    alter table public.bundles
      add constraint bundles_auto_drawer_shape
      check (auto_drawer is null or auto_drawer ~ '^[0-9]{4}:[a-z0-9]+(-[a-z0-9]+)*$');
  end if;
end $$;

comment on column public.bundles.auto_drawer is
  'Drawer pack key "year:programme" (kept in step by the pack builder); null = made by hand.';
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261109000200', 'drawer_packs');
end $migration$;

-- === 20261109000300_course_descriptions ===
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261109000300') then
    raise notice 'skip 20261109000300';
    return;
  end if;
  execute $m$-- One line on what each course covers, from the Winter 2026-27 syllabus, for every course whose
-- description is still empty. Courses with a description of their own are left alone.
-- Safe to run more than once. Generated from packages/contracts/src/course-blurbs.ts.
-- (The site already falls back to these lines when a description is empty; this writes them in so
-- they can be edited per course in Admin.)
update public.courses as c
   set description = v.line
  from (values
  ('ASE2003', 'Linkages, cams, gears and the kinematics and dynamics of machines.'),
  ('ASE2004', 'How aircraft parts are made: metals, composites, machining, joining and assembly.'),
  ('ASE2005', 'Stress, bending and buckling in thin walled aircraft structures.'),
  ('ASE2007', 'Aircraft parts and assemblies drawn and modelled in CAD.'),
  ('ASE2009', 'Flight basics, aircraft and spacecraft types, and how an aerospace system fits together.'),
  ('ASE2010', 'How aircraft and rockets find their way: sensors, navigation and feedback control.'),
  ('ASE2012', 'Laws of thermodynamics, cycles and their use in jet and rocket engines.'),
  ('ASE3007', 'Shape memory alloys, piezoelectrics and other materials that respond to their surroundings.'),
  ('ASE3010', 'Rocket propulsion, staging, trajectories and missile guidance.'),
  ('ASE5001', 'Conceptual design of aircraft and launch vehicles, from mission to layout.'),
  ('BIA1001', 'Cell structure, division, inheritance and the basics of genetics.'),
  ('BIA2001', 'Quantum ideas behind molecular structure, bonding and spectra in biology.'),
  ('BIO1001', 'Where biology meets engineering: devices, biomaterials and living systems.'),
  ('BIO1101', 'How cells and tissues work: membranes, signalling, muscle and nerve.'),
  ('BIO2002', 'DNA, gene expression, cloning and recombinant DNA tools.'),
  ('BIO2006', 'Circuits and sensors in medical devices: ECG, EEG, monitors and safety.'),
  ('BIO3002', 'The immune system and engineering it: vaccines, antibodies and immunotherapy.'),
  ('BIO3003', 'Scaffolds, cells and growth factors for rebuilding tissue.'),
  ('BIO3005', 'X-ray, CT, MRI and ultrasound, and how their images are analysed.'),
  ('BIO3014', 'How cancer starts and spreads, and how it is diagnosed and treated.'),
  ('BIO3017', 'Biomaterials, their properties and how implants and devices are made.'),
  ('BIO3020', 'Genomics and pharmacology for treatment matched to the patient.'),
  ('BIO3022', 'Stem cell types, differentiation and their use in regenerative medicine.'),
  ('BIO3023', 'Forces and motion in the body: bones, joints, muscles and blood flow.'),
  ('BIY3005', 'Fermentation, bioreactors and scaling up biological production.'),
  ('BIY3011', 'Nutrients, diet and their link to health and disease.'),
  ('BMT1002', 'Demand, supply, consumer choice, costs and market structures.'),
  ('BMT1003', 'Planning, organising, leading and controlling: how organisations are run.'),
  ('BMT1013', 'Hiring, training, appraisal, pay and employee relations.'),
  ('BMT1015', 'Indian traditions of science, mathematics, philosophy and governance.'),
  ('BMT2005', 'Leadership styles, team roles, motivation and resolving conflict.'),
  ('BMT2009', 'Why people buy: perception, attitudes, culture and decision making.'),
  ('BMT2014', 'Valuing stocks and bonds, risk and return, and building a portfolio.'),
  ('BMT2016', 'Understanding and managing emotions, at work and with others.'),
  ('BMT2018', 'Strategy analysis, competitive advantage and corporate level choices.'),
  ('BMT2021', 'Insurance principles, products, underwriting and claims.'),
  ('BMT2022', 'Self awareness, communication, etiquette and personal growth.'),
  ('BMT2025', 'Your internship report, presentation and what you learned on the job.'),
  ('BMT3004', 'Winning and keeping customers: CRM strategy, data and tools.'),
  ('BMT3005', 'SEO, social media, content, email and paid ads, and measuring them.'),
  ('BMT3006', 'Policy issue, servicing and claims: how insurance runs day to day.'),
  ('BMT3010', 'Attracting, developing and keeping the right people.'),
  ('BMT3011', 'Sourcing, inventory, logistics and planning across the supply chain.'),
  ('CCA2001', 'Cloud service models, virtual machines, hypervisors and containers.'),
  ('CCA2002', 'Designing on the cloud: compute, storage, networking and managed services.'),
  ('CCA3001', 'Storing and processing data in the cloud: databases, data lakes and NoSQL.'),
  ('CCA3002', 'Computing close to devices: fog and edge architecture for IoT.'),
  ('CDS3001', 'Clocks, consensus, replication and fault tolerance across many machines.'),
  ('CDS3002', 'Building systems that grow: load balancing, caching, sharding and queues.'),
  ('CDS4007', 'Machine learning on big data: distributed training and Spark MLlib.'),
  ('CDS4011', 'Microcontrollers, sensors and protocols for IoT devices.'),
  ('CEC2001', 'How online business works: models, payments, security and law.'),
  ('CEC3003', 'Warehouse layout, inventory, order picking and automation.'),
  ('CEC3006', 'Online customer relationships: analytics, personalisation and loyalty.'),
  ('CET3001', 'Mining student data to understand and improve learning.'),
  ('CHI1002', 'Computing and information systems in health care.'),
  ('CHI2002', 'ARM microcontrollers, interfacing and embedded C.'),
  ('CHI3001', 'Building mobile and web apps for health care.'),
  ('CHI3003', 'AI for diagnosis, medical images and clinical decisions.'),
  ('CHI3005', 'Wearable sensors, IoT platforms and health monitoring.'),
  ('CHI4010', 'Analysing clinical and health data with statistics and machine learning.'),
  ('CHY1001', 'Water, fuels, corrosion, polymers and materials chemistry for engineers.'),
  ('CHY1002', 'Ecosystems, pollution, resources and environmental protection.'),
  ('CHY1005', 'Molecular modelling and simulation of chemical systems.'),
  ('CHY1006', 'Sustainable development, clean energy and green technology.'),
  ('CHY1007', 'Chemistry in crime investigation: evidence, toxicology and analysis.'),
  ('CSA2001', 'Search, logic, and the first machine learning models, in a flipped class.'),
  ('CSA3003', 'Agents that learn by trial and reward: MDPs, Q-learning and policy methods.'),
  ('CSA3006', 'Data warehouses, OLAP, association rules, classification and clustering.'),
  ('CSA3007', 'Neural networks, CNNs, RNNs and training deep models.'),
  ('CSA3020', 'Transformers, LLMs, diffusion models and prompt engineering.'),
  ('CSA4001', 'Search, planning and optimisation algorithms used in AI.'),
  ('CSA4002', 'Perceptrons, backpropagation and neural network architectures.'),
  ('CSA4008', 'Machine learning end to end: data, models, evaluation and deployment.'),
  ('CSA4016', 'GPUs, TPUs and accelerators for training and running models.'),
  ('CSA4017', 'Gradient methods and convex optimisation behind machine learning.'),
  ('CSA4020', 'Neural networks, CNNs, RNNs and training deep models.'),
  ('CSA4028', 'Text processing, language models, embeddings and transformers.'),
  ('CSD1001', 'Collecting, preserving and analysing digital evidence.'),
  ('CSD3004', 'Threat intelligence, attack patterns and analysing cyber attacks.'),
  ('CSD3009', 'Data structures with the analysis of how fast algorithms run.'),
  ('CSD4001', 'Finding software flaws: fuzzing, static analysis and penetration testing.'),
  ('CSD4002', 'Recon, scanning, exploitation and reporting, the legal way.'),
  ('CSD4003', 'Firewalls, IDS, cryptography and securing networks and systems.'),
  ('CSD4012', 'OWASP Top 10: XSS, SQL injection, auth flaws and how to stop them.'),
  ('CSD5002', 'Hypervisors, virtual machines and virtual networks in practice.'),
  ('CSD5005', 'Network requirements, architecture choices and design.'),
  ('CSD6005', 'Securing Wi-Fi, cellular and mobile devices.'),
  ('CSE0001', 'Using computers, the internet and digital tools safely and well.'),
  ('CSE0002', 'Linux commands, shell, users, permissions and system administration.'),
  ('CSE2001', 'Classes, inheritance, polymorphism, templates and the STL in C++.'),
  ('CSE2002', 'Arrays, lists, stacks, queues, trees, graphs, sorting and searching.'),
  ('CSE2003', 'How a computer is built: CPU, memory, pipelining and I/O.'),
  ('CSE2004', 'Automata, grammars, Turing machines, and how a compiler works.'),
  ('CSE2006', 'Java, OOP, collections, exceptions, threads and JDBC.'),
  ('CSE3001', 'ER models, SQL, normalisation, transactions and indexing.'),
  ('CSE3003', 'Processes, scheduling, synchronisation, deadlocks, memory and files.'),
  ('CSE3004', 'Divide and conquer, greedy, dynamic programming and complexity.'),
  ('CSE3005', 'Requirements, design, testing, agile and project management.'),
  ('CSE3006', 'OSI and TCP/IP layers, routing, switching and protocols.'),
  ('CSE3010', 'Image processing, features, detection and deep learning for vision.'),
  ('CSE3011', 'Python basics to files, OOP and libraries like NumPy and pandas.'),
  ('CSE3015', 'AWS core services, pricing and security for the Cloud Practitioner exam.'),
  ('CSE3016', 'Designing resilient, secure and cost aware systems on AWS.'),
  ('CSE3017', 'Salesforce CRM, admin, automation and the basics of Apex.'),
  ('CSE4001', 'HTML, CSS, JavaScript, server side code and web frameworks.'),
  ('CSG2011', 'Game design and building playable levels in Unreal Engine.'),
  ('CSG3004', 'AR and VR hardware, tracking and building immersive games.'),
  ('CSG3005', 'Cloud gaming, streaming and backends for online games.'),
  ('CSG3006', 'Rendering, shading, particles and visual effects.'),
  ('CSG3007', 'Supervised and unsupervised learning, with its uses in games.'),
  ('CSG3008', 'Modelling, texturing, rigging and animating 3D characters.'),
  ('DSN2099', 'Building and showing your semester project.'),
  ('DSN5097', 'Revision across the core subjects for the comprehensive exam.'),
  ('EAC2002', 'Maxwell’s equations, waves and transmission lines.'),
  ('EAC2006', 'Processing audio, images and video: compression and filtering.'),
  ('EAC4001', 'Kinematics, dynamics and control of robot motion.'),
  ('EAC4010', 'Perception, localisation, mapping and planning for autonomous robots.'),
  ('ECE2002', 'Boolean algebra, gates, combinational and sequential circuits.'),
  ('ECE2101', 'Diodes, transistors, amplifiers and op amps.'),
  ('ECE3004', '8085, 8051 and ARM: programming and interfacing.'),
  ('ECE3005', 'Sampling, DFT, FFT, and designing FIR and IIR filters.'),
  ('ECE3006', 'CMOS design, layout and building digital chips.'),
  ('ECE3010', 'Entropy, source coding and error correcting codes.'),
  ('ECE4002', 'Antenna parameters, arrays and how radio waves travel.'),
  ('ECE4007', 'Sensor nodes, protocols and routing in wireless sensor networks.'),
  ('ECE4008', 'Wireless channels, modulation and optical fibre links.'),
  ('ECE4010', 'Microcontrollers, real time systems and embedded software.'),
  ('EEE1001', 'Circuit laws, network theorems, AC circuits and machines.'),
  ('EEE3100', 'Processing ECG, EEG and medical images.'),
  ('EEE3101', 'Modelling body systems and controlling them.'),
  ('ENG1004', 'Clear technical writing, reports and presentations.'),
  ('ENG2005', 'Technical reports, proposals, presentations and professional writing.'),
  ('ENG2006', 'Business letters, emails, reports and meetings.'),
  ('HUM1002', 'Understanding and managing emotions, at work and with others.'),
  ('HUM1014', 'The Constitution of India: rights, duties and government.'),
  ('HUM1108', 'Sanitation, cleanliness and community service.'),
  ('HUM2001', 'Human behaviour, personality, motivation and groups.'),
  ('MAS5009', 'Shipping ML models: pipelines, versioning, deployment and monitoring.'),
  ('MAT2002', 'Logic, sets, relations, combinatorics and graph theory.'),
  ('MAT2003', 'Roots, interpolation, numerical integration and solving ODEs.'),
  ('MAT2004', 'Linear programming, transportation, queues and decision models.'),
  ('MAT2005', 'Laplace, Fourier and Z transforms, and difference equations.'),
  ('MAT2101', 'Ordinary and partial differential equations and where they are used.'),
  ('MAT3002', 'Vector spaces, eigenvalues, SVD and their applications.'),
  ('MAT3003', 'Probability, distributions, hypothesis tests and reliability.'),
  ('MAT3008', 'Games, equilibria and algorithms for strategic decisions.'),
  ('MAT3015', 'Statistics for biology and medicine: designs, tests and survival.'),
  ('MAT3016', 'Markov chains, Poisson processes and queues.'),
  ('MEA2006', 'Robot types, kinematics, actuators and sensors.'),
  ('MEA3006', 'Robot vision, mapping and path planning.'),
  ('MEE1002', 'Forces, equilibrium, friction, and the motion of bodies.'),
  ('MEE1003', 'Metals, alloys, heat treatment and how materials are made.'),
  ('MEE1005', 'Fluid statics, flow, Bernoulli and pipe flow.'),
  ('MEE2001', 'Machine parts drawn to standard: views, fits and assemblies.'),
  ('MEE2002', 'Stress, strain, bending, torsion and deflection.'),
  ('MEE2004', 'IC engines, steam power, refrigeration and heat transfer.'),
  ('MEE2009', 'Measuring instruments, sensors and control systems.'),
  ('MEE2010', 'Mechanisms, cams, gears and velocity analysis.'),
  ('MEE2014', 'Design process, CAD modelling and analysis.'),
  ('MEE3015', 'Sensors, actuators and controllers working as one system.'),
  ('MEE4001', 'Designing gears, belts, chains, shafts and bearings.'),
  ('MGT2003', 'Turning tech ideas into ventures: validation, funding and growth.'),
  ('PHY1001', 'Optics, lasers, quantum ideas and semiconductors for engineers.'),
  ('PHY1003', 'Solving physics problems with numerical methods and code.'),
  ('PHY2011', 'Physics of biological molecules, cells and systems.'),
  ('PHY3001', 'Light in biology and medicine: microscopy and optical sensing.'),
  ('PLA1004', 'Timed problem solving with data structures and algorithms.'),
  ('PLA1005', 'Timed problem solving with data structures and algorithms.'),
  ('PLA1006', 'Puzzles and creative problem solving, the way placement tests ask.'),
  ('SST1001', 'Communication, confidence, teamwork and the first soft skills.'),
  ('SST1003', 'Speaking, writing and presenting as an engineer.'),
  ('SST2003', 'Workplace communication: meetings, emails, interviews and GDs.')
  ) as v(code, line)
 where upper(c.subject_code) = v.code
   and coalesce(btrim(c.description), '') = '';
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261109000300', 'course_descriptions');
end $migration$;

-- === 20261109000400_more_course_descriptions ===
do $migration$ begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261109000400') then
    raise notice 'skip 20261109000400';
    return;
  end if;
  execute $m$-- One-line summaries for the live courses that aren't on the Winter 2026-27 list (older batches'
-- subjects), filled in only where the description is still empty. Safe to run more than once.
update public.courses as c
   set description = v.line
  from (values
  ('CDS3005', 'Data wrangling, exploratory analysis, statistics and visualisation with Python.'),
  ('CSE1021', 'Problem solving, flowcharts and programming basics in Python.'),
  ('CSE3012', 'Building Android apps: layouts, activities, storage and APIs.'),
  ('EAC1002', 'Diodes, BJTs, MOSFETs, amplifiers and op amp circuits.'),
  ('ECE2003', 'Continuous and discrete signals, convolution, Fourier and Z transforms.'),
  ('EEE2001', 'Network theorems, transients, two port networks and resonance.'),
  ('MAT1001', 'Limits, derivatives, integrals and Laplace transforms.'),
  ('MAT1003', 'Limits, derivatives, integrals and their applications.'),
  ('MAT2001', 'Ordinary differential equations and difference equations.'),
  ('MGT1002', 'Planning, organising, leading, and how people behave at work.'),
  ('PHY1005', 'Motion, forces, collisions and rigid bodies for game physics engines.')
  ) as v(code, line)
 where upper(c.subject_code) = v.code
   and coalesce(btrim(c.description), '') = '';
$m$;
  insert into supabase_migrations.schema_migrations (version, name) values ('20261109000400', 'more_course_descriptions');
end $migration$;
