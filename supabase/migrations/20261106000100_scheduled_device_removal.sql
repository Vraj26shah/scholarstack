-- A device stays active during its three-day removal grace period. Count scheduled
-- removals as active until their timestamp so sign-in cannot claim the slot early.
create or replace function public.enforce_two_device_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from public.profiles where id = new.user_id for update;
  if (
    select count(*)
    from public.devices
    where user_id = new.user_id
      and (revoked_at is null or revoked_at > now())
  ) >= 2 then
    raise exception 'SS_DEVICE_LIMIT' using errcode = '23514';
  end if;
  return new;
end;
$$;
