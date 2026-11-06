-- ════════════════════════════════════════════════════════════════════════════
-- Recommended books per course: a name, an optional author and a link, chosen by an admin.
-- Only the link is kept, so publishers' textbooks never need to sit in the notes bucket.
-- Read and written by the server only (service role); students get them inside the course page.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.course_books (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses(id) on delete cascade,
  title       text not null check (length(title) between 2 and 200),
  author      text not null default '' check (length(author) <= 120),
  url         text not null check (length(url) <= 500 and url ~* '^https?://'),
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists course_books_course_idx on public.course_books (course_id, sort);

drop trigger if exists course_books_updated_at on public.course_books;
create trigger course_books_updated_at before update on public.course_books
  for each row execute function public.set_updated_at();

alter table public.course_books enable row level security; -- server only

comment on table public.course_books is
  'Recommended books per course (name, author, link). Shown on the course page; no files.';
