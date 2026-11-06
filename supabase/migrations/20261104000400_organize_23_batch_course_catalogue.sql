-- The imported course folders are all under drive-imports/23 Batch. Keep the
-- catalogue year aligned with that source folder and reconcile known subject
-- placements to programme_subjects, which was transcribed from the supplied
-- Winter 2026-27 course list. This intentionally leaves publication status,
-- file visibility, hidden units and course content unchanged.

insert into public.batches (year)
values (2023)
on conflict (year) do nothing;

update public.courses
set batch_year = 2023
where r2_prefix like 'drive-imports/23 Batch/%'
  and batch_year <> 2023;

-- Use the same RPC the admin uses so the primary programme stays among the
-- placements. Unmapped legacy subjects retain their current manual placement.
do $$
declare
  course record;
begin
  for course in
    select c.id,
           array_agg(ps.programme_slug order by p.sort, p.slug) as programme_slugs
      from public.courses c
      join public.programme_subjects ps on ps.subject_code = c.subject_code
      join public.programmes p on p.slug = ps.programme_slug and p.is_active
     where c.r2_prefix like 'drive-imports/23 Batch/%'
     group by c.id
  loop
    perform public.set_course_programmes(course.id, course.programme_slugs);
  end loop;
end $$;
