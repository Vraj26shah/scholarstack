-- ════════════════════════════════════════════════════════════════════════════
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
