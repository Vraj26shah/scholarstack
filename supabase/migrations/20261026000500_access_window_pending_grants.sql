-- ════════════════════════════════════════════════════════════════════════════
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
