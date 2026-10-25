-- ════════════════════════════════════════════════════════════════════════════
-- Storage map for the admin: how big each table is, and a safe clean-up for checkouts that were
-- started but never paid (no money moved; Razorpay keeps its own record either way).
-- Both run only for the server (service role).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.storage_tables()
returns table (table_name text, row_count bigint, total_bytes bigint)
language sql security definer set search_path = public, pg_catalog as $$
  select c.relname::text,
         greatest(c.reltuples, 0)::bigint,
         pg_total_relation_size(c.oid)::bigint
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
   order by 3 desc;
$$;
revoke execute on function public.storage_tables() from public, anon, authenticated;

create or replace function public.clean_abandoned_orders(p_days integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  with gone as (
    delete from public.orders o
     where o.status in ('created', 'failed')
       and o.gateway_payment_id is null
       and o.created_at < now() - make_interval(days => greatest(p_days, 7))
       and not exists (select 1 from public.entitlements e where e.order_id = o.id)
    returning o.id
  )
  select count(*) into n from gone;
  return n;
end $$;
revoke execute on function public.clean_abandoned_orders(integer) from public, anon, authenticated;
