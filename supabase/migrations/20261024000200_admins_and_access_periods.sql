-- ════════════════════════════════════════════════════════════════════════════
-- Admin allowlist (replaces the hard-coded address) and course access periods.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Who may sign up without a college address ───────────────────────────────
-- Exact, lower-case addresses only. No policies: only the service role and the
-- sign-up hook (security definer) can read it; students can't see or change it.
create table if not exists public.admin_emails (
  email      text primary key
             check (email = lower(btrim(email))
                    and octet_length(email) = char_length(email)        -- ASCII only
                    and email ~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$'),
  added_at   timestamptz not null default now()
);
alter table public.admin_emails enable row level security;
revoke all on public.admin_emails from anon, authenticated, public;
comment on table public.admin_emails is
  'Exact addresses allowed to sign up outside the college domain (admins). Keep in step with ADMIN_EMAILS.';

insert into public.admin_emails (email) values ('vitbsmashers@gmail.com') on conflict do nothing;

-- Sign-up gate. A college address must be exactly name@vitbhopal.ac.in: ASCII letters, digits,
-- dots, hyphens, underscores; no "+tags", no leading, trailing or doubled dots (so one inbox
-- can't become several accounts). Anything else must be on the admin list, exactly.
create or replace function public.hook_vit_only(event jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(event -> 'user' ->> 'email', '')));
  college boolean :=
    octet_length(v_email) = char_length(v_email)
    and v_email ~ '^[a-z0-9][a-z0-9._-]*@vitbhopal\.ac\.in$'
    and v_email !~ '\.\.'
    and v_email !~ '\.@';
begin
  if college or exists (select 1 from public.admin_emails a where a.email = v_email) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Please sign in with your @vitbhopal.ac.in email.'));
end $$;

grant execute on function public.hook_vit_only(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_vit_only(jsonb) from authenticated, anon, public;

-- ── Access periods ──────────────────────────────────────────────────────────
-- A course may have a term end. New purchases get access until then; null means no end.
alter table public.courses add column if not exists access_until timestamptz;
comment on column public.courses.access_until is
  'Term end for this course. Purchases made while it is set get access until this moment.';

-- Each purchase can end (expires_at) or be blocked by an admin (revoked_at + reason).
alter table public.entitlements add column if not exists expires_at timestamptz;
alter table public.entitlements add column if not exists revoke_reason text
  check (revoke_reason is null or revoke_reason in ('admin', 'dispute'));
create index if not exists entitlements_user_active_idx
  on public.entitlements (user_id) where revoked_at is null;

-- Disputes keep their reason so an admin "restore" never undoes a lost chargeback by accident.
update public.entitlements set revoke_reason = 'dispute'
 where revoked_at is not null and revoke_reason is null;

-- Paying grants (or renews) access: an ended or blocked purchase becomes active again with the
-- course's current term end. An active one is left alone, so the callback and webhook can both
-- arrive safely.
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
  insert into public.entitlements (user_id, course_id, order_id, expires_at)
  select o.user_id, i.course_id, o.id,
         case when c.access_until > now() then c.access_until end
    from public.order_items i join public.courses c on c.id = i.course_id
   where i.order_id = o.id
  on conflict (user_id, course_id) do update
    set revoked_at = null, revoke_reason = null, order_id = excluded.order_id,
        granted_at = now(), expires_at = excluded.expires_at
    where public.entitlements.revoked_at is not null
       or (public.entitlements.expires_at is not null and public.entitlements.expires_at <= now());
  return o.id;
end $$;

create or replace function public.revoke_by_payment(p_gateway_payment_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.orders set status = 'disputed' where gateway_payment_id = p_gateway_payment_id;
  update public.entitlements e set revoked_at = now(), revoke_reason = 'dispute'
    from public.orders o
   where o.gateway_payment_id = p_gateway_payment_id and e.order_id = o.id and e.revoked_at is null;
end $$;

revoke execute on function public.grant_order(text, text) from public, anon, authenticated;
revoke execute on function public.revoke_by_payment(text) from public, anon, authenticated;
