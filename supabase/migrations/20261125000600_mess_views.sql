-- ════════════════════════════════════════════════════════════════════════════
-- Restaurant page views
--
-- How many people open each restaurant's page, per campus day, for the owner's Insights tab. One
-- row per restaurant, day and visitor: "u:<account id>" when signed in, otherwise a hash of the
-- network that changes every day (not reversible, never an address). Owners and admins opening
-- their own page are not counted. Server only.
--
-- Safe to run more than once. Rollback:
--   drop function if exists public.mess_view_hit(text, date, text, uuid);
--   drop table if exists public.mess_views_daily;
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.mess_views_daily (
  mess_slug   text not null references public.messes(slug) on delete cascade,
  day         date not null,
  visitor     text not null,
  user_id     uuid,
  views       int not null default 1,
  first_at    timestamptz not null default now(),
  last_at     timestamptz not null default now(),
  primary key (mess_slug, day, visitor),
  constraint mess_views_visitor check (char_length(visitor) between 3 and 80)
);
create index if not exists mess_views_daily_day on public.mess_views_daily (mess_slug, day);
alter table public.mess_views_daily enable row level security; -- server only
revoke all on public.mess_views_daily from anon, authenticated;
comment on table public.mess_views_daily is 'Opens of each restaurant page per day and visitor (owner insights).';

-- One open: a new row, or one more on today's row (one call, no read-then-write race).
create or replace function public.mess_view_hit(p_slug text, p_day date, p_visitor text, p_user uuid)
returns void
language sql security definer set search_path = public as $$
  insert into public.mess_views_daily (mess_slug, day, visitor, user_id)
  values (p_slug, p_day, p_visitor, p_user)
  on conflict (mess_slug, day, visitor)
  do update set views = least(public.mess_views_daily.views + 1, 100000), last_at = now(),
    user_id = coalesce(excluded.user_id, public.mess_views_daily.user_id);
$$;
revoke execute on function public.mess_view_hit(text, date, text, uuid) from public, anon, authenticated;
grant execute on function public.mess_view_hit(text, date, text, uuid) to service_role;
