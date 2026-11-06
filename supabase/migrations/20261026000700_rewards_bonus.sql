-- ════════════════════════════════════════════════════════════════════════════
-- 1. Cash rewards for contributions: when you've paid one, mark it paid (it shows as owed
--    in Earnings until then, and the student sees "paid" on their Contribute page).
-- 2. Yearly top-contributor bonus: the contributor whose notes sold most in the last
--    12 months gets what they earned again. contributor_bonuses records each payment.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.contributions add column if not exists reward_paid_at timestamptz;
alter table public.contributions add column if not exists reward_paid_note text not null default ''
  check (length(reward_paid_note) <= 300);

create table if not exists public.contributor_bonuses (
  user_id uuid not null references public.profiles(id) on delete cascade,
  year int not null check (year between 2025 and 2100),
  amount_paise int not null check (amount_paise > 0),
  note text not null default '' check (length(note) <= 300),
  paid_at timestamptz not null default now(),
  recorded_by text not null default '',
  primary key (user_id, year)
);
alter table public.contributor_bonuses enable row level security;
revoke all on public.contributor_bonuses from anon, authenticated;

-- Royalty sales and revenue per contributor and course since a moment (counting each course
-- only from when its royalty began).
create or replace function public.royalty_earnings_since(p_since timestamptz)
returns table (user_id uuid, course_id uuid, share_percent int, sales int, revenue_paise bigint)
language sql stable security definer set search_path = public as $$
  select cr.user_id, cr.course_id, cr.share_percent, count(l.*)::int, coalesce(sum(l.amount_paise), 0)::bigint
    from public.course_royalties cr
    left join public.sale_lines() l
      on l.course_id = cr.course_id and l.paid_at >= greatest(cr.since, p_since)
   group by cr.user_id, cr.course_id, cr.share_percent;
$$;
revoke execute on function public.royalty_earnings_since(timestamptz) from public, anon, authenticated;
