-- ════════════════════════════════════════════════════════════════════════════
-- 0100 · Foundation
-- Shared building blocks used by every later migration: extensions, the
-- updated_at trigger, the "is this a college user" check and the audit trail.
--
-- Conventions (see DATABASE.md):
--   • snake_case, plural table names; primary keys are `id uuid` unless a natural
--     key exists (batch year, programme slug, subject code, feature key).
--   • Every mutable table has created_at / updated_at; updated_at is set by trigger.
--   • Status-like columns are text + CHECK (easy to extend in a later migration).
--   • RLS is ON for every table. The API uses the server (secret) key and filters
--     by user itself; policies only exist for what a signed-in browser may read.
--   • Functions are SECURITY DEFINER with a pinned search_path, and EXECUTE is
--     revoked from anon/authenticated unless the browser genuinely needs it.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── updated_at ──────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
comment on function public.set_updated_at() is 'BEFORE UPDATE trigger: stamps updated_at.';

-- ── Who may read the catalogue straight from the browser ───────────────────
create or replace function public.is_vit_user()
returns boolean language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', '') ilike '%@vitbhopal.ac.in'
$$;
comment on function public.is_vit_user() is 'True when the caller''s JWT carries a @vitbhopal.ac.in email.';

-- ── Audit trail ─────────────────────────────────────────────────────────────
-- Admin-managed tables (prices, publishing, programmes, bundles, tools) record
-- every insert/update/delete here, so "who changed the price and when" always
-- has an answer. High-churn tables (pages, logs) are deliberately not audited.
create table public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  table_name  text not null,
  row_key     text not null,
  action      text not null check (action in ('insert', 'update', 'delete')),
  -- Only the columns that changed (update) or the whole row (insert/delete).
  changes     jsonb not null default '{}'::jsonb,
  actor       text not null default current_user
);
create index audit_log_row_idx on public.audit_log (table_name, row_key, at desc);
create index audit_log_at_idx on public.audit_log (at desc);
alter table public.audit_log enable row level security; -- server only
comment on table public.audit_log is 'Append-only change history for admin-managed tables.';

-- TG_ARGV[0] names the key column (id, slug, code, key…).
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  key_col  text := coalesce(tg_argv[0], 'id');
  old_row  jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  new_row  jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  diff     jsonb := '{}'::jsonb;
  k        text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(new_row) loop
      if k <> 'updated_at' and (old_row -> k) is distinct from (new_row -> k) then
        diff := diff || jsonb_build_object(k, jsonb_build_object('from', old_row -> k, 'to', new_row -> k));
      end if;
    end loop;
    if diff = '{}'::jsonb then
      return new; -- nothing but updated_at changed
    end if;
  end if;
  insert into public.audit_log (table_name, row_key, action, changes)
  values (
    tg_table_name,
    coalesce(new_row ->> key_col, old_row ->> key_col, '?'),
    lower(tg_op),
    case tg_op when 'UPDATE' then diff when 'INSERT' then new_row else old_row end
  );
  return coalesce(new, old);
end $$;
revoke execute on function public.audit_row() from public, anon, authenticated;
comment on function public.audit_row() is 'AFTER trigger that writes the change set to audit_log.';
