-- ════════════════════════════════════════════════════════════════════════════
-- Partner terms from 31 Oct 2026: a whole-subject royalty is 30% (of what each sale brings in
-- after the payment fee). Only the default changes; royalties already agreed keep their share.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.course_royalties alter column share_percent set default 30;
