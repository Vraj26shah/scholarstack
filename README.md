# Scholars Stack

Handwritten notes from VIT Bhopal seniors, sorted the way you'd look for them: batch, branch, course.

Live: https://scholarstack.campusnotes.workers.dev

I started this because every semester the same thing happens. Good notes exist, but they're
spread across WhatsApp groups and Drive links that stop working, nobody knows which ones match
the current syllabus, and the people who wrote them get nothing for it. Scholars Stack puts them
in one place, checks them, lets you read page one of every unit before paying, and pays the
seniors who wrote them.

## What it does

**For students**

- Sign in with your `@vitbhopal.ac.in` email (one-time code, no password).
- Pick your batch and branch and you get your drawer: the courses you're studying this term.
- Every unit has a free first page. Buy one course, or a semester bundle for less.
- Notes open in the reader on the site. There's no PDF to download; each page carries your name,
  email and the time it was opened, so a screenshot always says whose copy it was.
- Two devices per account. Removing one takes effect after three days.
- Free tools that don't need an account: CGPA calculator, attendance calculator, timetable.

**For seniors who write notes**

- Upload notes from the Contribute page (PDF, slides, Word, images or a ZIP).
- Every upload is checked by hand. Accepted notes earn a free course or cash; a complete course
  earns 30% of each sale while it's listed.

**For admins**

- Notes live in Cloudflare R2. A folder becomes a course in a few clicks, and file conversion to
  pages runs in the background.
- One course can be offered to several batches and branches. By default this follows the
  Winter 2026-27 course list by course code (CSE3003 goes to 2024 BCE and 2025 BCY, for example),
  and it can be set by hand per course.
- Inbox for student questions and uploads, emails to students, storage clean-up for R2 and the
  database, and a log of site errors.

## How it's built

```
apps/web        React 19 + Vite + Tailwind. The site and the admin panel.
apps/api        Hono on Cloudflare Workers. Also serves the built site.
packages/contracts   Zod schemas and types shared by both.
converter       Turns uploads into page images (LibreOffice, pdftoppm). Runs on GitHub Actions.
supabase        Postgres migrations, RLS policies, seed data.
scripts         Small helpers for env files, secrets and checks.
```

- **Database and sign-in:** Supabase (Postgres + Auth).
- **Files:** Cloudflare R2. Original notes and generated pages are kept in separate areas.
- **Payments:** Razorpay Standard Checkout. The order is created on the server, the signature is
  checked with HMAC-SHA256, and the course is unlocked only once Razorpay confirms the payment
  was captured. A webhook covers the cases where the browser never comes back.
- **Reader:** pages are stored as scrambled tiles and put back together on a canvas in the
  browser, with the watermark drawn into the same pixels.

The API is split into `domain` (entities and ports), `application` (use cases), `infrastructure`
(Supabase, R2, Razorpay adapters) and `http` (routes). There's an in-memory version of every
adapter, which is what the tests and demo mode use.

## Running it locally

You need Node 22 and pnpm.

```bash
git clone https://github.com/Vraj26shah/scholarstack.git
cd scholarstack
pnpm install
pnpm dev:demo
```

Open http://localhost:5173. Demo mode needs no accounts: everything runs in memory with sample
courses. Sign in with any `@vitbhopal.ac.in` address, or with `admin` to see the admin panel.
Payments are simulated.

To run against real services:

```bash
cp .env.example .env     # fill in Supabase, R2 and Razorpay keys
pnpm env:sync
pnpm db:start            # local Supabase (needs Docker)
pnpm db:reset            # migrations + seed data
pnpm dev                 # site on :5173, API on :8787
```

`SETUP.md` goes through each key and where to find it. `LAUNCH_GUIDE.md` covers going live.

## Commands

| Command | |
| --- | --- |
| `pnpm dev:demo` | Run everything in memory, no accounts needed |
| `pnpm dev` | Run with real Supabase, R2 and Razorpay |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm --filter @ss/web test:e2e` | Browser tests (Playwright, desktop and phone) |
| `pnpm lint` / `pnpm typecheck` | Biome and TypeScript |
| `pnpm db:verify` | Runs every migration in PGlite and checks the RLS rules |
| `pnpm secrets:push` | Sends the Worker's secrets from `.env` to Cloudflare |
| `pnpm tunnel` | Public URL for testing Razorpay webhooks locally |

## Deploying

Pushing to `main` runs the checks, applies `supabase/apply-all.sql` to the database (it is safe
to run more than once) and deploys the Worker. The GitHub secrets and variables it needs are
listed in `SETUP.md`.

Two things keep a free Supabase project from pausing: the Worker reads the database every hour
on its own cron, and a GitHub workflow queries it twice a day and fails loudly if it doesn't
answer.

For Razorpay, put `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` in `.env`
and run `pnpm secrets:push`; set `VITE_RAZORPAY_KEY_ID` as a GitHub Actions variable. The secret
never goes to the browser.

## Policies

- Only `@vitbhopal.ac.in` accounts can sign in.
- Two devices per student.
- No downloads or printing. Every page is watermarked with the reader's identity.
- All sales are final. That's why every unit has a free first page.

This is an independent student project and isn't affiliated with VIT Bhopal University.

## Contact

Vraj Shah ([@Vraj26shah](https://github.com/Vraj26shah)) · vraj1012006shah@gmail.com

Notes,support and anything about the site: vitbsmashers@gmail.com