-- ════════════════════════════════════════════════════════════════════════════
-- 0001 · Allow admin emails (e.g. vitbsmashers@gmail.com) in before-user-created hook
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.hook_vit_only(event jsonb)
returns jsonb language plpgsql as $$
declare
  email text := lower(coalesce(event -> 'user' ->> 'email', ''));
begin
  -- Admin emails bypass the college domain restriction
  if email in ('vitbsmashers@gmail.com') then
    return '{}'::jsonb;
  end if;

  if email !~ '^[a-z0-9._%+-]+@vitbhopal\.ac\.in$' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Please sign in with your @vitbhopal.ac.in email.'));
  end if;
  return '{}'::jsonb;
end $$;

grant execute on function public.hook_vit_only(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_vit_only(jsonb) from authenticated, anon, public;
