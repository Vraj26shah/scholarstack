-- ════════════════════════════════════════════════════════════════════════════
-- Insights: what students look at, and how looking turns into buying
--
-- Admin › Students › Insights reads one report: new students, course and bundle page views,
-- checkouts started and paid, revenue, and what bought courses are read most.
--
-- Privacy by design: a page view is a counter per course (or bundle) per IST day. No student id,
-- e-mail, IP address or device is stored with it, so the table can never say who looked at what.
-- Reading figures come from access_logs, which already exists (and is pruned after 30 days).
--
-- Access: only the server (service role) can write or read any of this. Students and visitors
-- reach it only through the API, which validates the id, rate-limits each network, and counts a
-- page at most once per browser tab.
--
-- Safe to run more than once. Rollback:
--   drop function if exists public.admin_insights(timestamptz, int);
--   drop function if exists public.record_item_view(uuid, uuid, boolean);
--   drop table if exists public.item_views_daily;
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.item_views_daily (
  day              date not null,
  course_id        uuid references public.courses(id) on delete cascade,
  bundle_id        uuid references public.bundles(id) on delete cascade,
  views            int not null default 0 check (views >= 0),
  signed_in_views  int not null default 0 check (signed_in_views >= 0),
  constraint item_views_daily_one_item check (num_nonnulls(course_id, bundle_id) = 1),
  constraint item_views_daily_signed_in_le_views check (signed_in_views <= views)
);

create unique index if not exists item_views_daily_course_uq
  on public.item_views_daily (day, course_id) where course_id is not null;
create unique index if not exists item_views_daily_bundle_uq
  on public.item_views_daily (day, bundle_id) where bundle_id is not null;
create index if not exists item_views_daily_day_idx on public.item_views_daily (day);

comment on table public.item_views_daily is
  'Course and bundle page views per IST day. Counts only: no student, IP or device is stored.';
comment on column public.item_views_daily.signed_in_views is
  'Of the views, how many were by a signed-in student (the rest are visitors).';

alter table public.item_views_daily enable row level security;
revoke all on public.item_views_daily from anon, authenticated;

-- One view of a live course or bundle (anything else, a draft or a made-up id, is ignored).
create or replace function public.record_item_view(p_course uuid, p_bundle uuid, p_signed_in boolean)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'Asia/Kolkata')::date;
  v_signed int := case when coalesce(p_signed_in, false) then 1 else 0 end;
begin
  if num_nonnulls(p_course, p_bundle) <> 1 then
    return;
  end if;
  if p_course is not null then
    if not exists (select 1 from public.courses where id = p_course and status = 'live') then
      return;
    end if;
    insert into public.item_views_daily as v (day, course_id, views, signed_in_views)
    values (v_day, p_course, 1, v_signed)
    on conflict (day, course_id) where course_id is not null
    do update set views = v.views + 1, signed_in_views = v.signed_in_views + excluded.signed_in_views;
  else
    if not exists (select 1 from public.bundles where id = p_bundle and status = 'live') then
      return;
    end if;
    insert into public.item_views_daily as v (day, bundle_id, views, signed_in_views)
    values (v_day, p_bundle, 1, v_signed)
    on conflict (day, bundle_id) where bundle_id is not null
    do update set views = v.views + 1, signed_in_views = v.signed_in_views + excluded.signed_in_views;
  end if;
end;
$$;

