# Scholars Stack

A library catalogue for your semester. Handwritten notes for VIT Bhopal students, filed by **batch year → branch → course**, readable in a protected viewer on phone or laptop. Only `@vitbhopal.ac.in` accounts can sign in, notes can't be downloaded, and all sales are final.

- Design: the Scholars Stack UI canvas (drawers, divider tabs, index cards, shelf)
- Architecture decisions, limits and costs: the System Architecture doc

---

## Stack

| Part | Tech | Runs on |
| --- | --- | --- |
| Website | React 19 + Vite, TypeScript, Tailwind CSS v4, Radix UI, TanStack Query, Zustand | Cloudflare Worker static assets |
| API | Hono, TypeScript, Zod | Same Cloudflare Worker, under `/api` |
| Database + login | Supabase Postgres with Row Level Security, Supabase Auth (Google + email code) | Supabase (Mumbai) |
| Note files | Cloudflare R2, private bucket | Cloudflare |
| Page converter | TypeScript + LibreOffice + poppler | GitHub Actions runner, with jobs tracked in R2 and progress stored in Supabase |
| Payments | Razorpay Standard Checkout | Razorpay |
| Tooling | pnpm workspaces, Biome, Vitest, Playwright, Storybook, Supabase CLI, Wrangler | your laptop + CI |

One language end to end (TypeScript), plus SQL for the schema and security rules.

## Repository layout

```text
scholars-stack/
├── apps/
│   ├── web/                       # the website
│   │   └── src/
│   │       ├── app/               # providers, router, theme (light/dark)
│   │       ├── features/          # one folder per feature, each self-contained
│   │       │   ├── auth/          # sign in, OTP, session guard, signed-out sheet
│   │       │   ├── catalogue/     # drawers (batch), tabs (branch), index cards
│   │       │   ├── course/        # catalogue card, unit list, checkout panel
│   │       │   ├── checkout/      # Razorpay wrapper, "stamping your card" state
│   │       │   ├── shelf/         # My Courses as book spines, bookmark
│   │       │   ├── reader/        # canvas reader, tile unscramble, watermark
│   │       │   └── admin/         # sync R2, conversion status, publish
│   │       ├── shared/            # design-system components + stories
│   │       └── lib/               # api client, supabase client, query keys
│   └── api/                       # the Worker
│       └── src/
│           ├── domain/            # entities + ports (interfaces). Depends on nothing.
│           ├── application/       # use cases (services). Depends only on domain.
│           ├── infrastructure/    # adapters: Supabase, R2 manifests, Razorpay, crypto
│           ├── http/              # Hono routes + middleware. Thin.
│           └── composition.ts     # wires adapters into use cases (the only place that does)
├── packages/
│   └── contracts/                 # Zod schemas + TS types shared by web, api, converter
├── converter/                     # GitHub Actions runner: files → verified, scrambled page images
├── supabase/
│   ├── migrations/                # tables, RLS policies, the college-only signup hook
│   └── seed.sql                   # sample batches, branches, courses for local dev
├── .github/workflows/             # CI, deployment and the R2 conversion poller
├── scripts/                       # env-sync, secrets-push, setup
├── .env.example  SETUP.md  TASKS.md  CHANGELOG.md  README.md
└── pnpm-workspace.yaml
```

## How the code follows SOLID

The API is built in rings. Inner rings never import outer ones.

```text
http (routes, middleware)  →  application (use cases)  →  domain (entities, ports)
                                         ↑
                    infrastructure (adapters implement the ports)
```

| Principle | What it looks like here |
| --- | --- |
| **Single responsibility** | Each use case does one job: `StartCheckout`, `ConfirmPayment`, `ClaimDevice`, `OpenReader`, `ServePage`, `SyncCatalogue`. Routes only parse input, call one use case and shape the response. |
| **Open/closed** | New behaviour arrives as a new adapter or use case. Adding Cashfree means a new `CashfreeGateway`; nothing else changes. |
| **Liskov substitution** | Every adapter honours its port's contract, and each port has an in-memory fake used in tests, so use cases run the same against fakes or real services. |
| **Interface segregation** | Small ports instead of one big "database" object: `CourseCatalog`, `Entitlements`, `Orders`, `DeviceSessions`, `PageStore`, `PaymentGateway`, `ConversionQueue`, `TokenSigner`, `Clock`. |
| **Dependency inversion** | Use cases receive ports through their constructor. `composition.ts` builds the real adapters from env vars once per request; tests build fakes. |

