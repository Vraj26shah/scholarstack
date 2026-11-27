-- ════════════════════════════════════════════════════════════════════════════
-- Pay-first orders and no-shows
--
-- 1. messes.upi_id / prepay_above: the owner's UPI ID, and the amount above which an order is
--    paid first (students pay the owner straight; no money passes through the site).
-- 2. mess_orders.payment / paid_at: '' (pay on delivery), 'due', 'claimed' (the student says they
--    paid), 'paid' (the owner saw it arrive).
-- 3. mess_orders.no_show_at: the owner marked that the student never collected it. Counted per
--    student across restaurants, so the index is on user_id.
--
-- Safe to run more than once. Rollback:
--   alter table public.messes drop column if exists upi_id, drop column if exists prepay_above;
--   alter table public.mess_orders drop column if exists payment, drop column if exists paid_at,
--     drop column if exists no_show_at;
-- ════════════════════════════════════════════════════════════════════════════

alter table public.messes add column if not exists upi_id text not null default '';
alter table public.messes add column if not exists prepay_above int not null default 0;
alter table public.messes drop constraint if exists messes_pay_first;
alter table public.messes add constraint messes_pay_first check (
  char_length(upi_id) <= 110 and prepay_above between 0 and 100000
);

alter table public.mess_orders add column if not exists payment text not null default '';
alter table public.mess_orders add column if not exists paid_at timestamptz;
alter table public.mess_orders add column if not exists no_show_at timestamptz;
alter table public.mess_orders drop constraint if exists mess_orders_payment;
alter table public.mess_orders add constraint mess_orders_payment check (payment in ('', 'due', 'claimed', 'paid'));
create index if not exists mess_orders_no_shows on public.mess_orders (user_id, no_show_at) where no_show_at is not null;
