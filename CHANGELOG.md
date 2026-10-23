# Changelog

All notable changes. Versions follow [Semantic Versioning](https://semver.org).

## [0.3.1] — 2026-10-21

Live QA against the real Supabase project and R2 bucket.

### Fixed
- **Security headers on the website.** Cloudflare serves pages straight from static assets (the Worker only runs for `/api/*`), so the CSP, no-framing and referrer headers were never sent with the HTML. They now ship in `apps/web/public/_headers`, kept in sync with the Worker by a test, and HSTS was added. API responses also send `x-frame-options`, `referrer-policy` and HSTS.
- **Odd course addresses no longer cause server errors.** Slugs and unit keys are validated before they reach the database; a slug like `' or 1=1--` is now a plain "not found" (Supabase's firewall was blocking it, which surfaced as a 500). Upstream error text in logs is capped.
- **`.pps` / `.ppsx` slideshows convert** (the importer accepted them, the converter didn't).
- **Converter speed.** Pages are scrambled and uploaded six at a time, two files at once, and page-one previews come first.

### Added
- **Broken R2 copies are detected.** 129 of the 439 files under `drive-imports/` are Google sign-in pages saved instead of the notes (the Drive export hit a login). The converter now checks what each file really is, and a broken file is kept off the site with "Needs a new copy" in Admin → Files, so the rest of its course can still be published. Uploading a good copy over the same name brings it back on the next rescan. `pnpm ops broken` lists them.
- **Recommended books.** Reference books and textbooks found in a course folder are listed on its page by title, with a "Find a copy" link (Open Library). The files themselves are never served.
- **`pnpm ops qa`**: 70+ live checks covering database integrity, R2 ↔ database consistency, what the public key and outsiders can reach, admin edits with audit, path traversal, a real Razorpay test order with a signed webhook, and the protected reader. It uses throwaway accounts and cleans up after itself.

## [0.3.0] — 2026-10-21

Database redesign and live wiring to Supabase and the R2 bucket.

### Changed
- **Database rebuilt as one clean baseline** (nothing had been applied to Supabase yet): nine migrations by area: foundation, academic, content, accounts, commerce, reading, engagement, reporting, reference data. See DATABASE.md.
  - Programmes have their own table, and a `subjects` table holds course codes. The curriculum is a real join table (`programme_subjects`), replacing a text array.
  - A course's subject folders become rows in `course_units`, with a kind: module, pyq, syllabus, lab, revision, notes, reference, other.
  - Orders record what they grant in `order_items`, written atomically by `create_order`.
  - Every admin-managed change is written to `audit_log`, and every `updated_at` is set by trigger.
  - New reporting views: `course_overview` and `sales_daily`.
- **Importer fitted to the real bucket.**
  - `Subject Name (CODE)` folders give the title and code, and pre-select programmes.
  - Units are sorted modules → revision → PYQs → lab → syllabus → notes.
  - PPS/PPSX files are accepted.
- `GITHUB_REPO` accepts the full GitHub URL.

### Added
- **Reference books and textbooks kept off the site.**
  - "Reference Books" folders, and files that look like publishers' textbooks (z-lib, "edition", Grewal, Kreyszig…), are imported hidden: never listed, previewed, sold or converted.
  - Admin → Courses → **Files** shows every unit and file with a Show/Hide switch. Showing something converts it, and a live course waits as a draft until it's ready.
- **`pnpm ops`**, operations against your real Supabase and R2:
  - `check` tests every connection.
  - `db:apply` runs the migrations over HTTPS and sets the sign-up hook and session rules.
  - `db:bundle` writes `supabase/apply-all.sql` to paste into the SQL Editor.
  - `import`, `convert`, `publish`, `status` and `serve` run the live site locally. `convert` runs the page converter on this machine.
- The database checks grew from 24 to 55, including the paste-in file applied twice.

## [0.2.2] — 2026-10-21

Same design as 0.2.x, made calmer and more polished.

### Changed
- The rubber stamps stay: "PAGE 1" on the home hero, the price on the course page, the saving on the bundle page, and the three steps in "How it works".
- "Better together" on the course page is now a proper card, replacing the dashed box. It has a marigold edge, a "Save 39%" pill, the bundle price with its list price struck through, and the whole card links to the bundle.
- Less decoration: no tilted cards, price tags, receipts or slips, and no 3D pointer tilt. The bundle ribbon is now a thin marigold edge with no bow. "How it works" uses plain numbered steps. The footer is a quiet sign-off instead of a giant word.
- The stacked word ("stacked.", "drawer.") now has one soft sheet behind it instead of two hard ones. Its letters rise and sharpen into place.
- Motion uses one easing curve and short, consistent durations: reveals, dealt cards, hover lifts (mouse only) and the hero card shuffle. The idle float is removed. Everything still switches off for reduced motion.

### Added
- Admin → Tools & email → **Add a tool**: creates a new tool as "Coming soon" with no SQL needed (`POST /api/admin/features`).
- LAUNCH_GUIDE: "Adding a new tool", covering where it appears and how to announce it.

## [0.2.1] — 2026-10-21

Keeps the 0.2.0 design; refinements only.

### Changed
- New logo and favicon: an S built from three stacked slabs with a marigold bookmark. Reads clearly from 16 px up, in white on the blue hero and near-white in dark mode.
- Dark mode moved from saturated navy to a calm charcoal with a hint of blue; blue panels stay Ink Blue with a hairline edge so they read as raised.
- Smoother motion: smaller drops, gentler stamps and dealt cards, a slower idle float.
- Page-one previews show a loading skeleton and fade in when ready. A preview still being prepared is retried once, and never shows a broken image.

### Added
- Course cards and bundles now carry their page-one cover in the API (`previewFileId`, `coverFileIds`), ready for thumbnails.
- LAUNCH_GUIDE.md: deploy, import, payments, email deliverability, go-live and announcements, step by step.

## [0.2.0] — 2026-10-20

### Added
- Admin **Import**: browse `drive-imports/` in the `scholarstack` bucket, pick which folders become courses, set batch, branch, semester and price per folder (or for all at once). Unit names like "Module 2 - SQL", "Unit-3 Firewalls", "02. Transactions" are parsed and ordered; loose files go under "Notes"; junk files are ignored. Re-importing updates instead of duplicating.
- **Bundles**: several courses at a discount, shown as a ribboned box in each batch drawer, on course pages ("Better together") and on their own page. Buyers who already own some courses pay a proportional price and only get the rest. A lost dispute revokes every course in the bundle.
- **First-page previews**: the converter now writes an unscrambled, "PREVIEW"-stamped page 1 for every file; the course page shows page one of each unit in a strip and a full-screen viewer, without sign-in.
- **Toolbox**: a free-tools section on the home page and `/tools/:key` pages, driven from the database (CGPA calculator and timetable maker start as "coming soon").
- **Announcements**: compose, preview, test and send emails to every signed-in student via Brevo; resumable sends with a daily cap and an hourly cron; one-click unsubscribe; email toggle in Account.
- Admin is split into Import, Courses, Bundles and Tools & email tabs; courses can be edited, unpublished and archived.

### Changed
- New logo and favicon (stacked cards, S monogram, bookmark).
- The "stacked." type now uses solid offset sheets instead of outlines, so it reads clearly on light and dark.
- Colour roles: marigold only for buying and savings; prices in calm ink instead of red; blush kept for errors.
- Motion: letters drop onto the headline, hero cards shuffle, stamps land, cards are dealt into drawers and tilt under the pointer, sections rise in on scroll. All of it turns off with reduced-motion.
- "All branches" courses now appear in every branch tab of their batch, not only for first years.
- R2 binding points at the `scholarstack` bucket; cron runs hourly.

### Fixed
- Signing out no longer clears public data mid-load (the toolbox and bundles could get stuck loading).
- Admin course rows wrap on phones instead of overlapping their buttons.

## [0.1.0] — 2026-10-20

First complete build. Not yet committed or deployed.

### Added
- Catalogue: batch-year drawers, branch tabs, index cards with call numbers and price stamps; course pages that show every unit, file name, format and page count before purchase.
- College-only sign in (`@vitbhopal.ac.in`) enforced in the database hook, RLS and the Worker; Google and 6-digit email code; Turnstile.
- Session rules: one live session per account, two registered devices, 7-day cooldown after removing one, signed HttpOnly device cookie, refresh-token reuse detection.
- Razorpay checkout with server-side signature checks, webhook handling for captured, failed and lost-dispute payments, idempotent course grants. All sales final.
- Page converter (GitHub Actions): PDF/PPT/DOC/images → scrambled WebP pages in R2.
- Protected reader: viewer lease (one reader at a time), 2-minute viewer tokens, scrambled tiles reassembled on canvas, per-reader watermark baked into pixels, 40 pages/min and 600/day limits, `no-store`, CSP, print block, idle veil, keyboard navigation, zoom, resume where you left off.
- Shelf with book spines and a "continue reading" bookmark; account page with devices; admin page to sync R2 folders, watch conversion and publish with a price.
- Terms (all sales final, personal accounts, watermarking), Privacy and Contact pages.
- Light and dark themes, phone tab bar, offline banner.
- Demo mode: the full product with an in-memory API, test logins and simulated payments.
- Tooling: `env:sync`, `secrets:push`, `db:verify` (PGlite), CI, deploy, converter and nightly backup workflows.
- Tests: 9 contracts, 29 API, 3 converter, 5 web unit, 28 Playwright end-to-end (desktop + phone).
