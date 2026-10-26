# Scholars Stack — your setup checklist

Everything here is a one-time job you do in your own accounts. Each step ends with the exact `.env` keys it fills. Work top to bottom; the whole list takes about 2–3 hours, most of it waiting for Razorpay KYC.

> **Don't send me your secrets.** Keep `.env` on your laptop. I build against `.env.example`; you fill the real values locally and push production secrets with `pnpm secrets:push`. If you want me to check something, paste the key *names*, never the values.

Dashboard menu names below can move around between releases. If a label doesn't match, search the provider's docs for the item in **bold**.

---

## 0. Before you start (10 min)

- [ ] Install **Node.js 22+** and **pnpm** (`npm i -g pnpm`). Docker Desktop is only needed if you run Supabase locally.
- [ ] Decide the site name and domain, for example `scholarsstack.in`. You can launch on the free `*.workers.dev` address first and add the domain later.
- [ ] Create a password manager entry called "Scholars Stack" to hold every key you collect below.
- [ ] `cp .env.example .env` in the project folder.

## 1. Supabase — database and login (30 min)

- [ ] Create a project. Region **Mumbai (ap-south-1)**. Save the **database password**.
  → `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` (the id in the project URL)
- [ ] Project Settings → **API Keys**: copy the URL, the **publishable key** and the **secret key**.
  → `VITE_SUPABASE_URL`, `SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
- [ ] Account → **Access Tokens** → create one for the CLI.
  → `SUPABASE_ACCESS_TOKEN`
- [ ] Authentication → **Sign In / Providers**:
  - Turn **Email** on, with **email OTP** (6-digit code). Turn **password sign-up off**.
  - Leave **Google** for step 4.
- [ ] Authentication → **Sessions / JWT**: set access token expiry to **3600 seconds** (1 hour). Keep **refresh token rotation** and its **10-second reuse interval** on.
- [ ] Authentication → **URL Configuration**: Site URL `http://localhost:5173` for now; add your real domain later. Add both to the redirect allow list.
- [ ] After I push the code, run `pnpm db:push`. Then in Authentication → **Hooks**, turn on **Before User Created** and pick the Postgres function `public.hook_vit_only`. This is the wall that blocks non-college emails.

## 2. Cloudflare — website, API, files, bot check, and conversion (30 min)

- [ ] Create a free account. Note the **Account ID** (right side of the dashboard home).
  → `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCOUNT_ID`
- [ ] **R2** → your bucket `scholarstack` (already made). Keep it **private**: no public access, no r2.dev URL, no custom domain on the bucket. If you ever rename it, change `bucket_name` in `apps/api/wrangler.jsonc` too.
  → `R2_BUCKET`
- [ ] R2 → **Manage API tokens** → create a token with **Object Read & Write** for this bucket only.
  → `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- [ ] My Profile → **API Tokens** → create from the **Edit Cloudflare Workers** template.
  → `CLOUDFLARE_API_TOKEN`
- [ ] **Turnstile** → add a widget for `localhost` and your domain, mode **Managed**. Copy both keys.
  → `VITE_TURNSTILE_SITE_KEY`; paste the **secret key** into Supabase → Authentication → Attack Protection → **CAPTCHA** (provider: Turnstile).
- [ ] This repository is public, so GitHub's standard `ubuntu-latest` runner is free for Actions jobs. That covers converter compute; Cloudflare Worker and R2 usage still follows Cloudflare's own limits and pricing.
- [ ] Set `APP_URL_PRODUCTION` (and optionally `APP_URL_STAGING`) to the deployed `https://…workers.dev` or custom domain before running `pnpm secrets:push`.
- [ ] In the GitHub repository, add these **Actions repository secrets** (Settings → Secrets and variables → Actions): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `TILE_SEED_SECRET`, `CONVERTER_CALLBACK_URL`, and `CONVERTER_CALLBACK_SECRET`. Use an R2 token scoped to the `scholarstack` bucket with object read/write access. Set `CONVERTER_CALLBACK_URL` to the deployed Worker's `/api/internal/conversion` URL. Do not use the localhost value from `.env.example`.
- [ ] Enable Actions for the repository and keep `.github/workflows/convert-pages.yml` on its default branch. It polls R2 manifests every five minutes and can also be started manually from Actions → **Convert queued course files** → **Run workflow**. It processes up to five files per run, then picks up remaining jobs on later runs.
- [ ] `pnpm secrets:push` configures Worker secrets only. It does not copy credentials to GitHub. Keep the R2 credentials in GitHub Actions secrets for conversion and in your local `.env` only for local operations.
- [ ] Your notes are already in `scholarstack/drive-imports/23 Batch/…`. Keep adding batches the same way (`drive-imports/24 Batch/<Course>/<Unit>/<file>`). Nothing else to do here: you pick which folders become courses in **Admin → Courses → Add courses** after the first deploy.

