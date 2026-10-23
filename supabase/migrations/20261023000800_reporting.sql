-- ════════════════════════════════════════════════════════════════════════════
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
