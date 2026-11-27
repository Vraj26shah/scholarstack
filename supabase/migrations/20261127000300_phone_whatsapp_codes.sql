-- ════════════════════════════════════════════════════════════════════════════
-- Free phone checks through WhatsApp
--
-- A student gets a one-time code ("wa:123456" in user_phones.pending_ref) and sends
-- "VERIFY 123456" to the site's WhatsApp number; the webhook finds the account by its code.
-- This index makes that lookup instant.
--
-- Safe to run more than once. Rollback:
--   drop index if exists public.user_phones_pending_ref;
-- ════════════════════════════════════════════════════════════════════════════

create index if not exists user_phones_pending_ref on public.user_phones (pending_ref) where pending_ref like 'wa:%';
