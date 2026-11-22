-- ════════════════════════════════════════════════════════════════════════════
-- Welcome promo codes (NEW10 and the like)
--
-- A promo code can be kept for students who have never paid for anything. It works on their
-- first paid order, of any course or bundle the code covers, and together with
-- once_per_student it can be used only once.
--
-- Safe to run more than once, and safe while the previous release is still serving: the column
-- is additive with a default of false, so every existing code behaves exactly as before.
-- Rollback: alter table public.promo_codes drop column new_students_only;
--           drop index public.orders_user_paid_idx;
-- ════════════════════════════════════════════════════════════════════════════

alter table public.promo_codes
  add column if not exists new_students_only boolean not null default false;

comment on column public.promo_codes.new_students_only is
  'Only for a student with no paid order yet (a first-purchase / welcome code). Checked by the API at the slip and again when checkout starts.';

-- "Has this student ever paid?" is asked on every Apply of a welcome code: one index lookup.
create index if not exists orders_user_paid_idx on public.orders (user_id) where status = 'paid';

-- promo_codes keeps row level security on with no student access (20261116000100): students
-- never read codes directly, only through the API, so a welcome code can't be listed or guessed
-- from the browser.
