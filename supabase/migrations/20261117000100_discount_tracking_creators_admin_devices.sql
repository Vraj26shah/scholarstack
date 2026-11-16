-- Who used which discount, what each promo code's creator is owed, and more devices for admins.
--
-- 1. Promo codes can belong to a creator (a campus ambassador, a YouTuber) who earns a commission
--    on every paid order that used the code: a percentage of what the student paid, or a flat
--    amount per use. The commission is worked out when the order is placed and kept on the
--    redemption, so changing the rate later never rewrites what was already earned.
alter table public.promo_codes add column if not exists creator_name text
  check (creator_name is null or length(btrim(creator_name)) between 2 and 80);
alter table public.promo_codes add column if not exists creator_contact text
  check (creator_contact is null or length(creator_contact) <= 120);
alter table public.promo_codes add column if not exists commission_kind text
  check (commission_kind is null or commission_kind in ('percent', 'flat'));
alter table public.promo_codes add column if not exists commission_value int
  check (commission_value is null or commission_value >= 0);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'promo_codes_commission_shape') then
    alter table public.promo_codes add constraint promo_codes_commission_shape check (
      (commission_kind is null) = (commission_value is null)
      and (commission_kind is null or creator_name is not null)
      and (commission_kind is distinct from 'percent' or commission_value between 1 and 100)
    );
  end if;
end $$;

alter table public.promo_redemptions add column if not exists creator_name text;
alter table public.promo_redemptions add column if not exists commission_paise int not null default 0
  check (commission_paise >= 0);
create index if not exists promo_redemptions_creator_idx on public.promo_redemptions (lower(creator_name));

-- Money paid out to a creator. Kept by creator name (one person can have several codes).
create table if not exists public.promo_payouts (
  id            uuid primary key default gen_random_uuid(),
  creator_name  text not null check (length(btrim(creator_name)) between 2 and 80),
  amount_paise  int  not null check (amount_paise > 0),
  note          text not null default '' check (length(note) <= 200),
  recorded_by   text not null default '',
  paid_at       timestamptz not null default now()
);
create index if not exists promo_payouts_creator_idx on public.promo_payouts (lower(creator_name));
drop trigger if exists promo_payouts_audit on public.promo_payouts;
create trigger promo_payouts_audit after insert or update or delete on public.promo_payouts
  for each row execute function public.audit_row('id');

-- 2. Which offer (Diwali sale and the like) gave an order its price. Snapshot of the offer, so the
--    history survives the offer being changed or deleted.
create table if not exists public.order_offers (
  order_id        uuid primary key references public.orders(id) on delete cascade,
  offer_id        uuid references public.offers(id) on delete set null,
  offer_title     text not null,
  percent_off     int  not null,
  full_paise      int  not null check (full_paise > 0),
  discount_paise  int  not null check (discount_paise >= 0),
  created_at      timestamptz not null default now()
);
create index if not exists order_offers_offer_idx on public.order_offers (offer_id);

alter table public.promo_payouts enable row level security;
alter table public.order_offers enable row level security;
revoke all on public.promo_payouts from anon, authenticated;
revoke all on public.order_offers from anon, authenticated;

-- 3. Admins (listed in admin_emails) may use up to 10 devices; students keep 2.
create or replace function public.enforce_two_device_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  device_limit int := 2;
begin
  perform 1 from public.profiles where id = new.user_id for update;
  if exists (
    select 1
    from public.profiles p
    join public.admin_emails a on a.email = lower(btrim(p.email))
    where p.id = new.user_id
  ) then
    device_limit := 10;
  end if;
  if (
    select count(*)
    from public.devices
    where user_id = new.user_id
      and (revoked_at is null or revoked_at > now())
  ) >= device_limit then
    raise exception 'SS_DEVICE_LIMIT' using errcode = '23514';
  end if;
  return new;
end;
$$;
