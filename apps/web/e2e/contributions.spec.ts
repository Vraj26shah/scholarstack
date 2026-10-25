import { type Page, expect, test } from '@playwright/test';

/** A student shares notes; the librarian downloads, accepts with a free course, and the student sees it. */
test.describe.configure({ mode: 'serial' });

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

async function signIn(page: Page, username: string, next: string) {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.locator('#email').fill(username);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => u.pathname === next);
}

test('share notes, review them, reward the student', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough');
  const student = await (await browser.newContext()).newPage();
  await signIn(student, 'contributor.e2e', '/contribute');
  await expect(student.getByRole('heading', { name: /Earn every term/ })).toBeVisible();

  // The form explains what's missing instead of sending.
  await student.getByRole('button', { name: 'Send for review' }).click();
  await expect(student.getByRole('alert')).toContainText('Give it a title');

  await student.getByLabel('Title').fill('OS unit 3: scheduling, handwritten');
  await student.getByLabel('Course (code or name)').fill('Operating Systems');
  await student
    .locator('input[type=file]')
    .setInputFiles({ name: 'os-unit-3.pdf', mimeType: 'application/pdf', buffer: PDF });
  await expect(student.getByText('os-unit-3.pdf')).toBeVisible();
  await student.getByRole('checkbox').check();
  await student.getByRole('button', { name: 'Send for review' }).click();
  await expect(student.getByText(/is in the review pile/)).toBeVisible({ timeout: 20_000 });
  await expect(student.getByText('IN REVIEW', { exact: true })).toBeVisible();

  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'reviewer', '/admin');
  await admin.goto('/admin?section=contributions');
  const row = admin.getByRole('listitem').filter({ hasText: 'OS unit 3: scheduling' });
  await expect(row).toBeVisible();
  const download = admin.waitForEvent('download');
  await row.getByRole('button', { name: 'Download os-unit-3.pdf' }).click();
  expect((await download).suggestedFilename()).toBe('os-unit-3.pdf');

  await row.getByRole('button', { name: 'Review' }).click();
  await row.getByRole('button', { name: 'Free course' }).click();
  await row.getByLabel('Course to give, free').selectOption({ index: 1 });
  await row.getByLabel('Note to the student (optional)').fill('Very clear, thank you!');
  await row.getByRole('button', { name: 'Accept', exact: true }).last().click();
  await admin.getByRole('button', { name: 'Accepted' }).click();
  await expect(admin.getByText('Very clear, thank you!')).toBeVisible();

  await student.reload();
  await expect(student.getByText('ACCEPTED', { exact: true })).toBeVisible();
  await expect(student.getByText(/Free course:/)).toBeVisible();
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

test('a student reports a problem with a screenshot; the admin answers from Queries', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough');
  const student = await (await browser.newContext()).newPage();
  await signIn(student, 'asker.e2e', '/shelf');
  await student.goto('/c/dbms-2025-cse-core');
  await expect(student.getByText('check these units against your current syllabus')).toBeVisible();
  await student.getByRole('link', { name: 'Something wrong with these notes? Tell us' }).click();
  await student.waitForURL((u) => u.pathname === '/help');
  await expect(student.getByRole('radio', { name: 'Notes' })).toBeChecked();
  await expect(student.getByText('FROM PAGE · /c/dbms-2025-cse-core')).toBeVisible();
  await student.getByLabel('Subject').fill('Unit 3 preview is blurry');
  await student.getByLabel('What happened?').fill('The page-one preview of unit 3 is hard to read.');
  await student
    .locator('input[type=file]')
    .setInputFiles({ name: 'unit3.png', mimeType: 'image/png', buffer: PNG });
  await student.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(student.getByText(/We'll email you when we answer/)).toBeVisible({ timeout: 20_000 });

  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'reviewer', '/admin');
  await admin.goto('/admin?section=queries');
  const row = admin.getByRole('listitem').filter({ hasText: 'Unit 3 preview is blurry' });
  await expect(row).toContainText('asker.e2e@vitbhopal.ac.in');
  await expect(row).toContainText('/c/dbms-2025-cse-core');
  await row.getByLabel('Your answer').fill('Thanks! Fixed now, please try again.');
  await row.getByRole('button', { name: 'Send answer' }).click();
  await admin.getByRole('button', { name: /Answered/ }).click();
  await expect(admin.getByText('Thanks! Fixed now, please try again.')).toBeVisible();

  await student.reload();
  await expect(student.getByText('Thanks! Fixed now, please try again.')).toBeVisible();
  await student.getByRole('button', { name: "It's sorted, close it" }).click();
  await expect(student.getByText('CLOSED', { exact: true })).toBeVisible();
});

test('admin deletes a folder completely from Storage & health', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough');
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'keeper', '/admin');
  await admin.getByRole('tab', { name: 'Storage & health', exact: true }).click();
  await expect(admin.getByRole('heading', { name: 'Files & folders' })).toBeVisible();
  await admin.getByPlaceholder('Find a folder, file or course').fill('Cloud Computing');
  const folder = admin.getByRole('button', { name: /^Delete .*Cloud Computing\/$/ }).first();
  await folder.click();
  await expect(admin.getByText(/This removes/)).toBeVisible();
  await admin.getByLabel('Type DELETE to confirm').fill('DELETE');
  await admin.getByRole('button', { name: 'Delete for good' }).click();
  await expect(admin.getByText(/Removed \d+ files?/)).toBeVisible({ timeout: 20_000 });
  await admin.getByRole('button', { name: 'Done' }).click();
});

test('admin adds a year and a branch', async ({ browser }, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough');
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'registrar', '/admin');
  await admin.goto('/admin?section=years');
  await admin.getByLabel('New year', { exact: true }).fill('2032');
  await admin.getByRole('button', { name: 'Add year' }).click();
  await expect(admin.getByText('2032', { exact: true })).toBeVisible();
  const add = admin.getByRole('listitem').last();
  await add.getByLabel('Code', { exact: true }).fill('IOT');
  await add.getByLabel('Name', { exact: true }).fill('B.Tech IoT');
  await add.getByRole('button', { name: 'Add' }).click();
  await expect(admin.locator('input[value="B.Tech IoT"]')).toBeVisible();
});
