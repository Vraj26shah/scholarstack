-- ════════════════════════════════════════════════════════════════════════════
-- The admin's reason for the last change to a student's access (block, restore, end, renew),
-- shown to the student on their shelf and in the email, and to admins in Students.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.entitlements add column if not exists admin_note text
  check (admin_note is null or length(admin_note) <= 300);
alter table public.entitlements add column if not exists admin_note_at timestamptz;
