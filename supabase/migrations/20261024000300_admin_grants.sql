-- ════════════════════════════════════════════════════════════════════════════
-- An admin can give a course to a student directly (no payment). Such access has no order,
-- and records who gave it, so the history always says where every access came from.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.entitlements alter column order_id drop not null;
alter table public.entitlements add column if not exists granted_by text not null default 'purchase'
  check (granted_by in ('purchase', 'admin'));
alter table public.entitlements add column if not exists granted_by_admin text;
alter table public.entitlements drop constraint if exists entitlements_source_chk;
alter table public.entitlements add constraint entitlements_source_chk check (
  (granted_by = 'purchase' and order_id is not null)
  or (granted_by = 'admin' and granted_by_admin is not null)
);
comment on column public.entitlements.granted_by is 'purchase: paid order. admin: given by an admin (granted_by_admin).';

-- A purchase (re)activates access and records that it was bought.
create or replace function public.grant_order(p_gateway_order_id text, p_gateway_payment_id text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  select * into o from public.orders where gateway_order_id = p_gateway_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if o.status <> 'paid' then
    update public.orders set status = 'paid', gateway_payment_id = p_gateway_payment_id where id = o.id;
  end if;
  insert into public.entitlements (user_id, course_id, order_id, expires_at, granted_by)
  select o.user_id, i.course_id, o.id,
         case when c.access_until > now() then c.access_until end, 'purchase'
    from public.order_items i join public.courses c on c.id = i.course_id
   where i.order_id = o.id
  on conflict (user_id, course_id) do update
    set revoked_at = null, revoke_reason = null, order_id = excluded.order_id,
        granted_at = now(), expires_at = excluded.expires_at,
        granted_by = 'purchase', granted_by_admin = null
    where public.entitlements.revoked_at is not null
       or (public.entitlements.expires_at is not null and public.entitlements.expires_at <= now());
  return o.id;
end $$;

revoke execute on function public.grant_order(text, text) from public, anon, authenticated;
