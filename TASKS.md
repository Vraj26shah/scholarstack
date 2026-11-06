# Scholars Stack — build plan and status

Status as of 23 Oct 2026 (v0.7.0). **Me** = built here. **You** = an account step from SETUP.md.
Everything marked done is covered by an automated test (see QA_REPORT.md).

## Done
- [x] 0.24.0 · Courses offered to many batches and branches (course list + filing + admin choice), Course list view, Emails bulk delete, smooth Inbox, per-line marker lines, calmer doodles
- [ ] 0.24.0 · **You:** run supabase/apply-all.sql (adds courses.offered_to); make sure each course has its course code so the list can place it
- [x] 0.23.0 · Readable watermark with identity bands; Clean-up for R2 + Supabase (off-sale courses, missing files, orphan pages/uploads, unpaid checkouts); Folders scoped to drive-imports/; badges clear on open; uploads name the exact file/folder over a limit; Contribute layout and earnings explainer
- [ ] 0.23.0 · **You:** check Storage → Clean-up once before deleting anything
- [x] 0.22.0 · Admin keeps its storage connection after changes (page-image count served while re-read in the background; conversion progress no longer clears it; failed refreshes keep the screen); any folder → a course or into a course in one step; Courses filters (year, branch, ready, attention) and bulk publish/unpublish/archive/price; bulk close/delete in Questions and bulk delete in Uploads; full-screen reader fit with no flicker and round zoom steps; robots.txt and web manifest
- [x] 0.21.0 · No more semester picker: admins stop choosing a semester anywhere (import, course details, folder-to-course); the server works it out from the folder path or defaults it, and every student-facing label (card call number, shelf spine) shows year and branch instead. Added BBA (Bachelor of Business Administration) from the Winter 2026-27 FFCS course list, with its 23 official courses. Folders and Page jobs now share one state engine: the same working/queued/paused/stalled/stuck labels, colours and progress bar, and the per-folder view got Start/Pause/Resume/Delete to match Page jobs exactly.
- [ ] 0.21.0 · **You:** the PDF listed five more new programme codes (BET, MEI, MIP, MIB, MSI) without a confirmed official name — add them yourself in Admin → Courses → Years & branches whenever you're sure of the right name; nothing guesses at these.
- [x] 0.19.3 · Convert workflow fixed (pnpm version, missing secrets skip with a summary), stuck page maker shown on Today, shorter admin copy, every admin list refreshes after any change
- [x] 0.19.2 · All VIT Bhopal B.Tech programmes, Students as a CRM (courses, uploads, questions per person), even shelf, uploads inside the upload card
- [ ] 0.19.2 · **You:** check the new programme codes in Courses → Years & branches against real student emails
- [x] 0.19.1 · Own programme only for placed students (code from admin), search hint, course page: small details · Modules | Peek inside · wide buy bar, light by default, even Contribute page, all admin sections verified
- [x] 0.19.0 · Drawer from the college email, sign-in code entry, email health check, Brevo IP block found (switch off in Brevo), B.Tech CSE name, straight cards, contributor wording, high-contrast phone tab bar, compact course page
- [ ] 0.19.0 · **You:** Brevo → Security → Authorized IPs → deactivate for API and SMTP; add {{ .Token }} to the Supabase Magic Link and Confirm signup emails; send from your own domain
- [x] 0.18.6 · Original faint, slow background drawings; catalogue-card toolbox (no badges); plain bundle wording; whole-subject ZIPs filed unit by unit with the 30% royalty preselected
- [x] 0.18.5 · Admin 503s fixed (shared one-minute bucket listing, page images counted not kept), step-by-step Check & publish (storage → real documents → every page saved → details → publish; enforced on the server), Folders shows Not used / Not on sale by folder with Delete all and multi-delete from the bucket root, branch swipe in the drawer (then on to Shelf), admin tab rows swipe the section
- [x] 0.18.0 · ZIP-only uploads with a live whole-subject layout check (30%), Folders replaces Make pages and Full check (pick up changes, pages at any level, drag to move), Give access inside Students (+ bulk changes), phone swipe between tabs and admin sections, reader fits the screen on open, plain tool headings, phone doodles, faster converter (3 at a time, LibreOffice only when needed)
- [x] 0.17.0 · Admin redesign: counts that clear, course workspace (files & pages with progress, chosen free-preview pages, details, books), drive-like Folders, bundles delete/search, Students directory with reasons, Money (fees, profit, bundles, perks), email/tool delete and send-to-the-rest, scoped clean-up, custom timetable colours; 30% royalty, free grants excluded, .pdf/.ppt/.doc/.zip uploads, 48h shelf grace, one email per bundle, daily DB trimming
- [ ] 0.17.0 · **You:** apply migrations 20261031000100–000500 (`pnpm ops db:apply` with a fresh SUPABASE_ACCESS_TOKEN), then deploy
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
- [x] 0.13.0: admin Today screen, plain section names, live courses stay on sale when edited, crash page, simpler course cards and clean-up
- [x] 0.14.0: upload pipeline (check, file into our layout, reward, pages, done), contributor tracking, timetable rebuilt with PDF, print, calendar and share links
- [x] 0.16.0: converter queue can't stall, swipe to turn pages on phones, managed recommended books, year/branch dropdowns, single-query catalogue with 20 s cache cleared by admin edits, visible home animation, partner programme Earn page, royalty after payment fee, capped yearly bonus
- [x] 0.15.0: per-file filing, move/rename stored notes keeping pages, unused storage by kind, admin previews of drafts, Earn on phones, plainer Contribute page, upload and zip hardening
- [x] 0.20.0: **Page jobs** admin screen — every file making pages across every course, one place, with start/pause/resume/delete per file or in bulk, a live progress bar, and a one-click storage re-check so it's never stale

## Waiting on you (SETUP.md)
- [ ] Set the GitHub secret `CONVERTER_CALLBACK_URL` to the public `https://<site>/api/internal/conversion` (not localhost) so production progress bars move

- [ ] **You** Steps 0–7: GitHub repo, Supabase, Cloudflare (R2 bucket, Turnstile, Workers Paid), Google OAuth, Brevo SMTP, Razorpay test keys, generated secrets
- [ ] **You** Step 9: GitHub secrets/variables + `pnpm secrets:push`
- [ ] **You** Admin → Courses → Add courses: tick the `23 Batch` course folders, set branch/semester/price, import; check previews; publish
- [ ] **You** Admin → Bundles: "Add every live 2023 course" → price it → live
- [x] Migrations `20261027000100`, `20261027000200` and `20261028000100_course_books.sql` applied to the live database (31 Oct)
- [ ] **You** Commit and push 0.16.0 (the converter fix runs from GitHub only once pushed), then deploy the site
- [ ] **You** Run `pnpm github:secrets` so `CONVERTER_CALLBACK_URL` in GitHub is the live https address (the `.env` one is localhost)
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
