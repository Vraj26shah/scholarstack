-- ════════════════════════════════════════════════════════════════════════════
-- Notification counts per day
--
-- For Admin › Reminders: per campus day and kind (class, nightly, mess, order, chat, test, other)
-- how many notifications the push services accepted, how many devices said they showed one on
-- screen, how many were tapped, failed, or found the device switched off. Counts only: no device,
-- account or address is stored. Server only.
--
-- Safe to run more than once. Rollback:
--   drop function if exists public.push_daily_add(date, text, int, int, int, int, int);
--   drop table if exists public.push_daily;
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.push_daily (
  day     date not null,
  kind    text not null,
  sent    int not null default 0,
  seen    int not null default 0,
  opened  int not null default 0,
  failed  int not null default 0,
  gone    int not null default 0,
  primary key (day, kind),
  constraint push_daily_kind check (kind in ('class', 'nightly', 'mess', 'order', 'chat', 'test', 'other'))
);
alter table public.push_daily enable row level security; -- server only
revoke all on public.push_daily from anon, authenticated;
comment on table public.push_daily is 'Notifications sent, shown, tapped and failed per day and kind (counts only).';

-- Add to a day's counts in one call (no read-then-write race between runs).
create or replace function public.push_daily_add(
  p_day date, p_kind text, p_sent int, p_seen int, p_opened int, p_failed int, p_gone int
)
returns void
language sql security definer set search_path = public as $$
  insert into public.push_daily (day, kind, sent, seen, opened, failed, gone)
  values (p_day, p_kind, greatest(p_sent, 0), greatest(p_seen, 0), greatest(p_opened, 0),
          greatest(p_failed, 0), greatest(p_gone, 0))
  on conflict (day, kind) do update set
    sent   = public.push_daily.sent   + excluded.sent,
    seen   = public.push_daily.seen   + excluded.seen,
    opened = public.push_daily.opened + excluded.opened,
    failed = public.push_daily.failed + excluded.failed,
    gone   = public.push_daily.gone   + excluded.gone;
$$;
revoke execute on function public.push_daily_add(date, text, int, int, int, int, int) from public, anon, authenticated;
grant execute on function public.push_daily_add(date, text, int, int, int, int, int) to service_role;
