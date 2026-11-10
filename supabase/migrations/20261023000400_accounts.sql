-- ════════════════════════════════════════════════════════════════════════════
-- 0400 · Accounts: profiles, the college-only gate, devices, per-device sessions,
-- one open reader.
-- ════════════════════════════════════════════════════════════════════════════

create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text not null unique check (email = lower(email)),
  full_name        text check (full_name is null or length(full_name) <= 80),
  email_opt_in     boolean not null default true,
  unsubscribed_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index profiles_mailable_idx on public.profiles (id) where email_opt_in;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
comment on table public.profiles is 'One row per signed-in student, created by the auth trigger.';

-- Before User Created hook (Authentication → Hooks): keeps non-college emails out.
create or replace function public.hook_vit_only(event jsonb)
returns jsonb language plpgsql as $$
declare
  email text := lower(coalesce(event -> 'user' ->> 'email', ''));
begin
  if email !~ '^[a-z0-9._%+-]+@vitbhopal\.ac\.in$' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Please sign in with your @vitbhopal.ac.in email.'));
  end if;
  return '{}'::jsonb;
end $$;
grant execute on function public.hook_vit_only(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_vit_only(jsonb) from authenticated, anon, public;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(new.email), new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Devices (the API enforces MAX_DEVICES, default 2) ───────────────────────
create table public.devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  label         text not null check (length(label) <= 80),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz
);
create index devices_user_active_idx on public.devices (user_id) where revoked_at is null;
create index devices_user_revoked_idx on public.devices (user_id, revoked_at desc) where revoked_at is not null;

-- One live session per device; a later migration makes (user_id, device_id) the key.
create table public.active_sessions (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  session_id  text not null,
  device_id   uuid not null references public.devices(id) on delete cascade,
  updated_at  timestamptz not null default now()
);

-- Exactly one open reader per student.
create table public.viewer_leases (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  lease_id    text not null,
  device_id   uuid not null references public.devices(id) on delete cascade,
  file_id     uuid not null references public.course_files(id) on delete cascade,
  expires_at  timestamptz not null
);

alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.active_sessions enable row level security;
alter table public.viewer_leases enable row level security;
create policy "users read own profile" on public.profiles for select using (id = auth.uid());
create policy "users read own devices" on public.devices for select using (user_id = auth.uid());
