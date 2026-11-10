-- The admin can now pause a file's page-making job. Held files are skipped by the queue and
-- any result the converter sends back for them while held is ignored.
alter table public.course_files
  add column if not exists conversion_held boolean not null default false;