The website mirrors this: each `features/*` folder owns its components, hooks and API calls; shared UI lives in `shared/`; nothing in one feature imports from another feature's internals.

## Notes in R2 and the admin import

Notes live in the private bucket `scholarstack`, uploaded exactly as exported from Google Drive under `drive-imports/`:

```text
drive-imports/23 Batch/Big Data Analytics/Module 1 - Hadoop basics/BDA-M1-notes.pdf
drive-imports/23 Batch/Big Data Analytics/PYQs/BDA-PYQ-2025.pdf
drive-imports/23 Batch/software_project_management/SPM full notes.pdf      # no unit folders → "Notes"
drive-imports/23 Batch/Sem 7 Electives/Natural Language Processing/Module 1/NLP-M1.pdf
```

**Admin → Import** shows this tree. The admin ticks the folders that should become courses (any depth), and for each one sets the title, batch year (guessed from "23 Batch"), branch, semester and price. Nothing goes live on its own:

- Each sub-folder of a course becomes a unit. "Unit 3 - Normalisation", "Module 2 - SQL", "02. Transactions" and "MOD_04 spark" are all understood and ordered by number; other names ("PYQs", "Revision") come after.
- Files directly inside the course folder go into a unit called "Notes". Thumbs.db, .DS_Store and Office lock files are ignored.
- Supported: PDF, PPT/PPTX, DOC/DOCX, ODP/ODT, JPG, PNG. Anything else is listed as skipped.
- Imported courses start as drafts. Their files are converted into protected pages, plus a watermarked first-page preview per unit. Then **Courses → Publish**.
- **Rescan imported courses** picks up files you add to an imported folder later.

**Bundles** (Admin → Bundles) sell several courses together, e.g. a whole batch, at a discount. A buyer who already owns some of them pays proportionally less and gets the rest. Single courses stay on sale.

**Tools & email**: the free toolbox on the home page (CGPA calculator and timetable maker are listed as "coming soon") and announcement emails to every student who has signed in. "Launch" on a tool makes it live and drafts its email; you preview, send yourself a test, then send. Each email has a one-click unsubscribe, and sends are paced to the daily email limit.

## Environment variables

One `.env` at the root. `pnpm env:sync` splits it into `apps/web/.env.local` (public `VITE_*` only) and `apps/api/.dev.vars` (Worker secrets), and lists anything still empty. `pnpm secrets:push -- production` sends the Worker's secrets to Cloudflare straight from that file. Every key is documented in `.env.example`, and SETUP.md says where to get each one.

## Everyday commands

```bash
pnpm dev:demo         # no accounts needed: in-memory API, test logins, fake payments
pnpm dev              # web on :5173 + local API on :8787, real Supabase/R2, local converter
pnpm --filter @ss/api dev:worker  # optional Wrangler Worker simulation; conversion uses the Worker adapter
pnpm db:start         # local Supabase (Docker)
pnpm db:reset         # re-apply migrations + seed
pnpm test             # Vitest, all packages
pnpm db:verify        # runs every migration + RLS check in PGlite (no Docker)
pnpm test:e2e         # Playwright flows against the demo server (build:demo first)
pnpm lint             # Biome
pnpm typecheck        # tsc --noEmit, all packages
pnpm deploy:staging   # build + wrangler deploy --env staging
```

Testing Razorpay webhooks locally needs a public URL: `pnpm tunnel` opens a Cloudflare quick tunnel to :8787 and prints the URL to paste into Razorpay's test webhook.

## Policies built into the product

- Sign-in only with `@vitbhopal.ac.in` (enforced by a database hook, RLS and the Worker).
- One signed-in device at a time, two registered devices per account.
- No downloads or printing; every page is watermarked with the reader's name.
- **All sales are final.** Shown on the course page and at checkout before payment.
