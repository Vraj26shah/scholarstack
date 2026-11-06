# Changelog

All notable changes. Versions follow [Semantic Versioning](https://semver.org).

## [0.25.0] — 2026-11-07

### Added
- **Swipe hints on phones.** Wherever a swipe works, a small hint says so the first few visits (closable): between the four main tabs, between branches in the catalogue, to the next course in a drawer, and between admin screens. The reader already says "swipe to turn the page".

### Changed
- **CGPA calculator on phones:** each subject is a tidy card; the grade picker is one row of seven equal keys (S–F) with their points under each letter, so it never wraps; credits sit beside their label. The section tabs (This semester / Overall CGPA / What I need next) are equal segments on phones instead of a ragged wrap (all tools share this).
- **Keep-alive:** the GitHub check now runs twice a day and makes a real database query through Supabase's REST API (not only a health ping), on top of the Worker's own hourly database work.

### Checked
- Razorpay Standard Checkout was already complete (create order `POST /api/orders`, verify `POST /api/orders/verify` with HMAC-SHA256 of `order_id|payment_id`, webhook, cancel and failure handling). The new test keys were verified against Razorpay: an order was created, a correct signature was accepted and a wrong one refused.

## [0.24.0] — 2026-11-07

### Added
- **One course, many batches and branches.** The notes in R2 are one course; who reads them is now worked out per drawer. A course is shown to every batch and programme that takes its code in the Winter 2026-27 course list (e.g. CSE3003 Operating Systems → 2024 BCE and 2025 BCY), plus where it was filed. Each drawer shows it as that batch's course, with one card per subject even if two folders share a code.
- **Shown to** (course → Details): every batch and branch the course reaches, and why (course list, filed, or chosen by you). "Choose batches & branches" picks them by hand; "Follow the course list" goes back. Changing who sees a course never takes it off sale.
- **Courses → Course list:** the term's list programme by programme and batch by batch, with which listed courses have notes and their status; click one to open it.
- **All courses** lists where each course is shown, and the year and branch filters match any of those drawers.
- **Emails:** select all, untick the ones to keep, delete the rest in one go.
- Migration `20261107000200_course_offered_to` (adds `courses.offered_to`).

### Changed
- **Marker lines and highlights draw on every line they cover**, on phones too: the hero words ("stacked.", "drawer.") now use the same per-line stroke as highlighted phrases, and a highlight draws as soon as any part of it is on screen (before, a phrase that wrapped could stay blank).
- **Margin doodles are calmer:** each is written in at a pen's pace, stays longer and fades on its own rhythm, never in step with the others.
- **Inbox is as smooth as the other sections:** lists stay on screen while switching filters, and Questions and Uploads load each other ahead of time.

## [0.23.0] — 2026-11-07

### Changed
- **Reader watermark: clear to read, still in every screenshot.** A few faint diagonal lines of the reader's name, email and the time spread across each page (instead of a dense grid), plus a solid band above and below the page with the same identity and "sharing revokes access". The bands sit outside the notes, so they never cover writing, and can't be cropped off without cutting the page.
- **Storage → Clean-up covers R2 and the database.** One list of everything that can go, each tagged R2, Database or both: courses not on sale (draft or archived: their records, notes and pages), files whose note is gone from storage, pages of deleted files, unused files in course folders, upload and help-desk leftovers, and unpaid checkouts. Each kind opens to show every item (course names, not storage keys) and deletes one item or all; everything is checked again at the moment of deleting. Live courses and courses anyone bought are never removed.
- **Folders stay inside your notes.** The folder view starts and stays in drive-imports/ ("All notes"); the rest of the bucket (pages, uploads, backups) is looked after from Clean-up.
- **Tab badges clear when opened.** A tab shows what is new since you last opened it; opening it clears the badge (and its section's), and it comes back only when more arrives. Today still lists everything waiting. Folders and Page jobs no longer double-count the same files.
- **Uploads name the file at fault.** On Contribute, each file that is too big, the wrong type, or one of the largest pushing the total over the limit is marked on its own row, with a size meter; ZIPs show their largest folders and mark oversized files inside. In Admin → Folders, files over 40 MB or of the wrong type are listed by name with the reason, and the rest upload in batches the server accepts.
- **Contribute page:** the side column follows the form instead of leaving a blank stretch; the earnings slider shows the whole sum (sales → payment fee → your 30%).
- **Key words marked the same way everywhere.** The underlined key words in notes (site and admin) now use the hand-drawn marker line from the hero, which wraps line by line on phones.

## [0.22.0] — 2026-11-06

### Fixed
- **Admin no longer loses storage after a change.** Every admin change threw away the server's listing of storage, so the next screen walked tens of thousands of page images in R2 again; while pages were being made, every progress ping from the page maker did the same. That ran the Worker out of time, and the screen switched to "Storage didn't load" until it recovered. Now the page-image count keeps answering while a fresh one is read in the background (it only feeds sizes; deletes and moves still count fresh before acting), progress pings leave the listing alone, and notes are still re-read straight after a change.
- **A failed refresh no longer wipes the screen.** If a refresh fails for a moment, the admin keeps showing what it had, with one line ("Couldn't refresh part of this screen") that retries by itself after a few seconds. Requests also retry three times over ~5 s before giving up.
- **Full-screen reader no longer flickers.** The page was fitted to the scrolling area, so a scrollbar appearing on a slightly zoomed page shrank the fit, which removed the scrollbar, which grew the fit again, and so on. It is now fitted to a box that never scrolls, with the scrollbar's room kept. At 100% the whole page shows between the top and the toolbar (no 12 px overflow, no scrollbar), the gesture hint fades after 4 s, and on phones the toolbar stays on one row.
- **Zoom works properly.** + and − move between round sizes (110%, 125%, 150%…), keys + − 0 work outside full screen too, and a zoomed page outside full screen scrolls sideways so its left edge is always reachable.

- **A course you publish always shows to students.** The catalogue only lists a live course in the semesters its batch is studying now (2023 → 7–8), but since nobody picks a semester any more, new courses could be saved with semester 1 and stay invisible even while "Live". Every new course is now filed under its batch's current semesters, and changing a course's batch year moves its semester with it.
- **Contribute: a file turned away for its type no longer blocks sending.** Picking new files drops the rejected one, so students don't have to find it and remove it first.

### Added
- **Uploads: filing is guided.** Each upload in progress says what to do now and what happens next. Filing is three numbered steps: (1) the course, from a dropdown grouped by batch year with the guessed course marked "suggested" and "＋ Make a new course" at the end (with a list of what's still missing before it can be made); (2) the module, from a dropdown of the course's modules with "＋ New module…", a naming hint and a preview of how students will see it ("Unit 3 · Normalisation"); (3) where each file goes, folded away for big uploads. Before you press File, a short list says exactly what will happen.
- **Folders: clearer "New folder".** It works from the top of storage too (it goes into the notes area), its label says what kind of folder you're making at that level (batch, subject, module), and the top level explains why files go inside a batch folder.
- **Folders: any folder can become a course, or join one.** Any folder of notes inside the import folder can be made a course (not only ones two levels down), with programmes pre-ticked from the official course list. Folders that aren't a course show "Make course" and "Add to course" right on their row. "Add to a course" moves the notes into a unit of any course (search by name, code or year) and then adds them to that course and starts their pages, in one step. The server refuses a course inside another course's folder, or around one, so a file can never belong to two courses.
- **Courses: filters and bulk changes.** Filter by batch year and branch, plus "Ready to publish" and "Needs attention". Tick several courses (or a whole year) to publish the ready ones, take them off sale, archive them, or set one price. Year groups fold away. A course opens on the same tab after a refresh, and "Open its folder" jumps to it in Folders.
- **Inbox: clear a pile at once.** Questions and Uploads have a tick box on each item and "Tick all shown"; ticked questions can be closed, re-opened or deleted (with their attachments) in one go, and ticked uploads deleted.
- **Ready for the public:** `robots.txt` keeps admin, reading, checkout and accounts out of search engines; a web manifest lets students add the site to their home screen; link previews carry the site's address.

## [0.21.0] — 2026-11-04

### Changed
- **No more semester picker.** Admins used to have to choose a semester (1–10) for every imported course, every "make this folder a course," and every course edit — a step that rarely matched anything real and slowed the workflow down for nothing. That dropdown is gone from all three places; the server now works out a semester from the folder path when it can, and otherwise defaults it, so nothing blocks on it. Everywhere students see a course — the catalogue card's call number, the course page, the shelf spine — now shows the batch year and branch instead of "S{n}"; courses are organised by year and branch only.
- **BBA added**, from the official VIT Bhopal Winter Semester 2026-27 FFCS course list: Bachelor of Business Administration, with its 23 courses (Business Communication, Micro Economics, Human Resource Management, Digital Marketing, Customer Relationship Management, and the rest) mapped so imports land in the right programme automatically.
- **Folders and Page jobs now share one state engine.** The per-folder progress panel in Folders ("Pages for this folder") showed only ready/working/stuck/failed with a bare "Try again" button; the plain folder-tree row only ever said "Needs pages," "Ready" or "Couldn't make pages," even for a file that was actually paused, queued or mid-conversion. Both now show the exact same six states (working/queued/paused/stuck/failed/needs pages), the same colours and wording, and the same live progress bar as Page jobs — and the per-folder panel gained Start, Pause, Resume and Delete job on each file, matching Page jobs exactly instead of only "Try again."

### Noted for you
- The Winter 2026-27 course list also lists five programme codes we haven't seen before — BET, MEI, MIP, MIB, MSI — whose course content doesn't confirm an official full name on its own. Rather than guess at a name in front of your customer, these are left for you to add yourself (with the right name) in Admin → Courses → Years & branches, which needs no deploy.

## [0.20.0] — 2026-11-04

### Added
- **Page jobs: one screen for every file making pages, across every course.** Admin → Courses → Page jobs. Shows what's working, queued, paused, stuck or failed right now, with a live progress bar per file (same stage-by-stage progress the converter already reports — downloading, rendering, saving pages, verifying).
  - **Start** queues a waiting, failed or stuck file.
  - **Pause** pulls a queued file out of line before GitHub picks it up, and tells the system to ignore the result of one already running — nothing half-made gets published.
  - **Resume** lifts a pause and starts the file fresh; a late result from the paused run no longer matches and is thrown away.
  - **Delete job** cancels a job outright and puts the file back to "needs pages", with no half-made pages left behind.
  - Every action works on one file or on a bunch picked at once.
  - "Check storage for changes" re-reads every course folder first (moved, replaced or deleted files), so the board is never stale — the same storage check the publish checklist uses.

### Changed
- A file the admin pauses is skipped by every bulk "make pages" action until it's resumed, and says why in plain words.

### Fixed
- **UPI missing from the payment window.** NPCI switched off UPI Collect (typing a UPI ID) on 28 Feb 2026, and our payment window only listed UPI's Collect form, so Razorpay had nothing left to show under UPI. The window now hides Collect, as Razorpay asks, and shows UPI the way that works: a QR code to scan on a computer, and your UPI apps (GPay, PhonePe, Paytm…) on a phone.
- Razorpay's redirect for netbanking and wallets is allowed by the page's security rules.

## [0.19.3] — 2026-11-03

### Fixed
- **"Convert queued course files" failing every 10 minutes.** Two causes are handled:
  1. The workflow set a pnpm version and package.json sets one too; it now takes it from package.json like the other workflows.
  2. Missing repository secrets no longer fail the run (and email you every 10 minutes). The run lists exactly which secrets to add, in its summary and as a warning, and skips the rest.
- The admin's health line now says when files have waited more than half an hour for pages ("the page maker on GitHub isn't running"), so a stuck workflow shows up on Today, not only in email.

### Changed
- **Admin in fewer words.** Every section has one short line saying what it's for, and every screen's intro is one sentence. "Partners" is "Contributors" throughout Money.
- **Every admin section stays in step.** Any change you make (publish, file an upload, give access, delete files, answer a question) refreshes every admin list on screen and the public pages it affects, not only the badges.

## [0.19.2] — 2026-11-03

### Added
- **Every VIT Bhopal B.Tech programme**, so every student lands in their own drawer: CSE (Cyber Security and Digital Forensics) BCY, CSE (Health Informatics) BHI, CSE (Education Technology) BOE, ECE BEC, ECE (AI and Cybernetics) BAC, Mechanical BME, Mechanical (AI and Robotics) BMR and Aerospace BAS, next to the six already there. BAI and BCG take their official names (CSE (AI and Machine Learning), CSE (Gaming Technology)). New migration `20261103000200_vit_programmes.sql` adds only what's missing; codes and names can be corrected in Courses → Years & branches.
- **Students is now the admin's contact book (CRM).** One list of everyone who bought a course, shared notes or asked a question. Four totals on top (people, with a course now, shared notes, questions waiting), a "Who" filter (has a course / shared notes / asked a question), branch names next to codes, and each person opens to three equal columns: their courses (renew, end, block, unblock), their uploads with where each stands, and their questions, with links to Uploads and Queries. It reads the same lists those screens use, so everything stays in step.

### Changed
- **Shelf:** every book is the same size and stands straight in one even row, the "Add from catalogue" slot too.
- **Contribute, after uploading:** what you've uploaded sits inside the upload card, so the two columns stay even, instead of a lone card at the bottom.
- The Students filters sit in an even grid.

## [0.19.1] — 2026-11-03

### Changed
- **A student sees only their own programme.** The code in their college email ("BCE" in vraj.23bce11796) is matched against the programme codes set in the admin (Years & branches). When it matches, the branch tabs and branch swipes are gone and the drawer is theirs; the batch drawers stay so they can look at other years. Anyone we can't place (signed out, an admin's Gmail, a code not set up yet) gets the branch tabs as before.
- The programme's tagline and description above the cards are gone. Above the search box: "Notes you need not here? Search for them."
- **Course page:** the card's details sit in a small card at the top (call no., batch, branch, files, pages, formats, title). Below, **Modules** on the left and **Peek inside** on the right as a grid of every unit's free page. The price, what you get and the buy button are one wide bar across the page at the end, with the bundle offer under it. The price stamp no longer tilts.
- **Light by default.** The site opens light whatever the phone or laptop is set to; once a visitor picks dark it stays dark for them on that device (and light again if they switch back).
- **Contribute page is even:** the upload card and the rules/ZIP guide sit side by side at the same height, and the questions run full width in two columns underneath.

### Checked
- Every admin section and every course tab (Today, Courses, Folders and its filters, Bundles, Years & branches, Students, Earnings, Contributors, Queries, Uploads, Features & email, Clean-up, Problems) loads with no errors, failed requests or console errors. All 66 browser tests pass, including a new one for the student's own drawer.

## [0.19.0] — 2026-11-03

### Added
- **Your drawer opens first.** A signed-in student's college email says their batch and programme ("vraj.23bce11796@vitbhopal.ac.in" is the 2023 batch, BCE), so the catalogue opens on their drawer, with a line saying so and a "Back to yours" link after browsing others. If their programme has no drawer yet, the default one shows and they're pointed to search. Signed-out visitors still pick from the branch tabs.
- **Sign in with the code from the email.** After "Email me a sign-in link", the page takes the code from the email too, so a student who opens it in the Gmail app (another browser) can still sign in. A link opened in the wrong browser now says to type the code instead.
- **Email health on Today.** The admin's health line checks Brevo too and says plainly what's wrong (a blocked address, a bad key, no key).

### Fixed
- **Why emails didn't arrive:** Brevo's "Authorized IPs" setting is on, so it refuses the website's requests (Cloudflare and Supabase send from changing addresses). This has to be switched off in Brevo; see LAUNCH_GUIDE "If emails stop arriving". The site now reports that error in plain words instead of failing silently.
- **Phones (seen on a Samsung A55):** swiping inside something that scrolls sideways (the page previews, a wide table) only scrolls it; it never throws you to the next course or section.
- **The phone tab bar is easy to see:** deep blue with white labels, the current tab in a light-blue pill, a little taller, clear of the phone's gesture area. It reads the same in light, dark and forced-dark browsers.

### Changed
- BCE is **B.Tech Computer Science and Engineering** (B.Tech CSE). New migration `20261103000100_cse_name.sql`.
- **Straight, aligned cards:** the stacked cards in the home hero, the contributor statement, the step stamps, the sign-in card, the shelf's add card and the status stamps no longer tilt.
- **Contributor, not partner:** "Become a contributor", "Contributor statement", "How contributors are paid", "Contributor of the year". The menu says "Contribute & earn" and the phone tab "Contribute".
- The small lines above the hero titles ("The semester catalogue for @vitbhopal.ac.in", "Partner programme · for VIT Bhopal students") are gone; the college email is explained where you sign in.
- **Course page, what matters first:** title, description, the key facts (call no., batch, branch, files, pages, formats) and, on phones, the price button in one compact card; then Peek inside and Modules, with the same spacing between every section. "What's in the card" is now "Modules".
- Tighter, even spacing on the Contribute page and before the catalogue.

## [0.18.6] — 2026-11-01

### Changed — look
- **Background drawings back to how they first were:** faint ink (white at 20% on blue, navy at 14% on paper), a thinner line, and a slow cycle of 22–30 s per mark. Each is drawn in, left on the page most of the time, then rubbed out, so only one or two change at once. The paper plane's dotted trail is softer.
- **Toolbox cards read like catalogue cards:** a call number (T-01, T-02…) instead of the "Free · no sign-in" badge, and "Open CGPA calculator" with the name as written (no more "cgpa"). "Coming soon" is plain text.
- **Bundles say it plainly:** "Bundle of 3 courses" and "You save ₹78 (28%)" as text, not badges with icons. Stray "→" arrows were removed from text links.

### Fixed — accepting an upload
- **A whole-subject ZIP is filed unit by unit.** Its Syllabus, Unit 1…, Unit 2… and PYQs folders become the course's units as they are, instead of all landing inside one unit folder (which made "Unit 2 › Unit 1 › file"). No unit has to be typed; loose files at the top go to "Notes". A single file or a partial ZIP still asks for a unit.
- A ZIP wrapped in one subject folder with a loose file beside the units is still recognised as a whole subject, on the student's check and the admin's.
- When filing, each file's unit list includes the units the ZIP brings, so any file can be moved between them.
- **The reward starts from the rule students were given:** a whole subject in the right layout starts on the 30% royalty; anything smaller starts on a one-off payment. The step says which applies and why.

## [0.18.5] — 2026-11-01

### Fixed
- **Admin 503s on Folders and Today.** Every storage screen walked the whole bucket, including tens of thousands of page images, twice per request. With several admin tabs refreshing, the Worker ran out of memory and unrelated calls (Today) failed with 503. Now the notes are listed folder by folder (skipping the page, upload and help-desk areas), page images are only counted per file, and one listing is shared for a minute. Any admin change and every finished conversion clears it. Deletes and moves always look again first. Today reads the overview once instead of twice.
- Sideways swipes never trigger the browser's back or forward gesture.

### Changed — publishing, one step at a time
- **Nothing goes live from the course list.** "Check & publish" opens the course's checklist (the fifth tab, after Files & pages, Free preview, Details and Books):
  1. Storage matches the course: every file in the folder is on the course; none changed or gone.
  2. Every file is a real document.
  3. Every page of every visible file is made and saved, with a matching page list.
  4. Title, price and at least one readable file.
- Each step opens only when the one above is done and carries the one button that moves it on: Pick up changes, Open the folder, Make pages for N files, Open details.
- Under the steps, every file students would see is listed with its state, pages saved out of its total, and what's wrong. Each file has its own Make pages or Hide.
- Hidden files, ZIPs and system files are listed as left out, never blocking.
- The server runs the same checklist when a course is published, so a course can't go live half-made by any route. The refusal names the step and up to three files.

### Added — unused storage by folder
- **Folders has Everything · Not used · Not on sale.** "Not used" shows only files no course points at; "Not on sale" adds hidden files and files of draft or archived courses. Folders keep their structure and show only those files.
- "Delete all N…" deletes everything shown in the folder you're in, after the usual preview and DELETE. Files in folders that aren't a course yet are called out, in case they're new notes.
- Tick several files or folders, or tick everything in a folder, and delete them together.
- "Storage" at the start of the path opens the whole bucket, so loose files outside the import folder can be seen and deleted too.
- Clean-up links to these views.

### Changed — phones
- **Branches swipe.** Swiping across the drawer (cards, title or branch tabs) moves to the next or previous branch, and the cards slide like the sections do. Past the last branch the swipe goes on to Shelf, and before the first it does nothing.
- **Admin tab rows swipe the section**, as on YouTube: a swipe on the section or view tabs changes the section, and the row follows.
- Anything that scrolls sideways (a wide table) scrolls first; the swipe takes over once it reaches its end.

## [0.18.4] — 2026-11-01

### Changed — phones
- **Swiping like Instagram.** Between Catalogue, Shelf, Earn and Toolbox the page now follows your finger all the way: a quarter of the screen (or a quick flick) carries it off and the next section slides in from that side; less, and it springs back. At the first or last section it only gives a little.
- **Course to course.** On a course page, swipe left or right for the next or previous course in the same drawer.
- **Admin** swipes between its sections the same way.
- **Rows that move sideways keep their own swipe:** the branch tabs, the batch drawers, the admin tab rows, tables and any sideways list never switch section.

### Changed
- **Nothing moves under the pointer.** Course cards, bundle cards, shelf books, batch drawers and branch tabs no longer lift, tilt, grow or jump on hover; only their colour, edge or shadow answers. Cards in a row are all the same height.
- Card counts read "14 files · 212 pages" (no capitals).

## [0.18.3] — 2026-11-01

### Changed
- **Margin drawings back to the light ink**, but quicker: each is drawn in about a second, stays about 2.5 s, rubs out in under a second, and a new one starts every second or so.

### Fixed
- **Live QA (`pnpm ops qa`) reads the real setup correctly**: it adds its test admin to the database admin list for the run (and removes it), checks the drawer of the course's own batch, accepts "already paid" for a repeated payment webhook, and doesn't flag files already retired as missing. Run against the live database with this version: 78 of 79 checks pass; the last needs a valid `SUPABASE_ACCESS_TOKEN`.

## [0.18.2] — 2026-11-01

### Fixed
- **"Could not embed because more than one relationship was found for 'course_files' and 'course_units'."** The free-preview choice (0.17.0) added a second link between files and units, so the database could no longer tell which link a file's unit meant. Every query that reads files with their unit (catalogue, search, course pages, the reader, admin) now names the link. Checked against the live database.

## [0.18.1] — 2026-11-01

### Fixed — GitHub Actions
- **Deploys no longer stop on an expired Supabase access token.** The deploy tries the token first; if it is missing or rejected, it applies the same safe `supabase/apply-all.sql` with the database password (`SUPABASE_DB_PASSWORD` secret) over the session pooler, then continues. It stops before deploying only if neither works, so the site never runs ahead of its database.
- **The page converter no longer fails on a missing or local callback address**: it reports to `SITE_URL/api/internal/conversion` unless `CONVERTER_CALLBACK_URL` is set to a live https address.
- **Nightly backup** runs with just the database password too (no separate `SUPABASE_DB_URL` needed).
- `pnpm github:secrets` now also sends `SUPABASE_DB_PASSWORD` and `SUPABASE_POOLER_HOST`.

### Changed
- **Margin drawings you can actually see**: brighter, slightly bolder strokes; one starts every couple of seconds, each drawn in about 2 s, left for about 6 s, then rubbed out; placed only in open space (never over the headline, buttons or cards), with their own set on phones. The handwritten notes ("imp!!", "Σ notes = less panic"…) and their font are gone: one fewer download.
- **Today and the admin counts follow the work**: refreshed after every change, every 20 seconds, and when you come back to the tab. Problems now count until you clear them (not "the last day"), so a number only disappears when the work is done.
- Two lines of copy made plainer (admin sign-in, how partners are paid).

## [0.18.0] — 2026-10-31

### Changed — uploads
- **One file per upload**: either a ZIP of a whole subject, or a single PDF, PowerPoint or Word file (up to 60 MB). Picking another file replaces the first, so every upload is one thing to review and storage stays small. Anything else is turned away with what to send instead.
- **The ZIP layout is checked the moment it is picked.** Packed as a whole subject (a `Syllabus` folder, one folder per unit or module, `PYQs` optional) it says so and that it earns **30% of every sale**; otherwise it lists exactly what to add. The admin sees the same check on the upload ("whole subject, 5 units"). A ZIP that is damaged or has nothing usable inside is refused at once.

### Admin: one place for each job
- **Checked view by view, nothing doubled or idle.** Earnings pays people (royalties, cash rewards, payments made); Partners shows the people (uploads, earned, paid, owed) and the year's top partners with their perks. The course page's **Pick up changes** now works like Folders (only what differs is touched) and links to its folder. The bulk import lost its "Sync imported files" button, which re-checked every file of every course; Pick up changes does that job for just the folder you are in.
- **Removed what did nothing:** ten admin endpoints the site never called (old full-check, copy-to-folder, publish and folder-sync shortcuts, and a sync that only refused), their code, an unused reader message, unused icons, animations and styles. Unused code is now flagged by the type checker, so it can't build up again.
- **Make pages** and **Full check** are gone; everything they did is in **Folders**: **Pick up changes** compares the folder with storage and touches only what differs (new, changed or missing files, nothing re-made), **Make pages here** works at any level including all courses, and **Pages** shows every file's progress, stuck or failed ones with **Try again**. Today's "files students can't open" opens that list. The service health line (storage, database, page maker, payments) is now on Today.
- **Give access** is now a button in **Students** (pick the course, paste the emails). Students also gained bulk changes (choose a course, tick students, then renew, end, block or unblock with one reason) and **No end date** on renew.
- **Folders, like a drive**: drag files or folders onto a folder (or a step of the path) to move them; rename, new folder, upload and delete as before. A new file uploaded or picked up in a live course no longer takes it (or its bundles) off sale: students see it once its pages are made.
- Old links (`?section=sync`, `audit`, `access`) open the new places.

### Phones
- **Swipe between Catalogue, Shelf, Earn and Toolbox**, and **between admin sections**, like a phone app: the page follows your finger and the next one slides in. Never on a course, a tool or the reader, where a swipe turns the page.
- Admin tabs are one row that scrolls sideways and keeps the chosen one in view; branch tabs in the catalogue too.
- **The reader opens with the whole page in view** (fit to screen), on phones and computers; zoom still goes in from there.
- Margin doodles on phones as on computers; the partner steps are joined by a line down the side.

### Changed
- Tool pages and toolbox cards lost the "TOOL · 03 · FREE · SAVED ON THIS DEVICE" labels: one plain line says it is free, needs no sign-in, and keeps your data on the device.

### One look everywhere
- **One text family.** Labels, codes and figures now use the body font (with even-width digits) instead of a separate typewriter font; only real code (the ZIP layout) is monospaced. One fewer web font to download.
- **No shouting.** All-caps labels ("IN REVIEW", "CALL NO.", "PARTNER STATEMENT", "OVERALL CGPA"…) are in sentence case, status pills read "Live", "Draft". Round rubber stamps keep their capitals.
- Admin money figures fill the grid on phones (no empty cell); the admin tab row fades at the edges where it scrolls.

### Page converter (GitHub Actions)
- Converts **three files at a time** and up to **24 per run**; installs LibreOffice only when Word or PowerPoint files are waiting (PDFs need seconds of setup instead of about a minute). A run now has 20 minutes.

## [0.17.0] — 2026-10-31

### Changed — partner rules
- **Royalty is 30%** (was 50%) of what each sale brings in after the payment fee, everywhere: Earn page, rate card, Terms, the admin statement and the database default.
- **Courses given free by an admin never count** toward royalties or the partner bonus.
- **Uploads accept .pdf, .ppt/.pptx, .doc/.docx and .zip.** A whole subject can come as one ZIP (Syllabus, Unit 1…, PYQs); the Earn page shows the layout.
- **Ended or blocked courses stay on the shelf for 48 hours** with the date they leave and the admin's reason, then disappear. A bundle that ends sends one email naming the bundle, not one per course.

### Admin, redesigned
- **Counts on sections and views** (Courses, Make pages, Uploads, Questions, Emails, Problems, Rewards) come from the server and clear the moment the work is done.
- **All courses**: slim rows with price, live/draft/archived, Publish/Unpublish and Open; filters with counts; drafts first.
- **Course workspace** (Open): *Files & pages*: every file by unit with its page status, a progress bar, "stuck" after 30 minutes, Make pages per file, unit or course, Hide/Show, Pick up changes from storage. *Free preview*: choose which file and which pages (1–5) each unit shows; students see exactly those pages, still protected. *Details*: year and branch dropdowns, semester, code, title, description; archive, bring back, delete; move the folder. *Books*: titles and links.
- **Folders** (like a drive): breadcrumbs and search across storage, New folder, Upload (with replace), Rename, Move, Delete, Make pages here with live progress and retry, Make this folder a course, or many at once.
- **Bundles**: search courses to add, Create as draft, Publish/Unpublish/Archive/Delete (delete only if nobody ordered it), bundle search.
- **Students**: everyone with a course, filter by year, branch, course and state (active, ended, blocked); renew, end, block or unblock with a reason that is emailed and shown on their shelf; bought/given and end dates. Give access stays alongside.
- **Money**: per course money in, payment fees, partners' share, profit (losses flagged), free access, and which partner uploads earn; bundles table (who bought, how much); top contributors can be given cash or a gift, once per year.
- **Emails & tools**: preview and delete a tool or an email draft; "Send to the rest (n)" for students not yet emailed (each student gets an email once). Ready replies in the help desk.
- **Clean-up by folder**: unused storage can be narrowed to one folder (e.g. one course) before deleting.
- **Timetable**: any colour with a colour picker, text stays readable.

### Fixed
- Uploading a new file into a live course (Folders › Upload) no longer takes the course and its bundles off sale; students see the file once its pages are made.

### Database
- New migrations, **not yet applied to the live database**: `20261031000100_partner_terms.sql` (30% default), `20261031000200_unit_previews.sql`, `20261031000300_access_notes.sql`, `20261031000400_partner_perks.sql`, `20261031000500_housekeeping.sql`.
- **Housekeeping** (daily at 03:00 UTC): trims audit log after 180 days, access logs and email counters after 60, problem reports after 90, and abandoned orders after 14, so the database doesn't grow for nothing.

## [0.16.0] — 2026-10-31

### Fixed
- **Notes stuck waiting for pages.** The page converter (GitHub Actions, every 10 minutes) could stall on a single job: any report the site refused, a queue file naming another address, or a secret pasted with a stray space or line break stopped the whole run before the queue moved, so the same job blocked everything behind it on every run. Now each job is tried at most once per run; one that hits an error moves to the back of the queue and is dropped after 3 runs (queue it again from Admin). A broken or deleted file is reported to Admin as failed and leaves the queue. Results always go to the trusted address in the repository secret. Secrets are trimmed. Reports to the site are retried on network errors; a wrong secret says so plainly. Each run now handles up to 12 files. The workflow stops with a clear message if `CONVERTER_CALLBACK_URL` is not your live https address.
- The site accepts a converter result for a file deleted while it waited (and removes any pages written for it) instead of answering "not found".
- **Phones: swiping in the reader.** A sideways flick on the page turns it (up and down still scroll, two fingers still zoom), and the new page's top comes into view. In full screen, a flick past the edge of the page (or any flick at normal zoom) turns the page.
- **Home page animation**, now clearly visible: margin doodles draw themselves in stroke by stroke, stay, then rub out along the same stroke, one at a time, with darker ink. Phones get their own doodles. One paper plane, redrawn as a single clear shape (it used to read as two).
- **Speed.** The public catalogue is read in one query instead of one per batch and branch (about 12 before), and file lists are read in parallel pages with no 1,000-row cut-off. Catalogue, drawers, search and bundle cards are reused for 20 seconds, and any admin change clears them at once, so edits show straight away.

### Added
- **Recommended books, managed by the admin** (Courses › Books): name, optional author and link per book; reorder, edit, remove. Students see exactly that list on the course page ("Get it on amazon.in ↗"). Titles found in the course folder can be added in one tap. Until a course has its own list, the found titles show as before. New table `course_books` (migration `20261028000100_course_books.sql`).
- **Batch year and branches as dropdowns** in the course editor and import: the year lists the four batches now studying (with "2nd year"-style labels) plus the next intake; branches open a tick list with a filter, Choose all and Done. Admin › Years only adds those years and shows each year's label.

### Changed
- **Partner programme.** The Earn page is now an invitation to become a partner: why partner, the three ways partners are paid, an earnings slider, and an example statement in real numbers (₹99, fee included).
- **Royalty basis.** The 50% royalty is now on what each sale brings in after the payment provider's fee (2% + GST on it, 2.36%), as in the Terms.
- **Partner of the year** bonus is 25% of their year's royalties, capped at ₹10,000. The old "everything again" bonus could cost more than the sale earned.

### Database
- Applied to the live database: `20261027000100_contribution_pipeline.sql`, `20261027000200_relocate_file.sql`, `20261028000100_course_books.sql`. Every table and function the code uses is there, and every table has row security on.

## [0.15.0] — 2026-10-26

### Added
- **Filing uploads, file by file.** In an upload's File step every file (and every file inside a ZIP) can go to its own unit, get a new name, or be left out (and put back), with the exact result shown before anything is written.
- **Restructure stored notes** (Admin › Storage › Files): tick files or folders and **Move to…** any unit of any course (or a new unit), or **Rename** a file (its type is kept) or a unit folder. A preview shows every old → new path first. Storage and the database change together, one file at a time: pages are kept (nothing is re-made), students keep reading, and a live course that loses its last readable file comes off sale. A course's own folder still moves with "Move or rename a course's folder". New database function `relocate_course_file` (migration `20261027000200_relocate_file.sql`).
- **Unused storage** (Admin › Storage › Clean-up), by kind, each with what it is, its size, the list, and a safe delete that re-checks first: pages of deleted files, leftovers in course folders, uploads with no record, originals of finished uploads, help-desk attachments with no question. Folders waiting to be imported are listed apart and never deleted from here.
- **Admin preview before publishing** for draft courses and bundles: a yellow bar, buying off, and **Preview** buttons in All courses and Bundles. (Tools already had it; emails have Preview and Send me a test.)
- **Earn** in the phone tab bar, and the tab bar for visitors who aren't signed in.

### Changed
- The Contribute page's rate card is plain, like every other card on the site (no tilted stamps or ruled paper), and shows at once on phones. The "paid to you" stamp no longer covers the amount.
- Storage wording is exact: files in no course are "not on the site" (not imported yet, or leftovers), not "unused".
- Admin error messages no longer name storage or database vendors.

### Security
- Uploads are read with a byte limit, so a request that lies about (or leaves out) its size can't make the server read more.
- ZIPs from students are unpacked one file at a time, at most 40 MB each, and unpacking stops the moment a file grows past what the archive declared.
- Catalogue search is rate-limited per network.
- Checked under the production content-security policy: timetable PDF, print and downloads work with no violations.

## [0.14.0] — 2026-10-26

### Added
- **Upload pipeline.** Every student upload moves through Check → Decide → File → Reward → Pages → Done, shown as a bar on its card with only the current step open.
  - **Check** runs on upload: file type, about how many pages, locked PDFs, fake Word/PowerPoint files, and a ZIP's contents (system files ignored; nested archives and `.txt` flagged). Older uploads can be checked on demand.
  - **File** turns the upload into our layout, `Course / Unit / file`, with an exact preview first. ZIPs are unpacked on the server (no library; capped at 300 files and 200 MB unpacked), nothing is overwritten, and pages start being made at once. The course is guessed from what the student typed (short forms like DBMS, OS, CN understood).
  - Filing into a **live** course keeps it on sale: new files appear to students when their pages are ready (changed or deleted files still pause sales, as before).
  - **Reward** defaults to a 50% royalty on the course it was filed into and sends the one "accepted" email; **Done** sends "Your notes are live in <course>" once.
  - Filters: To review, In progress, Done, Rejected, All. Today counts uploads waiting for any admin step.
- **Contributors** (Admin → Students): each contributor's uploads, acceptance rate, files and pages live, royalty sales, earned, paid and owed, most valuable first.
- Students see their notes' progress on the Contribute page: in review → accepted → in a course → live, with the course linked.
- **Timetable maker, rebuilt.**
  - **Download PDF**: a real one-page A4 PDF made in the browser (no library), branded, with code, name, room and lecturer.
  - **Print** now works: it prints exactly the PDF picture from a hidden frame, one page; notes still can't be printed.
  - **Add to calendar** (`.ics`, weekly repeats) and **Share link**: a friend can use it or add it as planned courses, offered and never applied silently.
  - **Now / Next** card, today's row and the current period highlighted, a **Day** view (the default on phones), a Room field, and course names suggested from the catalogue with a **Notes for this →** link to the matching course.
- Admins can use a tool before launching it ("Admin preview"); students still see "coming soon".
- Migration `20261027000100_contribution_pipeline.sql` (filed course, folder, keys, filed and completed times).

### Changed
- "Copy to a storage folder" on uploads is replaced by the File step (the API route stays for scripts).

## [0.13.0] — 2026-10-26

### Added
- **Today** is the first admin screen: only what needs you (questions, uploads, courses ready to publish, files students can't open, money owed to contributors, emails still going out, problems in the last day), each with one button to the right place. One server call (`GET /admin/today`); a part that fails shows "couldn't check" instead of breaking the screen. The tab badges use the same check.
- A calm page for crashes instead of a blank screen ("Something went wrong on this page. Nothing is lost."), with the details sent to Admin → Problems. After a new deploy, an open tab reloads itself once to pick up the new version.
- Emails to students when an admin blocks, restores or changes their access, and a fix for sending mail from the Cloudflare Worker (from your commits after 0.12.0).

### Changed
- Admin sections renamed in plain words: Today · Courses (All courses, Add courses, Make pages, Bundles, Years & branches) · Students (Access, Earnings) · Inbox (Questions, Uploads) · Emails · Storage (Files, Clean-up, Problems, Full check). Old links still work.
- No vendor names in the admin's text (storage, website, payments instead of R2, Supabase, Cloudflare).
- Changing a live course's price or details keeps it on sale (it used to unpublish the course and its bundles). Unpublish is its own button.
- Course cards: no storage paths, "N files · N pages", and Save price only appears when the price changed. The folder is shown in Edit.
- Make pages: a short intro, and one line when storage, website, page maker and payments all work (a card only for one that doesn't). The glossary starts closed.
- Clean-up: the database table list is folded away; unpaid checkouts have their own short section.
- Panel headings match their tab names; on phones the six sections show as two rows of three.
- Students and visitors only see calm, short error messages; admins keep the details (from your commits after 0.12.0).

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
