-- ════════════════════════════════════════════════════════════════════════════
-- Delete a course for good (admin). Refused when anyone bought or was given it: those rows are
-- the sales and access history. Checkouts that were started for it but never paid go with it.
-- Units, files, the page index, branch listings and bundle entries are removed by cascade.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.delete_course(p_course_id uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.courses where id = p_course_id) then
    return 'not-found';
  end if;
  if exists (select 1 from public.entitlements where course_id = p_course_id)
     or exists (
       select 1 from public.order_items i join public.orders o on o.id = i.order_id
        where i.course_id = p_course_id and (o.status = 'paid' or o.gateway_payment_id is not null))
     or exists (
       select 1 from public.orders o where o.course_id = p_course_id
          and (o.status = 'paid' or o.gateway_payment_id is not null)) then
    return 'sold';
  end if;
  delete from public.orders o
   where o.course_id = p_course_id
      or o.id in (select order_id from public.order_items where course_id = p_course_id);
  delete from public.courses where id = p_course_id;
  return 'deleted';
end $$;
revoke execute on function public.delete_course(uuid) from public, anon, authenticated;
