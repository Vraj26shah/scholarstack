-- ════════════════════════════════════════════════════════════════════════════
-- "Who comes back": students grouped by the week they signed up (Monday-based, IST)
--
-- For each signup week of the last 8 weeks:
--   joined     students who signed up that week
--   weekReady  how many of them signed up at least 7 days ago (so "within a week" can be judged)
--   weekBack   of those, how many opened anything again on days 1–7 after signing up
--   monthReady how many signed up at least 28 days ago
--   monthBack  of those, how many opened anything on days 22–28 (still around in week 4)
-- Only students who joined on or after the first day activity was counted, so a quiet week
-- before counting started never looks like everyone left. Admins and restaurant owners
-- (owner sign-ins, @owners.invalid) are not students and are left out.
--
-- admin_activity() now carries it under 'retention', so Admin › Insights is still ONE call
-- (the Worker's request budget). Everything else in admin_activity() is unchanged.
--
-- Safe to run more than once. Rollback:
--   re-create admin_activity() from 20261122000300_student_activity.sql, then
--   drop function if exists public.admin_retention();
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.admin_retention()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with
  today as (select (now() at time zone 'Asia/Kolkata')::date as t),
  counted as (select min(day) as d from public.activity_daily),
  joined as (
    select p.id, (p.created_at at time zone 'Asia/Kolkata')::date as jd
      from public.profiles p, today, counted
     where counted.d is not null
       and (p.created_at at time zone 'Asia/Kolkata')::date >= greatest(counted.d, today.t - 55)
       and p.email not like '%@owners.invalid'
       and not exists (select 1 from public.admin_emails e where e.email = lower(p.email))
  ),
  marks as (
    select j.jd,
           j.jd + 7 <= today.t as week_ready,
           exists (select 1 from public.activity_daily a
                    where a.user_id = j.id and a.day between j.jd + 1 and j.jd + 7) as week_back,
           j.jd + 28 <= today.t as month_ready,
           exists (select 1 from public.activity_daily a
                    where a.user_id = j.id and a.day between j.jd + 22 and j.jd + 28) as month_back
      from joined j, today
  ),
  weeks as (
    select date_trunc('week', jd)::date as week,
           count(*) as joined,
           count(*) filter (where week_ready) as week_ready,
           count(*) filter (where week_ready and week_back) as week_back,
           count(*) filter (where month_ready) as month_ready,
           count(*) filter (where month_ready and month_back) as month_back
      from marks group by 1
  )
  select jsonb_build_object(
    'countingSince', (select d from counted),
    'weeks', coalesce((select jsonb_agg(jsonb_build_object(
        'week', week, 'joined', joined, 'weekReady', week_ready, 'weekBack', week_back,
        'monthReady', month_ready, 'monthBack', month_back) order by week desc) from weeks), '[]'::jsonb)
  );
$$;

revoke execute on function public.admin_retention() from public, anon, authenticated;
grant execute on function public.admin_retention() to service_role;

-- Admin › Insights: pages, actions, active students per day, the most active students, and now
-- who comes back (above). Same as 20261122000300 plus the 'retention' key.
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
        'lastAt', last_at, 'topPage', top_page) order by last_at desc) from top_students), '[]'::jsonb),
    'retention', public.admin_retention()
  );
$$;

revoke execute on function public.admin_activity(timestamptz, int) from public, anon, authenticated;
grant execute on function public.admin_activity(timestamptz, int) to service_role;
