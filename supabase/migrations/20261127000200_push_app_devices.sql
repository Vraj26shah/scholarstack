-- ════════════════════════════════════════════════════════════════════════════
-- Notifications to the Android apps
--
-- The Scholars Stack and Partner apps get notifications through Firebase Cloud Messaging. A
-- phone's FCM token is stored in push_subscriptions like a browser's push address, written
-- "fcm:<token>", so reminders, order alerts, receipts and counts work the same for both. App
-- devices have no Web Push keys: p256dh and auth are empty for them.
--
-- Safe to run more than once. Rollback (only once no app devices are stored):
--   alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint;
--   alter table public.push_subscriptions add constraint push_subscriptions_endpoint
--     check (endpoint ~ '^https://' and length(endpoint) <= 1000);
-- ════════════════════════════════════════════════════════════════════════════

alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint;
alter table public.push_subscriptions add constraint push_subscriptions_endpoint check (
  (endpoint ~ '^https://' and length(endpoint) <= 1000)
  or endpoint ~ '^fcm:[A-Za-z0-9_:-]{20,400}$'
);
