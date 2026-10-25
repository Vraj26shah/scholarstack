-- ════════════════════════════════════════════════════════════════════════════
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
