-- ════════════════════════════════════════════════════════════════════════════
-- Monthly tiffin plans
--
-- A restaurant's tiffin item is ordered with a meal plan (lunch, dinner or both) and a first day;
-- it runs 30 days. These columns say so on the order; the owner's Tiffin tab lists each day's
-- deliveries from them. Ordinary orders leave them empty.
--
-- Safe to run more than once. Rollback:
--   alter table public.mess_orders drop column if exists tiffin_plan,
--     drop column if exists tiffin_starts, drop column if exists tiffin_ends;
-- ════════════════════════════════════════════════════════════════════════════

alter table public.mess_orders add column if not exists tiffin_plan   text;
alter table public.mess_orders add column if not exists tiffin_starts date;
alter table public.mess_orders add column if not exists tiffin_ends   date;
alter table public.mess_orders drop constraint if exists mess_orders_tiffin;
alter table public.mess_orders add constraint mess_orders_tiffin check (
  (tiffin_plan is null and tiffin_starts is null and tiffin_ends is null)
  or (tiffin_plan in ('lunch', 'dinner', 'both') and tiffin_starts is not null and tiffin_ends >= tiffin_starts)
);
create index if not exists mess_orders_tiffin on public.mess_orders (mess_slug, tiffin_ends) where tiffin_plan is not null;
