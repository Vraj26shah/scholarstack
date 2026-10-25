# Security

How Scholars Stack protects accounts, payments and the notes themselves, what is tested,
what the operator still has to do, and which risks remain. Last reviewed 2026-10-23 (v0.7.0).

## Reporting a problem

Email the maintainers privately with what you found and how to reproduce it. Please don't
open a public issue for a security bug.

## Who can do what

| Caller | Can | Cannot |
| --- | --- | --- |
| Visitor | Browse the published catalogue; see page-one previews of visible files | Anything under `/me`, `/orders`, `/reader`, `/admin` (401) |
| Student (exactly `name@vitbhopal.ac.in`: no `+tags`, look-alike letters or doubled dots) | Buy; read what they own (until its access period ends) on up to 2 devices; manage their own profile, devices and orders | Read other students' orders or devices (404), use another student's viewer token (401), open hidden files or draft courses, reach any admin route (403) |
| Admin (an exact address in `ADMIN_EMAILS`; a non-college one such as a Gmail must also be in the database `admin_emails` list) | Every `/admin/*` route: import, sync, convert, publish, bundles, students & access, features, email | Become admin through the API (`PATCH /me` ignores `isAdmin`/`role`), with a look-alike or `+tag` copy of an admin address, or by signing up with the admin's address and a password |
| Converter | Report conversion results and progress | Anything without the shared `x-ss-converter` secret (403, constant-time compare) |
| Razorpay | Mark orders paid via the webhook | Anything without a valid HMAC signature over the raw body; amounts are checked against the order |

All 76 admin routes go through `requireAdmin`; the two converter callbacks check the converter secret. `apps/api/test/security.test.ts` checks each
one for 401 (visitor) and 403 (student).

Two public routes take input without a sign-in, by design:
- `POST /api/payments/razorpay/return` is Razorpay's redirect after a bank or wallet page. It grants nothing unless the Razorpay signature over `order_id|payment_id` is valid **and** Razorpay confirms the payment is captured for that order and amount. A forged or failed result only ever leads to the "didn't go through" receipt.
- `POST /api/problems` is the browser's problem report for the admin's Problems log. It is rate limited per (hashed) IP, capped at 4 KB, validated, and emails, tokens and payment ids are removed before saving. Nothing from it is ever shown to students or executed.

## Authentication

- **Sign-in** is Supabase Auth: Google, or a one-time email code. JWTs are verified inside the API
  against Supabase's JWKS (signature, issuer, audience and expiry). No session secret is held in
  the browser beyond Supabase's own tokens.
