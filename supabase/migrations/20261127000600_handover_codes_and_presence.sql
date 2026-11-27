-- ════════════════════════════════════════════════════════════════════════════
-- Two-way handover (orders and tiffin meals), disputes, and who is looking right now
--
-- 1. mess_orders.handover_secret: the student's handover codes are made from it (one 4-digit
--    code per order, one per tiffin meal). Never sent to the restaurant.
--    handover_tries / handover_tries_on: wrong codes typed per campus day (5 allowed).
--    handed_over_at / handover_how: 'code' (the student's code), 'student' (the student said they
--    got it), 'owner' (the restaurant's word alone; the student is asked to confirm).
-- 2. mess_orders.dispute / dispute_state / disputed_at / dispute_note: the student contests a
--    handover ("I didn't get it") or a no-show. A contested no-show doesn't count until the admin
--    decides. dispute_state: open, student, owner (the admin's decision), settled (code entered).
-- 3. tiffin_marks.how / confirm / decided: the same for each tiffin meal.
-- 4. app_presence: who has an order screen open right now (scope + email), so a notification about
--    what they're already looking at isn't sent. Rows are overwritten every few seconds.
--
-- Safe to run more than once. Rollback:
--   alter table public.mess_orders drop column if exists handover_secret,
--     drop column if exists handover_tries, drop column if exists handover_tries_on,
--     drop column if exists handed_over_at, drop column if exists handover_how,
--     drop column if exists dispute, drop column if exists dispute_state,
--     drop column if exists disputed_at, drop column if exists dispute_note;
--   alter table public.tiffin_marks drop column if exists how, drop column if exists confirm,
--     drop column if exists decided;
--   drop table if exists public.app_presence;
-- ════════════════════════════════════════════════════════════════════════════

alter table public.mess_orders add column if not exists handover_secret text not null default '';
alter table public.mess_orders add column if not exists handover_tries int not null default 0;
alter table public.mess_orders add column if not exists handover_tries_on text not null default '';
alter table public.mess_orders add column if not exists handed_over_at timestamptz;
alter table public.mess_orders add column if not exists handover_how text not null default '';
alter table public.mess_orders add column if not exists dispute text not null default '';
alter table public.mess_orders add column if not exists dispute_state text not null default '';
alter table public.mess_orders add column if not exists disputed_at timestamptz;
alter table public.mess_orders add column if not exists dispute_note text not null default '';
alter table public.mess_orders drop constraint if exists mess_orders_handover;
alter table public.mess_orders add constraint mess_orders_handover check (
  handover_how in ('', 'code', 'student', 'owner')
  and dispute in ('', 'not_received', 'no_show')
  and dispute_state in ('', 'open', 'student', 'owner', 'settled')
  and char_length(dispute_note) <= 300
  and char_length(handover_secret) <= 64
  and handover_tries between 0 and 1000
);
create index if not exists mess_orders_disputes on public.mess_orders (disputed_at desc) where dispute <> '';

alter table public.tiffin_marks add column if not exists how text not null default '';
alter table public.tiffin_marks add column if not exists confirm text not null default '';
alter table public.tiffin_marks add column if not exists decided text not null default '';
alter table public.tiffin_marks drop constraint if exists tiffin_marks_handover;
alter table public.tiffin_marks add constraint tiffin_marks_handover check (
  how in ('', 'code', 'student', 'owner')
  and confirm in ('', 'yes', 'no')
  and decided in ('', 'student', 'owner')
);
create index if not exists tiffin_marks_disputed on public.tiffin_marks (day desc) where confirm = 'no';

create table if not exists public.app_presence (
  scope    text not null,
  who      text not null,
  seen_at  timestamptz not null default now(),
  primary key (scope, who),
  constraint app_presence_sizes check (char_length(scope) <= 80 and char_length(who) <= 320)
);
create index if not exists app_presence_seen on public.app_presence (seen_at);
alter table public.app_presence enable row level security; -- server only
revoke all on public.app_presence from anon, authenticated;
comment on table public.app_presence is 'Who has an order screen open right now (scope + email), to skip notifications they would see live.';
