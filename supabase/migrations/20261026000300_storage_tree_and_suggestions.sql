-- ════════════════════════════════════════════════════════════════════════════
-- 1. delete_course_files: remove notes files from the database for good (when their R2
--    files are deleted from Admin → Storage). Their page index, reading progress and read
--    counts go with them by cascade; units left with no files are removed too.
-- 2. Suggestions: students can send ideas through the help desk.
-- 3. Batch years can be hidden; 4. a whole year's courses move to another year in one step.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.delete_course_files(p_file_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
  affected uuid[];
begin
  select array_agg(distinct course_id) into affected from public.course_files where id = any(p_file_ids);
  delete from public.course_files where id = any(p_file_ids);
  get diagnostics n = row_count;
  delete from public.course_units u
   where u.course_id = any(coalesce(affected, '{}'))
     and not exists (select 1 from public.course_files f where f.unit_id = u.id);
  return n;
end $$;
revoke execute on function public.delete_course_files(uuid[]) from public, anon, authenticated;

alter table public.support_queries drop constraint if exists support_queries_topic_check;
alter table public.support_queries add constraint support_queries_topic_check
  check (topic in ('feature', 'notes', 'payment', 'contribute', 'account', 'suggestion', 'other'));

-- 3. Years you can hide from the catalogue without touching their courses.
alter table public.batches add column if not exists is_visible boolean not null default true;

-- 4. Move every course (and bundle) of one batch year to another in one step, optionally for
--    one branch only. Returns how many courses moved.
create or replace function public.move_batch_courses(p_from int, p_to int, p_programme text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.batches (year) values (p_to) on conflict (year) do nothing;
  update public.courses c set batch_year = p_to
   where c.batch_year = p_from
     and (p_programme is null or c.primary_programme_slug = p_programme
          or exists (select 1 from public.course_programmes cp where cp.course_id = c.id and cp.programme_slug = p_programme));
  get diagnostics n = row_count;
  if p_programme is null then
    update public.bundles set batch_year = p_to where batch_year = p_from;
  end if;
  return n;
end $$;
revoke execute on function public.move_batch_courses(int, int, text) from public, anon, authenticated;
