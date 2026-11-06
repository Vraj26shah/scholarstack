-- The owner requested that these six 23 Batch courses appear under every
-- active programme section. Keep this curriculum in sync with branch-catalog.ts.
insert into public.programme_subjects (programme_slug, subject_code)
select p.slug, s.code
from public.programmes p
cross join (values
  ('ENG2005'),
  ('MAT1001'),
  ('MAT2001'),
  ('HUM1002'),
  ('CHY1005'),
  ('CSE1021')
) as s(code)
where p.is_active
on conflict (programme_slug, subject_code) do nothing;
