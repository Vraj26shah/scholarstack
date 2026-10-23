# Launching Scholars Stack

The order to go from this folder to a live site that takes payments and emails students. SETUP.md has the click-by-click details for each account; this guide is the sequence. Allow two evenings, plus a few days for Razorpay KYC.

Never paste a key or password into a chat, an issue or a screenshot. Worker keys live in your own `.env` and in Cloudflare (via `pnpm secrets:push`). The converter uses repository Actions secrets and free GitHub-hosted runners for public repositories.

---

## 0. How admin access works (there is no admin password)

Scholars Stack has no passwords at all, so there is nothing to leak or share.

- **Live site:** you are an admin when your college email is listed in `ADMIN_EMAILS` (comma-separated). Sign in the normal way (Google, or the 6-digit code to your inbox) and an **Admin** link appears in the top bar.
  - To add a co-admin, add their email to `ADMIN_EMAILS` and run `pnpm secrets:push -- production`.
- **Demo mode** (`pnpm dev:demo`): on the sign-in page, type `admin` and press Sign in. There's also `librarian` (a second admin).

Admins get the same two-device and one-session rules as everyone else.

---

## 1. Accounts (one evening, SETUP.md steps 0–7)

1. **Supabase**: the project, its URL and keys.
2. **Cloudflare**:
   - your account,
   - the private `scholarstack` bucket (you have it already),
   - an R2 API token,
   - an API token for deploys,
   - Turnstile.
4. **Google Cloud**: an OAuth client for "Continue with Google".
5. **Brevo**:
   - verify your domain,
   - an SMTP key for sign-in codes,
   - an **API key** for announcements.
6. **Razorpay**: start KYC now, and use test keys for everything until it's approved.
7. **This app's secrets**: generate five random secrets with `openssl rand -base64 32`.

Then on your laptop:

```bash
cp .env.example .env      # fill it in
pnpm install
pnpm env:sync             # lists anything still missing
```

---

## 2. Database (5 minutes)

The schema is described in **DATABASE.md**. Pick one way to apply it:

**A. One command (recommended).**
1. Create a personal access token: Supabase dashboard → your avatar → **Account → Access Tokens** → Generate.
2. Put it in `.env` as `SUPABASE_ACCESS_TOKEN`.
3. Run:
   ```bash
   pnpm ops db:apply     # every table, rule, function and the programme/subject data
   pnpm ops check        # confirms Supabase, R2, Brevo and Razorpay are all reachable
   ```
   `db:apply` also switches on the college-only sign-up hook, 10-minute access tokens and refresh-token rotation.

**B. Paste one file.** Open Supabase → SQL Editor, paste `supabase/apply-all.sql` and press Run. Then, in the dashboard:
1. Authentication → Hooks → **Before User Created** → `public.hook_vit_only`. This blocks every non-college email.
2. Authentication → Sessions: set the access-token lifetime to 600 seconds, and turn on refresh-token reuse detection.

Either way, also add your staging and production URLs under Authentication → URL configuration. Both ways are safe to repeat: migrations already applied are skipped.

---

## 3. First deploy, to staging (20 minutes)

The site runs on the Cloudflare Worker and private R2 bucket. The page converter runs from GitHub Actions and stores job manifests in R2; no Cloudflare Queues, Containers, or paid Workers plan are required for this conversion path.

1. Set the deployed URLs in `.env`, sign in with Wrangler, and deploy the Worker:
   ```bash
   pnpm --filter @ss/api exec wrangler login
   pnpm deploy:staging
   pnpm secrets:push -- staging
   ```
2. Add the seven Actions secrets listed in SETUP.md to the repository, enable Actions, and keep the workflow on the default branch.
3. Open the staging Worker URL. Sign in with your college email; you should see **Admin**. Use Actions → **Convert queued course files** → **Run workflow** to check the converter without waiting for the five-minute schedule.

---

## 4. Put your notes on sale (staging)

