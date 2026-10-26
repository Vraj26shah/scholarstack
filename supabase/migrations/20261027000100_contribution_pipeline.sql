-- ════════════════════════════════════════════════════════════════════════════
-- Contribution pipeline: where the admin filed a student's upload (course, folder, the storage
-- keys written), and when the whole job was marked done. The automatic file checks live inside
-- the existing `files` json (one `check` per file), so they need no column.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.contributions add column if not exists filed_course_id uuid
  references public.courses(id) on delete set null;
alter table public.contributions add column if not exists filed_folder text not null default ''
  check (length(filed_folder) <= 600);
alter table public.contributions add column if not exists filed_keys text[] not null default '{}';
alter table public.contributions add column if not exists filed_at timestamptz;
alter table public.contributions add column if not exists completed_at timestamptz;

create index if not exists contributions_filed_course_idx on public.contributions (filed_course_id)
  where filed_course_id is not null;
