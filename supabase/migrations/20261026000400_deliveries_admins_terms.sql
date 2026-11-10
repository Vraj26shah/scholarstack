-- ════════════════════════════════════════════════════════════════════════════
-- 1. announcement_deliveries: who got each announcement, and when. With the daily email
--    limit an announcement goes out over several days; this is how the admin sees exactly
--    who has it and who is still waiting.
-- 2. admin_emails.source: GitHub (synced from the ADMIN_EMAILS variable) or added in the
--    database by hand. The Worker now reads admins from this table, so a change made in
--    GitHub reaches production as soon as the sync runs, without a redeploy.
-- 3. Terms students can see: a course's term has a name ("Sem 5 · Winter 2026"), and each
--    access remembers whether its "ending soon" reminder went out.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.announcement_deliveries (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);
create index if not exists announcement_deliveries_sent_idx on public.announcement_deliveries (sent_at);
alter table public.announcement_deliveries enable row level security;
revoke all on public.announcement_deliveries from anon, authenticated;

alter table public.admin_emails add column if not exists source text not null default 'github'
  check (source in ('github', 'manual'));

alter table public.courses add column if not exists term_label text not null default ''
  check (length(term_label) <= 60);
comment on column public.courses.term_label is 'Name of the term access_until ends, shown to students (e.g. "Sem 5 · Winter 2026").';

alter table public.entitlements add column if not exists ending_notified_at timestamptz;

-- Opted-in students who haven't had this announcement yet, in a stable order. Students who opt
-- in while an email is going out are included, wherever their id falls.
create or replace function public.announcement_pending(p_announcement uuid, p_limit int)
returns table (id uuid, email text, full_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.full_name from public.profiles p
   where p.email_opt_in
     and not exists (select 1 from public.announcement_deliveries d
                      where d.announcement_id = p_announcement and d.user_id = p.id)
   order by p.id
   limit greatest(1, least(p_limit, 1000));
$$;

create or replace function public.announcement_progress(p_announcement uuid)
returns table (sent int, waiting int)
language sql stable security definer set search_path = public as $$
  select
    (select count(*)::int from public.announcement_deliveries d where d.announcement_id = p_announcement),
    (select count(*)::int from public.profiles p
      where p.email_opt_in
        and not exists (select 1 from public.announcement_deliveries d
                         where d.announcement_id = p_announcement and d.user_id = p.id));
$$;

-- Everyone who got it, then everyone still waiting (for the admin's list).
create or replace function public.announcement_recipients(p_announcement uuid, p_limit int)
returns table (id uuid, email text, full_name text, sent_at timestamptz)
language sql stable security definer set search_path = public as $$
  (select p.id, p.email, p.full_name, d.sent_at
     from public.announcement_deliveries d join public.profiles p on p.id = d.user_id
    where d.announcement_id = p_announcement)
  union all
  (select p.id, p.email, p.full_name, null::timestamptz
     from public.profiles p
    where p.email_opt_in
      and not exists (select 1 from public.announcement_deliveries d
                       where d.announcement_id = p_announcement and d.user_id = p.id))
  order by sent_at nulls last, email
  limit greatest(1, least(p_limit, 5000));
$$;

-- Accesses whose term ends within the window and whose reminder hasn't gone out yet.
create or replace function public.access_ending_soon(p_before timestamptz, p_limit int)
returns table (user_id uuid, email text, full_name text, course_id uuid, course_title text, course_slug text,
               expires_at timestamptz, term_label text)
language sql stable security definer set search_path = public as $$
  select e.user_id, p.email, p.full_name, c.id, c.title, c.slug, e.expires_at, c.term_label
    from public.entitlements e
    join public.profiles p on p.id = e.user_id
    join public.courses c on c.id = e.course_id
   where e.revoked_at is null and e.ending_notified_at is null
     and e.expires_at > now() and e.expires_at <= p_before
   order by e.expires_at
   limit greatest(1, least(p_limit, 1000));
$$;

revoke execute on function public.announcement_pending(uuid, int) from public, anon, authenticated;
revoke execute on function public.announcement_progress(uuid) from public, anon, authenticated;
revoke execute on function public.announcement_recipients(uuid, int) from public, anon, authenticated;
revoke execute on function public.access_ending_soon(timestamptz, int) from public, anon, authenticated;