1. **Admin → Import.**
   - The folder tree refreshes when opened, on focus, and every 30 seconds; **Check for new folders** refreshes it on demand.
   - Tick each folder that is a course. Review or edit its title and course code; course codes preselect matching programmes. Choose the branch set, batch year, semester, price, and an existing draft bundle (or leave bundle membership for the Bundles tab), then **Import**.
   - Imported courses start as drafts. R2 stores each conversion job; GitHub Actions converts one file at a time and reports progress back to this panel.
2. When the run is green, go to **Admin → Courses**.
   - Each course shows its units, pages and previews.
   - Open a course page to check page one of every unit. A preview that isn't ready yet shows a loading skeleton, never a broken image.
   - Press **Publish** after review. Only published courses appear in the public catalogue; shared courses appear in every programme you assigned. Editing a published course or syncing changed R2 files moves it back to drafts.
3. **Admin → Bundles → New bundle.** Draft courses can be selected while the bundle stays in draft. The admin total adds each active course's current price and calculates the savings against the bundle price.
   - Pick 2023, then "Add every live 2023 course".
   - Press "Suggest ~30% off" (or type your own price), set Live, and save.
4. **Test a purchase** with Razorpay test mode:
   - Buy one course and one bundle. Use a card from Razorpay's test-card list (Razorpay docs → "Test Card Details") or test UPI, and pick **Success** on the test payment page.
   - Both should land on your shelf, and the reader should open.
   - To test the webhook on its own, close the tab right after paying: the course should still arrive within a minute.

If any folder or unit name comes out wrong, rename it in R2 and press **Rescan imported courses**, or edit the course in Admin → Courses.

**Reference books and textbooks.** Folders like "Reference Books" and files that look like publishers' textbooks are imported but **kept off the site**: not listed, previewed, sold or converted. You see them in Admin → Courses → **Files** and can show any that really are your own material.

**From the command line instead.** These do the same as the Admin screens, against your real Supabase and R2:
```bash
pnpm ops import "23 Batch"   # every subject folder → draft course (programmes from its course code)
pnpm ops convert             # pages + previews into R2, converted on this computer
pnpm ops publish --price 99  # publish every draft whose pages are ready
pnpm ops status              # files, pages, previews, buyers per course
pnpm ops serve               # the real site on http://localhost:8787 with live data
pnpm ops qa                  # live checks: database, security, admin, purchase, reader
pnpm ops broken > broken.csv # files whose R2 copy is a web page / empty: re-upload these
```

**Broken copies in R2.** Some Drive exports saved a Google sign-in page instead of the file. These show as "Needs a new copy" in Admin → Files and stay off the site. Download each one from Drive again (signed in), upload it to R2 over the same name, then run `pnpm ops import "23 Batch"` followed by `pnpm ops convert`. The file comes back by itself.

---

## 5. Email that reaches inboxes (30 minutes)

Two kinds of email go out, both through Brevo:

- **Sign-in codes**: Supabase sends them through Brevo SMTP.
- **Announcements**: the app sends them through the Brevo API (`BREVO_API_KEY`).

To keep them out of spam:

1. In Brevo → Senders, Domains & Dedicated IPs → **Domains**, add your domain. Copy the DKIM, SPF (Brevo code) and DMARC records into **Cloudflare DNS**, then press Verify in Brevo. Start with a DMARC record like `v=DMARC1; p=none; rua=mailto:you@your-domain.in`.
2. Send from an address on that domain, e.g. `EMAIL_FROM=hello@your-domain.in`. Never send from a Gmail address.
3. Admin → **Tools & email** → Write an email → **Send me a test**. Check that it lands in your college inbox (not spam), and that the button link and the "Stop these emails" link both work.

How announcements are delivered:

- They go to every student who has **signed in at least once** and kept emails on (Account → Emails). Students who have never signed in can't be emailed.
- Sending is paced to `EMAIL_DAILY_LIMIT`. If more students are waiting, the rest go out over the next days on the hourly schedule, and nobody gets it twice.
- Brevo's free plan allows about 300 emails a day **including sign-in codes**, so keep the limit near 200. For 5,000 students in one go, move to a paid Brevo plan and raise `EMAIL_DAILY_LIMIT`.
- Launching a free tool works the same way: Admin → Tools & email → **Launch & draft the email** makes the tool live and prepares the email. You read it, test it, then send.

