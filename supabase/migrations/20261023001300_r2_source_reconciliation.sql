-- Keep removed source files visible to admins for audit/history while making them
-- unavailable to students. Student reading progress and access logs remain attached.
alter table public.course_files
  add column if not exists source_missing_at timestamptz;

create index if not exists course_files_source_missing_idx
  on public.course_files (course_id, source_missing_at)
  where source_missing_at is not null;

comment on column public.course_files.source_missing_at is
  'Set after a complete scoped R2 scan no longer finds source_key; the file stays hidden for audit and history.';
