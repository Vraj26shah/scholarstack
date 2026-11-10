-- Require useful support requests and replies while preserving existing short threads.
-- The API validates these limits immediately; the cutoff also protects direct DB writes.
alter table public.support_queries
  add constraint support_queries_subject_minimum_check
  check (created_at < timestamptz '2026-11-09 00:00:00+00' or length(btrim(subject)) >= 8)
  not valid;

alter table public.support_messages
  add constraint support_messages_body_minimum_check
  check (created_at < timestamptz '2026-11-09 00:00:00+00' or length(btrim(body)) >= 15)
  not valid;
