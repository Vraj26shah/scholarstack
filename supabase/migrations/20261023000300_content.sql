-- ════════════════════════════════════════════════════════════════════════════
-- 0300 · Content: what we sell and what the reader shows
--   courses            one R2 folder (drive-imports/23 Batch/DBMS (CSE3001)/)
--   course_programmes  which programme tabs a course appears under
--   course_units       its sub-folders (Module 1, PYQs, Syllabus, Reference Books…)
--   course_files       every file, its conversion state and page-one preview
--   file_pages         converted page images + secret tile seeds (server only)
-- ════════════════════════════════════════════════════════════════════════════

create table public.courses (
  id                      uuid primary key default gen_random_uuid(),
  slug                    text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title                   text not null check (length(title) between 2 and 120),
  description             text not null default '',
  subject_code            text references public.subjects(code) on update cascade on delete set null,
  batch_year              int not null references public.batches(year) on update cascade,
  -- The programme used in call numbers and URLs; always also in course_programmes.
  primary_programme_slug  text not null references public.programmes(slug) on update cascade,
  semester                int not null check (semester between 1 and 10),
  seq                     int not null default 1 check (seq >= 1),
  r2_prefix               text not null unique check (r2_prefix like '%/'),
  price_paise             int not null default 9900 check (price_paise between 100 and 1000000),
  status                  text not null default 'draft' check (status in ('draft', 'live', 'archived')),
  published_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index courses_batch_status_idx on public.courses (batch_year, status);
create index courses_subject_idx on public.courses (subject_code);
create index courses_primary_programme_idx on public.courses (primary_programme_slug);
create trigger courses_updated_at before update on public.courses
  for each row execute function public.set_updated_at();
create trigger courses_audit after insert or update or delete on public.courses
  for each row execute function public.audit_row('id');
comment on table public.courses is 'A sellable course: one folder in R2. Draft until the admin publishes it.';
comment on column public.courses.r2_prefix is 'Folder in the scholarstack bucket, ending in "/". Source of truth for its files.';

-- Stamp published_at the first time a course goes live.
create or replace function public.stamp_published_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'live' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end $$;
create trigger courses_published_at before insert or update of status on public.courses
  for each row execute function public.stamp_published_at();

-- ── Placement in programme tabs ─────────────────────────────────────────────
create table public.course_programmes (
  course_id       uuid not null references public.courses(id) on delete cascade,
  programme_slug  text not null references public.programmes(slug) on update cascade on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (course_id, programme_slug)
);
create index course_programmes_programme_idx on public.course_programmes (programme_slug, course_id);
comment on table public.course_programmes is 'A course is stored once and listed under every programme here.';

-- The primary programme is always one of the placements.
create or replace function public.keep_primary_programme()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.course_programmes (course_id, programme_slug)
  values (new.id, new.primary_programme_slug)
  on conflict do nothing;
  return new;
end $$;
create trigger courses_primary_programme after insert or update of primary_programme_slug on public.courses
  for each row execute function public.keep_primary_programme();

-- Replace a course's placements in one transaction; the first slug becomes primary.
create or replace function public.set_course_programmes(p_course_id uuid, p_programme_slugs text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(cardinality(p_programme_slugs), 0) < 1 then
    raise exception 'Select at least one programme' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_programme_slugs) s(slug)
    left join public.programmes p on p.slug = s.slug and p.is_active
    where p.slug is null
  ) then
    raise exception 'One or more programmes are unavailable' using errcode = '22023';
  end if;
  update public.courses set primary_programme_slug = p_programme_slugs[1] where id = p_course_id;
  if not found then
    raise exception 'Course not found' using errcode = 'P0002';
  end if;
  delete from public.course_programmes
   where course_id = p_course_id and programme_slug <> all (p_programme_slugs);
  insert into public.course_programmes (course_id, programme_slug)
  select p_course_id, s.slug from unnest(p_programme_slugs) s(slug)
  on conflict do nothing;
