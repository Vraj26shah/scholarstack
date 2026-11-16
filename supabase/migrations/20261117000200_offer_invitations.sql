-- Offer invitations: an announcement can be about an offer (a Diwali sale) and can go only to
-- some batches (the batches an offer on chosen drawers or courses reaches).
--
-- Offer emails are news, so they only go to students who keep news emails on (and every email
-- carries its one-click unsubscribe). A student's batch comes from the college email, the same
-- way the per-batch delivery report reads it ("24bce10001@…" → 2024).
alter table public.announcements add column if not exists offer_id uuid
  references public.offers(id) on delete set null;
alter table public.announcements add column if not exists batch_years int[];

comment on column public.announcements.offer_id is 'The offer this email announces, if any.';
comment on column public.announcements.batch_years is
  'Only students of these batches (from their college email); null = every opted-in student.';

create index if not exists announcements_offer_idx on public.announcements (offer_id);

create or replace function public.announcement_audience(p_announcement uuid)
returns table (id uuid, email text, full_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.full_name
    from public.profiles p, public.announcements a
   where a.id = p_announcement
     and case when a.course_id is null then
                p.email_opt_in
                and (a.batch_years is null
                     or ('20' || substring(lower(p.email) from '(\d{2})[a-z]{3}\d+@'))::int = any(a.batch_years))
              else exists (select 1 from public.entitlements e
                            where e.user_id = p.id and e.course_id = a.course_id and e.revoked_at is null
                              and (e.expires_at is null or e.expires_at > now())) end;
$$;
revoke execute on function public.announcement_audience(uuid) from public, anon, authenticated;
