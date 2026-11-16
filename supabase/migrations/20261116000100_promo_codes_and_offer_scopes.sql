-- Promo codes, and offers that cover every course or every bundle in one go.
--
-- Offers: besides "everything" or a hand-picked list, a festival sale can now cover all courses
-- (and nothing else) or all bundles (and nothing else). Prices are still never written over.
alter table public.offers add column if not exists all_courses boolean not null default false;
alter table public.offers add column if not exists all_bundles boolean not null default false;

comment on column public.offers.all_courses is 'Covers every live course (bundles only through their own rule).';
comment on column public.offers.all_bundles is 'Covers every live bundle.';

-- A promo code a student types at checkout. It takes a percentage or a flat amount off the price
-- they would pay right then (offers included), never below ₹1. Codes are stored upper-case.
create table if not exists public.promo_codes (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique check (code ~ '^[A-Z0-9_-]{3,24}$'),
  kind              text not null check (kind in ('percent', 'flat')),
  percent_off       int check (percent_off between 1 and 90),
  amount_off_paise  int check (amount_off_paise between 100 and 5000000),
  applies_to        text not null default 'everything'
                      check (applies_to in ('everything', 'courses', 'bundles', 'chosen')),
  course_ids        uuid[] not null default '{}',
  bundle_ids        uuid[] not null default '{}',
  starts_at         timestamptz not null default now(),
  ends_at           timestamptz,
  status            text not null default 'draft' check (status in ('draft', 'live')),
  max_uses          int check (max_uses is null or max_uses >= 1),
  once_per_student  boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check ((kind = 'percent' and percent_off is not null) or (kind = 'flat' and amount_off_paise is not null)),
  check (ends_at is null or ends_at > starts_at)
);

drop trigger if exists promo_codes_updated_at on public.promo_codes;
create trigger promo_codes_updated_at before update on public.promo_codes
  for each row execute function public.set_updated_at();
drop trigger if exists promo_codes_audit on public.promo_codes;
create trigger promo_codes_audit after insert or update or delete on public.promo_codes
  for each row execute function public.audit_row('id');

-- Which order used which code. Only paid orders count as a use. The code text is kept, so the
-- history survives the code being deleted.
create table if not exists public.promo_redemptions (
  order_id        uuid primary key references public.orders(id) on delete cascade,
  promo_code_id   uuid references public.promo_codes(id) on delete set null,
  code            text not null,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  full_paise      int not null check (full_paise > 0),
  discount_paise  int not null check (discount_paise >= 0),
  created_at      timestamptz not null default now()
);
create index if not exists promo_redemptions_code_idx on public.promo_redemptions (promo_code_id);

-- Only the server (service role) reads and writes these; students go through the API.
alter table public.promo_codes enable row level security;
alter table public.promo_redemptions enable row level security;
revoke all on public.promo_codes from anon, authenticated;
revoke all on public.promo_redemptions from anon, authenticated;
