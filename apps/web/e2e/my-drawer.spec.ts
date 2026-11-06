import { expect, test } from '@playwright/test';

test('a signed-in student sees only their own programme, from their college email', async ({
  page,
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough');
  await page.goto('/sign-in?next=%2F');
  await page.locator('#email').fill('vraj.23bce11796');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => u.pathname === '/');
  await page.goto('/#catalogue');
  const catalogue = page.locator('#catalogue');
  // 2023 batch, BCE (the code set in the admin), and no branch tabs to switch away.
  await expect(catalogue.getByText(/Drawer 2023 · B\.Tech Computer Science and Engineering/)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('tablist', { name: 'Branch' })).toHaveCount(0);
  await expect(catalogue.getByText(/Courses for your batch and programme/)).toBeVisible();
  // Signed out, the branch tabs are back.
  const fresh = await (await browser.newContext()).newPage();
  await fresh.goto('/#catalogue');
  await expect(fresh.getByRole('tablist', { name: 'Branch' })).toBeVisible({ timeout: 15_000 });
});
