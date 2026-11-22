-- ════════════════════════════════════════════════════════════════════════════
-- Student activity: which pages and tools are opened, and what students do there
--
-- One row per IST day, person, kind and target, with a counter:
--   kind 'page'   target '/c/dbms-2025-cse-core', '/tools/cgpa', '/shelf', '/read' …
--   kind 'action' target 'read_open', 'begin_checkout:/c/dbms-2025-cse-core', 'login' …
-- Signed-in students have their own rows (Admin › Students › Activity). Visitors who are not
-- signed in are counted together (user_id is null): no visitor id, IP or device is stored, so a
-- visitor can't be told apart or followed. Admins are never counted.
--
-- The API decides what a target may be (a fixed list of pages and actions; anything else is
-- dropped), so this table can't be filled with made-up paths. Rows older than 180 days are
-- deleted by the nightly prune_history().
--
-- Access: only the server (service role). Students and visitors reach it only through the API.
--
-- Safe to run more than once. Rollback:
--   drop function if exists public.admin_people();
--   drop function if exists public.admin_student_activity(uuid, timestamptz);
--   drop function if exists public.admin_activity(timestamptz, int);
--   drop function if exists public.record_activity(uuid, text, text);
--   drop table if exists public.activity_daily;
--   (and re-create prune_history() from 20261031000500_housekeeping.sql)
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.activity_daily (
  day       date not null,
  user_id   uuid references public.profiles(id) on delete cascade,
  kind      text not null,
  target    text not null,
  hits      int not null default 1,
  first_at  timestamptz not null default now(),
  last_at   timestamptz not null default now(),
  constraint activity_daily_kind check (kind in ('page', 'action')),
  constraint activity_daily_target check (target ~ '^[a-z0-9_/:.-]{1,160}$'),
  constraint activity_daily_hits check (hits >= 1),
  constraint activity_daily_times check (last_at >= first_at)
);

-- One row per day, person (or "visitors"), kind and target.
create unique index if not exists activity_daily_uq on public.activity_daily
  (day, (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)), kind, target);
create index if not exists activity_daily_day_idx on public.activity_daily (day);
create index if not exists activity_daily_user_idx on public.activity_daily (user_id, day desc)
  where user_id is not null;

comment on table public.activity_daily is
  'Pages and actions per IST day: per signed-in student, visitors together (no visitor id). Kept 180 days.';
comment on column public.activity_daily.user_id is 'The signed-in student, or null for visitors (counted together).';
comment on column public.activity_daily.target is
  'A page (/c/<slug>, /tools/<key>, /shelf …) or an action (read_open, begin_checkout:/c/<slug> …), checked by the API.';

alter table public.activity_daily enable row level security;
revoke all on public.activity_daily from anon, authenticated;

-- One page view or action, today (IST).
create or replace function public.record_activity(p_user uuid, p_kind text, p_target text)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.activity_daily as a (day, user_id, kind, target)
  values ((now() at time zone 'Asia/Kolkata')::date, p_user, p_kind, p_target)
  on conflict (day, (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)), kind, target)
  do update set hits = a.hits + 1, last_at = now();
$$;

