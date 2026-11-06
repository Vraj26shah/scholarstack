-- ════════════════════════════════════════════════════════════════════════════
-- 0500 · Commerce: bundles, orders (one course or one bundle), what each order
-- grants (order_items), and access (entitlements). All sales are final; a lost
-- bank dispute is the only thing that removes access.
-- ════════════════════════════════════════════════════════════════════════════

create table public.bundles (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title         text not null check (length(title) between 2 and 120),
  description   text not null default '',
  batch_year    int references public.batches(year) on update cascade,
  price_paise   int not null check (price_paise between 100 and 5000000),
  status        text not null default 'draft' check (status in ('draft', 'live', 'archived')),
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger bundles_updated_at before update on public.bundles
  for each row execute function public.set_updated_at();
create trigger bundles_published_at before insert or update of status on public.bundles
  for each row execute function public.stamp_published_at();
create trigger bundles_audit after insert or update or delete on public.bundles
  for each row execute function public.audit_row('id');

create table public.bundle_courses (
  bundle_id  uuid not null references public.bundles(id) on delete cascade,
  course_id  uuid not null references public.courses(id) on delete cascade,
  sort       int not null default 0,
  primary key (bundle_id, course_id)
);
create index bundle_courses_course_idx on public.bundle_courses (course_id);

-- ── Orders ──────────────────────────────────────────────────────────────────
create table public.orders (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  -- Exactly what was bought: a course or a bundle.
  course_id           uuid references public.courses(id),
  bundle_id           uuid references public.bundles(id),
  amount_paise        int not null check (amount_paise > 0),
  currency            text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  gateway             text not null default 'razorpay',
  gateway_order_id    text not null unique,
  gateway_payment_id  text unique,
  status              text not null default 'created' check (status in ('created', 'paid', 'failed', 'disputed')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (num_nonnulls(course_id, bundle_id) >= 1)
);
create index orders_user_idx on public.orders (user_id, created_at desc);
create index orders_paid_idx on public.orders (created_at) where status = 'paid';
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

-- What an order grants, frozen at purchase time: editing a bundle later never
-- changes what an earlier buyer received.
create table public.order_items (
  order_id   uuid not null references public.orders(id) on delete cascade,
  course_id  uuid not null references public.courses(id),
  primary key (order_id, course_id)
);
create index order_items_course_idx on public.order_items (course_id);

create table public.entitlements (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  course_id   uuid not null references public.courses(id),
  order_id    uuid not null references public.orders(id),
  granted_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  primary key (user_id, course_id)
);
create index entitlements_course_idx on public.entitlements (course_id) where revoked_at is null;
create index entitlements_order_idx on public.entitlements (order_id);

-- ── Functions ───────────────────────────────────────────────────────────────
-- Create an order and its items atomically. Returns the order with course_ids.
create or replace function public.create_order(
  p_user_id uuid,
  p_course_id uuid,
  p_bundle_id uuid,
  p_course_ids uuid[],
  p_amount_paise int,
  p_gateway_order_id text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  if coalesce(cardinality(p_course_ids), 0) < 1 then
    raise exception 'An order must grant at least one course' using errcode = '22023';
  end if;
  insert into public.orders (user_id, course_id, bundle_id, amount_paise, gateway_order_id)
  values (p_user_id, p_course_id, p_bundle_id, p_amount_paise, p_gateway_order_id)
  returning * into o;
  insert into public.order_items (order_id, course_id)
  select o.id, c from unnest(p_course_ids) c
  on conflict do nothing;
  return to_jsonb(o) || jsonb_build_object('course_ids', to_jsonb(p_course_ids));
end $$;

-- Mark paid and grant every course in one transaction. Safe to call twice
-- (checkout callback and webhook can both arrive): the second call changes nothing.
create or replace function public.grant_order(p_gateway_order_id text, p_gateway_payment_id text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
begin
  select * into o from public.orders where gateway_order_id = p_gateway_order_id for update;
  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if o.status <> 'paid' then
    update public.orders set status = 'paid', gateway_payment_id = p_gateway_payment_id where id = o.id;
  end if;
  insert into public.entitlements (user_id, course_id, order_id)
  select o.user_id, i.course_id, o.id from public.order_items i where i.order_id = o.id
  on conflict (user_id, course_id) do update
    set revoked_at = null, order_id = excluded.order_id, granted_at = now()
    where public.entitlements.revoked_at is not null;
  return o.id;
end $$;

-- A lost bank dispute removes what that payment granted.
create or replace function public.revoke_by_payment(p_gateway_payment_id text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.orders set status = 'disputed' where gateway_payment_id = p_gateway_payment_id;
  update public.entitlements e set revoked_at = now()
    from public.orders o
   where o.gateway_payment_id = p_gateway_payment_id and e.order_id = o.id and e.revoked_at is null;
end $$;

revoke execute on function public.create_order(uuid, uuid, uuid, uuid[], int, text) from public, anon, authenticated;
revoke execute on function public.grant_order(text, text) from public, anon, authenticated;
revoke execute on function public.revoke_by_payment(text) from public, anon, authenticated;

alter table public.bundles enable row level security;
alter table public.bundle_courses enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.entitlements enable row level security;
create policy "vit users read live bundles" on public.bundles
  for select using (public.is_vit_user() and status = 'live');
create policy "vit users read live bundle contents" on public.bundle_courses
  for select using (
    public.is_vit_user()
    and exists (select 1 from public.bundles b where b.id = bundle_id and b.status = 'live')
  );
create policy "buyers read own orders" on public.orders for select using (user_id = auth.uid());
create policy "buyers read own order items" on public.order_items
  for select using (exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()));
create policy "buyers read own entitlements" on public.entitlements for select using (user_id = auth.uid());
