-- ════════════════════════════════════════════════════════════════════════════
-- Restaurant offers
--
-- Owners set up promo codes, automatic deals and combos in their dashboard (kept as a list on the
-- restaurant, like its menu card). An order keeps what an offer took off and which one, so the
-- owner's Insights can show what each offer brought in. The total stays the amount to pay.
--
-- Safe to run more than once. Rollback:
--   alter table public.messes drop column if exists offers;
--   alter table public.mess_orders drop column if exists discount, drop column if exists offer_label;
-- ════════════════════════════════════════════════════════════════════════════

alter table public.messes add column if not exists offers jsonb not null default '[]'::jsonb;
alter table public.mess_orders add column if not exists discount int not null default 0;
alter table public.mess_orders add column if not exists offer_label text not null default '';
alter table public.mess_orders drop constraint if exists mess_orders_discount;
alter table public.mess_orders add constraint mess_orders_discount check (discount >= 0 and char_length(offer_label) <= 80);
