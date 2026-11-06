// Browser QA against the REAL Supabase project and R2 bucket (not demo data).
// Start the live server first:  ADMIN_EMAILS=<qa admin> PORT=8790 pnpm ops serve
// Then:  QA_BASE=http://localhost:8790 QA_ADMIN=<email> QA_STUDENT=<email> QA_PASSWORD=<pw> node e2e-live/live-tour.mjs
// It signs in with real Supabase sessions, walks every screen, and saves screenshots.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, devices } from '@playwright/test';

const base = process.env.QA_BASE ?? 'http://localhost:8790';
const out = process.env.QA_SHOTS ?? 'live-shots';
mkdirSync(out, { recursive: true });
const ref = new URL(process.env.SUPABASE_URL).hostname.split('.')[0];
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function session(email) {
  const r = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: process.env.QA_PASSWORD }),
  });
  const s = await r.json();
  if (!s.access_token) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(s).slice(0, 200)}`);
  return { ...s, expires_at: Math.floor(Date.now() / 1000) + s.expires_in };
}

async function context(browser, opts, s) {
  const ctx = await browser.newContext(opts);
  if (s) {
    await ctx.addInitScript(
      ([key, value]) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, value);
      },
      [`sb-${ref}-auth-token`, JSON.stringify(s)],
    );
  }
  return ctx;
}

async function imagesLoaded(page, selector = 'img') {
  return page.evaluate(
    (sel) =>
      [...document.querySelectorAll(sel)].map((i) => ({
        src: i.getAttribute('src'),
        ok: i.complete && i.naturalWidth > 0,
      })),
    selector,
  );
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
try {
  const shoot = async (page, name) => page.screenshot({ path: `${out}/${name}.png` });

  // ── Signed out: catalogue with real covers from R2 ──
  for (const [tag, opts] of [
    ['desktop', { viewport: { width: 1440, height: 900 } }],
    ['phone', devices['Pixel 7']],
  ]) {
    const ctx = await context(browser, opts);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
    page.on(
      'console',
      (m) => m.type() === 'error' && !/favicon/.test(m.text()) && errors.push(`${tag} console: ${m.text()}`),
    );
    const csp = (await page.goto(`${base}/`)).headers()['content-security-policy'] ?? '';
    if (tag === 'desktop')
      check(
        'site pages carry the security headers (CSP, no framing)',
        csp.includes("frame-ancestors 'none'"),
      );
    await page.waitForTimeout(1500);
    await shoot(page, `${tag}-01-home`);
    await page.goto(`${base}/?batch=2023#catalogue`);
    await page.locator('#catalogue').scrollIntoViewIfNeeded();
    await page.waitForTimeout(3500);
    await shoot(page, `${tag}-02-catalogue-2023`);
    const cardCount = await page.locator('#catalogue a[href^="/c/"]').count();
    check(`${tag}: catalogue drawer lists live courses from Supabase`, cardCount > 0, `${cardCount} cards`);

    const first = page.locator('#catalogue a[href^="/c/"]').first();
    const href = await first.getAttribute('href');
    await page.goto(`${base}${href}`);
    await page.waitForTimeout(3500);
    await shoot(page, `${tag}-03-course`);
    await page.locator('#peek-title').scrollIntoViewIfNeeded();
    await page.waitForTimeout(2500);
    await shoot(page, `${tag}-04-page-one-of-every-module`);
    // Thumbnails load lazily as they scroll into view, so fetch every one directly.
    const peekStatus = await page.evaluate(async () =>
      Promise.all(
        [...document.querySelectorAll('section[aria-labelledby="peek-title"] img')].map(async (i) => {
          const r = await fetch(i.getAttribute('src'));
          return r.ok && (r.headers.get('content-type') ?? '').startsWith('image/');
        }),
      ),
    );
    check(
      `${tag}: page one of every module loads from R2`,
      peekStatus.length > 0 && peekStatus.every(Boolean),
      `${peekStatus.filter(Boolean).length}/${peekStatus.length}`,
    );
    await page
      .getByRole('button', { name: /Preview page 1 of/ })
      .first()
      .click();
    await page.waitForTimeout(2500);
    await shoot(page, `${tag}-05-preview-lightbox`);
    await page.keyboard.press('Escape');
    const books = page.locator('#books-title');
    if (await books.count()) {
      await books.scrollIntoViewIfNeeded();
      await page.waitForTimeout(600);
      await shoot(page, `${tag}-06-recommended-books`);
    }
    await ctx.close();
  }

  // A course that has reference books, to show the reading list.
  {
    const ctx = await context(browser, { viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const slugs = JSON.parse(process.env.QA_BOOK_SLUGS ?? '[]');
    for (const slug of slugs.slice(0, 1)) {
      await page.goto(`${base}/c/${slug}`);
      await page.waitForTimeout(2500);
      const n = await page.locator('#books-title').count();
      check('course page lists recommended books (titles only, no files)', n === 1);
      if (n) {
        await page.locator('#books-title').scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await shoot(page, 'desktop-07-recommended-books');
      }
    }
    await ctx.close();
  }

  // ── Admin with a real Supabase session ──
  {
    const ctx = await context(
      browser,
      { viewport: { width: 1440, height: 1000 } },
      await session(process.env.QA_ADMIN),
    );
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`admin: ${e.message}`));
    await page.goto(`${base}/favicon.svg`); // same origin, before the app starts
    await page.evaluate(async () => {
      const key = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
      const token = JSON.parse(localStorage.getItem(key)).access_token;
      await fetch('/api/session/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ label: 'QA admin laptop' }),
      });
    });
    await page.goto(`${base}/admin`);
    await page
      .getByText('23 Batch')
      .first()
      .waitFor({ timeout: 20_000 })
      .catch(() => {});
    await shoot(page, 'admin-01-import-from-r2');
    check('admin: R2 import tree loads', (await page.getByText('23 Batch').count()) > 0);
    await page.getByRole('tab', { name: 'Courses' }).click();
    await page.waitForTimeout(3000);
    await shoot(page, 'admin-02-courses');
    const row = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('button', { name: 'Files', exact: true }) })
      .filter({ hasText: 'kept off the site' })
      .first();
    if (await row.count()) {
      await row.getByRole('button', { name: 'Files', exact: true }).click();
      await page.waitForTimeout(2500);
      await row.scrollIntoViewIfNeeded();
      await shoot(page, 'admin-03-files-hidden-books-and-broken-copies');
      check(
        'admin: Files panel shows hidden books with switches',
        (await row.getByRole('switch').count()) > 0,
      );
    }
    // Edit a course description through the UI and check it saved.
    const editRow = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('button', { name: 'Edit', exact: true }) })
      .first();
    await editRow.getByRole('button', { name: 'Edit', exact: true }).click();
    const desc = editRow.getByRole('textbox').last();
    const before = await desc.inputValue();
    const marker = `Checked by QA ${Date.now().toString(36)}`;
    await desc.fill(marker);
    await shoot(page, 'admin-04-editing-a-course');
    await editRow.getByRole('button', { name: 'Save changes' }).click();
    await page.waitForTimeout(2500);
    const api = await page.evaluate(async () =>
      (
        await fetch('/api/admin/courses', {
          headers: {
            authorization: `Bearer ${JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith('-auth-token')))).access_token}`,
          },
        })
      ).json(),
    );
    check('admin: editing in the UI saves to Supabase', JSON.stringify(api).includes(marker));
    writeFileSync(`${out}/edit-revert.json`, JSON.stringify({ marker, before }));
    await page.getByRole('tab', { name: /Tools/ }).click();
    await page.waitForTimeout(2000);
    await shoot(page, 'admin-05-tools-and-email');
    await page.getByRole('tab', { name: 'Bundles' }).click();
    await page.waitForTimeout(2000);
    await shoot(page, 'admin-06-bundles');
    await ctx.close();
  }

  // ── Student: shelf and the protected reader ──
  if (process.env.QA_READ_FILE) {
    const ctx = await context(
      browser,
      { viewport: { width: 1440, height: 900 } },
      await session(process.env.QA_STUDENT),
    );
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`student: ${e.message}`));
    // Same step the sign-in page takes after a successful sign-in: claim this device.
    await page.goto(`${base}/favicon.svg`); // same origin, before the app starts
    const claim = await page.evaluate(async () => {
      const key = Object.keys(localStorage).find((k) => k.endsWith('-auth-token'));
      const token = JSON.parse(localStorage.getItem(key)).access_token;
      const r = await fetch('/api/session/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ label: 'QA laptop' }),
      });
      return r.status;
    });
    check('a fresh sign-in on a new device takes the session over', claim === 200, `HTTP ${claim}`);
    await page.goto(`${base}/shelf`);
    await page.waitForTimeout(4000);
    await shoot(page, 'student-01-shelf');
    const pages = [];
    page.on('response', (r) => r.url().includes('/api/reader/pages/') && pages.push(r.status()));
    await page.goto(`${base}/read/${process.env.QA_READ_FILE}`);
    await page.waitForTimeout(9000);
    await shoot(page, 'student-02-reader');
    check(
      'reader: page images stream from R2 and are reassembled',
      pages.length > 0 && pages.every((s) => s === 200),
      `${pages.length} page requests`,
    );
    await ctx.close();
  }

  check('no JavaScript errors on any screen', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  writeFileSync(`${out}/checks.json`, JSON.stringify({ checks, errors }, null, 2));
}
