-- Persist the converter's current phase so the admin audit can distinguish queued,
-- running, R2 verification and Supabase registration for every file.
alter table public.course_files
  add column if not exists conversion_stage text
    check (conversion_stage in (
      'queued', 'downloading_source', 'validating_source', 'rendering_pages',
      'clearing_previous_pages', 'writing_preview', 'writing_pages', 'verifying_r2', 'saving_manifest',
      'complete', 'failed'
    )),
  add column if not exists conversion_error_stage text
    check (conversion_error_stage in (
      'downloading_source', 'validating_source', 'rendering_pages',
      'clearing_previous_pages', 'writing_preview', 'writing_pages', 'verifying_r2', 'saving_manifest', 'dispatch'
    )),
  add column if not exists conversion_progress_current int not null default 0 check (conversion_progress_current >= 0),
  add column if not exists conversion_progress_total int not null default 0 check (conversion_progress_total >= 0),
  add column if not exists conversion_queue_id uuid,
  add column if not exists conversion_queue_position int not null default 0 check (conversion_queue_position >= 0),
  add column if not exists conversion_queue_total int not null default 0 check (conversion_queue_total >= 0),
  add column if not exists conversion_updated_at timestamptz;

create index if not exists course_files_conversion_queue_idx
  on public.course_files (conversion_queue_id, conversion_queue_position)
  where conversion_queue_id is not null;

comment on column public.course_files.conversion_stage is
  'Most recent sequential R2 conversion stage reported to the admin audit.';
comment on column public.course_files.conversion_error_stage is
  'Exact conversion phase that failed, or dispatch when GitHub could not start the run.';
