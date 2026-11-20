-- Diwali 2026: a real offer and a promo code, written straight to the database (not through the
-- admin page). Safe to run more than once. Both show up in Admin › Courses › Offers / Promo codes
-- and can be edited or ended there.
--
-- Why: the packs had been renamed "Diwali pack · …" through the pack-name setting, which only
-- changes the name: no discount, no struck-through price, no banner, nothing under Offers. A real
-- offer does all of that, and shows drawer packs as "Diwali pack · …" only while it runs, then
-- puts them back to "Semester pack · …" by itself.

begin;

-- 1. The packs' own name goes back to "Semester pack"; the offer lends them "Diwali pack" while it runs.
update public.site_settings
   set value = jsonb_set(value, '{titlePrefix}', '"Semester pack"'), updated_at = now()
 where key = 'drawer_packs' and value->>'titlePrefix' = 'Diwali pack';

update public.bundles
   set title = 'Semester pack' || substr(title, length('Diwali pack') + 1), updated_at = now()
 where auto_drawer is not null and title like 'Diwali pack · %';

-- 2. Diwali offer: 20% off every course and bundle, till 30 Nov 2026, 11:59 pm IST.
insert into public.offers (title, percent_off, starts_at, ends_at, status, everything)
select 'Diwali offer', 20, now(), '2026-11-30 23:59:00+05:30', 'live', true
 where not exists (select 1 from public.offers where title = 'Diwali offer' and ends_at > now());

-- 3. DIWALI10: a further 10% off the offer price, once per student, ends with the offer.
insert into public.promo_codes (code, kind, percent_off, applies_to, starts_at, ends_at, status, once_per_student)
values ('DIWALI10', 'percent', 10, 'everything', now(), '2026-11-30 23:59:00+05:30', 'live', true)
on conflict (code) do nothing;

commit;
