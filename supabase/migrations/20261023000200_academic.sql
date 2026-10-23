-- ════════════════════════════════════════════════════════════════════════════
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
