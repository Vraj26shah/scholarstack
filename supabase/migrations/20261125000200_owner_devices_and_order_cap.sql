-- ════════════════════════════════════════════════════════════════════════════
-- Restaurant owners: any number of devices, and a daily order limit
--
-- 1. Owners run their kitchen from several phones, a counter tablet and a laptop, so the
--    device-limit trigger lets an address listed in messes.owner_emails register up to 100
--    devices (students 2, admins 10). The API applies the same numbers.
-- 2. messes.daily_order_cap: the most orders a restaurant takes on the site in one day (campus
--    time), set by its owner or an admin. 0 = no limit.
--
-- Safe to run more than once. Rollback:
--   re-run enforce_two_device_limit() from 20261117000100;
--   alter table public.messes drop column if exists daily_order_cap;
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.enforce_two_device_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  device_limit int := 2;
  v_email text;
begin
  perform 1 from public.profiles where id = new.user_id for update;
  select lower(btrim(email)) into v_email from public.profiles where id = new.user_id;
  if exists (select 1 from public.messes m where v_email = any (m.owner_emails)) then
    device_limit := 100;
  elsif exists (select 1 from public.admin_emails a where a.email = v_email) then
    device_limit := 10;
  end if;
  if (
    select count(*)
    from public.devices
    where user_id = new.user_id
      and (revoked_at is null or revoked_at > now())
  ) >= device_limit then
    raise exception 'SS_DEVICE_LIMIT' using errcode = '23514';
  end if;
  return new;
end;
$$;

alter table public.messes add column if not exists daily_order_cap int not null default 0;
alter table public.messes drop constraint if exists messes_daily_order_cap;
alter table public.messes add constraint messes_daily_order_cap check (daily_order_cap between 0 and 2000);
