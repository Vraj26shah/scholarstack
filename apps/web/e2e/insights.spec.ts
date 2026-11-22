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
  const top = admin.getByRole('region', { name: 'Most viewed' });
  await expect(top.getByRole('link').first()).toBeVisible();
  await expect(top).toContainText(/DBMS|Database/i);
  await expect(admin.getByRole('region', { name: 'Totals' })).toContainText('Page views');
  await admin.getByRole('button', { name: 'Table' }).click();
  await expect(admin.getByRole('columnheader', { name: 'New students' })).toBeVisible();
  await expect(admin.getByRole('link', { name: /Errors students hit/ })).toHaveAttribute(
    'href',
    /sentry\.io\/issues/,
  );
  await shot(admin, 'admin');
  expect(errors).toEqual([]);
});
