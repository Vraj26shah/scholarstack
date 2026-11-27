import { type Page, devices, expect, test } from '@playwright/test';

// The student app's screens (the Android app), previewed in a phone browser (lib/app-mode.ts).
// Runs in the "phone-app" project, which turns the preview on.

async function signIn(page: Page, username: string, next = '/app') {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.locator('#email').fill(username);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => u.pathname !== '/sign-in');
}

const tabs = (page: Page) => page.getByRole('navigation', { name: 'App' });

test('a phone browser gets the website; the app preview maps website links to app screens', async ({
  browser,
  page,
}) => {
  // Without the preview (any visitor's phone): the website, and /app links open website pages.
  // A context of its own without the project's preview setting.
  const site = await browser.newContext({
    ...devices['Pixel 7'],
    storageState: { cookies: [], origins: [] },
  });
  const sp = await site.newPage();
  await sp.goto('/');
  await expect(sp).toHaveURL(/\/$/);
  await expect(sp.getByRole('link', { name: /Find your notes/ })).toBeVisible();
  await sp.goto('/app/tools');
  await expect(sp).toHaveURL(/\/#toolbox$/);
  await site.close();

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page).toHaveURL(/\/app$/);
  await expect(tabs(page).getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
  // The catalogue link keeps its batch and branch; the toolbox opens Tools.
  await page.goto('/?batch=2024&branch=bce#catalogue');
  await expect(page).toHaveURL(/\/app\/notes\?batch=2024&branch=bce/);
  await expect(page.getByRole('radio', { name: /^3rd year/ })).toHaveAttribute('aria-checked', 'true');
  await page.goto('/#toolbox');
  await expect(page).toHaveURL(/\/app\/tools$/);
  // No horizontal scrolling anywhere on the main screens.
  for (const path of ['/app', '/app/notes', '/app/tools', '/app/me']) {
    await page.goto(path);
    await expect(tabs(page)).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
  }
  // "?app=off" ends the preview (the website), "?app=on" starts it again.
  await page.goto('/?app=off');
  await expect(page).toHaveURL(/\/\?app=off$/);
  await expect(page.getByRole('link', { name: /Find your notes/ })).toBeVisible();
  await page.goto('/?app=on');
  await expect(page).toHaveURL(/\/app$/);
  expect(errors).toEqual([]);
});

test('student: Notes by year and branch, a plain course page, Me', async ({ page }) => {
  await signIn(page, 'asha.25bce10001');
  await tabs(page).getByRole('link', { name: 'Notes' }).click();
  await expect(page.getByText('Your batch and branch, from your college email.')).toBeVisible({
    timeout: 15_000,
  });
  const course = page.locator('main ul a[href^="/c/"]').first();
  await expect(course).toBeVisible();
  await course.click();
  await page.waitForURL(/\/c\//);
  // No swipe slider or index-card box in the app.
  await expect(page.getByText(/Swipe for the next course/)).toHaveCount(0);
  await expect(page.getByText('Call no.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/\/app\/notes/);
  await tabs(page).getByRole('link', { name: 'Me' }).click();
  await expect(page.getByText('asha.25bce10001@vitbhopal.ac.in')).toBeVisible();
  // The mess menu isn't live in the demo, so food and ordering stay hidden.
  await expect(page.getByRole('link', { name: /Food orders/ })).toHaveCount(0);
  await expect(tabs(page).getByRole('link', { name: 'Food' })).toHaveCount(0);
});

test('partner: only a PIN opens it, then orders, sales by year and a customer’s full record', async ({
  page,
}) => {
  // A student's session doesn't open the restaurant: the PIN screen shows instead.
  await signIn(page, 'asha.25bce10001');
  await page.goto('/partner');
  await expect(page.getByLabel(/PIN/)).toBeVisible();
  await expect(page.getByText(/restaurant owners only|सिर्फ़ रेस्टोरेंट मालिकों/)).toBeVisible();

  await page.locator('input[inputmode="tel"]').fill('98765 43210');
  await page.getByLabel(/PIN/).fill('1234');
  await page.locator('form button[type="submit"]').click();
  await expect(page.getByRole('navigation', { name: 'Partner' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'English' }).first().click();

  await page.getByRole('navigation', { name: 'Partner' }).getByRole('button', { name: 'Sales' }).click();
  await page.getByRole('tab', { name: 'This year' }).click();
  await expect(page.getByText('Earned')).toBeVisible();

  await page.goto('/partner?tab=more&page=customers');
  const first = page.locator('main ul button').first();
  await expect(first).toBeVisible({ timeout: 15_000 });
  await first.click();
  await expect(page.getByText('Their full record, last 12 months')).toBeVisible();
  await expect(page.getByText(/^Every order · \d+/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Call/ })).toBeVisible();
});

test('attendance: subjects from the timetable, a plan for the next exam', async ({ page }) => {
  // (The demo keeps the tool "coming soon" for students; the demo admin can use it.)
  await signIn(page, 'planner');
  await page.evaluate(() => {
    localStorage.setItem(
      'ss_tool_timetable_courses',
      JSON.stringify([
        {
          id: 'c1',
          name: 'Data Structures',
          code: 'CSE2001',
          teacher: '',
          slots: ['A11', 'A12', 'A13'],
          color: '#A1D6E2',
          tentative: false,
        },
      ]),
    );
    localStorage.setItem(
      'ss_tool_attendance_planner',
      JSON.stringify({
        v: 2,
        semesterStart: '2026-07-20',
        subjects: [],
        exams: [{ id: 'tee', name: 'Term End', kind: 'final', date: '2099-01-11', countFrom: '' }],
        holidays: [],
        counts: {},
      }),
    );
  });
  await page.goto('/tools/attendance');
  await page.getByRole('button', { name: /From my timetable/ }).click();
  const row = page
    .locator('main li')
    .filter({ has: page.getByLabel('Attended') })
    .first();
  await row.getByLabel('Attended').fill('40');
  await row.getByLabel('Held').fill('48');
  await expect(row.getByText(/You can skip \d+ of the next \d+ classes/)).toBeVisible();
  await expect(row.getByText('83%')).toBeVisible();
});

test('every screen stays inside the app, even after visiting the Partner app', async ({ page }) => {
  await signIn(page, 'planner');
  await page.goto('/partner');
  await expect(page.getByLabel(/PIN/)).toBeVisible();
  for (const path of [
    '/app',
    '/app/notes',
    '/app/tools',
    '/app/me',
    '/tools/mess-menu',
    '/tools/timetable',
    '/my-orders',
    '/shelf',
    '/contribute',
    '/help',
    '/account',
    '/contact',
    '/terms',
  ]) {
    await page.goto(path);
    await expect(tabs(page), path).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' }), path).toHaveCount(0);
    await expect(page.locator('footer').filter({ hasText: 'Not affiliated' }), path).toHaveCount(0);
  }
});
