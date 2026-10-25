-- ════════════════════════════════════════════════════════════════════════════
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
