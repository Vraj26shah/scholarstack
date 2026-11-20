-- ════════════════════════════════════════════════════════════════════════════
-- "Peek inside" from more than one file per unit: the admin can pick up to four files of a unit,
-- each with up to five of its pages (ten pages in all), instead of one file. Stored as a list of
-- {"fileId": uuid, "pages": [int]} in the order students see them.
--
-- The single-file columns stay and keep mirroring the first pick, so code that reads them (and a
-- Worker still running the previous release during a deploy) carries on working. An existing
-- choice is copied over. An empty list means "no choice": page 1 of the unit's first ready file.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.course_units add column if not exists preview_files jsonb not null default '[]'::jsonb;

alter table public.course_units drop constraint if exists course_units_preview_files_chk;
alter table public.course_units add constraint course_units_preview_files_chk check (
  jsonb_typeof(preview_files) = 'array' and jsonb_array_length(preview_files) <= 4
);

update public.course_units
   set preview_files = jsonb_build_array(
         jsonb_build_object('fileId', preview_file_id, 'pages', to_jsonb(preview_pages)))
 where preview_file_id is not null and preview_files = '[]'::jsonb;

comment on column public.course_units.preview_files is
  'Free preview picks, in order: [{"fileId": uuid, "pages": [1..5 page numbers]}], at most 4 files. Empty = default.';
