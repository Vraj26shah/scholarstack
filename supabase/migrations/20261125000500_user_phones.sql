-- ════════════════════════════════════════════════════════════════════════════
-- Checked mobile numbers
--
-- Restaurants call the number on an order, so a student proves it's theirs once with a code sent
-- by SMS. The checked number is kept here and every order uses it; the order form can't change
-- it. The SMS service makes and checks the code: only its handle (pending_ref) is stored here.
-- Server only (the API's service key).
--
-- Safe to run more than once. Rollback:
--   drop table if exists public.user_phones;
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.user_phones (
  user_id        uuid primary key,
  phone          text not null default '',
  verified_at    timestamptz,
  pending_phone  text not null default '',
  pending_ref    text not null default '',
  pending_at     timestamptz,
  attempts       int not null default 0,
  sends_day      date,
  sends          int not null default 0,
  updated_at     timestamptz not null default now(),
  constraint user_phones_phone check (phone = '' or phone ~ '^[6-9][0-9]{9}$'),
  constraint user_phones_pending check (pending_phone = '' or pending_phone ~ '^[6-9][0-9]{9}$')
);
create index if not exists user_phones_pending on public.user_phones (pending_phone, sends_day)
  where pending_phone <> '';
create index if not exists user_phones_phone on public.user_phones (phone) where phone <> '';
alter table public.user_phones enable row level security; -- server only
revoke all on public.user_phones from anon, authenticated;
comment on table public.user_phones is 'Mobile numbers students proved with an SMS code; orders use them.';
