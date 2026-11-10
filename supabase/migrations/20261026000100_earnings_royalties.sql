-- ════════════════════════════════════════════════════════════════════════════
-- Earnings per course, and royalties for students whose notes became a course.
--   • orders.paid_at: when the money arrived (royalties count sales from a date).
--   • sale_lines(): one row per paid course sale. A bundle payment is split across its
--     courses by their prices, so every rupee is counted once.
--   • course_royalties: who earns a share of a course's sales, from when, and how much (50%).
--   • royalty_payouts: what the admin has paid each contributor (paid outside the site).
-- Only the server (service role) reads these.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.orders add column if not exists paid_at timestamptz;
update public.orders set paid_at = updated_at where status = 'paid' and paid_at is null;

create or replace function public.stamp_paid_at() returns trigger language plpgsql as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    new.paid_at := coalesce(new.paid_at, now());
  end if;
  return new;
end $$;
drop trigger if exists orders_paid_at on public.orders;
create trigger orders_paid_at before update on public.orders
  for each row execute function public.stamp_paid_at();

create or replace function public.sale_lines()
returns table (order_id uuid, user_id uuid, course_id uuid, paid_at timestamptz, amount_paise bigint)
language sql stable security definer set search_path = public as $$
  select
    o.id,
    o.user_id,
    i.course_id,
    coalesce(o.paid_at, o.updated_at),
    case
      when count(*) over (partition by o.id) = 1 then o.amount_paise::bigint
      else round(
        o.amount_paise::numeric * greatest(c.price_paise, 1)
          / sum(greatest(c.price_paise, 1)) over (partition by o.id)
      )::bigint
    end
  from public.orders o
  join public.order_items i on i.order_id = o.id
  join public.courses c on c.id = i.course_id
  where o.status = 'paid';
$$;
revoke execute on function public.sale_lines() from public, anon, authenticated;

create table if not exists public.course_royalties (
  course_id uuid primary key references public.courses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  share_percent int not null default 50 check (share_percent between 1 and 90),
  since timestamptz not null default now(),
  contribution_id uuid references public.contributions(id) on delete set null,
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists course_royalties_user_idx on public.course_royalties (user_id);
alter table public.course_royalties enable row level security;
revoke all on public.course_royalties from anon, authenticated;

create table if not exists public.royalty_payouts (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount_paise int not null check (amount_paise > 0),
  note text not null default '' check (length(note) <= 300),
  paid_at timestamptz not null default now(),
  recorded_by text not null default ''
);
create index if not exists royalty_payouts_course_idx on public.royalty_payouts (course_id, user_id);
alter table public.royalty_payouts enable row level security;
revoke all on public.royalty_payouts from anon, authenticated;

-- Everything the Earnings screen needs, one row per course, in one query.
create or replace function public.course_earnings()
returns table (
  course_id uuid,
  sales int,
  buyers int,
  revenue_paise bigint,
  last_sale_at timestamptz,
  free_access int,
  reading_now int,
  royalty_sales int,
  royalty_revenue_paise bigint,
  paid_out_paise bigint
) language sql stable security definer set search_path = public as $$
  select
    c.id,
    coalesce(s.sales, 0)::int,
    coalesce(s.buyers, 0)::int,
    coalesce(s.revenue, 0)::bigint,
    s.last_sale_at,
    coalesce(e.free_access, 0)::int,
    coalesce(e.reading_now, 0)::int,
    coalesce(r.sales, 0)::int,
    coalesce(r.revenue, 0)::bigint,
    coalesce(p.paid, 0)::bigint
  from public.courses c
  left join (
    select l.course_id, count(*) as sales, count(distinct l.user_id) as buyers,
           sum(l.amount_paise) as revenue, max(l.paid_at) as last_sale_at
      from public.sale_lines() l group by l.course_id
  ) s on s.course_id = c.id
  left join (
    select en.course_id,
           count(*) filter (where en.granted_by = 'admin' and en.revoked_at is null) as free_access,
           count(*) filter (where en.revoked_at is null and (en.expires_at is null or en.expires_at > now())) as reading_now
      from public.entitlements en group by en.course_id
  ) e on e.course_id = c.id
  left join public.course_royalties cr on cr.course_id = c.id
  left join lateral (
    select count(*) as sales, sum(l.amount_paise) as revenue
      from public.sale_lines() l
     where l.course_id = c.id and cr.course_id is not null and l.paid_at >= cr.since
  ) r on true
  left join lateral (
    select sum(rp.amount_paise) as paid
      from public.royalty_payouts rp
     where rp.course_id = c.id and rp.user_id = cr.user_id
  ) p on true;
$$;
revoke execute on function public.course_earnings() from public, anon, authenticated;

create or replace function public.paid_totals()
returns table (orders int, buyers int) language sql stable security definer set search_path = public as $$
  select count(*)::int, count(distinct user_id)::int from public.orders where status = 'paid';
$$;
revoke execute on function public.paid_totals() from public, anon, authenticated;
