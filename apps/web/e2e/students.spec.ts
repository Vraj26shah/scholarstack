import { type Page, expect, test } from '@playwright/test';

const unique = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function signIn(page: Page, user: string, next: string) {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.locator('#email').fill(user);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // Shared demo admins hit the two-device limit across tests: take over the oldest device.
  const takeOver = page.getByRole('button', { name: 'Remove and sign in here' }).first();
  await Promise.race([
    page.waitForURL((u) => u.pathname === next),
    takeOver
      .waitFor({ timeout: 15_000 })
      .then(() => takeOver.click())
      .catch(() => undefined),
  ]);
  await page.waitForURL((u) => u.pathname === next);
}

test('admin blocks a student course with a reason; the student sees why on their shelf', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'one run is enough');
  test.setTimeout(90_000);
  const name = unique('blocked');
  const student = await (await browser.newContext()).newPage();
  await signIn(student, name, '/c/dbms-2025-cse-core');
  await student
    .getByRole('button', { name: /Buy for ₹/ })
    .first()
    .click();
  await expect(student.getByText("It's on your")).toBeVisible({ timeout: 20_000 });

  const admin = await (await browser.newContext()).newPage();
  // Demo admins have two devices each across the run; this one has room.
  await signIn(admin, 'keeper', '/admin');
  await admin.goto('/admin?section=students');
  await admin.getByRole('searchbox', { name: 'Find a student' }).fill(name);
  await admin.getByRole('button', { name: new RegExp(name) }).click();
  await admin.getByRole('button', { name: 'Block', exact: true }).click();
  await admin.getByLabel('Reason (the student reads this)').fill('Shared the login with a friend.');
  await admin.getByRole('button', { name: 'Block and tell them' }).click();
  await expect(admin.getByText(/^Done\./)).toBeVisible({ timeout: 15_000 });
  await admin.getByRole('button', { name: 'Close' }).click();
  await expect(admin.getByText('Last reason', { exact: false })).toBeVisible({ timeout: 15_000 });

  await student.goto('/shelf');
  await expect(student.getByText('Paused by the library: Shared the login with a friend.')).toBeVisible({
    timeout: 15_000,
  });
});
