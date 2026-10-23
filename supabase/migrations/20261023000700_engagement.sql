-- ════════════════════════════════════════════════════════════════════════════
-- 0700 · Engagement: the free toolbox and feature-announcement emails.
-- ════════════════════════════════════════════════════════════════════════════

create table public.features (
  key         text primary key check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title       text not null check (length(title) between 2 and 60),
  blurb       text not null default '' check (length(blurb) <= 200),
  status      text not null default 'soon' check (status in ('soon', 'live', 'hidden')),
  sort        int not null default 0,
  launched_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger features_updated_at before update on public.features
  for each row execute function public.set_updated_at();
create trigger features_audit after insert or update or delete on public.features
  for each row execute function public.audit_row('key');

create or replace function public.stamp_launched_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'live' and new.launched_at is null then
    new.launched_at := now();
  end if;
  return new;
end $$;
create trigger features_launched_at before insert or update of status on public.features
  for each row execute function public.stamp_launched_at();
comment on table public.features is 'Free tools on the home page (/tools/<key>). Open to everyone.';

create table public.announcements (
  id           uuid primary key default gen_random_uuid(),
  subject      text not null check (length(subject) between 3 and 140),
  heading      text not null,
  body         text not null,
  cta_label    text not null default '',
  cta_url      text not null default '',
  feature_key  text references public.features(key) on update cascade on delete set null,
  status       text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'failed')),
  recipients   int not null default 0 check (recipients >= 0),
  sent         int not null default 0 check (sent >= 0),
  -- Last profile id already mailed: sending resumes after it (daily quota, retries).
  cursor_id    uuid,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  sent_at      timestamptz
);
create index announcements_sending_idx on public.announcements (created_at) where status = 'sending';
create trigger announcements_updated_at before update on public.announcements
  for each row execute function public.set_updated_at();

-- Emails sent per day across all announcements (provider's daily cap).
create table public.email_quota (
  day   date primary key,
  sent  int not null default 0 check (sent >= 0)
);

create or replace function public.add_email_quota(p_day date, p_count int)
returns int language plpgsql security definer set search_path = public as $$
declare
  total int;
begin
  insert into public.email_quota (day, sent) values (p_day, p_count)
  on conflict (day) do update set sent = public.email_quota.sent + excluded.sent
  returning sent into total;
  return total;
end $$;
revoke execute on function public.add_email_quota(date, int) from public, anon, authenticated;

alter table public.features enable row level security;
alter table public.announcements enable row level security; -- server only
alter table public.email_quota enable row level security;   -- server only
create policy "anyone reads visible features" on public.features for select using (status <> 'hidden');
