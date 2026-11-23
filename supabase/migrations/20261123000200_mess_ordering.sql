-- ════════════════════════════════════════════════════════════════════════════
-- Restaurant ordering, and reminders folded into the tools
--
-- 1. messes gets the owner's phone (calls and WhatsApp orders), a delivery line, and the list of
--    things students can order with the owner's prices (sections of items, edited in
--    Admin › Campus). The dhaba gets the number and prices printed on its menu card.
-- 2. Reminders now live inside the Mess menu and the Timetable maker and launch with the Mess
--    menu, so the separate "Reminders" toolbox entry is removed while it is still Coming soon.
--
-- Safe to run more than once. Rollback:
--   alter table public.messes drop constraint if exists messes_order_json;
--   alter table public.messes drop column if exists phone, drop column if exists order_note,
--     drop column if exists order_menu;
-- ════════════════════════════════════════════════════════════════════════════

alter table public.messes add column if not exists phone      text  not null default '';
alter table public.messes add column if not exists order_note text  not null default '';
alter table public.messes add column if not exists order_menu jsonb not null default '[]'::jsonb;

alter table public.messes drop constraint if exists messes_order_json;
alter table public.messes add constraint messes_order_json
  check (jsonb_typeof(order_menu) = 'array' and pg_column_size(order_menu) < 100000);

-- The dhaba: the number and prices from its menu card (only if nobody has filled them in yet).
update public.messes
   set phone = '+91 85179 03810',
       order_note = 'Free home delivery · Parcel available',
       order_menu = '[{"title":"Thali & tiffin","items":[{"name":"Mess thali","price":80,"note":"today''s lunch or dinner menu"},{"name":"Monthly tiffin","price":3600,"note":"a month"}]}]'::jsonb
 where slug = 'radha-rani-ka-dhaba' and phone = '' and order_menu = '[]'::jsonb;

delete from public.features where key = 'reminders' and status = 'soon';
