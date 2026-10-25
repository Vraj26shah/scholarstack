# Changelog

All notable changes. Versions follow [Semantic Versioning](https://semver.org).

## [0.12.0] — 2026-10-26

### Added
- **Sign-in check.** Before a link is sent, the address must be an exact @vitbhopal.ac.in address or on the admin list (any domain, Gmail too); admins get the link and an admin session. 5 refused addresses from one network in 24 hours block that network for 24 hours (`signin_strikes`, IP stored as a hash).
- **3 months of access per purchase.** Counted from the purchase day, whatever the course or branch. The course page shows "N days left · yours until <date>"; an email goes out when it ends. Replaces per-course term dates.
- **Give access by email before sign-up** (`pending_grants`): the course is on the student's shelf when they first sign in.
- **Emails per batch.** Every announcement shows sent and still-to-go, in total and per batch year.
- **Course update emails.** New readable files in a live course email that course's current students automatically (hourly). The composer can also target one course's students.
- **Cash rewards** owed and paid (Earnings → Cash rewards, "Mark paid"); students see "paid" or "we'll pay you by UPI soon".
- **Yearly top-contributor bonus**: the contributor with the most royalty earnings in the last 12 months gets the same amount again (`contributor_bonuses`, once per year).
- Course search in Earnings shows "₹X earned from <course>, N sales".
- One set of labels for the whole site (`shared/copy.ts`): "Earn from notes", "Upload your notes", "Help & suggestions" everywhere.
- Contribute page and Terms: royalties last until the course is replaced; the yearly bonus.
- Migrations `0500_access_window_pending_grants`, `0600_signin_guard`, `0700_rewards_bonus`.

### Removed
- Admins list view, term dates card, ending-soon reminder and end dates on the shelf.

## [0.11.0] — 2026-10-26

### Added
- **Who got each email.** Every announcement records each student it reached (`announcement_deliveries`). Admin → Email & tools shows "X of Y got it · the other Z by <date>", a list of everyone (sent when / waiting), and today's room: how many more can go out, and the plan for the next days. Sending goes to every opted-in student who hasn't had it, so students who opt in while it's going out are never skipped (the old cursor could miss them), and nobody gets it twice. A sent email can go again to new opt-ins only ("Send to N new students").
- **Room for personal emails.** 20 emails a day (EMAIL_RESERVE) are kept back from announcements for receipts, answers and reminders. The production limit is 300 a day (EMAIL_DAILY_LIMIT, Brevo's free plan).
- **Term names and reminders.** Admin → Students & money → Access → Term dates now takes a term name ("Sem 3 · Winter 2026", suggested from the semester and date). Students see it with the date on the course page and their shelf, the shelf warns "ends in N days" in the last two weeks, and a reminder email goes a week before access ends (once; again if you change the date).
- **Admins → from GitHub, live in a minute.** The site now reads the admin list from Supabase (cached for a minute) instead of a Worker secret, so changing admins needs no redeploy. Edit the `ADMIN_EMAILS` variable (or secret) in GitHub, then run **Actions → Update admins** (it also runs every 6 hours and on every deploy). Admin → Students & money → Admins shows the current list. Any address works, Gmail included; the sign-in page links to the admin sign-in for non-college admins. The Worker secret is only a fallback when the database list is empty.
- Migration `20261026000400_deliveries_admins_terms.sql`.

## [0.10.0] — 2026-10-26

### Changed
- **Admin in five places instead of twelve tabs:** Notes & courses (R2 → Website, Import, Courses, Bundles, Years & branches), Students & money (Access, Earnings & royalties), Inbox (Questions & suggestions, Uploaded notes), Email & tools, and Storage & health (Files & folders, Clean-up, Problems, Full audit). Counts show where something is waiting. Old links still open the right screen.
- **One line instead of boxes.** Explanations and notices are a single sentence with the key words underlined, for students and in Admin (syllabus note, upload limits, email set-up, empty states).
- **Shorter student pages.** Help and Contribute keep only what's needed; the help topics are a row of chips.
- **Email & tools** puts emails first and says how to announce a tool: press Launch (the email is written for you), or Write an email.

### Added
- **Storage & health → Files & folders.** Every notes file in R2 as a folder tree, each course folder labelled with its course, with sizes, unused files and records whose file is gone from R2. Deleting a folder or a file removes it **completely**: the R2 files, their reader pages, and their Supabase rows (files, page index, reading progress, empty units). A course left with nothing is deleted, or archived if students bought it so the sales history stays. A preview shows exactly what goes, and you type DELETE to confirm.
- **Notes & courses → Years & branches.** Add, hide or remove batch years; add, rename, retire or mark branches as common; move every course of one year (or of one branch in it) to another year in one step.
- **Suggestions.** Students can send a suggestion from the Help page; Admin → Inbox filters questions and suggestions.
- Migration `20261026000300_storage_tree_and_suggestions.sql` (`delete_course_files`, `move_batch_courses`, `batches.is_visible`, the suggestion topic).

## [0.9.0] — 2026-10-26

### Added
- **Earnings per course.** Admin → Earnings & royalties shows, for every course, how many paid orders included it, how many different students bought it, how many have it free, and what it earned. Bundle payments are split between their courses by price, so every rupee is counted once; disputed payments are left out. Totals for the whole site (earned, paid orders, paying students, owed to contributors). Migration `20261026000100_earnings_royalties.sql` (adds `orders.paid_at`, `course_royalties`, `royalty_payouts` and the server-only `sale_lines()`, `course_earnings()` and `paid_totals()` functions).
- **Royalties for contributors.** When a student's notes for a whole subject become a course, give them a royalty (50% by default, 1–90%) from the contribution review or from Earnings by their email. Only sales from that day count. Record each UPI payment; the site refuses to record more than is owed. Contributors see a "What your notes have earned" ledger on the Contribute page: sold, earned, paid and due per course.
- **Help desk.** A new `/help` page where signed-in students ask a question or report what's wrong, choosing a topic and attaching up to 3 screenshots (PNG/JPG/PDF, 5 MB each, checked by contents). Admin → Queries shows each conversation with the student, the page they came from and their screenshots; answers are emailed and the student can reply or close. Limits: 5 open and 5 new a day per student, 40 messages per conversation, rate limited. "Something not working? Tell us" links on tool pages and "Something wrong with these notes?" on course pages open it with the topic and page filled in. Migration `20261026000200_support_queries.sql`.
- **Syllabus notice.** Course pages tell buyers to compare the units with their current syllabus before buying, and the Terms have a "Syllabus changes" section: the university can revise syllabi and differences aren't grounds for a refund.
- **Contributor terms** in the Terms (rights you keep, what we may do, how rewards and the 50% royalty work, UPI payments, removal), linked from the upload form. Privacy and Contact updated for uploads and the help desk.

### Changed
- **Contribute page redesigned** around getting paid: a navy hero with an example royalty statement, a three-rate card (paid for what we use, paid by contribution for full papers or sets, 50% of every sale for a whole subject), how-it-works steps, the upload form as an accession slip, house rules and common questions. The home band and footer say "Earn from your notes".
- Shared building blocks instead of copies: one upload policy module (contributions and screenshots), one file-storing helper with rollback, one student-email sender, one multipart form reader and download response.

## [0.8.2] — 2026-10-25

### Fixed
- **Netbanking and wallets on phones.** Those payments open the bank's page in a popup that, on most phones and inside WhatsApp/Instagram browsers, can't report back, so payments stayed "created" and the student saw Try again. Razorpay now brings the student back to the site with the signed result (`/api/payments/razorpay/return`), which confirms it with Razorpay, grants the course and shows the receipt, or the bank's reason when it failed. Desktop popups work as before. Verified end to end with real Razorpay test payments.
- **No red errors in the console on normal use.** The first page after a sign-in registers the device straight away instead of getting a 409 first. The sign-in security check only loads once the email form is used, so its own (Cloudflare) console messages no longer appear on every visit or with Google sign-in.
- **Tabs left open across a deploy** reload once to the new version instead of failing to load parts of the site.
- **A preview that won't load** shows "Preview isn't available right now" instead of a skeleton forever.
- **Long emails in the toolbox cards** wrap inside the card on every screen size.

### Changed
- **GitHub Actions, short and automatic.** One workflow checks every push in about 3 minutes (lint, types, tests, migrations, bundle) and, on `main`, deploys to Cloudflare by itself: migrations and admin list, build, deploy, then a live check of the site. The full browser suite moved to a run-by-hand workflow. A daily "Keep Supabase awake" check was added, the nightly backup skips quietly when it isn't set up, and the converter polls every 10 minutes. `pnpm github:secrets` copies what Actions needs from `.env` to GitHub.
- **Deploys reach the real site.** The production Worker is now named `scholarstack` (the live `scholarstack.campusnotes.workers.dev`), not `scholars-stack`, which created a second, empty Worker. `ADMIN_EMAILS` and `APP_URL` are only Worker secrets now; listing them as plain variables too made Cloudflare refuse every deploy.
- **Hourly jobs run independently.** The keep-alive read, announcement emails and access-ended emails no longer stop each other when one fails, and failures go to Admin → Problems.
- **Less template, more library.** The buy panel's perks are lines on a borrower slip (ticks, dashed rules) instead of icons in circles; the toolbox tools are catalogue cards (call number, ruled lines, punch hole, a rubber "COMING SOON" stamp) instead of icon tiles with pills; cards tilt a little when picked up instead of floating. Fonts and text styles are unchanged.

### Added
- **Contribute: students share their notes.** A new `/contribute` page (linked in the header, footer and a home-page band) where signed-in students send notes, past papers, slides or lab work: PDF, PowerPoint, Word, ZIP, JPG or PNG, with upload progress. Files go to private R2 storage under `contributions/` and only an admin can download them. Limits against misuse, checked on the server: 5 files and 60 MB per send, 25 MB per file, 3 sends a day, 5 waiting for review at once, files checked by their contents (a renamed script is refused), an "my own work" confirmation, rate limiting, and an admin switch to block a student from sharing. Students see each contribution's status, the reviewer's note and their reward, and can take back one that hasn't been reviewed (migration `20261025000600_contributions.sql`).
- **Admin → Contributions.** Review what students sent: download each file, accept or reject with a note, reward with a free course (granted instantly), cash (paid by you, recorded and announced to the student) or a thank-you, and email the student the decision. Copy accepted files straight into an R2 course folder for R2 → Website. Pause or reopen sharing for everyone, block or allow a student, delete a contribution and its files. Contributions never appear as "unused" in the Storage map.
- **Tools rebuilt into `features/tools/` with SOLID structure.** CGPA calculator (semester GPA, overall CGPA, "what do I need next"), a new **attendance calculator** (VIT 75% rule, attendance marks, classes you can miss or must attend, saved subjects) and the **timetable maker** (VIT slot grid, clash warnings, colours, PNG download and print). Each tool is a module in one registry; rules live in pure, tested `domain.ts` files; saving and exporting go through small interfaces (`ToolStore`, `TimetableExporter`) so new storage or export formats plug in without touching the screens. Everything saves on the student's own device (migration `20261025000500_attendance_tool.sql` adds the attendance tool as "coming soon").
- **Admin → Problems.** What went wrong for students and on the server, grouped with counts, device and page: crashed pages, previews or reader pages that wouldn't load, payment windows or sign-in checks blocked by the browser, Razorpay refusing a payment, server errors. Personal details are removed before saving. Mark as fixed or clear. Students never see it (migration `20261025000100_problem_reports.sql`).
- **Admin → Storage map.** Every folder of uploaded notes in R2 with its course, size and unused files; generated page folders whose file no longer exists; every Supabase table with what it holds, rows and size. Delete unused notes files, unused page folders, or checkouts that were never paid (older than 30 days), each after typing DELETE; the server re-checks before deleting and never touches anything in use or any paid order (migration `20261025000200_storage_map.sql`).
- **Ad-blocker help.** When a blocker stops the payment window or the sign-in check, students get plain steps (pause the blocker for this site, Brave Shields, open outside WhatsApp/Instagram) instead of an error.
- **Netbanking and UPI payments are confirmed properly (backend).**
  - The course is granted only once the money is captured. A payment that is approved but not yet captured (common for netbanking/UPI) is captured by the site first, so it is never refunded back to the student after they got the course.
  - A bank that is slow to confirm no longer strands the student: the order check asks Razorpay directly whether any attempt succeeded, so a closed tab, a slow netbanking redirect or a missing webhook still ends with the course on the shelf.
  - A failed first attempt followed by a successful retry (another bank, UPI app or card) on the same order ends paid.
  - New webhook events handled: `payment.authorized` (captured, then granted) and `order.paid`.
  - Razorpay calls time out after 8 seconds and retry once on a network blip; if Razorpay is unreachable, a student who paid is told it is still confirming, never that it failed.
  - The Razorpay window lists UPI, netbanking, cards and wallets.
- **Payment result window.** When a purchase doesn't finish, a clear window (bottom sheet on phones) says what happened and whether money moved: "Payment didn't go through" with the bank's reason, "Payments are paused" when the payment window can't open, or "Something went wrong". Each has Try again, Not now and Contact us. Closing the Razorpay window yourself only shows a quiet note.
- **Several admins.** `ADMIN_EMAILS` takes any number of addresses separated by commas (or spaces, semicolons, new lines). Each one can sign in to the admin portal; run `pnpm ops admins:sync` after changing the list.
- **"Your access has ended" email.** Once per ended access, the hourly job emails the student: which courses ended, that their progress is saved, that new courses and cheaper bundles are being filed, and the live free tools. One email per student even when several courses end together. Blocked or disputed access is never emailed. Buying again or an admin extending access re-arms it (migration `20261024000400_access_notices.sql`).
- **"Added to your shelf" email.** Students given a course by an admin get a welcome email with the course, how long it lasts and a Start reading button. The admin's result message says who was emailed.

### Changed
- **Hero copy speaks to both visitors.** Notes first ("seniors who sat the same exams", page one free), then a quiet line for tool-only visitors. Buttons now read "Find your notes" and "Try the free tools".
- **Key phrases are highlighted** with the same hand-drawn marker stroke as the accent words, drawn in when seen: on the hero, How it works, House rules, the toolbox and the course page (access dates, "All sales are final"). One or two per block, in light, dark and on navy.
- **House rule 2 matched to the real limit:** two devices, not one.
- **My shelf keeps ended courses on the shelf.** Ended or paused courses stand as dashed spines labelled ENDED / PAUSED after the active ones, with Buy again in the list below, whether or not the student has other active courses.

## [0.8.1] — 2026-10-24

### Added
- **Give a course by email (admin → Students & access → Give access).**
  - Paste one or more student emails and the course goes onto their shelf without payment, for a scholarship or to fix a payment problem.
  - Choose the course's term end, no end, or a date.
  - Students who have never signed in, and addresses that aren't exact college addresses (a `+tag`, a Gmail, a typo), are listed back to you, never guessed at.
  - Given access is marked "given" in the list, and the database records which admin gave it.
  - New endpoint `POST /admin/access/grant`; new migration `20261024000300_admin_grants.sql`.
- **Back buttons go where you came from.**
  - The reader's Back returns to the course, bundle, shelf or catalogue you opened it from, skipping the other files you flipped through. Opened from a link, it goes to that file's course.
  - The same applies to the checkout's "payment failed" screen and the tool pages.
  - Going back now restores the exact scroll position (for example, the catalogue card you tapped) instead of jumping to the top.
- **Admins on phones** get an "Admin" button next to the profile picture.

### Changed
- **The phone tab bar is docked to the bottom edge**, like a native app, instead of a floating pill that covered content:
  - full width, solid, with a hairline on top;
  - it respects the phone's home-indicator area;
  - the current tab gets a teal line and a bold label.
- **Tabs are now Catalogue, Shelf and Toolbox.** Account is reached from the profile picture in the top bar.

### Verified
- 270 unit and API tests, all database checks (including the new grant rules), and 58 browser tests pass.
- New browser tests cover Back from the reader (from the course page and from the shelf) and the docked tab bar.

## [0.8.0] — 2026-10-24

### Security: the right person, and only them
- **Typing an address proves nothing.** The API now accepts a session only if it was opened by proving the inbox: a Google login or an emailed one-time link or code. Password and anonymous sessions are refused, so no one can sign up with the admin's address (or anyone's) plus a password.
- **One inbox, one account.** College addresses must be exactly `name@vitbhopal.ac.in`, checked the same way in the browser, the API and the database sign-up hook. These are refused:
  - `+tag` aliases;
  - doubled, leading or trailing dots;
  - look-alike (non-English) letters and hidden characters;
  - `…@vitbhopal.ac.in.evil.com` style addresses.
- **Admins are an exact list.**
  - `vitbsmashers@gmail.com` is the admin, and `vraj.23bce11796@vitbhopal.ac.in` is removed.
  - The database keeps its own admin list (`admin_emails`, unreadable by students), read by the sign-up hook in place of a hard-coded address.
  - `pnpm ops admins:sync` copies `ADMIN_EMAILS` into it.
  - Copies such as `vit.bsmashers@gmail.com`, `vitbsmashers+x@gmail.com` or `vitbsmashers@gmail.com.evil.in` are different people and are refused.
- The admin address and the hidden "click the card five times" admin mode are removed from the website's code. The admin portal is `/sign-in?admin=1` (or open `/admin`).
- After sign-in, students and admins return to the page they came from, but only ever to a page on this site.
- Local Supabase now requires confirming an email before sign-in, and `pnpm ops db:apply` sets the same in production.
- New tests: 12 sign-in-trick tests (`apps/api/test/auth.test.ts`), 13 email-rule tests and 9 database sign-up hook checks.

### Added: Students & access (admin)
- **Term dates:**
  - choose a batch and semester (or individual courses) and the date access ends;
  - new purchases get access until then;
  - students who already have the courses change only if you tick "Also apply to students who already have these courses", with a warning before you cut anyone's access short.
- **Students:** for any course, see everyone who has or had it (active, ended, blocked or bank dispute), with search and filters. Select students to **block**, **restore**, **end now**, set **no end date** or **set an end date**.
  - Blocking keeps the record.
  - A lost bank dispute can't be "restored" by an admin.
- **Students see it:**
  - the course page shows "Access lasts until …" before paying and "Yours until …" after;
  - the shelf lists ended or blocked courses under "Access ended" with **Buy again** or **Contact us**.

  Buying again after a term restores access, and reading progress is kept.
- The Terms page has a new "How long access lasts" section.
- New endpoints: `GET /admin/access`, `POST /admin/access/change`, `POST /admin/access/term`.
- New migration `20261024000200_admins_and_access_periods.sql` adds:
  - `courses.access_until`;
  - `entitlements.expires_at` and `revoke_reason`;
  - `admin_emails`;
  - the stricter sign-up hook;
  - renewing purchases in `grant_order`.

### Fixed
- **Admin sign-in:**
  - after signing in, an admin always landed on `/admin` and lost the section they asked for (`/admin?tab=tools`);
  - the admin portal refused a plain college username.
- **Admin on phones:**
  - long course names made the page scroll sideways;
  - the selection and import action bars hid behind the bottom navigation.

### Verified
- 268 unit and API tests, all database checks, and 55 browser tests (including the new Students & access flow) pass.
- Lint and typecheck are clean.
- No sideways scrolling at 360, 390 or 768 px.

## [0.7.4] — 2026-10-24

### Changed
- **The paper plane is thrown, not on rails.** Each flight is one glide:
  - in from off-screen, out the far side;
  - four routes, never the same one twice in a row: under the navigation, below the buttons, and one with a loop-the-loop;
  - quicker on the dips, a gentle rock in the air, and the right way up whichever way it flies;
  - a pencil-dot trail that fades a moment behind it, with no permanent track;
  - a short breath between throws, so a plane is in the air about 90% of the time.
- On small phones the bundle page's label no longer wraps inside its pill; the page count sits beside it.

### Verified
- Responsive layout at 360, 390, 768, 1024 and 1440 px: no sideways scrolling or cut-off content on any page. That covers home, search, course, bundle, tools, legal, sign-in, not found, shelf, reader, account and every admin section, including the bundle editor.

## [0.7.3] — 2026-10-24

### Changed
- **Background ink comes and goes, and never moves.** Each doodle and margin note:
  - writes itself in;
  - stays for most of a long cycle (22–34 s, different for each mark);
  - fades out over 2 s and is written again.

  Only one or two change at a time. Nothing drifts, sways or reacts to the cursor any more.
- **The paper plane is back.** It glides a slow, steady loop round the hero on a faint dotted route, below the buttons and clear of the text. It points along its path through every curve. The route is rebuilt in pixels whenever the hero resizes, so it keeps the same speed (70 px/s) on a phone or a monitor.
- **The hero card stack shuffles steadily.** The cursor no longer tilts it or pauses it. It only rests when out of sight or in a background tab.
- **Admin on phones:**
  - the overview is a swipeable strip, not a tall block with an empty cell;
  - the section tabs stay pinned at the top, fade at the edges, and keep the open tab in view;
  - each course's price and buttons form a tidy two-column grid;
  - feature buttons line up, with shorter labels on phones (screen readers still hear the full name).

## [0.7.2] — 2026-10-24

### Added
- **Catalogue search** across every batch and programme:
  - matches course titles, codes (CSE3001), semesters ("sem 3"), years ("2024 batch"), programmes and live bundles;
  - every word must match;
  - results are grouped by batch, with bundles first;
  - press "/" to jump into the box, and Esc or × to clear;
  - the search is kept in the link (`?q=`) so it can be shared.

  New endpoint: `GET /catalogue/search?q=`. It is cached for 30 s and never returns drafts.
- **Payments health card** in the admin (Razorpay test or live). It says plainly when the keys are rejected and what to do.

### Changed
- **Background motion lives all the time:** stars slowly turn, squiggles sway, arrows nudge, and margin notes rock like paper. Each mark keeps its own rhythm and stays fully visible, never fading. The paper plane is gone. Reduced-motion users get a still page.
- **When Razorpay refuses to create an order** (bad keys, outage), the student gets "Payments can't start right now. Nothing was charged." (503 `PAYMENTS_UNAVAILABLE`), the cause is logged, and no order is left behind.
- **Checkout** allows Razorpay's built-in retries. If a failed attempt is then closed, the student sees the reason.

## [0.7.1] — 2026-10-24

### Fixed
- **Bundles and course publishing failed with 409.** The publish check counted problems that students can never see:
  - hidden reference books whose R2 copy is a saved Google sign-in page;
  - a ZIP sitting in a course folder.

  That blocked 7 real courses, and every live bundle containing one of them. Only problems in files students can see now block publishing: a broken, changed or missing visible file, or a broken page map. The R2 audit still lists everything.
- **Admins now see the real reason for a refusal** (which file, and what to do) instead of "This file is still being prepared". Students still get the calm wording.
- When a bundle is refused, the message names the course and the file.

### Changed
- **Bundle editor:**
  - pick the batch, then the programme, then the semester, and only matching courses are shown, grouped by semester;
  - chosen courses that don't fit are flagged with a one-click "Remove them";
  - bundles can no longer mix batches, checked on the server too.
- **Import asks each detail once.** The "for all" bar is gone. With several folders picked, a folder's form offers "Use these for all N folders", and the bottom bar shows the count, what's missing and the Import button.
- **Bundles on the catalogue:**
  - each card lays itself out by its own width (side by side when wide, stacked when narrow);
  - tablets show two per row, and a leftover card spans the row;
  - wide screens show three per row;
  - phones get one swipeable row.
- **Homepage:**
  - the library stats sentence and the subject ticker are removed;
  - doodles and margin notes write in once when that part of the page comes into view, then stay, instead of fading and rewriting on a loop (no more flicker);
  - style work while idle is down by three-quarters, and layout shift is 0.0017.

## [0.7.0] — 2026-10-23

Production hardening: a security review with tests for every attack path, a faster reader, an admin panel that holds up with thousands of files, and finished homepage motion.

### Security
- **A viewer token is bound to its reader.** Page requests need the student's sign-in as well as the token, and the token's user must match. A token copied to another account is refused (401).
- **Rate limits** on checkout, payment verification, profile edits, device removal and unsubscribe, alongside the existing page limit (40 a minute, 429 beyond).
- The Worker refuses to start with secrets shorter than 32 characters. Secret comparison is constant-time and rejects empty values.
- 55 new security tests (`apps/api/test/security.test.ts`):
  - every admin route against visitors and students;
  - privilege escalation;
  - converter secrets;
  - cross-user data;
  - forged webhooks;
  - bursts;
  - drafts and hidden files;
  - malformed input;
  - headers.
- Dependencies: sharp 0.35.5 and vitest 4.1.12. `pnpm audit` reports 0 vulnerabilities.
- `SECURITY.md`: the access matrix, how notes and payments are protected, the operator's launch checklist and the known limits.

### Added
- **Homepage motion that reacts to you:**
  - the marker underlines draw when each phrase scrolls into view;
  - the "How it works" stamps thud down one after another;
  - "page one" gets a pencil underline;
  - the footer tagline is marked too.
- The hero card shuffle pauses while you hover over it, when it is off screen and in background tabs.
- `scripts/reader-speed.mjs` and `scripts/admin-speed.mjs` measure the reader and the admin panel. `DEMO_BULK=N` fills the demo bucket with N extra files for load testing.

### Changed
- **Page turns:**
  - the next pages are reassembled in the background, so turning only paints one image (about 0.2 s on a slow phone, and a far jump went from 354 ms to 92 ms);
  - the spinner appears only when a page is genuinely slow (over 150 ms);
  - only pages near where you are stay in memory, so long files no longer grow the tab's memory.
- **Reader toolbar** is a single row on desktop, with "Ask AI" beside it.
- **Admin search over big buckets:**
  - typing stays instant;
  - when results exceed 2,000, the panel says how many there are instead of cutting them off silently.
- **The homepage never moves layout while idle**, because every animation uses transforms only. Layout shift is 0.023, down from 0.156.

### Verified
- 217 unit and integration tests pass.
- 54 browser tests pass on desktop and phone.
- Lint and typecheck are clean.
- The error sweep finds no app errors; only the deliberate not-found and outage probes and Cloudflare's bot check remain.
- With 5,000 extra files in R2:
  - the admin panel is ready in under 1 s;
  - comparing everything takes under 1 s;
  - scrolling stays at 60 fps.

## [0.6.0] — 2026-10-23

The reader moves freely between modules, the pages come alive in the background, the admin hides nothing, and the site loads faster. See docs/QA-REPORT.md for every error found.

### Added
- **Reader "Contents" panel**, in normal view and full screen: every module and file, one tap away. Switching files keeps you in full screen. On the last page, "Up next" offers the next file.
- **Background life, specific to notes:**
  - handwritten margin notes ("imp!!", "revise b4 exam", "PYQ ✓") that write themselves in and fade like pencil;
  - doodles that drift slightly away from the cursor;
  - a paper plane that crosses the hero about every 26 s on a dotted trail;
  - pencil doodles behind "How it works".
  Everything stays still for reduced-motion users.
- **Bundles are tied with a satin ribbon and bow** (the bow wiggles on hover), replacing the flat side stripe.
- **Admin "Everything in the system" strip:** courses, ready to publish, files, files needing pages, problems, off the site, gone from R2.
- `apps/web/scripts/error-sweep.mjs` and `apps/web/scripts/perf-check.mjs`.

### Changed
- **The admin hides nothing:**
  - every expandable section starts open;
  - all lists show every item in scrolling boxes, with no "…and N more";
  - the conversion board and the "not in any course" list are uncapped;
  - the comparison rows with differences open by default.
- **The library stats are a sentence with counting numbers**, not a block of giant figures.
- **Faster loading:**
  - letter-subset fonts for the logo and handwriting;
  - libraries in long-cached files;
  - hover, focus and touch prefetch of courses, previews and bundles;
  - the reader's code preloads while you browse;
  - the demo server compresses and caches assets like production.
- Mouse-wheel zoom in full screen is gentler (about 15% per notch).
- **Error messages:**
  - a failure is reported in about 2 s instead of about 7 s;
  - students see a human sentence for server problems, while admins keep the real detail.
- The unused shield icon is removed, and the glow behind the perk icons is gone.

### Fixed
- On phones the reader page could be wider than the screen (fixed at 660 px).
- Collapsed modules in the reader sidebar kept invisible links that could swallow taps.
- A doodle sat behind the "Free student tools" button.

## [0.5.0] — 2026-10-23

Every admin feature verified in a real browser, and a calmer, more human design across the site.

### Changed
- **Headings use a soft, bookish serif** (Fraunces at a medium weight with natural spacing) instead of a crushed extra-bold grotesque. The logo keeps its own font.
- **Accent words get a hand-drawn marker stroke** that draws itself in, instead of a 3D offset shadow.
- **Labels are quiet sentence case.** The wide-tracked monospace-uppercase eyebrows and the numbered "01 —" section labels are gone. Monospace stays only for real library data such as call numbers and page counts. The printed props (borrower card, receipt, borrower slip, stamps) keep their print look.
- Breadcrumbs, counts, chips and meta lines are written in plain words ("Drawer 2025 → B.Tech Computer Engineering → Card S3 · BCE · 01").
- The shelf greets you by name ("Hi Riya, Your shelf"). The bookmark reads "Pick up where you left off · page 3 of 24".
- Pages settle in gently on navigation. Every animation respects reduced motion.

### Fixed
- Hero stack: the back cards' titles were cut mid-letter. The cards are now spaced so every title shows.
- Course card on phones: the punch-hole sat on the description text.
- Curly apostrophes in headings, and the tool button copy is now short enough for its pill.

### Tests
- **`e2e/admin-features.spec.ts`** drives every admin feature through the real UI:
  - section navigation and old links;
  - health cards;
  - comparing everything, one folder, one file, or a mix;
  - making the website match R2;
  - page making with progress bars;
  - importing a course;
  - editing a course, hiding and showing a unit, the per-course R2 audit, setting the price, publishing (and checking it appears in the catalogue) and unpublishing;
  - creating a bundle;
  - adding and editing a free tool;
  - an announcement draft, preview and test send;
  - the full R2 audit.
- The suite also passes against a demo where R2 really differs from the database.

## [0.4.1] — 2026-10-23

The admin is organised by what you want to do, not as fixed steps, and every R2 action works on exactly what you choose.

### Changed
- **Admin sections instead of forced steps:** R2 → Website, Import courses, Courses & publishing, Bundles, Features & email, Full R2 audit. Open any section in any order. Publishing is its own section, and nothing pushes you to publish.
- **R2 → Website is a guided page with three parts:**
  1. **Choose** what to check: everything in R2, or any mix of folders and single files, picked from the real R2 tree. The tree shows search, open/close all, "course" and "not imported" tags, and greys out unsupported files.
  2. **Compare** that selection with Supabase and make the website match R2. Files in the selection that belong to no course are listed, with a button to go to Import.
  3. **Make pages** for that selection, with a live bar per file.
- **Features are back in plain sight** as "Features & email": the free tools (add, coming soon, launch & draft email) and announcements.

### Added
- `POST /admin/storage-compare`, `POST /admin/convert-selection` and `POST /admin/conversions/query` take free-form scopes: `""` is everything, `"folder/"` is a folder, `"folder/file.pdf"` is one file. Scopes are limited to the import root, and a folder already covers anything inside it.
- The selection is remembered for the browser session. Old `?tab=` and `?step=` links open the matching section.

## [0.4.0] — 2026-10-23

Admin rebuilt as a step-by-step workflow, R2 → Supabase sync fixes, and page conversion with live per-file progress.

### Added
- **Step-by-step admin.** Five steps in order — 1 Check storage, 2 Add courses, 3 Make pages, 4 Review & publish, 5 Sell & share. Each step explains in plain words what it does and which button to press, shows a coloured tag for what needs attention, and ends with a "Next" button. A glossary explains R2, Supabase, pages and "off the site". Old `?tab=` links still work.
- **Check storage: R2 compared with the website** (`GET /admin/storage-compare`). Read-only, per course: files new in R2, changed in R2 and gone from R2. "Make website match R2" applies R2's version one file at a time with a progress bar. R2 is the source of truth, and nothing is ever deleted from R2.
- **Make pages for a scope** (`POST /admin/convert`): a course, one unit, or chosen files; only waiting files, only failed ones, or both. Files whose R2 copy changed are refused, with the reason, until Supabase is updated. Each request is capped at 200 files.
- **Live conversion board** (`GET /admin/conversions`): every file's stage, page count and percentage. The admin polls it every 1.5 s while work is running and shows a progress bar per file ("Saving page 7 of 12 · 58%").
- **`GET /admin/overview`**: Supabase-only counts behind the step tags.
- **Demo server flags**: `DEMO_CONVERT_PAGE_MS=450` makes demo conversions run in the background with real stages; `DEMO_DRIFT=1` makes R2 differ from the database, so "Check storage" has something to show.

### Changed
- **The converter renders in chunks of 8 pages** (`pdftoppm -f/-l`) and uploads each chunk before rendering the next. Memory now depends on the chunk size, not the document length, and progress is reported for every page instead of only after the whole document has rendered. Every chunk is still checked against `pdfinfo`'s page count.
- **Progress callbacks are best-effort and throttled**: one on each stage change, one for the final page, otherwise at most one per second. A failed progress call no longer fails the conversion.
- **Local mode (`pnpm dev`) reports progress.** The in-process converter now sends results and progress through the same AdminService checks as the HTTPS callbacks, so admin progress bars move locally too.

### Fixed
- **Syncing one folder no longer wipes sibling files' pages.** A strict `sourceMissingAt !== null` check treated an unset value as "was missing", so every file in the folder looked changed and lost its pages (26 page objects removed instead of 2).
- **The page audit in "Advanced: full bucket audit" found 0 pages** when the originals and pages were in separate stores (demo and tests). `pages/` prefixes are now listed from the page store; in production both are the same R2 bucket.
- **Demo page images were blank** because placeholder bytes were served instead of the generated demo pages.
- Lint is clean: 35 errors, now 0. Stale test expectations were updated.

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