---

## 6. Go live (one evening, once KYC is approved)

1. **Domain**:
   - Buy it and add it to Cloudflare.
   - Workers & Pages → `scholars-stack` → Settings → **Domains & Routes** → add your domain.
   - Set `APP_URL=https://your-domain.in` in `.env`.
2. Start with Cloudflare Workers Free. Its request allowance is separate from GitHub's free public runner; check Cloudflare usage if site traffic grows beyond the Free limits.
3. **Razorpay live**:
   - Generate live keys, and put them in `.env` and the public Vite variable `VITE_RAZORPAY_KEY_ID`.
   - Add a live webhook to `https://your-domain.in/api/webhooks/razorpay` with the events `payment.captured`, `payment.failed` and `payment.dispute.lost`.
4. **Google**: publish the OAuth consent screen ("In production") and add your domain to the authorised origins.
5. **Supabase**: set the Site URL to your domain.
6. **Contact email**: replace `[YOUR CONTACT EMAIL]` in `apps/web/src/features/legal/legal-pages.tsx`.
7. Deploy production from your computer with Wrangler:
   ```bash
   pnpm deploy:production
   pnpm secrets:push -- production
   ```
8. Re-import and publish your courses on production, the same as step 4, but with real payments. Test with one ₹1 course you then unpublish, if you like.

---

## 7. Telling everyone

Day one, nobody has signed in yet, so email can't reach them. Share the link where students already are:

- WhatsApp batch groups
- class representatives
- clubs

After that:

- Each new signup is opted in to announcements. Use **Admin → Tools & email** for new courses, new batches, bundles and new tools.
- Keep it to a few emails a semester. Every email carries a one-click unsubscribe.

---

## 8. After launch

- **Backups:** keep a scheduled database backup in Supabase or another storage account.
- **Uptime:** point UptimeRobot (free) at `https://your-domain.in/api/health`.
- **New batch:** upload `drive-imports/24 Batch/…` to R2, then Admin → Import → tick the folders → Import → wait for conversion → Publish → (optional) bundle → announce.
- **Changes to a course:** add or replace files in its R2 folder, then **Rescan imported courses**. Buyers get the new files automatically.
- **Problems:** check Admin → Storage audit for R2/Supabase/queue status and per-file progress, then Actions → **Convert queued course files** for runner logs.

---

## 9. Adding a new tool (and telling everyone)

Free tools (CGPA calculator, timetable maker, attendance tracker, …) live in the **Toolbox** section of the home page and at `your-domain.in/tools/<key>`. Anyone can use them without signing in.

**1. List it (2 minutes, no code).** Go to Admin → Tools & email → **Add a tool**.
- Give it a key (its web address, e.g. `attendance`), a name and a one-line description.
- It appears straight away in the home-page Toolbox as **Coming soon**. Visitors can open its page, and signed-in students can tap "Tell me when it's ready".

**2. Build its screen (code).**
- Create `apps/web/src/features/tools/attendance/attendance-tool.tsx`, exporting a default React component.
- Register it in `apps/web/src/features/tools/registry.ts`:
  ```ts
  import { lazy } from 'react';
  export const TOOL_SCREENS = {
    attendance: lazy(() => import('./attendance/attendance-tool')),
  };
  ```
- Optional: give it an icon in `tool-icon.tsx`. Otherwise it gets a sparkle.
- Run `pnpm dev:demo` to try it at `/tools/attendance`, then push to `main`. That deploys to staging; ship to production when you're happy.

**3. Launch and email.**
- Admin → Tools & email → on the tool's row, press **Launch & draft the email**. The tool goes live, and an email is drafted with its name, description and a button to `/tools/attendance`.
- Edit the wording if you like, press **Send me a test**, check your inbox, then press **Send to N students**.
- It reaches every student who has signed in at least once and kept emails on. Sending is paced to `EMAIL_DAILY_LIMIT` a day; anyone left over gets it on the following days, and nobody gets it twice. Every email has a one-click unsubscribe.

To hide a tool again, set its status to **Hidden**.
