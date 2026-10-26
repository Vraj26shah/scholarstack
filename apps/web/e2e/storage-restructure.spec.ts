import { type Page, expect, test } from '@playwright/test';

async function signIn(page: Page, username: string) {
  await page.goto('/sign-in?next=%2Fadmin');
  await page.locator('#email').fill(username);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => u.pathname !== '/sign-in');
}

test('Files: rename a file and move it to another unit; Clean-up lists unused storage', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough');
  const page = await (await browser.newContext()).newPage();
  await signIn(page, 'registrar');
  await page.goto('/admin?section=files');
  await page.getByPlaceholder('Find a folder, file or course').fill('Data Structures');
  const file = page
    .getByRole('checkbox', { name: /Select .*Data Structures and Algorithms\/.*\.pdf$/ })
    .first();
  await expect(file).toBeVisible({ timeout: 20_000 });
  const path = ((await file.getAttribute('aria-label')) ?? '').replace(/^Select /, '');

  // Rename: preview first, then do it.
  await page.getByRole('button', { name: `Rename ${path}` }).click();
  await page.getByLabel('New name').fill('Renamed by e2e');
  await expect(page.getByText(/Renamed by e2e\.pdf/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.getByText(/Moved 1 file/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Done' }).click();

  // Move it into a new unit of the same course.
  const renamed = page.getByRole('checkbox', { name: /Renamed by e2e\.pdf$/ });
  await expect(renamed).toBeVisible({ timeout: 15_000 });
  await renamed.check();
  await page.getByRole('button', { name: 'Move to…' }).click();
  await page.getByLabel('Unit folder (pick or type a new one)').fill('Unit 9 - Extra');
  await expect(page.getByText(/Unit 9 - Extra\/Renamed by e2e\.pdf/)).toBeVisible();
  await page.getByRole('button', { name: /^Move 1 file/ }).click();
  await expect(page.getByText(/Moved 1 file, 1 site file updated/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Done' }).click();

  await page.goto('/admin?section=cleanup');
  await expect(page.getByRole('heading', { name: 'Unused storage' })).toBeVisible({ timeout: 30_000 });
});
