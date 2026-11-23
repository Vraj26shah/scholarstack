-- ════════════════════════════════════════════════════════════════════════════
-- Mess menus and reminder notifications
--
-- 1. messes: one row per hostel mess (four meals) or restaurant for day scholars (lunch and
--    dinner). The week's menu is JSON (weeks → days → meals → dishes), edited in Admin › Campus.
--    A rotating menu has several weeks, counted from cycle_start. Unpublished rows are seen by
--    admins only.
-- 2. mess_reports: "Something changed? Tell us" from the menu page. Only a hash of the sender's
--    network is kept (for rate limits), never the address itself.
-- 3. push_subscriptions: one row per device that turned reminders on. It holds the browser's push
--    address and keys and what the device asked for (mess and meals, and only the classes the
--    student ticked: name, room, start times). user_id is set only when the student was signed in,
--    so they can see and switch off their devices from another one.
-- 4. push_sent: which reminder each device already got today, so none is sent twice.
-- 5. The toolbox: "Mess menu" stays Coming soon, and "Reminders" is added as Coming soon. Admins
--    can use both on the live site; students see them when an admin presses Launch.
--
-- Access: only the server (service role). Students reach these only through the API.
--
-- Safe to run more than once. Rollback:
--   drop table if exists public.push_sent;
--   drop table if exists public.push_subscriptions;
--   drop table if exists public.mess_reports;
--   drop table if exists public.messes;
--   delete from public.features where key = 'reminders' and status = 'soon';
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.messes (
  slug         text primary key,
  name         text not null,
  kind         text not null,
  place        text not null default '',
  source       text not null default 'notice',
  note         text not null default '',
  prices       text not null default '',
  meals        jsonb not null default '[]'::jsonb,
  weeks        jsonb not null default '[]'::jsonb,
  cycle_start  date not null default current_date,
  published    boolean not null default false,
  sort         int not null default 0,
  updated_at   timestamptz not null default now(),
  constraint messes_slug check (slug ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
  constraint messes_kind check (kind in ('hostel', 'restaurant')),
  constraint messes_source check (source in ('notice', 'owner')),
  constraint messes_name check (length(name) between 2 and 80),
  constraint messes_json check (jsonb_typeof(meals) = 'array' and jsonb_typeof(weeks) = 'array'),
  constraint messes_size check (pg_column_size(weeks) < 200000)
);
alter table public.messes enable row level security; -- server only
revoke all on public.messes from anon, authenticated;

create table if not exists public.mess_reports (
  id          uuid primary key default gen_random_uuid(),
  mess_slug   text not null references public.messes(slug) on delete cascade,
  day         text,
  meal        text,
  message     text not null,
  contact     text not null default '',
  status      text not null default 'new',
  ip_hash     text not null default '',
  created_at  timestamptz not null default now(),
  constraint mess_reports_day check (day is null or day in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')),
  constraint mess_reports_meal check (meal is null or meal in ('breakfast', 'lunch', 'snacks', 'dinner')),
  constraint mess_reports_message check (length(message) between 5 and 600),
  constraint mess_reports_contact check (length(contact) <= 120),
  constraint mess_reports_status check (status in ('new', 'done'))
);
create index if not exists mess_reports_recent on public.mess_reports (created_at desc);
alter table public.mess_reports enable row level security; -- server only
revoke all on public.mess_reports from anon, authenticated;

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  prefs       jsonb not null default '{}'::jsonb,
  user_id     uuid references public.profiles(id) on delete set null,
  label       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint push_subscriptions_endpoint check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  constraint push_subscriptions_prefs check (jsonb_typeof(prefs) = 'object' and pg_column_size(prefs) < 20000)
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id) where user_id is not null;
alter table public.push_subscriptions enable row level security; -- server only
revoke all on public.push_subscriptions from anon, authenticated;

create table if not exists public.push_sent (
  subscription_id  uuid not null references public.push_subscriptions(id) on delete cascade,
  key              text not null,
  day              date not null,
  sent_at          timestamptz not null default now(),
  primary key (subscription_id, key)
);
create index if not exists push_sent_day on public.push_sent (day);
alter table public.push_sent enable row level security; -- server only
revoke all on public.push_sent from anon, authenticated;

comment on table public.messes is 'Mess menus: hostel messes and restaurants for day scholars (Admin › Campus).';
comment on table public.mess_reports is 'Menu corrections sent by students from the mess menu page.';
comment on table public.push_subscriptions is 'Devices that turned reminders on: push address, keys and what they asked for.';
comment on table public.push_sent is 'Reminders already sent to each device (kept two days).';

-- The first menus (unpublished: admins check them on the live site first). Kept if they exist.
insert into public.messes (slug, name, kind, place, source, note, prices, meals, weeks, cycle_start, published, sort)
values
  ('safal-hostel-mess', 'Safal hostel mess', 'hostel', 'VIT Bhopal hostels', 'notice', 'Typed from the notice-board photo (week 1, from 12 Oct 2026, veg & non-veg). High tea and dinner times are our best guess until the notice gives them.', '', '[{"key":"breakfast","start":"07:30","end":"09:30","extras":"Bread, butter, jam · Tea, coffee, milk"},{"key":"lunch","start":"12:15","end":"14:30","extras":"Roti (plain & butter) · Plain rice (north & south) · Pickle"},{"key":"snacks","start":"16:30","end":"17:30","extras":"Tea, coffee, milk"},{"key":"dinner","start":"19:30","end":"21:30","extras":"Roti (plain & butter) · Plain rice (north & south) · Pickle"}]'::jsonb, '[{"label":"Week 1","days":{"mon":{"breakfast":[{"name":"Idly & masala vada","unsure":false},{"name":"Moong dal sambar","unsure":false},{"name":"Peanut chutney","unsure":false},{"name":"Mix fruits","unsure":false},{"name":"1 boiled egg (non-veg) / steamed sprouts salad (veg)","unsure":false}],"lunch":[{"name":"Dal fry","unsure":false},{"name":"Aloo gobi sukhi (dry)","unsure":false},{"name":"Mixed vegetable sambar","unsure":false},{"name":"Beans peas stir fry","unsure":false},{"name":"Tomato dhaniya shorba","unsure":true},{"name":"Curd","unsure":false},{"name":"Kheer","unsure":true}],"snacks":[{"name":"Kala chana sundal","unsure":false}],"dinner":[{"name":"Methi mutter malai paneer curry (veg) / egg curry (non-veg)","unsure":false},{"name":"Yellow dal","unsure":false},{"name":"Mix vegetable salad","unsure":false},{"name":"Rasam","unsure":false},{"name":"Curd rice","unsure":false}]},"tue":{"breakfast":[{"name":"Aloo paratha","unsure":false},{"name":"Curd & pickle","unsure":false},{"name":"Banana","unsure":false},{"name":"1 boiled egg (non-veg) / mixed vegetables & sprouts salad (veg)","unsure":false}],"lunch":[{"name":"Rajma masala","unsure":false},{"name":"Tindora fry","unsure":true},{"name":"Mixed veg curry","unsure":true},{"name":"Stir-fried vegetables","unsure":true},{"name":"Ajwain rasam","unsure":true},{"name":"Butter milk","unsure":false}],"snacks":[{"name":"Punugulu + podi & allam (ginger) chutney","unsure":true}],"dinner":[{"name":"Veg pulao","unsure":false},{"name":"Veg jalfrezi","unsure":false},{"name":"Dal makhani","unsure":false},{"name":"Mix vegetable salad","unsure":false},{"name":"Rasam","unsure":false},{"name":"Curd rice","unsure":false}]},"wed":{"breakfast":[{"name":"Sabudana khichdi","unsure":true},{"name":"Set dosa & vada curry","unsure":true},{"name":"Coconut chutney","unsure":false},{"name":"Mix fruits","unsure":false},{"name":"1 boiled egg (non-veg) / steamed green gram sprouts (veg)","unsure":false}],"lunch":[{"name":"Gujarati dal","unsure":false},{"name":"Veg kofta curry (semi gravy)","unsure":false},{"name":"Drumstick sambar","unsure":false},{"name":"Cabbage peas carrot sauté","unsure":false},{"name":"Garlic pepper rasam","unsure":false},{"name":"Curd","unsure":false},{"name":"Kesari","unsure":true}],"snacks":[{"name":"Pani puri with aloo, kala chana, onion","unsure":false}],"dinner":[{"name":"Paneer chatpata (veg) / chicken korma (non-veg)","unsure":false},{"name":"Moong masoor dal (North)","unsure":false},{"name":"Bengali salad","unsure":true},{"name":"Rasam","unsure":false},{"name":"Curd rice","unsure":false}]},"thu":{"breakfast":[{"name":"Pav bhaji & fried chillies","unsure":false},{"name":"Mix fruits","unsure":false},{"name":"2 boiled eggs (non-veg) / green gram sprouts chaat (veg)","unsure":false}],"lunch":[{"name":"Jeera rice (+ plain rice south)","unsure":false},{"name":"Cholar dal","unsure":false},{"name":"Aloo posto","unsure":false},{"name":"Butter beans curry","unsure":true},{"name":"Carrot & beans poriyal (Tamil Nadu)","unsure":false},{"name":"Chenna saag","unsure":true},{"name":"Chaas","unsure":false}],"snacks":[{"name":"Mini veg samosa, green & sweet chutney","unsure":false}],"dinner":[{"name":"Palak paneer (veg) / anda curry (non-veg)","unsure":false},{"name":"Mix vegetable salad","unsure":false},{"name":"Rasam","unsure":false},{"name":"Curd rice","unsure":false}]},"fri":{"breakfast":[{"name":"Vegetable poha","unsure":false},{"name":"Jalebi","unsure":true},{"name":"Single fruit","unsure":false},{"name":"Egg bhurji (non-veg) / paneer bhurji (veg)","unsure":false}],"lunch":[{"name":"Rajasthani kadhi","unsure":false},{"name":"Bhindi pachadi","unsure":true},{"name":"Mixed vegetable tooran","unsure":true},{"name":"Dal sambar","unsure":false},{"name":"Seasonal mixed vegetable sabji","unsure":false},{"name":"Chettinad rasam","unsure":false},{"name":"Curd","unsure":false},{"name":"Gulab jamun","unsure":true}],"snacks":[{"name":"Cheese & vegetable sandwich","unsure":true}],"dinner":[{"name":"Paneer tikka masala (veg) / chicken tikka masala (non-veg)","unsure":false},{"name":"Dal fry","unsure":false},{"name":"Salad","unsure":false},{"name":"Rasam","unsure":false},{"name":"Curd rice","unsure":false}]},"sat":{"breakfast":[{"name":"Wheat poori","unsure":false},{"name":"Channa masala","unsure":false},{"name":"Chilli & lemon wedges","unsure":false},{"name":"Banana","unsure":false},{"name":"1 boiled egg (non-veg) / green gram sprouts (veg)","unsure":false}],"lunch":[{"name":"Lasooni dal","unsure":false},{"name":"Jeera aloo dry","unsure":false},{"name":"Tomato rice (Karnataka)","unsure":false},{"name":"Papad","unsure":true},{"name":"Bellulli saaru (garlic rasam)","unsure":false},{"name":"Butter milk","unsure":false}],"snacks":[{"name":"Dal kachori + green chutney","unsure":false}],"dinner":[{"name":"Aloo fried (Indo-Chinese)","unsure":true},{"name":"Dal tadka","unsure":false},{"name":"Mix vegetable salad","unsure":false},{"name":"Rasam","unsure":false},{"name":"Curd rice","unsure":false}]},"sun":{"breakfast":[{"name":"Dosa, masala separately","unsure":false},{"name":"Sambar","unsure":false},{"name":"Tomato garlic chutney","unsure":true},{"name":"Banana","unsure":false},{"name":"1 boiled egg (non-veg) / mixed sprouts chaat (veg)","unsure":false}],"lunch":[{"name":"Veg Hyderabadi dum biryani (veg) / chicken Hyderabadi dum biryani (non-veg)","unsure":false},{"name":"Dal Kolhapuri","unsure":true},{"name":"Chole paneer (Punjabi)","unsure":true},{"name":"Mix raita","unsure":false},{"name":"Veg salan (long mirchi)","unsure":true},{"name":"Pineapple kesari","unsure":true}],"snacks":[{"name":"Vada pav, green chutney","unsure":false}],"dinner":[{"name":"Main dish not readable on the notice","unsure":true},{"name":"Dal Kolhapuri","unsure":true},{"name":"Salad","unsure":false},{"name":"Rasam","unsure":false},{"name":"Curd rice","unsure":false}]}}}]'::jsonb, '2026-10-12'::date, false, 0),
  ('radha-rani-ka-dhaba', 'Radha Rani Ka · Vrindavan Dhaba', 'restaurant', 'VIT Chauraha, Kothri', 'owner', 'Pure vegetarian dhaba and family restaurant. Free home delivery; parcels available. Serving hours are not on the menu card, so the times here are approximate.', 'Mess thali ₹80 · Tiffin ₹3,600 a month', '[{"key":"lunch","start":"12:00","end":"15:00","extras":""},{"key":"dinner","start":"19:00","end":"22:00","extras":""}]'::jsonb, '[{"label":"","days":{"mon":{"lunch":[{"name":"Aloo paratha","unsure":false},{"name":"Matar pulao","unsure":false},{"name":"Salad","unsure":false}],"dinner":[{"name":"Chhole masala","unsure":false},{"name":"Dal","unsure":false},{"name":"Rice","unsure":false},{"name":"Roti","unsure":false},{"name":"Salad","unsure":false}]},"tue":{"lunch":[{"name":"Mix veg","unsure":false},{"name":"Dal","unsure":false},{"name":"Rice","unsure":false},{"name":"Roti","unsure":false},{"name":"Salad","unsure":false}],"dinner":[{"name":"Aloo / drumstick","unsure":false},{"name":"Dal","unsure":false},{"name":"Rice","unsure":false},{"name":"Roti","unsure":false}]},"wed":{"lunch":[{"name":"Sev tamatar","unsure":false},{"name":"Dal","unsure":false},{"name":"Rice","unsure":false},{"name":"Roti","unsure":false},{"name":"Salad","unsure":false}],"dinner":[{"name":"Matar paneer","unsure":false},{"name":"Dal","unsure":false},{"name":"Rice","unsure":false},{"name":"Roti","unsure":false},{"name":"Papad","unsure":false},{"name":"Salad","unsure":false}]},"thu":{"lunch":[{"name":"Bhindi masala","unsure":false},{"name":"Dal","unsure":false},{"name":"Rice","unsure":false},{"name":"Roti","unsure":false}],"dinner":[{"name":"Chhole bhature","unsure":false},{"name":"Matar pulao","unsure":false}]},"fri":{"lunch":[{"name":"Aloo chole","unsure":false},{"name":"Dal","unsure":false},{"name":"Rice","unsure":false},{"name":"Roti","unsure":false},{"name":"Salad","unsure":false}],"dinner":[{"name":"Kadhi pakoda","unsure":false},{"name":"Dal","unsure":false},{"name":"Picadi","unsure":true},{"name":"Rice","unsure":false},{"name":"Salad","unsure":false}]},"sat":{"lunch":[{"name":"Punjabi aloo","unsure":false},{"name":"Dal","unsure":false},{"name":"Rice","unsure":false},{"name":"Roti","unsure":false}],"dinner":[{"name":"Hakka noodles","unsure":false},{"name":"Matar paneer","unsure":false},{"name":"Paratha","unsure":false},{"name":"Papad","unsure":false}]},"sun":{"lunch":[{"name":"Mushroom matar","unsure":false},{"name":"Dal","unsure":false},{"name":"Rice","unsure":false},{"name":"Roti","unsure":false},{"name":"Papad","unsure":false},{"name":"Salad","unsure":false}],"dinner":[{"name":"Paneer masala","unsure":false},{"name":"Methi paratha","unsure":false},{"name":"Veg fried rice","unsure":false}]}}}]'::jsonb, '2026-11-23'::date, false, 1)
on conflict (slug) do nothing;

insert into public.features (key, title, blurb, status, sort)
select 'reminders',
       'Reminders',
       'Your mess menu before each meal and tomorrow''s classes the night before, on your phone, even with the site closed.',
       'soon',
       coalesce((select max(sort) from public.features), 0) + 1
on conflict (key) do nothing;