end $$;
revoke execute on function public.set_course_programmes(uuid, text[]) from public, anon, authenticated;

-- ── Units: the sub-folders of a course ──────────────────────────────────────
create table public.course_units (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses(id) on delete cascade,
  key         text not null check (key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title       text not null,
  -- What kind of folder this is. "reference" (publishers' textbooks) is hidden by default.
  kind        text not null default 'other'
              check (kind in ('module', 'pyq', 'syllabus', 'lab', 'revision', 'notes', 'reference', 'other')),
  -- Hidden units are never listed, previewed, sold or converted.
  is_hidden   boolean not null default false,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (course_id, key),
  unique (id, course_id) -- target of the composite FK below
);
create trigger course_units_updated_at before update on public.course_units
  for each row execute function public.set_updated_at();
create trigger course_units_audit after update of is_hidden, title, kind on public.course_units
  for each row execute function public.audit_row('id');
comment on table public.course_units is 'Sub-folders of a course: modules, PYQs, syllabus, lab files, reference books.';

-- ── Files ───────────────────────────────────────────────────────────────────
create table public.course_files (
  id                 uuid primary key default gen_random_uuid(),
  course_id          uuid not null,
  unit_id            uuid not null,
  name               text not null,
  format             text not null check (format in ('pdf', 'pptx', 'docx', 'image')),
  size_bytes         bigint not null default 0 check (size_bytes >= 0),
  page_count         int not null default 0 check (page_count >= 0),
  source_key         text not null unique,
  source_etag        text not null default '',
  conversion_status  text not null default 'pending' check (conversion_status in ('pending', 'ready', 'failed')),
  conversion_error   text,
  converted_at       timestamptz,
  -- Watermarked, unscrambled page 1 in R2 (public preview).
  preview_key        text,
  is_hidden          boolean not null default false,
  sort               int not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- The unit must belong to the same course (no cross-course mix-ups).
  foreign key (unit_id, course_id) references public.course_units(id, course_id) on delete cascade
);
create index course_files_course_idx on public.course_files (course_id, sort);
create index course_files_unit_idx on public.course_files (unit_id, sort);
create index course_files_pending_idx on public.course_files (course_id) where conversion_status = 'pending';
create trigger course_files_updated_at before update on public.course_files
  for each row execute function public.set_updated_at();
create trigger course_files_audit after update of is_hidden on public.course_files
  for each row execute function public.audit_row('id');
comment on table public.course_files is 'Every file of a course, mirrored from R2 by the importer.';

-- ── Page images (server only: tile seeds are secret) ────────────────────────
create table public.file_pages (
  file_id     uuid not null references public.course_files(id) on delete cascade,
  page_no     int not null check (page_no >= 1),
  image_key   text not null,
  tile_seed   text not null,
  created_at  timestamptz not null default now(),
  primary key (file_id, page_no)
);
comment on table public.file_pages is 'Scrambled page images in R2 and their tile seeds. No browser policy: server only.';

-- ── Row-level security ──────────────────────────────────────────────────────
alter table public.courses enable row level security;
alter table public.course_programmes enable row level security;
alter table public.course_units enable row level security;
alter table public.course_files enable row level security;
alter table public.file_pages enable row level security;

create policy "vit users read live courses" on public.courses
  for select using (public.is_vit_user() and status = 'live');
create policy "vit users read live placements" on public.course_programmes
  for select using (
    public.is_vit_user()
    and exists (select 1 from public.courses c where c.id = course_id and c.status = 'live')
  );
create policy "vit users read visible units" on public.course_units
  for select using (
    public.is_vit_user() and not is_hidden
    and exists (select 1 from public.courses c where c.id = course_id and c.status = 'live')
  );
create policy "vit users read visible files" on public.course_files
  for select using (
    public.is_vit_user() and not is_hidden
    and exists (select 1 from public.course_units u where u.id = unit_id and not u.is_hidden)
    and exists (select 1 from public.courses c where c.id = course_id and c.status = 'live')
  );
-- file_pages: RLS on, no policy.
