-- ════════════════════════════════════════════════════════════════════════════
-- Help desk: students ask a question or report what's wrong (with screenshots), and the
-- admin answers from Admin → Queries. Screenshots live in R2 under support/<user>/<id>/.
-- Only the server (service role) reads or writes these tables.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.support_queries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  topic text not null check (topic in ('feature', 'notes', 'payment', 'contribute', 'account', 'other')),
  subject text not null check (length(subject) between 3 and 140),
  page text not null default '' check (length(page) <= 300),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  files jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_queries_user_idx on public.support_queries (user_id, created_at desc);
create index if not exists support_queries_status_idx on public.support_queries (status, updated_at desc);
alter table public.support_queries enable row level security;
revoke all on public.support_queries from anon, authenticated;

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  query_id uuid not null references public.support_queries(id) on delete cascade,
  from_admin boolean not null default false,
  author text not null default '',
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists support_messages_query_idx on public.support_messages (query_id, created_at);
alter table public.support_messages enable row level security;
revoke all on public.support_messages from anon, authenticated;
