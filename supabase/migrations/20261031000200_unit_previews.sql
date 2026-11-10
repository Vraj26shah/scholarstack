-- ════════════════════════════════════════════════════════════════════════════
-- Free preview chosen by the admin, per unit: which file, and which of its pages (1 to 5).
-- No choice (or a file that is no longer readable) falls back to page 1 of the unit's first
-- readable file, so a preview never breaks when files change.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.course_units add column if not exists preview_file_id uuid
  references public.course_files(id) on delete set null;
alter table public.course_units add column if not exists preview_pages smallint[] not null default '{1}';

alter table public.course_units drop constraint if exists course_units_preview_pages_chk;
alter table public.course_units add constraint course_units_preview_pages_chk check (
  cardinality(preview_pages) between 1 and 5 and 0 < all(preview_pages)
);
