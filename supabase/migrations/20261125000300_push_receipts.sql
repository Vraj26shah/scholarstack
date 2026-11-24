-- ════════════════════════════════════════════════════════════════════════════
-- Notification receipts
--
-- push_subscriptions.seen_at: the last time this device actually showed one of our notifications
-- (its service worker reports back after showing it). "Sent" only means the push service accepted
-- it; "seen" means it reached the screen, so a test can say which devices really work.
--
-- Safe to run more than once. Rollback:
--   alter table public.push_subscriptions drop column if exists seen_at;
-- ════════════════════════════════════════════════════════════════════════════

alter table public.push_subscriptions add column if not exists seen_at timestamptz;
