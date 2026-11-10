-- Bundles across batches and programmes, and offers (Diwali and other sales).
--
-- One course is often shared by several years and programmes, so a bundle is no longer kept to one
-- batch. Where it shows is its own setting: [{"batchYear": 2025, "branchSlug": "bce"}, ...], where
-- "*" means every programme of that batch. Null keeps the automatic rule: every drawer that shows
-- two or more of its courses (and, for an old bundle with batch_year set, only that batch).
alter table public.bundles add column if not exists offered_to jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bundles_offered_to_is_array') then
    alter table public.bundles
      add constraint bundles_offered_to_is_array
      check (offered_to is null or jsonb_typeof(offered_to) = 'array');
  end if;
end $$;

comment on column public.bundles.offered_to is
  'Admin-chosen drawers [{batchYear, branchSlug}] ("*" = whole batch); null = automatic.';

-- An offer takes a percentage off while it runs. It never changes the stored prices, so when it
-- ends the old price simply comes back. When two offers cover the same thing the bigger one wins.
create table if not exists public.offers (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (length(btrim(title)) between 2 and 60),
  percent_off  int  not null check (percent_off between 1 and 90),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  status       text not null default 'draft' check (status in ('draft', 'live')),
  everything   boolean not null default false,
  course_ids   uuid[] not null default '{}',
  bundle_ids   uuid[] not null default '{}',
  drawers      jsonb not null default '[]'::jsonb check (jsonb_typeof(drawers) = 'array'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists offers_window_idx on public.offers (status, ends_at);

drop trigger if exists offers_updated_at on public.offers;
create trigger offers_updated_at before update on public.offers
  for each row execute function public.set_updated_at();
drop trigger if exists offers_audit on public.offers;
create trigger offers_audit after insert or update or delete on public.offers
  for each row execute function public.audit_row('id');

-- Only the server (service role) reads and writes offers; students see prices through the API.
alter table public.offers enable row level security;
revoke all on public.offers from anon, authenticated;
