/**
 * Error sweep: visits every page (desktop light, desktop dark, phone) plus every admin section,
 * forces bad cases (wrong links, fake reader file, API outage, offline) and prints every console
 * error, crash and failed request, grouped.
 *   pnpm build:demo && pnpm --filter @ss/api start:demo   (WEB_DIST=../web/dist PORT=8791)
 *   PW_CHROMIUM=/path/to/chromium node scripts/error-sweep.mjs ./sweep-out
 * Expected noise: Cloudflare Turnstile requests when the challenge servers are unreachable.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://localhost:8791';
const out = process.argv[2] ?? 'sweep-out';
mkdirSync(out, { recursive: true });
const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const findings = [];
const note = (where, kind, detail) => findings.push({ where, kind, detail: String(detail).slice(0, 300) });

async function session(tag, opts) {
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  let where = 'start';
  p.on('pageerror', (e) => note(`${tag} ${where}`, 'crash', e.message));
  p.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      note(`${tag} ${where}`, `console.${m.type()}`, m.text());
  });
  p.on('response', (r) => {
    const u = r.url();
    if (r.status() >= 400 && !u.includes('/dev/'))
      note(`${tag} ${where}`, `HTTP ${r.status()}`, `${r.request().method()} ${u.replace(base, '')}`);
  });
  p.on('requestfailed', (r) => {
    const f = r.failure()?.errorText ?? '';
    if (!f.includes('ERR_ABORTED'))
      note(`${tag} ${where}`, 'request failed', `${r.url().replace(base, '')} ${f}`);
  });
  const visit = async (path, check) => {
    where = path;
    await p.goto(base + path);
    await p.waitForTimeout(1500);
    if (check) {
      try {
        await check();
      } catch (e) {
        note(`${tag} ${path}`, 'check failed', e.message.split('\n')[0]);
      }
    }
  };
  const user = `sweep${tag}${Date.now() % 10000}`;
  // Signed out
  await visit('/', () => p.locator('a[href^="/c/"]').first().waitFor({ timeout: 8000 }));
  await visit('/?batch=2023&branch=bce#catalogue');
  await visit('/c/dbms-2025-cse-core', () =>
    p.getByRole('heading', { name: 'Peek at page one' }).waitFor({ timeout: 8000 }),
  );
  await visit('/b/23-batch-complete-set');
  await visit('/tools/cgpa');
  await visit('/tools/timetable');
  await visit('/terms');
  await visit('/privacy');
  await visit('/contact');
  await visit('/nope', () => p.getByText('This card’s misfiled.').waitFor({ timeout: 5000 }));
  await visit('/c/not-a-real-course', () =>
    p
      .getByText(/not|find|misfiled/i)
      .first()
      .waitFor({ timeout: 5000 }),
  );
  await visit('/b/not-a-real-bundle', () =>
    p
      .getByText(/not|find|misfiled/i)
      .first()
      .waitFor({ timeout: 5000 }),
  );
  await visit('/shelf', () => p.waitForURL(/sign-in/, { timeout: 5000 }));
  await visit('/admin', () => p.waitForURL(/sign-in/, { timeout: 5000 }));
  await visit('/unsubscribe?token=bad');
  // Signed in
  await visit('/sign-in?next=%2Fshelf');
  await p.getByLabel('College email').fill(user);
  await p.getByRole('button', { name: 'Sign in', exact: true }).click();
  await p.waitForURL(/\/shelf/);
  await visit('/shelf');
  await visit('/account');
  await visit('/c/dbms-2025-cse-core');
  where = 'buy';
  await p.getByRole('button', { name: /Buy for ₹/ }).click();
  await p.getByText("It's on your").waitFor({ timeout: 20000 });
  await visit('/shelf');
  await visit('/c/dbms-2025-cse-core');
  const first = await p.locator('a[href^="/read/"]').first().getAttribute('href');
  await visit(first, () => p.getByRole('img', { name: 'Note page' }).waitFor({ timeout: 15000 }));
  where = 'reader turn pages';
  for (let i = 0; i < 3; i++) {
    await p.getByRole('button', { name: 'Next page' }).click();
    await p.waitForTimeout(400);
  }
  await visit('/read/00000000-0000-0000-0000-000000000000', () =>
    p
      .getByText(/can't open|can’t open|not/i)
      .first()
      .waitFor({ timeout: 8000 }),
  );
  await visit('/c/os-2023-cse-core');
  const other = await p
    .locator('a[href^="/read/"]')
    .first()
    .getAttribute('href')
    .catch(() => null);
  if (other)
    await visit(other, () =>
      p
        .getByText(/can't open|can’t open|buy|own/i)
        .first()
        .waitFor({ timeout: 8000 }),
    );
  await visit('/admin', () => p.waitForURL((u) => u.pathname === '/', { timeout: 5000 }));
  // API outage: the catalogue fails
  where = 'API outage';
  await p.route('**/api/catalogue**', (r) =>
    r.fulfill({
      status: 503,
      body: '{"error":{"code":"UNAVAILABLE","message":"down"}}',
      contentType: 'application/json',
    }),
  );
  await p.goto(`${base}/`);
  await p.waitForTimeout(4000);
  const outageText = await p.locator('body').innerText();
  if (!/try again|didn.t load|couldn.t|went wrong/i.test(outageText))
    note(`${tag} API outage`, 'no error message shown', 'home page with catalogue down');
  await p.screenshot({ path: `${out}/${tag}-outage.png` });
  await p.unroute('**/api/catalogue**');
  // Offline
  where = 'offline';
  await ctx.setOffline(true);
  await p.waitForTimeout(800);
  const offline = await p.locator('body').innerText();
  if (!/offline|no connection|connection/i.test(offline)) note(`${tag} offline`, 'no offline banner', '');
  await p.screenshot({ path: `${out}/${tag}-offline.png` });
  await ctx.setOffline(false);
  await ctx.close();
}

