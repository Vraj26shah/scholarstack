-- ════════════════════════════════════════════════════════════════════════════
-- Partner app sign-in: restaurant owners use their mobile number and a 4-digit PIN
--
-- No SMS. The admin adds the number (checked in person) and reads the owner a one-time 6-digit
-- setup code; the owner types number + code and picks a PIN. pin_hash and setup_hash are HMACs
-- with a server-only pepper (OWNER_PIN_PEPPER), never the PIN or code itself. After 5 wrong tries
-- in a row the number is locked until locked_until. Server only (the API's service key).
--
-- Safe to run more than once. Rollback:
--   drop table if exists public.owner_logins;
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.owner_logins (
  phone             text primary key,
  name              text not null default '',
  email             text not null,
  pin_hash          text not null default '',
  setup_hash        text not null default '',
  setup_expires_at  timestamptz,
  failed            int not null default 0,
  locked_until      timestamptz,
  last_login_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint owner_logins_phone check (phone ~ '^[6-9][0-9]{9}$'),
  constraint owner_logins_email check (email = lower(email) and position('@' in email) > 1)
);
create index if not exists owner_logins_email on public.owner_logins (email);
alter table public.owner_logins enable row level security; -- server only
revoke all on public.owner_logins from anon, authenticated;
comment on table public.owner_logins is 'Restaurant owners'' Partner app sign-in: mobile number + PIN (hashed).';