## 4. Google sign-in (20 min)

- [ ] Google Cloud Console → new project "Scholars Stack" → **OAuth consent screen**: user type **External**, app name Scholars Stack, your support email. Add the scopes `email`, `profile`, `openid`.
- [ ] **Credentials** → Create **OAuth client ID** → type **Web application**.
  - Authorised redirect URI: `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`
- [ ] Paste the client ID and secret into Supabase → Authentication → Providers → **Google**, and turn it on.
- [ ] Publish the consent screen (move it from Testing to **In production**) before launch, or only test users can sign in.

## 5. Email for sign-in codes — Brevo (15 min)

- [ ] Create a free Brevo account (300 emails a day).
- [ ] **Senders & domains**: verify your domain (or a sender email for now). Add the DNS records Brevo shows you in Cloudflare DNS.
- [ ] **SMTP & API** → create an SMTP key.
- [ ] Supabase → Authentication → Emails → **SMTP settings**: host `smtp-relay.brevo.com`, port `587`, username = your Brevo login, password = the SMTP key, sender = `no-reply@your-domain.in`.
- [ ] For feature/course announcements: **SMTP & API → API keys** → generate an API key.
  → `BREVO_API_KEY`; set `EMAIL_FROM` to a verified sender on your domain.
- [ ] Mind the shared daily allowance: sign-in codes and announcements both count. With ~300/day free, keep `EMAIL_DAILY_LIMIT` around 200; longer sends continue automatically the next day. For 5,000 students in one go, move to a paid Brevo plan and raise the limit.

## 6. Razorpay — payments (20 min + KYC wait)

- [ ] Sign up and start **KYC** (PAN, bank account, website URL). Approval can take a few days, so start early. Your site needs visible **Terms**, **Privacy**, **Contact** and **"All sales are final"** wording; the pages ship with the code.
- [ ] In **Test mode**: Account & Settings → **API Keys** → generate.
  → `VITE_RAZORPAY_KEY_ID`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
- [ ] **Webhooks** → add `https://YOUR-DOMAIN/api/webhooks/razorpay` (use a tunnel URL while testing locally; README explains). Events: `payment.authorized`, `payment.captured`, `order.paid`, `payment.failed`, `payment.dispute.lost`. Also turn on **Settings → Payment Capture → Automatic** (the site captures authorised netbanking/UPI payments itself as a backup). Type a long random secret.
  → `RAZORPAY_WEBHOOK_SECRET`
- [ ] When KYC clears, generate **Live** keys and swap them into production only.

## 7. Generate this app's own secrets (2 min)

Run each line once and paste the output:

```bash
openssl rand -base64 32   # → VIEWER_TOKEN_SECRET
openssl rand -base64 32   # → DEVICE_COOKIE_SECRET
openssl rand -base64 32   # → CONVERTER_CALLBACK_SECRET
openssl rand -base64 32   # → TILE_SEED_SECRET   (set once, never change it after pages are converted)
```

Set `ADMIN_EMAILS` to your own college email.

## 9. Optional now, useful later

- [ ] **UptimeRobot** (free): monitor `https://YOUR-DOMAIN/api/health` every 5 minutes.
- [ ] **Domain**: buy it, add it to Cloudflare, then attach it to the Worker under Workers → your worker → **Domains & Routes**.

## 10. Configure Cloudflare and deploy (10 min)

Cloudflare Queues and Containers are not used. Build and deploy the Worker from this computer with Wrangler; GitHub Actions processes conversion jobs:

```bash
pnpm --filter @ss/api exec wrangler login
pnpm env:sync
pnpm deploy:staging
pnpm secrets:push -- staging
pnpm deploy:production
pnpm secrets:push -- production
```

The secrets script selects `APP_URL_STAGING` / `APP_URL_PRODUCTION` (or `APP_URL`) and sets the converter callback URL from that public origin. R2 S3 credentials are not sent to the Worker; add them separately as repository Actions secrets for the converter. They are never exposed to the browser.

## 11. First run

Want to see the demo before connecting real accounts? It does not require Cloudflare or Supabase:

```bash
pnpm install
pnpm dev:demo        # site on :5173, in-memory API on :8787
```

Sign in with any `@vitbhopal.ac.in` username (use `admin` for the admin page). Payments are simulated and notes are generated sample pages. Nothing is saved when you stop it.

With your real accounts:

```bash
pnpm install
pnpm env:sync        # splits .env into the web and api files
pnpm db:start        # local Supabase in Docker
pnpm db:reset        # applies migrations + seed data
pnpm dev             # site on :5173, local Node API on :8787; real Supabase/R2, conversion runs locally
```

Run the checks any time with `pnpm lint && pnpm typecheck && pnpm test && pnpm db:verify`, and the browser tests with `pnpm --filter @ss/web build:demo && pnpm test:e2e`.
