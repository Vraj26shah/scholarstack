-- ════════════════════════════════════════════════════════════════════════════
-- Moving or renaming a course's folder in R2 from the admin panel. The files are copied first,
-- then this updates the course folder and every file's R2 path in one go, so the site never
-- points at a half-moved course. Generated pages are keyed by file id, so nothing is re-made.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.move_course_source(p_course_id uuid, p_prefix text, p_files jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_prefix !~ '/$' then
    raise exception 'folder must end with /' using errcode = '22023';
  end if;
  update public.courses set r2_prefix = p_prefix where id = p_course_id;
  if not found then
    raise exception 'course not found' using errcode = 'P0002';
  end if;
  update public.course_files f
     set source_key = x.source_key, source_etag = x.source_etag
    from jsonb_to_recordset(p_files) as x(file_id uuid, source_key text, source_etag text)
   where f.id = x.file_id and f.course_id = p_course_id;
end $$;
revoke execute on function public.move_course_source(uuid, text, jsonb) from public, anon, authenticated;
