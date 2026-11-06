import { type Page, expect, test } from '@playwright/test';

async function signIn(page: Page, username: string) {
  await page.goto('/sign-in?next=%2Fadmin');
  await page.locator('#email').fill(username);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // Shared demo admins hit the two-device limit across tests: take over the oldest device.
  const takeOver = page.getByRole('button', { name: 'Remove and sign in here' }).first();
  await Promise.race([
    page.waitForURL((u) => u.pathname !== '/sign-in'),
    takeOver
      .waitFor({ timeout: 15_000 })
      .then(() => takeOver.click())
      .catch(() => undefined),
  ]);
  await page.waitForURL((u) => u.pathname !== '/sign-in');
}

test('Folders: make a folder, upload a file, rename it and move it; Clean-up lists unused storage', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough');
  const page = await (await browser.newContext()).newPage();
  await signIn(page, 'registrar');
  await page.goto('/admin?section=folders');
  const find = page.getByRole('searchbox', { name: 'Find a folder or file' });

  // Open the course folder from search, make a unit folder in it, and upload a PDF there.
  await find.fill('Data Structures');
  const results = page.getByRole('list', { name: 'Search results' });
  await results
    .getByRole('button', { name: /^Data Structures and Algorithms/ })
    .first()
    .click({ timeout: 20_000 });
  await expect(page.getByText(/This folder is the course/)).toBeVisible();
  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByLabel('New folder name').fill('Unit 8 - From e2e');
  await page.getByRole('button', { name: 'Make folder' }).click();
  await page.getByRole('button', { name: /^Unit 8 - From e2e/ }).click({ timeout: 15_000 });
  await expect(page.getByText('This folder is empty. Upload files or make a folder.')).toBeVisible();
  await page.getByLabel('Files to upload').setInputFiles({
    name: 'e2e upload.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'),
  });
  await expect(page.getByText(/Uploaded 1 file to Data Structures and Algorithms/)).toBeVisible({
    timeout: 20_000,
  });

  // Rename it: preview first, then do it.
  await page.getByRole('checkbox', { name: 'Tick e2e upload.pdf' }).check();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByLabel('New name').fill('Renamed by e2e');
  await expect(page.getByText(/Renamed by e2e\.pdf/).first()).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.getByText(/Moved 1 file/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Done' }).click();

  // Move it into another new unit of the same course.
  const renamed = page.getByRole('checkbox', { name: 'Tick Renamed by e2e.pdf' });
  await expect(renamed).toBeVisible({ timeout: 15_000 });
  await renamed.check();
  await page.getByRole('button', { name: 'Move to…' }).click();
  await page.getByLabel('Unit folder (pick or type a new one)').fill('Unit 9 - Extra');
  await expect(page.getByText(/Unit 9 - Extra\/Renamed by e2e\.pdf/)).toBeVisible();
  await page.getByRole('button', { name: /^Move 1 file/ }).click();
  await expect(page.getByText(/Moved 1 file, 1 site file updated/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Done' }).click();

  await page.goto('/admin?section=cleanup');
  await expect(page.getByRole('heading', { name: 'Can be deleted' })).toBeVisible({ timeout: 30_000 });
});
