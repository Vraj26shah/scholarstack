-- ════════════════════════════════════════════════════════════════════════════
-- Sign-in guard. Before a sign-in link is sent, the Worker checks the address: an exact
-- @vitbhopal.ac.in address, or an address on the admin list. Each refused address counts
-- against the network (IP, stored only as a hash); 5 refusals within 24 hours block that
-- network from asking for links for 24 hours.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.signin_strikes (
  ip_hash text primary key,
  strikes int not null default 0,
  first_at timestamptz not null default now(),
  blocked_until timestamptz
);
alter table public.signin_strikes enable row level security;
revoke all on public.signin_strikes from anon, authenticated;

-- Count one refusal; returns when the block ends (null = not blocked).
create or replace function public.signin_strike(p_ip text, p_limit int, p_hours int)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare r public.signin_strikes;
begin
  insert into public.signin_strikes as s (ip_hash, strikes, first_at)
  values (p_ip, 1, now())
  on conflict (ip_hash) do update
    set strikes = case when s.first_at < now() - make_interval(hours => p_hours) then 1 else s.strikes + 1 end,
        first_at = case when s.first_at < now() - make_interval(hours => p_hours) then now() else s.first_at end
  returning * into r;
  if r.strikes >= p_limit and (r.blocked_until is null or r.blocked_until < now()) then
    update public.signin_strikes set blocked_until = now() + make_interval(hours => p_hours)
     where ip_hash = p_ip returning * into r;
  end if;
  return case when r.blocked_until > now() then r.blocked_until end;
end $$;
revoke execute on function public.signin_strike(text, int, int) from public, anon, authenticated;

-- Old rows are useless after a day; the hourly job clears them.
create or replace function public.prune_signin_strikes() returns int
language sql security definer set search_path = public as $$
  with gone as (
    delete from public.signin_strikes
     where first_at < now() - interval '48 hours' and (blocked_until is null or blocked_until < now())
    returning 1)
  select count(*)::int from gone;
$$;
revoke execute on function public.prune_signin_strikes() from public, anon, authenticated;
