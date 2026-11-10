-- Drawer packs: one bundle per drawer (batch × programme) holding every course that drawer shows,
-- priced on a fixed ladder (5 courses for ₹349, and so on). The pack builder keeps each pack's
-- courses and price in step with its drawer; "2025:bce" says which drawer a pack belongs to.
-- Null for bundles made by hand.
alter table public.bundles add column if not exists auto_drawer text;

create unique index if not exists bundles_auto_drawer_key
  on public.bundles (auto_drawer) where auto_drawer is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bundles_auto_drawer_shape') then
    alter table public.bundles
      add constraint bundles_auto_drawer_shape
      check (auto_drawer is null or auto_drawer ~ '^[0-9]{4}:[a-z0-9]+(-[a-z0-9]+)*$');
  end if;
end $$;

comment on column public.bundles.auto_drawer is
  'Drawer pack key "year:programme" (kept in step by the pack builder); null = made by hand.';
