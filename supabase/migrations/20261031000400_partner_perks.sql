-- ════════════════════════════════════════════════════════════════════════════
-- Partner of the year: the perk can be cash or a gift (a prize, a voucher, merchandise), with
-- what it was. One perk per person per year, as before. A gift may have no rupee value.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.contributor_bonuses add column if not exists kind text not null default 'cash'
  check (kind in ('cash', 'gift'));
alter table public.contributor_bonuses drop constraint if exists contributor_bonuses_amount_paise_check;
alter table public.contributor_bonuses add constraint contributor_bonuses_amount_paise_check check (amount_paise >= 0);
