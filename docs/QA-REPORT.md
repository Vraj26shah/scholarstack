# QA report — 0.6.0 (2026-10-23)

Everything below was run on the demo server (in-memory API, same routes and use cases as
production). The live Supabase project and R2 bucket were **not** exercised in this pass;
run `pnpm ops qa` against them before release.

## Automated checks

| Check | Result |
|---|---|
| Biome lint (171 files) | 0 errors, 0 warnings |
| TypeScript (api, web, converter, contracts) | 0 errors |
| API unit tests | 123 passed |
| Converter tests (incl. real PDF render) | 10 passed |
| Web unit tests | 15 passed |
| Browser tests, desktop + phone | 54 passed (12 desktop-only admin tests skipped on phone) |
| Production build (`pnpm build`) | OK |

New browser tests in this release:
- `e2e/reader-navigation.spec.ts`: move from Module 1 to Module 2 in the sidebar; open another module from the Contents panel while in full screen; check the page fits the phone width; wheel-zoom (desktop) or button-zoom (phone); AI button in full screen; "up next" on the last page.
- `e2e/admin-features.spec.ts`: every admin section and feature (see CHANGELOG 0.5.0).

## Error sweep (`apps/web/scripts/error-sweep.mjs`)

Every page was visited on desktop light, desktop dark and phone, signed out and signed in, plus
every admin section in light and dark. It also forced these cases:
- wrong course and bundle links;
- a fake reader file;
- someone else's file;
- an API outage;
- going offline.

### Found and fixed

| # | Problem | Where | Fix |
|---|---|---|---|
| 1 | After opening a file in one module you could not reach other modules in full screen (no contents there). On phones the contents list sits below the page and is easy to miss. | Reader | "Contents" button in the reader toolbar (normal and full screen) opens every module and file. Switching files stays in full screen. |
| 2 | Collapsed modules kept their file links focusable and clickable underneath the unit rows, which could swallow taps. | Reader sidebar | Collapsed lists are `inert` and hidden from screen readers. |
| 3 | The page could be wider than a phone screen (fixed 660 px), cutting off the right side of the notes. | Reader, phones | The reader re-measures the screen once the page area appears; a test checks the width. |
| 4 | With the catalogue API down, the home page showed loading placeholders for about 7 s before any message. | Home | Faster retries (0.5 s, 1 s): the message shows in about 2.4 s and "Try again" recovers. |
| 5 | Server failures showed raw internal text to students (for example "down"). | All student pages | Students see a calm sentence; the admin still sees the real server detail. |
| 6 | Mouse-wheel zoom jumped about 30% per notch (100% → 286% in four notches). | Reader, full screen | About 15% per notch. |
| 7 | The scribbled-circle doodle sat behind the "Free student tools" button. | Home hero | Moved. |

### Remaining messages (not bugs in this code)

| Message | Why it appears | Action |
|---|---|---|
| Requests to `challenges.cloudflare.com` failing (401, tunnel failures, CSP `data:` refusals, media and WebGL warnings) | Cloudflare Turnstile's own frame, which cannot reach its servers from the test sandbox. | None. It works on the real network. |
| `WebGPU Context Provider` warning | The headless test browser has no GPU. | None. |
| One `OTS parsing error` for a WOFF2 font, seen once and not reproducible | A tiny letter-subset Google font through the sandbox proxy. The font still loaded. | Watch the browser console after deploy. If it appears there, drop the `text=` subset in `index.html`. |
| 404s for `/c/not-a-real-course`, `/b/not-a-real-bundle`, a fake reader file | Deliberate bad links. Each page shows a clear "not found" message. | None. |

## Speed (`apps/web/scripts/perf-check.mjs`)

Simulated mid-range phone on 4G (9 Mbps, 60 ms latency, 4× slower CPU), demo server.

| Measure | Before | After |
|---|---|---|
| First visit, data downloaded | 728 KB | 159 KB |
| Repeat visit, data downloaded | 510 KB | 5 KB |
| Course card → course page | 449 ms | ~310 ms |
| Back to home | 202 ms | 133 ms |

What changed:
- **Fonts:** the logo font and the handwriting font are fetched as letter subsets.
- **Libraries:** split into long-cached files.
- **Prefetching:** a card loads its course and first previews on hover, focus or touch. The reader's code loads while you browse a course you own or your shelf. (The reader already preloaded the next three pages.)
- **Demo server:** compresses responses and caches assets like production does.

## Not covered by this pass

- Live Razorpay payments, real email sending, and Google sign-in on the real domain. These need live keys; run `pnpm ops qa`.
- Very large real PDFs through the GitHub Actions converter. The chunked renderer was tested on a real 31-page PDF locally.
