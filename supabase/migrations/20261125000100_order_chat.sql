-- ════════════════════════════════════════════════════════════════════════════
-- Order chat, blocks, chat reports, and order alerts for restaurant owners
--
-- 1. mess_order_messages: the chat on each order (student ⇄ restaurant), plus "system" lines for
--    status changes. Photos live in R2 under chat-photos/<order id>/, never public.
-- 2. mess_orders gains the chat's bookkeeping: unread counts and read times per side, "clear chat"
--    per side (the other side and admins still see everything), the latest line for lists, when the
--    restaurant answered, the 3-minute nudge, who ended an unfinished order, and what happened to
--    the owner's new-order alert.
-- 3. mess_blocks: students a restaurant blocked (they can't order there or message it).
-- 4. mess_chat_reports: "Report" from either side of a chat, read in Admin › Campus › Orders.
-- 5. push_subscriptions.email: devices that asked for order alerts and chat messages under an
--    account (restaurant owners are found by their email).
-- 6. mess_chat_post(): adds a message and updates the order's counters in one step.
--
-- Everything is server only, like the rest of the campus tables. Safe to run more than once.
-- Rollback:
--   drop function if exists public.mess_chat_post(uuid, text, uuid, text, text);
--   drop table if exists public.mess_chat_reports, public.mess_blocks, public.mess_order_messages;
--   alter table public.mess_orders drop column if exists student_unread, drop column if exists owner_unread,
--     drop column if exists student_read_at, drop column if exists owner_read_at,
--     drop column if exists student_cleared_at, drop column if exists owner_cleared_at,
--     drop column if exists last_body, drop column if exists last_sender, drop column if exists last_at,
--     drop column if exists responded_at, drop column if exists nudged_at, drop column if exists ended_by,
--     drop column if exists alert_note;
--   alter table public.push_subscriptions drop column if exists email;
-- ════════════════════════════════════════════════════════════════════════════

alter table public.mess_orders add column if not exists student_unread     int not null default 0;
alter table public.mess_orders add column if not exists owner_unread       int not null default 0;
alter table public.mess_orders add column if not exists student_read_at    timestamptz;
alter table public.mess_orders add column if not exists owner_read_at      timestamptz;
alter table public.mess_orders add column if not exists student_cleared_at timestamptz;
alter table public.mess_orders add column if not exists owner_cleared_at   timestamptz;
alter table public.mess_orders add column if not exists last_body          text not null default '';
alter table public.mess_orders add column if not exists last_sender        text not null default '';
alter table public.mess_orders add column if not exists last_at            timestamptz;
alter table public.mess_orders add column if not exists responded_at       timestamptz;
alter table public.mess_orders add column if not exists nudged_at          timestamptz;
alter table public.mess_orders add column if not exists ended_by           text not null default '';
alter table public.mess_orders add column if not exists alert_note         text not null default '';
-- The ten-minute sweep looks for orders still waiting.
create index if not exists mess_orders_placed on public.mess_orders (created_at) where status = 'placed';

create table if not exists public.mess_order_messages (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.mess_orders(id) on delete cascade,
  mess_slug   text not null,
  sender      text not null,
  user_id     uuid,
  body        text not null default '',
  photo       text not null default '',
  -- An owner's answer to a student's message: how long the student waited (for reply times).
  reply_ms    int,
  created_at  timestamptz not null default now(),
  constraint mess_order_messages_sender check (sender in ('student', 'owner', 'system')),
  constraint mess_order_messages_body check (char_length(body) <= 1000),
  constraint mess_order_messages_photo check (photo ~ '^([a-f0-9]{24}\.(webp|jpg|png))?$'),
  constraint mess_order_messages_some check (body <> '' or photo <> '')
);
create index if not exists mess_order_messages_order on public.mess_order_messages (order_id, created_at);
create index if not exists mess_order_messages_user on public.mess_order_messages (user_id, created_at desc);
create index if not exists mess_order_messages_reply on public.mess_order_messages (mess_slug, created_at desc)
  where reply_ms is not null;
alter table public.mess_order_messages enable row level security; -- server only
revoke all on public.mess_order_messages from anon, authenticated;
comment on table public.mess_order_messages is 'Chat on each restaurant order (student, owner, and status lines).';

create table if not exists public.mess_blocks (
  mess_slug   text not null references public.messes(slug) on delete cascade,
  user_id     uuid not null,
  phone       text not null default '',
  email       text not null default '',
  name        text not null default '',
  reason      text not null default '',
  created_at  timestamptz not null default now(),
  primary key (mess_slug, user_id)
);
create index if not exists mess_blocks_phone on public.mess_blocks (mess_slug, phone);
alter table public.mess_blocks enable row level security; -- server only
revoke all on public.mess_blocks from anon, authenticated;
comment on table public.mess_blocks is 'Students a restaurant blocked: no orders or messages to it until unblocked.';

create table if not exists public.mess_chat_reports (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.mess_orders(id) on delete cascade,
  by_role     text not null,
  reason      text not null,
  status      text not null default 'new',
  created_at  timestamptz not null default now(),
  constraint mess_chat_reports_by check (by_role in ('student', 'owner')),
  constraint mess_chat_reports_status check (status in ('new', 'done')),
  constraint mess_chat_reports_reason check (char_length(reason) between 3 and 500)
);
create index if not exists mess_chat_reports_new on public.mess_chat_reports (created_at desc);
alter table public.mess_chat_reports enable row level security; -- server only
revoke all on public.mess_chat_reports from anon, authenticated;
comment on table public.mess_chat_reports is 'Reports from either side of an order chat, for the admin.';

alter table public.push_subscriptions add column if not exists email text not null default '';
create index if not exists push_subscriptions_email on public.push_subscriptions (email) where email <> '';

-- One message, and the order's counters with it: the other side's unread count, the latest line,
-- and (for an owner answering a student) how long the student waited.
create or replace function public.mess_chat_post(
  p_order uuid, p_sender text, p_user uuid, p_body text, p_photo text
) returns public.mess_order_messages
language plpgsql security definer set search_path = public as $$
declare
  o public.mess_orders;
  m public.mess_order_messages;
  wait_ms int;
begin
  select * into o from public.mess_orders where id = p_order for update;
  if not found then raise exception 'no such order'; end if;
  if p_sender = 'owner' and o.last_sender = 'student' and o.last_at is not null then
    wait_ms := least(extract(epoch from (now() - o.last_at)) * 1000, 2000000000)::int;
  end if;
  insert into public.mess_order_messages (order_id, mess_slug, sender, user_id, body, photo, reply_ms)
  values (p_order, o.mess_slug, p_sender, p_user, coalesce(p_body, ''), coalesce(p_photo, ''), wait_ms)
  returning * into m;
  update public.mess_orders set
    student_unread = student_unread + case when p_sender in ('owner', 'system') then 1 else 0 end,
    owner_unread   = owner_unread   + case when p_sender = 'student' then 1 else 0 end,
    last_body   = case when m.body <> '' then left(m.body, 140) else '📷 Photo' end,
    last_sender = p_sender,
    last_at     = m.created_at
  where id = p_order;
  return m;
end $$;
revoke execute on function public.mess_chat_post(uuid, text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.mess_chat_post(uuid, text, uuid, text, text) to service_role;
