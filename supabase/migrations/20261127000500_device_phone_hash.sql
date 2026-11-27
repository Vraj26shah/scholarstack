-- ════════════════════════════════════════════════════════════════════════════
-- The student app knows its phone
--
-- devices.phone_hash: a SHA-256 of the phone's own Android ID, sent by the student app (never by a
-- browser or the Partner app). It survives clearing the app's data, so the same phone is the same
-- device again, and one phone can't be signed in to two students' accounts at once.
--
-- Safe to run more than once. Rollback:
--   drop index if exists public.devices_phone_hash;
--   alter table public.devices drop column if exists phone_hash;
-- ════════════════════════════════════════════════════════════════════════════

alter table public.devices add column if not exists phone_hash text;
alter table public.devices drop constraint if exists devices_phone_hash;
alter table public.devices add constraint devices_phone_hash check (phone_hash is null or phone_hash ~ '^[0-9a-f]{64}$');
create index if not exists devices_phone_hash on public.devices (phone_hash) where phone_hash is not null;
