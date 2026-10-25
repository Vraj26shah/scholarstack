# Scholars Stack — build plan and status

Status as of 23 Oct 2026 (v0.7.0). **Me** = built here. **You** = an account step from SETUP.md.
Everything marked done is covered by an automated test (see QA_REPORT.md).

## Done
- [x] 0.7.0 · Security review: viewer token bound to its reader, rate limits on checkout/profile/devices/unsubscribe, 32+ char secrets enforced, 55 security tests, 0 dependency vulnerabilities, SECURITY.md
- [x] 0.7.0 · Reader: background page assembly, spinner only when slow, bounded page memory, one-row desktop toolbar
- [x] 0.7.0 · Admin holds up with 5,000+ files (deferred search, stated result counts); `DEMO_BULK` load test
- [x] 0.7.0 · Homepage motion: scroll-triggered markers, stamp thuds, pencil underline, shuffle pauses when unseen; 0 idle layouts, CLS 0.023
- [x] 0.6.0 · Reader Contents panel (all modules, in full screen too), up-next card, gentler wheel zoom; hide-nothing admin; faster loading
- [x] 0.5.0 · Flexible admin scopes: everything, folders, single files or a mix; publish independent of conversion
- [x] 0.4.0 · Admin as a 5-step workflow (check storage → add courses → make pages → publish → sell)
- [x] 0.4.0 · R2 vs Supabase comparison, plus "make website match R2" (R2 is the source of truth)
- [x] 0.4.0 · Converting a course, a unit or chosen files, with a live progress bar per file
- [x] 0.4.0 · Converter renders 8 pages at a time (memory stays flat); progress is throttled and best-effort
- [x] 0.4.0 · Fixed: syncing one folder deleted sibling files' pages

- [x] **Me** pnpm monorepo (`apps/web`, `apps/api`, `packages/contracts`, `converter`), Biome, strict TypeScript
- [x] **Me** `pnpm env:sync`, `pnpm secrets:push`, `.env.example` matching what the code reads
- [x] **Me** Database: catalogue, accounts, commerce migrations; RLS; `hook_vit_only`; `grant_order` / `revoke_by_payment` / `log_pages`; `pnpm db:verify`
- [x] **Me** API (Hono on a Cloudflare Worker), ports-and-adapters layout, `/api/health`
- [x] **Me** College-only sign in (DB hook + Worker check + UI), Google + 6-digit code, Turnstile
- [x] **Me** Anti-sharing: one live session, signed device cookie, 2 devices, 7-day swap cooldown, "card in use elsewhere" sheet
- [x] **Me** Razorpay orders, checkout signature check, webhook (`payment.captured`, `payment.failed`, `payment.dispute.lost`), idempotent grants
- [x] **Me** Converter: LibreOffice → PDF → pdftoppm → 8×8 tile shuffle → WebP → R2 → signed callback; GitHub workflow
- [x] **Me** Protected reader: lease, 2-minute viewer token, per-page seed header, canvas reassembly, watermark, 40/min + 600/day limits, idle/blur veil, print/save blocked
- [x] **Me** Web: home catalogue (drawers, branch tabs, index cards), course page, checkout, shelf, reader, account, admin, terms/privacy/contact, 404, light/dark
- [x] **Me** Demo mode (`pnpm dev:demo`) — whole product with no external accounts
- [x] **Me** CI (lint, typecheck, unit, DB, e2e), deploy (staging/production), nightly DB backup, keep-alive cron
- [x] **Me** 28 Playwright journeys on desktop + phone, 46 unit/API tests

### 0.2.0 (20 Oct 2026)

- [x] **Me** Admin **Import** from `scholarstack/drive-imports/`: browse the tree, tick folders, file them under batch/branch/semester/price; Drive-style unit names understood; rescan
- [x] **Me** Six programme catalogue, course-code branch suggestions, multi-programme/year assignments, auto-refreshing R2 folder discovery, and draft-only-until-published visibility
- [x] **Me** **Bundles** with discounts (e.g. whole 23 Batch): bundle cards in drawers, bundle page, owned-course price adjustment, dispute revokes all
- [x] **Me** **First-page previews** of every unit (converter writes a watermarked page 1; public, cached; lightbox on the course page)
- [x] **Me** **Toolbox** (CGPA calculator, timetable maker as "coming soon") + **announcement emails** via Brevo with daily cap, hourly resume, one-click unsubscribe, account opt-out
- [x] **Me** New logo and favicon, legible stacked type, animations (letter drop, card shuffle, stamp thud, dealt cards, tilt), marigold "buy/save" colour
- [x] 0.12.0: sign-in check (college or admin list) with 24-hour network block; 3 months of access per purchase with countdown and end email; give access by email before sign-up; per-batch email counts; course update emails; cash rewards and yearly top-contributor bonus; one set of site labels

## Waiting on you (SETUP.md)
- [ ] Set the GitHub secret `CONVERTER_CALLBACK_URL` to the public `https://<site>/api/internal/conversion` (not localhost) so production progress bars move

- [ ] **You** Steps 0–7: GitHub repo, Supabase, Cloudflare (R2 bucket, Turnstile, Workers Paid), Google OAuth, Brevo SMTP, Razorpay test keys, generated secrets
- [ ] **You** Step 9: GitHub secrets/variables + `pnpm secrets:push`
- [ ] **You** Admin → Import: tick the `23 Batch` course folders, set branch/semester/price, import; check previews; publish
- [ ] **You** Admin → Bundles: "Add every live 2023 course" → price it → live
- [ ] **You** Apply migrations 0500–0700 (`pnpm ops db:apply`) before deploying 0.12.0
- [ ] **You** Brevo API key + verified sender (`BREVO_API_KEY`, `EMAIL_FROM`)
- [ ] **You** Replace `[YOUR CONTACT EMAIL]` in `apps/web/src/features/legal/legal-pages.tsx` (Razorpay KYC needs a reachable contact)
- [ ] **You** Domain, attach to the Worker, switch Razorpay to live keys

## After the first real deploy (needs live services, can't be tested in demo)

- [ ] **Me** Smoke test on staging: real Google sign-in, real OTP mail, Razorpay test payment + webhook, real PPT conversion (~1 h)
- [ ] **Me** Load test 2,500 concurrent readers on staging with k6 (~2 h)
- [ ] **Me** Error monitoring (Sentry) for web + Worker (~1 h)
- [ ] **Me** Full WCAG 2.1 AA audit with a screen reader (~2 h); automated checks pass today
- [ ] **Me** Build the CGPA calculator and timetable maker screens (registry slot is ready: `features/tools/registry.ts`) (~1 day each)
- [ ] **Me** Onboarding fields (registration number, batch, branch) if you want them on the watermark (~2 h)
