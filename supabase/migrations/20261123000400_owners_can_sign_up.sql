-- ════════════════════════════════════════════════════════════════════════════
-- Restaurant owners can create their account
--
-- Supabase's "before user created" hook only let college addresses and admins sign up, so a
-- restaurant owner's own address (set in Admin › Campus, messes.owner_emails) was refused before
-- the site ever saw it. Owners are now let in too, exactly like admins: only the listed addresses.
--
-- Safe to run more than once. Rollback: re-run the hook from 20261024000200 (without the messes
-- line).
-- ════════════════════════════════════════════════════════════════════════════

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
  if college
     or exists (select 1 from public.admin_emails a where a.email = v_email)
     or exists (select 1 from public.messes m where v_email = any (m.owner_emails)) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Please sign in with your @vitbhopal.ac.in email.'));
end $$;
grant execute on function public.hook_vit_only(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_vit_only(jsonb) from authenticated, anon, public;