-- Admin › Insights: pages, actions, active students per day and the most active students.
create or replace function public.admin_activity(p_since timestamptz, p_limit int default 30)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with
  bounds as (
    select (p_since at time zone 'Asia/Kolkata')::date as since_day,
           least(greatest(coalesce(p_limit, 30), 1), 100) as lim
  ),
  rows as (
    select a.* from public.activity_daily a, bounds b where a.day >= b.since_day
  ),
  days as (
    select generate_series(b.since_day, (now() at time zone 'Asia/Kolkata')::date, interval '1 day')::date as day
      from bounds b
  ),
  daily as (
    select d.day,
           (select count(distinct r.user_id) from rows r where r.day = d.day and r.user_id is not null) as students,
           (select coalesce(sum(r.hits), 0) from rows r where r.day = d.day and r.kind = 'page' and r.user_id is not null) as student_pages,
           (select coalesce(sum(r.hits), 0) from rows r where r.day = d.day and r.kind = 'page' and r.user_id is null) as visitor_pages
      from days d
  ),
  pages as (
    select target,
           sum(hits) as hits,
           coalesce(sum(hits) filter (where user_id is not null), 0) as student_hits,
           coalesce(sum(hits) filter (where user_id is null), 0) as visitor_hits,
           count(distinct user_id) as students
      from rows where kind = 'page' group by target
     order by hits desc, target collate "C" limit (select lim from bounds)
  ),
  actions as (
    select target,
           sum(hits) as hits,
           coalesce(sum(hits) filter (where user_id is null), 0) as visitor_hits,
           count(distinct user_id) as students
      from rows where kind = 'action' group by target
     order by hits desc, target collate "C" limit (select lim from bounds)
  ),
  per_student as (
    select user_id, count(distinct day) as days, sum(hits) as hits, max(last_at) as last_at
      from rows where user_id is not null group by user_id
  ),
  top_students as (
    select s.*, p.email, p.full_name,
           (select r.target from rows r
             where r.user_id = s.user_id and r.kind = 'page'
             group by r.target order by sum(r.hits) desc, r.target collate "C" limit 1) as top_page
      from per_student s join public.profiles p on p.id = s.user_id
     order by s.last_at desc
     limit (select lim from bounds)
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'activeStudents', (select count(*) from per_student),
      'studentPages', (select coalesce(sum(hits), 0) from rows where kind = 'page' and user_id is not null),
      'visitorPages', (select coalesce(sum(hits), 0) from rows where kind = 'page' and user_id is null),
      'actions', (select coalesce(sum(hits), 0) from rows where kind = 'action')
    ),
    'daily', coalesce((select jsonb_agg(jsonb_build_object(
        'day', day, 'students', students, 'studentPages', student_pages,
        'visitorPages', visitor_pages) order by day) from daily), '[]'::jsonb),
    'pages', coalesce((select jsonb_agg(jsonb_build_object(
        'target', target, 'hits', hits, 'studentHits', student_hits, 'visitorHits', visitor_hits,
        'students', students) order by hits desc, target collate "C") from pages), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(jsonb_build_object(
        'target', target, 'hits', hits, 'visitorHits', visitor_hits, 'students', students)
        order by hits desc, target collate "C") from actions), '[]'::jsonb),
    'students', coalesce((select jsonb_agg(jsonb_build_object(
        'userId', user_id, 'email', email, 'fullName', full_name, 'days', days, 'hits', hits,
        'lastAt', last_at, 'topPage', top_page) order by last_at desc) from top_students), '[]'::jsonb)
  );
$$;

-- Admin › Students › one student: what they opened and did, newest first.
create or replace function public.admin_student_activity(p_user uuid, p_since timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with rows as (
    select * from public.activity_daily
     where user_id = p_user and day >= (p_since at time zone 'Asia/Kolkata')::date
  ),
  recent as (
    select * from rows order by last_at desc, target collate "C" limit 300
  )
  select jsonb_build_object(
    'lastSeenAt', (select max(last_at) from public.activity_daily where user_id = p_user),
    'days', (select count(distinct day) from rows),
    'hits', (select coalesce(sum(hits), 0) from rows),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'day', day, 'kind', kind, 'target', target, 'hits', hits,
        'firstAt', first_at, 'lastAt', last_at) order by last_at desc, target collate "C") from recent), '[]'::jsonb)
  );
$$;

revoke execute on function public.record_activity(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.admin_activity(timestamptz, int) from public, anon, authenticated;
revoke execute on function public.admin_student_activity(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.record_activity(uuid, text, text) to service_role;
grant execute on function public.admin_activity(timestamptz, int) to service_role;
grant execute on function public.admin_student_activity(uuid, timestamptz) to service_role;

-- Nightly housekeeping now also drops activity older than 180 days (everything else unchanged).
create or replace function public.prune_history()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a int; l int; q int; p int; o int; v int;
begin
  delete from public.audit_log where at < now() - interval '180 days';
  get diagnostics a = row_count;
  delete from public.access_logs where day < current_date - 60;
  get diagnostics l = row_count;
  delete from public.email_quota where day < current_date - 60;
  get diagnostics q = row_count;
  delete from public.problem_reports where last_at < now() - interval '90 days';
  get diagnostics p = row_count;
  delete from public.activity_daily where day < current_date - 180;
  get diagnostics v = row_count;
  o := public.clean_abandoned_orders(14);
  return jsonb_build_object('audit', a, 'accessLogs', l, 'emailQuota', q, 'problems', p,
                            'activity', v, 'unpaidOrders', o);
end $$;
revoke execute on function public.prune_history() from public, anon, authenticated;

-- Admin › Students lists everyone who has signed up (not only buyers), with when they joined and
-- when they were last seen. One call, as one JSON value, so it is never cut at 1,000 rows.
create or replace function public.admin_people()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'userId', p.id, 'email', p.email, 'fullName', p.full_name,
           'joinedAt', p.created_at, 'lastSeenAt', s.last_at)
           order by p.created_at desc), '[]'::jsonb)
    from public.profiles p
    left join (
      select user_id, max(last_at) as last_at
        from public.activity_daily where user_id is not null group by user_id
    ) s on s.user_id = p.id;
$$;
revoke execute on function public.admin_people() from public, anon, authenticated;
grant execute on function public.admin_people() to service_role;
