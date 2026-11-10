-- One course (one set of notes in R2) can be offered to several batches and programmes.
-- By default a course follows the term's course list by its code (e.g. CSE3003 → 2024 BCE and
-- 2025 BCY) plus the batch and programmes it was filed under. When an admin picks the drawers
-- by hand, the choice is kept here as [{"batchYear": 2025, "branchSlug": "bce"}, ...].
alter table public.courses add column if not exists offered_to jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'courses_offered_to_is_array'
  ) then
    alter table public.courses
      add constraint courses_offered_to_is_array
      check (offered_to is null or jsonb_typeof(offered_to) = 'array');
  end if;
end $$;

comment on column public.courses.offered_to is
  'Admin-chosen drawers [{batchYear, branchSlug}]; null = follow the course list and filing.';
