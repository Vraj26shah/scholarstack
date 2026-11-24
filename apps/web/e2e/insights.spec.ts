import { type Page, expect, test } from '@playwright/test';

/**
 * Insights through the real UI: a visitor opens a course page (counted once per tab, even after a
 * refresh), and the admin sees the view and the course in Students › Insights.
 */
const SHOTS = process.env.E2E_SHOTS; // folder for review screenshots (optional)
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/insights-${name}.png`, fullPage: true });
};

async function signIn(page: Page, username: string, next: string) {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.locator('#email').fill(username);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => u.pathname === next.split('?')[0]);
}

test('a course page view shows up in Admin › Students › Insights', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'one admin session per run');
  test.setTimeout(90_000);

  const visitor = await (await browser.newContext()).newPage();
  const sent: string[] = [];
  visitor.on('request', (r) => {
    if (r.url().includes('/insights/view')) sent.push(r.postData() ?? '');
  });
  await visitor.goto('/c/dbms-2025-cse-core');
  await expect(visitor.getByRole('heading', { level: 1, name: 'Database Management Systems' })).toBeVisible();
  await expect.poll(() => sent.length).toBe(1);
  expect(JSON.parse(sent[0]!)).toMatchObject({ signedIn: false });
  // A refresh in the same tab is not another view.
  await visitor.reload();
  await expect(visitor.getByRole('heading', { level: 1, name: 'Database Management Systems' })).toBeVisible();
  await visitor.waitForTimeout(500);
  expect(sent).toHaveLength(1);

  const admin = await (await browser.newContext()).newPage();
  const errors: string[] = [];
  admin.on('pageerror', (e) => errors.push(e.message));
  await signIn(admin, 'librarian', '/admin');
  await admin.getByRole('tablist', { name: 'Admin sections' }).getByRole('tab', { name: 'Students' }).click();
  await admin.getByRole('tab', { name: 'Insights', exact: true }).click();
  await admin.getByRole('radio', { name: 'Today' }).click();
  const views = admin.getByRole('tablist', { name: 'Insights views' });
  // The summary: headline numbers, what needs a look, and the path to buying.
  await views.getByRole('tab', { name: 'Summary' }).click();
  await expect(admin.getByRole('region', { name: 'Totals' })).toContainText('Students active');
  await expect(admin.getByRole('region', { name: 'Needs a look' })).toBeVisible();
  await expect(admin.getByRole('region', { name: 'From looking to buying' })).toContainText(
    'Opened a course page',
  );
  await views.getByRole('tab', { name: 'Buying' }).click();
  const top = admin.getByRole('region', { name: 'Most viewed' });
  await expect(top.getByRole('link').first()).toBeVisible();
  await expect(top).toContainText(/DBMS|Database/i);
  await views.getByRole('tab', { name: 'Summary' }).click();
  await admin.getByRole('button', { name: 'Table' }).click();
  await expect(admin.getByRole('columnheader', { name: 'New students' })).toBeVisible();
  await views.getByRole('tab', { name: 'Errors & speed' }).click();
  await expect(admin.getByRole('link', { name: /Errors students hit/ })).toHaveAttribute(
    'href',
    /sentry\.io\/issues/,
  );
  await shot(admin, 'admin');
  expect(errors).toEqual([]);
});

test('a visitor who gets stuck shows up in "Where people get stuck", and tool use in Tools', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'one admin session per run');
  test.setTimeout(90_000);

  const visitor = await (await browser.newContext()).newPage();
  const hits: string[] = [];
  visitor.on('request', (r) => {
    if (r.url().includes('/insights/hit')) hits.push(r.postData() ?? '');
  });
  // Opens the attendance tool and taps inside it: opened and used.
  await visitor.goto('/tools/attendance');
  await expect(visitor.getByRole('heading', { level: 1 })).toBeVisible();
  await visitor.locator('main :is(input, button, select):not([data-tool-header] *)').first().click();
  await expect.poll(() => hits.some((h) => h.includes('tool_used'))).toBe(true);
  // Taps the same empty spot again and again: "angry tapping".
  await visitor.goto('/tools/attendance');
  const title = visitor.getByRole('heading', { level: 1 });
  for (let i = 0; i < 5; i++) await title.click({ delay: 10 });
  await expect.poll(() => hits.some((h) => h.includes('stuck_rage'))).toBe(true);
  // A sign-in address that can't work: a form error.
  await visitor.goto('/sign-in');
  await visitor.locator('#email').fill('not+an+address');
  await visitor.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect.poll(() => hits.some((h) => h.includes('stuck_form'))).toBe(true);

  const admin = await (await browser.newContext()).newPage();
  const errors: string[] = [];
  admin.on('pageerror', (e) => errors.push(e.message));
  await signIn(admin, 'librarian', '/admin');
  await admin.getByRole('tablist', { name: 'Admin sections' }).getByRole('tab', { name: 'Students' }).click();
  await admin.getByRole('tab', { name: 'Insights', exact: true }).click();
  await admin.getByRole('radio', { name: 'Today' }).click();
  const views = admin.getByRole('tablist', { name: 'Insights views' });
  await views.getByRole('tab', { name: 'Summary' }).click();
  await expect(admin.getByRole('region', { name: 'Needs a look' })).toContainText(/Sign-in page|Attendance/);
  await shot(admin, 'summary');

  await views.getByRole('tab', { name: /Where people get stuck/ }).click();
  const stuck = admin.getByRole('region', { name: 'Where people get stuck' });
  await expect(stuck).toContainText('Sign-in page');
  await expect(stuck).toContainText('got an error while filling a form');
  await expect(stuck).toContainText('Attendance');
  await expect(stuck).toContainText('tapped the same spot');
  await shot(admin, 'stuck');

  await views.getByRole('tab', { name: 'Tools' }).click();
  const tools = admin.getByRole('region', { name: 'Tools' });
  await expect(tools).toContainText('Attendance');
  await expect(tools).toContainText(/1\s*used/);
  await shot(admin, 'tools');
  await views.getByRole('tab', { name: 'Buying' }).click();
  await shot(admin, 'buying');
  expect(errors).toEqual([]);
});
