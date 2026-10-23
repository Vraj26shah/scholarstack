# QA report — 21 Oct 2026 (v0.2.2)

v0.2.2 refines the same screens: stamps kept, "Better together" redesigned, decoration and motion calmed, and an Admin "Add a tool" form. Re-run: lint and types clean; 77 unit/API/converter tests (one new, for adding a tool); 24 database checks; 35 browser journeys passed (1 skipped by design). Light and dark were reviewed on desktop and phone.

v0.2.1 keeps the 0.2.0 screens and adds the new logo, the calmer dark mode, smoother motion and skeleton-loading previews. Re-run on 21 Oct: lint clean, types clean, 76 unit/API/converter tests, 24 database checks, 35 browser journeys passed (1 skipped by design). Light and dark mode were reviewed on desktop and phone.

---

Previous round (v0.2.0):

Everything below ran against the **demo build**: the real API code with an in-memory database, simulated Supabase and Razorpay, and a stand-in mailer. The demo bucket copies the layout of `scholarstack/drive-imports/` (23/24/25/26 Batch, module folders, loose files, a .heic and a Thumbs.db). Steps that need your real accounts are listed at the end.

## Results

| Check | Command | Result |
|---|---|---|
| Lint and format | `pnpm lint` | clean (127 files) |
| Types | `pnpm typecheck` | clean, 4 packages |
| Shared contracts | `pnpm test` | 9 / 9 |
| API rules | `pnpm test` | 57 / 57 (29 before + 28 new) |
| Converter (real PDF → tiles + preview) | `pnpm test` | 4 / 4 |
| Web units | `pnpm test` | 5 / 5 |
| Database migrations and RLS | `pnpm db:verify` | 24 / 24 checks |
| Worker bundle | `pnpm --filter @ss/api build` | 218 KB gzip |
| Browser journeys | `pnpm test:e2e` | 35 passed, 1 skipped by design (desktop 1366 px and Pixel 7) |

## New in this round, and what proves it

- **Import from drive-imports/** (API + browser): the tree shows `23 Batch` → 2023 and lists which folders are new or already imported. Only ticked folders are imported, as drafts, with sub-folders as units. Loose files go to "Notes", junk files are ignored, the .heic is reported as skipped, and re-importing updates the course instead of duplicating it. Folders outside the root and unknown branches are refused, and students can't open the import. Nine real-world folder names are parsed correctly ("Module 2 - MapReduce", "Unit-2 Network attacks", "MOD_04 spark streaming", "02. Transactions", "PYQs"…).
- **Bundles** (API + browser): bundle cards show the list price, the price and the saving. Buying one grants every course in it, and buying it again is refused. If you already own DBMS, the Sem 3 pack drops from ₹199 to ₹128 and only grants the other two courses. A lost dispute revokes the whole bundle. A bundle can't be priced above its courses. The browser test buys the pack and sees 3 courses on the shelf.
- **Previews** (API + browser + converter): each unit has exactly one public preview, its first ready file. Other files and draft courses return 404. The image is cacheable and visibly stamped "PREVIEW". The browser test opens the viewer, checks the image actually loads, and flips with the arrow keys and Escape.
- **Toolbox and emails** (API + browser): the tools are public and "coming soon". Launch drafts the email; preview, test and send all work. Only opted-in students get it, with personal unsubscribe links that work, and forged links are refused. The daily cap pauses the send and the next day resumes with no duplicates. A provider error pauses the send and Resume finishes it. The browser test launches the timetable maker, previews the email, sends it and sees the tool go live on the home page.

## Bugs found and fixed during this QA

1. Signing out cleared *all* cached data, including public lists still loading, so the toolbox (and potentially bundles) could hang in a loading state. Now only the student's own data is cleared.
2. On phones, the admin course row's stats overflowed over the Publish button. They wrap now.
3. Bundle and drawer "ribbons" ran across the text and looked like grey bars. They're now a solid ribbon down the side, with a bow.
4. Gallery unit labels ("UNIT 1") wrapped onto two lines. Fixed.
5. The preview stamp text was too large and ran off the page. Resized.
6. The send loop could stay in "sending" when the last batch exactly hit the daily cap. It now finishes correctly.
7. The admin form selects had no accessible names (screen readers read the option list). Labelled.
8. Footer word mark was still using the old outline markup and stretched the page sideways. Rebuilt with the new stacked style.

## Visual review

Home (light and dark, desktop and phone), catalogue with the bundle box, course page with the preview strip, the preview viewer, bundle page, tool page, and the Import, Bundles, Courses and Tools & email admin tabs. Reduced-motion turns every animation off.

## Still to check on staging (needs your accounts)

- A real import of `drive-imports/23 Batch` (folder names may need a tweak to the unit parser; tell me any it gets wrong).
- PPTX/DOCX conversion and preview in GitHub Actions.
- Brevo: a test announcement to yourself, then the daily limit with the free plan.
- Razorpay test payment and webhook for a bundle.
