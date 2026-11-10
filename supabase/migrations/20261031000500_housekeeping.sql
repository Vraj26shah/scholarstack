-- ════════════════════════════════════════════════════════════════════════════
-- Daily housekeeping, so the tables that only grow don't cost more over time. Kept:
--   audit_log (change history)          180 days
--   access_logs (pages read per day)     60 days   (only today's count matters for limits)
--   email_quota (emails sent per day)    60 days
--   problem_reports (last seen)          90 days
--   unpaid checkouts (never paid)        14 days   (the existing clean_abandoned_orders rules)
-- Paid orders, access, reading progress and royalties are never touched.
-- ════════════════════════════════════════════════════════════════════════════

create index if not exists access_logs_day_idx on public.access_logs (day);

create or replace function public.prune_history()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a int; l int; q int; p int; o int;
begin
  delete from public.audit_log where at < now() - interval '180 days';
  get diagnostics a = row_count;
  delete from public.access_logs where day < current_date - 60;
  get diagnostics l = row_count;
  delete from public.email_quota where day < current_date - 60;
  get diagnostics q = row_count;
  delete from public.problem_reports where last_at < now() - interval '90 days';
  get diagnostics p = row_count;
  o := public.clean_abandoned_orders(14);
  return jsonb_build_object('audit', a, 'accessLogs', l, 'emailQuota', q, 'problems', p, 'unpaidOrders', o);
end $$;
revoke execute on function public.prune_history() from public, anon, authenticated;