- **Typing an address proves nothing.** The API accepts a session only if it was opened by proving
  the inbox: a Google login or an emailed one-time code/link (the token's `amr`). Password and
  anonymous sessions are refused outright, so nobody can sign up with someone else's address and
  a password, including the admin's (`apps/api/test/auth.test.ts`).
- **One inbox, one account.** College addresses must be exactly `name@vitbhopal.ac.in` (ASCII
  letters, digits, dots, hyphens, underscores; no `+tags`, no leading, trailing or doubled dots),
  checked identically in the browser, the API and the database sign-up hook.
- **Admins** are an exact list. `ADMIN_EMAILS` gives admin rights in the API; the database table
  `admin_emails` (no policies, unreadable by students) lets those addresses past the college-only
  sign-up hook. `pnpm ops admins:sync` keeps the two identical. No admin address is in the
  website's code.
- **After sign-in** a student only ever returns to a page on this site (never an outside address).
- **Devices:** each account may be signed in on 2 devices. A device is bound by an `HttpOnly`,
  `Secure`, `SameSite=Strict` signed cookie (`DEVICE_COOKIE_SECRET`). The student sees and
  removes devices under Account.
- **Turnstile** (Cloudflare) guards sign-in against bots. Its token is checked by Supabase Auth's
  captcha protection, so turn that on in Supabase (see the checklist).

## Protecting the notes

- Original PDFs and slides stay in **R2** and are never sent to a browser. Students receive page
  images produced by the converter.
- Every page image is **tile-scrambled** on the server with a per-page seed derived from
  `TILE_SEED_SECRET`. The reader reassembles it on a canvas, and no `<img>` or file URL ever appears.
- The reader's **name and email watermark** is painted into the page pixels, diagonally.
- **Viewer tokens:** reading a page needs both a short-lived viewer token (HMAC,
  `VIEWER_TOKEN_SECRET`, 120 s by default and renewed by the heartbeat) and the student's sign-in.
  The token names the file and the user. A token copied to another account, or used for another
  file, is refused.
- **One reading lease per account:** opening a file on a second screen pauses the first.
- **Page rate limit:** 40 requests a minute per key, using the Cloudflare `PAGE_LIMITER` binding
  in production. The same limiter slows checkout, profile edits, device removal and unsubscribe
  bursts (429).
- Right-click, drag and text selection are disabled on the page, and the reader veils itself
  after inactivity and when the tab is hidden.

## Payments

- Orders are created on the server with the server's price. The browser never sends an amount.
- `POST /orders/verify` and the webhook both check Razorpay's HMAC signature
  (`RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET`). A forged signature marks nothing as paid,
  and that is tested.
- Grants are idempotent: a payment that is verified twice grants once.

## Database

- **Row Level Security is on for all 24 tables** (`supabase/migrations`). The browser's anon key
  can read only what the policies allow; the API uses the service role on the server only.
- Queries go through the Supabase client with parameters. No SQL is built from strings, and
  injection-shaped input gets a 4xx (tested).

## Web hardening

- **Content Security Policy** (`apps/web/public/_headers`): scripts only from self, Razorpay
  and Cloudflare Turnstile; `object-src 'none'`; `frame-ancestors 'none'`; `base-uri 'self'`;
  `form-action 'self'`.
- **Other headers:** HSTS (1 year), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, and a Permissions-Policy that turns off the
  camera, microphone and location. The API adds the same protective headers to every response
  (tested).
- **Email preview:** the admin email preview renders in an `<iframe sandbox="">`.
- **React** escapes all text. There are no `dangerouslySetInnerHTML` paths for user content.

## Secrets

- All secrets live in environment files that are **not** in the repository or the handover zip:
  `.env`, `apps/api/.dev.vars` and `apps/web/.env.local`. `.env.example` lists every variable.
- The Worker refuses to start if `VIEWER_TOKEN_SECRET`, `DEVICE_COOKIE_SECRET`,
  `TILE_SEED_SECRET` or `CONVERTER_CALLBACK_SECRET` is shorter than 32 characters.
- Generate new ones with `openssl rand -base64 48`. In production, set them with
  `wrangler secret put <NAME>`.

## Dependencies

- `pnpm audit` reports **0 known vulnerabilities** as of 2026-10-23. sharp was upgraded to
  0.35.5 and vitest to 4.1.12 to clear earlier advisories.
- Re-run `pnpm audit` before each release; Dependabot is recommended on the repository.

## Tests that guard this

`pnpm -r test` runs 217 unit and integration tests, 55 of them in
`apps/api/test/security.test.ts`:

- admin route access;
- privilege escalation;
- converter callback secrets;
- cross-user orders, devices and viewer tokens;
- page-number abuse;
- forged webhooks and signatures;
- rate limits;
- draft and hidden content;
- malformed input never producing a 500;
- demo routes being absent from production;
- response headers.

## Operator checklist before launch

1. Put production secrets in place with `wrangler secret put`, each newly generated and at least
   32 characters long. Never reuse the demo or `.dev.vars` values.
2. In Supabase:
   - restrict Auth redirect URLs to the production domain;
   - turn on email OTP rate limits;
   - keep the service-role key server-side only.
3. Set the Razorpay webhook secret and point the webhook at `/api/webhooks/razorpay`.
4. Create the Turnstile site for the production domain. Put the site key in the web app's env and
   the secret in Supabase → Authentication → Bot and abuse protection (captcha on).
5. Admins: put the exact addresses in `ADMIN_EMAILS`, run `pnpm ops db:apply`, then
   `pnpm ops admins:sync`. Keep the list short. Admins sign in at `/sign-in?admin=1` (or by
   opening `/admin`) with Google or the emailed link.
6. In Supabase → Authentication → Sign In / Providers → Email, keep **Confirm email** on
   (`pnpm ops db:apply` sets it). The app refuses password sessions anyway.
7. Keep the converter's callback secret identical on both sides, and keep the converter off the
   public internet apart from its callback.

## Known limits (be honest with users)

- **Screenshots and phone cameras cannot be blocked** by any website. The watermark is the
  deterrent: every leaked page carries the reader's name and email.
- Without the Cloudflare `PAGE_LIMITER` binding (for example in local development), rate
  limiting falls back to in-memory counters, which apply per Worker instance only.
- The demo server (`pnpm start:demo`) uses in-memory adapters and fake payments. It is for
  local testing only and must never be exposed publicly.
