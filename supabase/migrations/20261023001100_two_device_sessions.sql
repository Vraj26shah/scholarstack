-- Keep one current Supabase auth session for each of the account's registered devices.
-- The device table remains the source of truth for the two-device account limit.
alter table public.active_sessions drop constraint active_sessions_pkey;
alter table public.active_sessions
  add constraint active_sessions_pkey primary key (user_id, device_id);

create index active_sessions_user_idx on public.active_sessions (user_id);
create unique index active_sessions_user_session_idx on public.active_sessions (user_id, session_id);

-- Serialize new-device registration by locking the owning profile. The application
-- also checks MAX_DEVICES for a friendly response; this database guard closes races.
create or replace function public.enforce_two_device_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from public.profiles where id = new.user_id for update;
  if (select count(*) from public.devices where user_id = new.user_id and revoked_at is null) >= 2 then
    raise exception 'SS_DEVICE_LIMIT' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger devices_two_device_limit
before insert on public.devices
for each row execute function public.enforce_two_device_limit();
