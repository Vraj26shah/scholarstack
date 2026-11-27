-- ════════════════════════════════════════════════════════════════════════════
-- Restaurant fees: what each restaurant pays Scholars Stack, and how it is settled
--
-- 1. mess_fee_rules: a restaurant's fee (none, per accepted order, or monthly) from a day on.
--    Rules are only ever added: a past order keeps the price it was accepted at.
-- 2. mess_ledger: every money event (an order's fee, a waiver, a monthly charge, an adjustment,
--    a payment received), in paise. Only ever added to: the triggers below refuse any change or
--    delete, so the account can always be added up again from its entries.
--    One fee per order and one monthly charge per month are enforced by unique indexes.
-- 3. mess_settlements: a closed month (opening, charges, credits, payments, closing). Final.
--
-- Server only (row level security on, no policies). Safe to run more than once. Rollback:
--   drop table if exists public.mess_settlements, public.mess_ledger, public.mess_fee_rules;
--   drop function if exists public.refuse_change();
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.mess_fee_rules (
  id          uuid primary key default gen_random_uuid(),
  mess_slug   text not null,
  starts_on   date not null,
  mode        text not null,
  per_order   int not null default 0,
  percent_bp  int not null default 0,
  tiffin_fee  int not null default 0,
  monthly     int not null default 0,
  free_until  date,
  note        text not null default '',
  created_at  timestamptz not null default now(),
  created_by  text not null default '',
  constraint mess_fee_rules_valid check (
    mode in ('none', 'per_order', 'monthly')
    and per_order between 0 and 1000
    and percent_bp between 0 and 3000
    and tiffin_fee between 0 and 10000
    and monthly between 0 and 200000
    and char_length(note) <= 300
  )
);
create index if not exists mess_fee_rules_slug on public.mess_fee_rules (mess_slug, starts_on);

create table if not exists public.mess_ledger (
  id          uuid primary key default gen_random_uuid(),
  mess_slug   text not null,
  day         date not null,
  kind        text not null,
  order_id    text,
  period      text,
  amount      bigint not null,
  note        text not null default '',
  method      text not null default '',
  created_at  timestamptz not null default now(),
  created_by  text not null default '',
  constraint mess_ledger_valid check (
    kind in ('order', 'waive', 'unwaive', 'monthly', 'adjust', 'payment')
    and (kind not in ('order', 'waive', 'unwaive') or order_id is not null)
    and (kind <> 'monthly' or period ~ '^\d{4}-\d{2}$')
    and (kind <> 'payment' or amount < 0)
    and abs(amount) <= 1000000000
    and char_length(note) <= 300
    and char_length(method) <= 40
  )
);
create unique index if not exists mess_ledger_one_fee_per_order on public.mess_ledger (order_id) where kind = 'order';
create unique index if not exists mess_ledger_one_charge_per_month on public.mess_ledger (mess_slug, period) where kind = 'monthly';
create index if not exists mess_ledger_slug_day on public.mess_ledger (mess_slug, day);
create index if not exists mess_ledger_day on public.mess_ledger (day);

create table if not exists public.mess_settlements (
  mess_slug   text not null,
  period      text not null,
  opening     bigint not null,
  charges     bigint not null,
  credits     bigint not null,
  payments    bigint not null,
  closing     bigint not null,
  orders      int not null default 0,
  sales       bigint not null default 0,
  note        text not null default '',
  closed_at   timestamptz not null default now(),
  closed_by   text not null default '',
  primary key (mess_slug, period),
  constraint mess_settlements_valid check (period ~ '^\d{4}-\d{2}$' and char_length(note) <= 300)
);

-- Money records are never changed or deleted: corrections are new entries.
create or replace function public.refuse_change() returns trigger language plpgsql as $f$
begin
  raise exception 'Fee records are never changed or deleted: add a correcting entry instead.';
end
$f$;
drop trigger if exists mess_ledger_append_only on public.mess_ledger;
create trigger mess_ledger_append_only before update or delete on public.mess_ledger
  for each row execute function public.refuse_change();
drop trigger if exists mess_settlements_final on public.mess_settlements;
create trigger mess_settlements_final before update or delete on public.mess_settlements
  for each row execute function public.refuse_change();
drop trigger if exists mess_fee_rules_append_only on public.mess_fee_rules;
create trigger mess_fee_rules_append_only before update or delete on public.mess_fee_rules
  for each row execute function public.refuse_change();

alter table public.mess_fee_rules enable row level security;
alter table public.mess_ledger enable row level security;
alter table public.mess_settlements enable row level security;
revoke all on public.mess_fee_rules, public.mess_ledger, public.mess_settlements from anon, authenticated;
comment on table public.mess_ledger is 'Restaurant fees: append-only ledger in paise (+ owed, - credited or paid).';

-- When the restaurant accepted an order: its fee is worked out from the rule of that day.
alter table public.mess_orders add column if not exists accepted_at timestamptz;
create index if not exists mess_orders_accepted on public.mess_orders (accepted_at) where accepted_at is not null;