-- The whole Insights report since a moment, in one call (the Worker has a small budget of
-- database calls per request). Days are IST. p_limit caps the "top" lists.
create or replace function public.admin_insights(p_since timestamptz, p_limit int default 15)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with
  bounds as (
    select (p_since at time zone 'Asia/Kolkata')::date as since_day,
           least(greatest(coalesce(p_limit, 15), 1), 50) as lim
  ),
  signups as (
    select id, created_at from public.profiles where created_at >= p_since
  ),
  period_orders as (
    select id, user_id, course_id, bundle_id, amount_paise, status, created_at
      from public.orders where created_at >= p_since
  ),
  paid as (
    select * from period_orders where status = 'paid'
  ),
  first_paid as (
    -- Each student's first paid order ever, when it falls in the period.
    select distinct on (o.user_id) o.user_id, o.created_at
      from public.orders o
     where o.status = 'paid'
     order by o.user_id, o.created_at
  ),
  views as (
    select v.* from public.item_views_daily v, bounds b where v.day >= b.since_day
  ),
  reading as (
    select f.course_id, a.user_id, a.pages_viewed
      from public.access_logs a
      join public.course_files f on f.id = a.file_id, bounds b
     where a.day >= b.since_day
  ),
  days as (
    select generate_series(b.since_day, (now() at time zone 'Asia/Kolkata')::date, interval '1 day')::date as day
      from bounds b
  ),
  daily as (
    select d.day,
           (select count(*) from signups s where (s.created_at at time zone 'Asia/Kolkata')::date = d.day) as signups,
           (select coalesce(sum(v.views), 0) from views v where v.day = d.day) as views,
           (select count(*) from period_orders o where (o.created_at at time zone 'Asia/Kolkata')::date = d.day) as checkouts,
           (select count(*) from paid o where (o.created_at at time zone 'Asia/Kolkata')::date = d.day) as paid,
           (select coalesce(sum(o.amount_paise), 0) from paid o where (o.created_at at time zone 'Asia/Kolkata')::date = d.day) as revenue_paise
      from days d
  ),
  item_views as (
    select coalesce(course_id, bundle_id) as item_id,
           case when course_id is not null then 'course' else 'bundle' end as kind,
           sum(views) as views, sum(signed_in_views) as signed_in_views
      from views group by 1, 2
  ),
  item_orders as (
    select coalesce(bundle_id, course_id) as item_id,
           case when bundle_id is not null then 'bundle' else 'course' end as kind,
           count(*) as checkouts,
           count(*) filter (where status = 'paid') as paid,
           coalesce(sum(amount_paise) filter (where status = 'paid'), 0) as revenue_paise
      from period_orders group by 1, 2
  ),
  items as (
    select coalesce(v.item_id, o.item_id) as item_id, coalesce(v.kind, o.kind) as kind,
           coalesce(v.views, 0) as views, coalesce(v.signed_in_views, 0) as signed_in_views,
           coalesce(o.checkouts, 0) as checkouts, coalesce(o.paid, 0) as paid,
           coalesce(o.revenue_paise, 0) as revenue_paise
      from item_views v full join item_orders o on o.item_id = v.item_id and o.kind = v.kind
  ),
  top_items as (
    select i.*, coalesce(c.title, bu.title) as title, coalesce(c.slug, bu.slug) as slug
      from items i
      left join public.courses c on i.kind = 'course' and c.id = i.item_id
      left join public.bundles bu on i.kind = 'bundle' and bu.id = i.item_id
     where coalesce(c.id, bu.id) is not null
     order by i.views desc, i.paid desc, i.checkouts desc, title
     limit (select lim from bounds)
  ),
  top_reading as (
    select r.course_id, c.title, c.slug, count(distinct r.user_id) as readers, sum(r.pages_viewed) as pages
      from reading r join public.courses c on c.id = r.course_id
     group by r.course_id, c.title, c.slug
     order by readers desc, pages desc, c.title
     limit (select lim from bounds)
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'signups', (select count(*) from signups),
      'signupsWhoBought', (select count(*) from signups s where exists
                             (select 1 from paid o where o.user_id = s.id)),
      'firstPurchases', (select count(*) from first_paid where created_at >= p_since),
      'buyers', (select count(distinct user_id) from paid),
      'checkouts', (select count(*) from period_orders),
      'paidOrders', (select count(*) from paid),
      'revenuePaise', (select coalesce(sum(amount_paise), 0) from paid),
      'views', (select coalesce(sum(views), 0) from views),
      'signedInViews', (select coalesce(sum(signed_in_views), 0) from views),
      'readers', (select count(distinct user_id) from reading),
      'pagesRead', (select coalesce(sum(pages_viewed), 0) from reading)
    ),
    'daily', coalesce((select jsonb_agg(jsonb_build_object(
        'day', day, 'signups', signups, 'views', views, 'checkouts', checkouts,
        'paid', paid, 'revenuePaise', revenue_paise) order by day) from daily), '[]'::jsonb),
    'topItems', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', kind, 'id', item_id, 'title', title, 'slug', slug, 'views', views,
        'signedInViews', signed_in_views, 'checkouts', checkouts, 'paid', paid,
        'revenuePaise', revenue_paise)
        order by views desc, paid desc, checkouts desc, title) from top_items), '[]'::jsonb),
    'topReading', coalesce((select jsonb_agg(jsonb_build_object(
        'courseId', course_id, 'title', title, 'slug', slug, 'readers', readers,
        'pages', pages) order by readers desc, pages desc, title) from top_reading), '[]'::jsonb)
  );
$$;

-- Only the server may call these.
revoke execute on function public.record_item_view(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.admin_insights(timestamptz, int) from public, anon, authenticated;
grant execute on function public.record_item_view(uuid, uuid, boolean) to service_role;
grant execute on function public.admin_insights(timestamptz, int) to service_role;