await session('desk', { viewport: { width: 1440, height: 900 } });
await session('dark', { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
await session('phone', { ...devices['Pixel 7'] });

// Admin: every section, light and dark
for (const scheme of ['light', 'dark']) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
  const p = await ctx.newPage();
  let where = `admin-${scheme}`;
  p.on('pageerror', (e) => note(where, 'crash', e.message));
  p.on(
    'console',
    (m) => (m.type() === 'error' || m.type() === 'warning') && note(where, `console.${m.type()}`, m.text()),
  );
  p.on(
    'response',
    (r) =>
      r.status() >= 400 &&
      note(where, `HTTP ${r.status()}`, `${r.request().method()} ${r.url().replace(base, '')}`),
  );
  await p.goto(`${base}/sign-in?next=%2Fadmin`);
  await p.getByLabel('College email').fill(scheme === 'light' ? 'admin' : 'librarian');
  await p.getByRole('button', { name: 'Sign in', exact: true }).click();
  await p.waitForURL((u) => u.pathname === '/admin');
  for (const name of [
    'R2 → Website',
    'Import courses',
    'Courses & publishing',
    'Bundles',
    'Features & email',
    'Full R2 audit',
  ]) {
    where = `admin-${scheme} ${name}`;
    await p
      .getByRole('tablist', { name: 'Admin sections' })
      .getByRole('tab', { name: new RegExp(`^${name.replace(/[&→]/g, '.')}`) })
      .click();
    await p.waitForTimeout(1500);
  }
  where = `admin-${scheme} compare everything`;
  await p.getByRole('tablist', { name: 'Admin sections' }).getByRole('tab', { name: /^R2/ }).click();
  await p.getByRole('radio', { name: /Everything in R2/ }).click();
  await p.getByRole('button', { name: 'Next: compare with the website' }).click();
  await p
    .getByText('Not in any course')
    .waitFor({ timeout: 20000 })
    .catch((e) => note(where, 'check failed', e.message.split('\n')[0]));
  await ctx.close();
}

await b.close();
writeFileSync(`${out}/findings.json`, JSON.stringify(findings, null, 2));
const grouped = {};
for (const f of findings) {
  const k = `${f.kind} :: ${f.detail}`;
  grouped[k] = grouped[k] ?? [];
  grouped[k].push(f.where);
}
for (const [k, w] of Object.entries(grouped))
  console.log(`${w.length}× ${k}\n     at: ${[...new Set(w)].slice(0, 6).join(' | ')}`);
console.log(`TOTAL findings: ${findings.length}`);
