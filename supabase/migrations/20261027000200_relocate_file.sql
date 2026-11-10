-- ════════════════════════════════════════════════════════════════════════════
-- Move or rename one notes file without re-making its pages: point the file row at its new
-- storage key, unit (created if new) and, if needed, another course, all in one step. Page rows
-- and reading progress are keyed by the file id, so they follow it. A unit left empty is removed.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.relocate_course_file(
  p_file_id uuid,
  p_course_id uuid,
  p_unit_key text,
  p_unit_title text,
  p_unit_kind text,
  p_unit_sort int,
  p_unit_hidden boolean,
  p_source_key text,
  p_source_etag text,
  p_name text
) returns void language plpgsql security definer set search_path = public as $$
declare
  old_unit uuid;
  new_unit uuid;
begin
  select unit_id into old_unit from public.course_files where id = p_file_id for update;
  if not found then
    raise exception 'file not found' using errcode = 'P0002';
  end if;
  insert into public.course_units (course_id, key, title, kind, sort, is_hidden)
  values (p_course_id, p_unit_key, p_unit_title, p_unit_kind, p_unit_sort, p_unit_hidden)
  on conflict (course_id, key) do nothing;
  select id into new_unit from public.course_units where course_id = p_course_id and key = p_unit_key;
  update public.course_files
     set course_id = p_course_id, unit_id = new_unit, source_key = p_source_key,
         source_etag = p_source_etag, name = p_name, source_missing_at = null
   where id = p_file_id;
  if old_unit is distinct from new_unit
     and not exists (select 1 from public.course_files where unit_id = old_unit) then
    delete from public.course_units where id = old_unit;
  end if;
end $$;
revoke execute on function public.relocate_course_file(uuid, uuid, text, text, text, int, boolean, text, text, text)
  from public, anon, authenticated;
