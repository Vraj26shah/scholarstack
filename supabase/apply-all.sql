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
  if (select count(*) from public.devices where user_id = new.user_id and revoked_at is null) >= 2 then
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
