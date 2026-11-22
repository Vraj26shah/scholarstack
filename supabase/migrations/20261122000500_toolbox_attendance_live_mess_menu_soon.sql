-- ════════════════════════════════════════════════════════════════════════════
-- Toolbox: the attendance calculator goes live; the mess menu is announced as coming soon
--
-- * attendance: built and tested, now open to every student (was "soon"). No email is sent from
--   here: an announcement can still be drafted and sent from Admin › Emails.
-- * mess-menu: shown in the toolbox as "Coming soon" with "Notify me" (not built yet). Added
--   only if there is no row with that key, so an admin's own wording is kept.
--
-- Safe to run more than once. Rollback:
--   update public.features set status = 'soon', launched_at = null where key = 'attendance';
--   delete from public.features where key = 'mess-menu' and status = 'soon';
-- ════════════════════════════════════════════════════════════════════════════

update public.features
   set status = 'live', launched_at = coalesce(launched_at, now())
 where key = 'attendance' and status = 'soon';

insert into public.features (key, title, blurb, status, sort)
select 'mess-menu',
       'Mess menu',
       'Today''s breakfast, lunch, snacks and dinner for your mess, and the rest of the week, for hostellers and day scholars.',
       'soon',
       coalesce((select max(sort) from public.features), 0) + 1
on conflict (key) do nothing;
