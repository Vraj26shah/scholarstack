-- ════════════════════════════════════════════════════════════════════════════
-- 20261104 · BBA, from the official Winter 2026-27 FFCS course list. Codes and names
-- can be corrected in the admin (Courses → Years & branches) without a migration.
-- Adds only what is missing; never changes or removes a programme the admin already has.
-- ════════════════════════════════════════════════════════════════════════════

insert into public.programmes (slug, code, name, short_name, tagline, description, sort)
select v.slug, v.code, v.name, v.short_name, v.tagline, v.description, v.sort
from (values
  ('bba', 'BBA', 'Bachelor of Business Administration', 'BBA', 'Management, marketing and business strategy',
   'Semester notes for Bachelor of Business Administration students at VIT Bhopal.', 14)
) as v(slug, code, name, short_name, tagline, description, sort)
where not exists (select 1 from public.programmes p where p.slug = v.slug or p.code = v.code);
