import { type Browser, type Page, expect, test } from '@playwright/test';

const SHOTS = process.env.E2E_SHOTS; // folder for review screenshots (optional)
let n = 0;
async function shot(page: Page, name: string, info: { project: { name: string } }) {
  if (!SHOTS) return;
  n += 1;
  await page.screenshot({
    path: `${SHOTS}/${info.project.name}-${String(n).padStart(2, '0')}-${name}.png`,
    fullPage: true,
  });
}

const unique = (p: string) => `${p}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function signIn(page: Page, username: string, next = '/shelf') {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.locator('#email').fill(username);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => u.pathname === next.split('?')[0]);
}

async function buyDbms(page: Page) {
  await page.goto('/c/dbms-2025-cse-core');
  await page.getByRole('button', { name: /Buy for ₹/ }).click();
  await expect(page.getByText("It's on your")).toBeVisible({ timeout: 20_000 });
}

async function newPage(browser: Browser) {
  const ctx = await browser.newContext();
  return ctx.newPage();
}

test.describe('browsing (signed out)', () => {
  test('home shows drawers, branch tabs and cards; course shows files but locked', async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await shot(page, 'home', info);

    await page.getByRole('link', { name: /Find your notes/ }).click();
    const catalogue = page.locator('#catalogue');
    await catalogue.scrollIntoViewIfNeeded();
    await catalogue.getByRole('button', { name: /2nd year/ }).click();
    await catalogue.getByRole('tab', { name: /Computer Engineering/ }).click();
    const card = catalogue.getByRole('link', { name: /Database Management Systems/ });
    await expect(card).toBeVisible();
    await card.click();
    await page.waitForURL(/\/c\//);
    await expect(page.getByRole('heading', { name: /Database Management Systems/ })).toBeVisible();
    await expect(page.getByText(/unit-3|Normalisation/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Sign in to buy/ })).toBeVisible();
    await shot(page, 'course-locked', info);
    expect(errors).toEqual([]);
  });

  test('protected pages send you to sign in', async ({ page }) => {
    await page.goto('/shelf');
    await page.waitForURL(/\/sign-in\?next=%2Fshelf/);
  });

  test('unknown routes show the 404 card', async ({ page }) => {
    await page.goto('/nope/nothing');
    await expect(page.getByText('This card’s misfiled.')).toBeVisible();
  });
});

test.describe('sign in', () => {
  test('non-college email is rejected', async ({ page }, info) => {
    await page.goto('/sign-in');
    await page.locator('#email').fill('someone@gmail.com');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('vitbhopal.ac.in');
    await shot(page, 'sign-in-rejected', info);
  });

  test('college email signs in and lands on an empty shelf', async ({ page }, info) => {
    await signIn(page, unique('fresh'));
    await expect(page.getByText('An empty shelf, for now.')).toBeVisible();
    await shot(page, 'shelf-empty', info);
  });
});

test.describe('buy and read', () => {
  test('buy a course, see it on the shelf, open the protected reader', async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await signIn(page, unique('buyer'), '/c/dbms-2025-cse-core');
    await shot(page, 'course-signed-in', info);
    await page.getByRole('button', { name: /Buy for ₹/ }).click();
    await expect(page.getByText("It's on your")).toBeVisible({ timeout: 20_000 });
    await shot(page, 'checkout-paid', info);

    await page.goto('/shelf');
    await expect(page.getByRole('link', { name: /Database Management Systems/ }).first()).toBeVisible();
    await shot(page, 'shelf-owned', info);

    await page.goto('/c/dbms-2025-cse-core');
    const fileLink = page.locator('a[href^="/read/"]').first();
    await expect(fileLink).toBeVisible();
    await fileLink.click();
    await page.waitForURL(/\/read\//);

    const canvas = page.getByRole('img', { name: 'Note page' });
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    // The canvas has real pixels drawn (not blank).
    await expect
      .poll(async () =>
        canvas.evaluate((c: HTMLCanvasElement) => {
          const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          let dark = 0;
          for (let i = 0; i < d.length; i += 400) if (d[i]! < 200) dark++;
          return dark;
        }),
      )
      .toBeGreaterThan(10);
    // No <img> or file URL for the page exists in the DOM.
    expect(await page.locator('main img').count()).toBe(0);
    await shot(page, 'reader', info);

    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.getByLabel('Page number')).toHaveValue('2');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByLabel('Page number')).toHaveValue('3');
    expect(errors).toEqual([]);
  });

  test('page images come back scrambled and cannot be cached', async ({ page }) => {
    await signIn(page, unique('net'), '/c/dbms-2025-cse-core');
    await buyDbms(page);
    await page.goto('/c/dbms-2025-cse-core');
    const responses: { status: number; cache: string | null; type: string | null; seed: string | null }[] =
      [];
    page.on('response', (r) => {
      if (r.url().includes('/api/reader/pages/'))
        responses.push({
          status: r.status(),
          cache: r.headers()['cache-control'] ?? null,
          type: r.headers()['content-type'] ?? null,
          seed: r.headers()['x-ss-tiles'] ?? null,
        });
    });
    await page.locator('a[href^="/read/"]').first().click();
    await expect(page.getByRole('img', { name: 'Note page' })).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => responses.length).toBeGreaterThan(0);
    const first = responses[0]!;
    expect(first.status).toBe(200);
    expect(first.cache).toContain('no-store');
    expect(first.type).toContain('image/webp');
    expect(first.seed).toMatch(/^[0-9a-f]{32}$/);

    // The page URL replayed without the viewer token is refused.
    const url = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .find((u) => u.includes('/api/reader/pages/')),
    );
    const replay = await page.request.get(url!);
    expect(replay.status()).toBe(401);
  });
});

test.describe('anti-sharing', () => {
  test('two devices stay signed in at once', async ({ page, browser }, info) => {
    const user = unique('shared');
    await signIn(page, user);
    const other = await newPage(browser);
    await signIn(other, user);
    await page.reload();
    await expect(page).toHaveURL(/\/shelf/);
    await expect(other).toHaveURL(/\/shelf/);
    await expect(page.getByText('An empty shelf, for now.')).toBeVisible({ timeout: 10_000 });
    await shot(page, 'two-devices', info);
    await other.context().close();
  });

  test('a third device is refused', async ({ page, browser }, info) => {
    const user = unique('three');
    await signIn(page, user);
    const b = await newPage(browser);
    await signIn(b, user);
    const c = await newPage(browser);
    await c.goto('/sign-in');
    await c.getByLabel('College email').fill(user);
    await c.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(c.getByText('Two devices already.')).toBeVisible({ timeout: 10_000 });
    await shot(c, 'device-limit', info);
    await b.context().close();
    await c.context().close();
  });

  test('a third device replaces an old one immediately', async ({ page, browser }) => {
    const user = unique('swap');
    await signIn(page, user);
    const other = await newPage(browser);
    await signIn(other, user);
    const replacement = await newPage(browser);
    await replacement.goto('/sign-in?next=%2Fshelf');
    await replacement.getByLabel('College email').fill(user);
    await replacement.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(replacement.getByText('Two devices already.')).toBeVisible({ timeout: 10_000 });
    await replacement.getByRole('button', { name: 'Remove and sign in here' }).first().click();
    await expect(replacement).toHaveURL(/\/shelf/, { timeout: 10_000 });
    await expect(replacement.getByText('An empty shelf, for now.')).toBeVisible({ timeout: 10_000 });
    await expect(replacement.getByText('New device on hold.')).toHaveCount(0);
    await other.context().close();
    await replacement.context().close();
  });

  test('an unblocked device can sign in even after a recent removal', async ({ page, browser }) => {
    const user = unique('removed');
    await signIn(page, user);
    const other = await newPage(browser);
    await signIn(other, user);
    await page.goto('/account');
    await page.getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('button', { name: 'Yes, remove' }).click();
    const replacement = await newPage(browser);
    await signIn(replacement, user);
    await expect(replacement.getByText('An empty shelf, for now.')).toBeVisible({ timeout: 10_000 });
    await replacement.context().close();
    await other.context().close();
  });
});

test.describe('account and admin', () => {
  test('rename shows in the account', async ({ page }, info) => {
    await signIn(page, unique('named'), '/account');
    await page.getByLabel('Full name').fill('Aarav Sharma');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await shot(page, 'account', info);
  });

  test('students cannot open admin', async ({ page }) => {
    await signIn(page, unique('student'));
    await page.goto('/admin');
    await page.waitForURL((u) => u.pathname === '/');
  });

  test('admin imports a Drive folder as a course, then publishes it', async ({ page }, info) => {
    await signIn(page, 'admin', '/admin');
    const tabs = page.getByRole('tablist', { name: 'Admin sections' });
    await expect(page.getByRole('heading', { name: 'Keep the website in step with R2' })).toBeVisible();
    // Pick one folder only, compare it, and see the page-making stage for that folder.
    await page.getByRole('radio', { name: /Only some folders or files/ }).click();
    await page.getByRole('checkbox', { name: 'Select folder Database Management Systems' }).check();
    await page.getByRole('button', { name: 'Next: compare with the website' }).click();
    await expect(page.getByText('The website already matches R2 for everything you chose.')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/Every file here has its pages|Done \d+/).first()).toBeVisible();
    await tabs.getByRole('tab', { name: 'Email & tools' }).click();
    await expect(page.getByRole('heading', { name: 'Tools on the home page' })).toBeVisible();
    await tabs.getByRole('tab', { name: 'Notes & courses' }).click();
    await page.getByRole('tab', { name: 'Import', exact: true }).click();
    const pick = page.getByRole('checkbox', { name: 'Import Network Security as a course' });
    await expect(pick).toBeVisible();
    await pick.check();
    await page
      .getByRole('group', { name: 'Branches for Network Security' })
      .getByRole('checkbox', { name: 'Assign to B.Tech CS (Game Development)' })
      .check();
    await page.getByRole('combobox', { name: 'Semester', exact: true }).selectOption('3');
    await page.getByRole('button', { name: /Import 1 course/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Imported' })).toBeVisible();
    await shot(page, 'admin-imported', info);

    await tabs.getByRole('tab', { name: 'Notes & courses' }).click();
    await page.getByRole('tab', { name: 'Courses', exact: true }).click();
    const panel = page.locator('#admin-panel');
    await expect(page.getByRole('heading', { name: 'Courses', exact: true })).toBeVisible();
    const search = page.getByRole('searchbox', { name: 'Search courses' });
    await expect(search).toBeVisible();
    const titles = await panel
      .getByRole('listitem')
      .evaluateAll((items) => items.map((item) => item.querySelector('a')?.textContent?.trim() ?? ''));
    expect(titles).toEqual(
      [...titles].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })),
    );
    await search.fill('Network Security');
    await expect(panel.getByRole('listitem')).toHaveCount(1);
    const row = panel
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: 'Network Security' }) });
    await expect(row).toBeVisible();
    const publish = row.getByRole('button', { name: 'Publish', exact: true });
    if (await publish.isVisible()) await publish.click(); // a second run finds it already live
    await expect(row.getByText('live', { exact: true })).toBeVisible({ timeout: 10_000 });

    await tabs.getByRole('tab', { name: 'Storage & health' }).click();
    await page.getByRole('tab', { name: 'Full audit', exact: true }).click();
    await page.getByLabel('Scan scope').selectOption('course');
    const scanControls = page.locator('section').filter({ hasText: 'Scan scope' }).first();
    const courseSelect = scanControls.locator('select').nth(1);
    await expect(courseSelect).toBeEnabled();
    const seededCourseOption = await courseSelect.locator('option').evaluateAll((options) => {
      const option = options.find((entry) => entry.textContent?.includes('Database Management Systems'));
      return option?.value ?? '';
    });
    expect(seededCourseOption).toBeTruthy();
    await courseSelect.selectOption(seededCourseOption);
    await page.getByRole('button', { name: 'Scan this course' }).click();
    await expect(page.getByText(/file page folders were checked/)).toBeVisible({ timeout: 20_000 });
    const scopeTotals = page.getByRole('region', { name: 'Selected scope totals' });
    const generatedPageObjects = scopeTotals
      .getByText('Generated page assets', { exact: true })
      .locator('..');
    await expect(generatedPageObjects.locator('strong')).not.toHaveText('Not checked');

    await page.goto('/?batch=2025&branch=bcg#catalogue');
    await expect(page.locator('#catalogue').getByRole('link', { name: /Network Security/ })).toBeVisible();
  });

  test('admin launches a tool and emails every student', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'one launch per server run');
    await signIn(page, 'librarian', '/admin?tab=tools');
    const row = page.getByRole('listitem').filter({ hasText: '/tools/timetable' });
    await row.getByRole('button', { name: 'Launch & draft the email' }).click();
    await expect(page.getByLabel('Subject line')).toHaveValue('New on Scholars Stack: Timetable maker');
    await page.getByRole('button', { name: 'Preview' }).click();
    await expect(
      page.frameLocator('iframe[title="Email preview"]').getByText('Timetable maker is here.'),
    ).toBeVisible();
    await page.getByRole('button', { name: /Send to \d+ student/ }).click();
    await page.getByRole('button', { name: 'Yes, send now' }).click();
    await expect(
      page
        .getByRole('listitem')
        .filter({ hasText: 'New on Scholars Stack: Timetable maker' })
        .getByText('sent', { exact: true }),
    ).toBeVisible();
    await shot(page, 'admin-announced', info);
    await page.goto('/#toolbox');
    await expect(page.getByRole('link', { name: /Open timetable maker/ })).toBeVisible();
  });
});

test.describe('previews, bundles and the toolbox', () => {
  test('anyone can flip through page one of every unit', async ({ page }, info) => {
    await page.goto('/c/dbms-2025-cse-core');
    const thumb = page.getByRole('button', { name: /Preview page 1 of UNIT 3/ });
    await thumb.scrollIntoViewIfNeeded();
    await thumb.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: /Normalisation/ })).toBeVisible();
    const img = dialog.getByRole('img');
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
      .toBeGreaterThan(100);
    await shot(page, 'preview-lightbox', info);
    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByRole('heading', { name: /Transactions and concurrency/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('a bundle shows its saving and puts every course on the shelf', async ({ page }, info) => {
    await page.goto('/?batch=2025&branch=bce#catalogue');
    await expect(page.getByRole('link', { name: /CSE Semester 3 pack/ })).toBeVisible();
    await signIn(page, unique('bundler'), '/b/cse-sem-3-pack');
    await expect(page.getByText('28%').first()).toBeVisible();
    await page.getByRole('button', { name: /Get all 3 for ₹199/ }).click();
    await expect(page.getByText("They're on your")).toBeVisible({ timeout: 20_000 });
    await shot(page, 'bundle-paid', info);
    await page.goto('/shelf');
    await expect(page.getByText('3 COURSES')).toBeVisible();
  });

  test('the free toolbox is on the home page without signing in', async ({ page }) => {
    await page.goto('/#toolbox');
    const box = page.locator('#toolbox');
    await expect(box.getByText('CGPA calculator')).toBeVisible();
    await page.goto('/tools/cgpa');
    await expect(page.getByText(/is on the workbench/)).toBeVisible();
  });
});

test('theme switch flips light and dark and remembers it', async ({ page }, info) => {
  await page.goto('/');
  const html = page.locator('html');
  const before = await html.getAttribute('data-theme');
  await page
    .getByRole('button', { name: /Switch to (dark|light) mode/ })
    .first()
    .click();
  const after = await html.getAttribute('data-theme');
  expect(after).not.toBe(before);
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', after!);
  await shot(page, `home-${after}`, info);
});
