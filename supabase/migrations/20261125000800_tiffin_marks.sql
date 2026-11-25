-- ════════════════════════════════════════════════════════════════════════════
-- Tiffin deliveries
--
-- Each day the restaurant marks every tiffin meal Delivered or Missed. A missed meal can be made
-- up within the next 4 days (a row with makeup_for = the missed day); after that it lapses.
-- makeup_for is '' for the day's regular meal. Server only.
--
-- Safe to run more than once. Rollback:
--   drop table if exists public.tiffin_marks;
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.tiffin_marks (
  order_id    uuid not null references public.mess_orders(id) on delete cascade,
  day         date not null,
  meal        text not null,
  makeup_for  text not null default '',
  status      text not null,
  marked_at   timestamptz not null default now(),
  primary key (order_id, day, meal, makeup_for),
  constraint tiffin_marks_meal check (meal in ('lunch', 'dinner')),
  constraint tiffin_marks_status check (status in ('delivered', 'missed')),
  constraint tiffin_marks_makeup check (makeup_for = '' or makeup_for ~ '^\d{4}-\d{2}-\d{2}$')
);
create index if not exists tiffin_marks_day on public.tiffin_marks (day);
alter table public.tiffin_marks enable row level security; -- server only
revoke all on public.tiffin_marks from anon, authenticated;
comment on table public.tiffin_marks is 'Tiffin meals marked delivered or missed per day, and make-up meals (within 4 days).';
