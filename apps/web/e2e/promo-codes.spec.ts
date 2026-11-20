import { type Page, expect, test } from '@playwright/test';

/**
 * Promo codes through the real UI: Buy opens the check-out slip, which always has the promo box;
 * the admin switches a code on; a student applies it on the slip, sees the lower total and pays
 * exactly that.
 */
const SHOTS = process.env.E2E_SHOTS; // folder for review screenshots (optional)
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/promo-${name}.png`, fullPage: false });
};
const unique = (p: string) => `${p}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const rupees = (text: string) => Number((text.match(/₹\s?([\d,]+)/)?.[1] ?? '').replace(/,/g, ''));

async function signIn(page: Page, username: string, next: string) {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.locator('#email').fill(username);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => u.pathname === next.split('?')[0]);
}

test('an admin switches a promo code on and a student pays the lower price with it', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'one admin session per run');
  // Two sign-ins and the admin page: more than the default on a cold demo server.
  test.setTimeout(90_000);
  const code = `E2E${Date.now().toString(36).toUpperCase().slice(-6)}`;
  const course = '/c/dbms-2025-cse-core';

  const student = await (await browser.newContext()).newPage();
  const errors: string[] = [];
  student.on('pageerror', (e) => errors.push(e.message));
  await signIn(student, unique('promo'), course);
  const buy = student.getByRole('button', { name: /Buy for ₹/ }).first();
  await expect(buy).toBeVisible();
  const fullPrice = rupees((await buy.textContent()) ?? '');
  expect(fullPrice).toBeGreaterThan(1);
  // Buy opens the slip at the normal price; with no code, Pay is the same amount.
  await buy.click();
  await expect(student.getByRole('button', { name: `Pay ₹${fullPrice}` })).toBeVisible();
  await shot(student, '1-slip-no-code');
  await student.keyboard.press('Escape');

  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'librarian', '/admin');
  await admin.getByRole('tablist', { name: 'Admin sections' }).getByRole('tab', { name: 'Courses' }).click();
  await admin.getByRole('tab', { name: 'Promo codes', exact: true }).click();
  await admin.getByRole('button', { name: 'New code' }).click();
  await admin.getByPlaceholder('DIWALI20').fill(code.toLowerCase());
  const percent = admin.getByLabel('Percent off');
  await percent.fill('20');
  // The code belongs to a creator who earns 10% of what each student pays.
  const creator = `Creator ${code}`;
  await admin.getByLabel("Creator's name").fill(creator);
  await admin.getByLabel('Their commission').selectOption('percent');
  await admin.getByLabel('Percent', { exact: true }).fill('10');
  await shot(admin, '2-admin-new-code');
  await admin.getByRole('button', { name: 'Save and switch on' }).click();
  const row = admin.locator('li', { hasText: code }).first();
  await expect(row).toBeVisible();
  await expect(row.getByText('running')).toBeVisible();
  await shot(admin, '3-admin-list');

  await buy.click();
  const link = student.getByRole('button', { name: 'Have a promo code?' });
  await expect(link).toBeVisible();
  await shot(student, '4-slip-link');
  await link.click();
  const box = student.getByLabel('Promo code');
  await box.fill('NOT-A-CODE');
  await student.getByRole('button', { name: 'Apply' }).click();
  await expect(student.getByRole('alert')).toContainText("isn't a valid promo code");
  await box.fill(code.toLowerCase());
  await student.getByRole('button', { name: 'Apply' }).click();
  await expect(student.getByText(`${code}`, { exact: true })).toBeVisible();
  const pay = student.getByRole('button', { name: /^Pay ₹/ });
  const discounted = rupees((await pay.textContent()) ?? '');
  expect(discounted).toBe(Math.floor((fullPrice * 80) / 100));
  await shot(student, '5-slip-applied');

  await pay.click();
  await expect(student.getByText("It's on your")).toBeVisible({ timeout: 20_000 });
  await expect(student.getByText(`₹${discounted}`).first()).toBeVisible();
  await shot(student, '6-paid');

  await admin.reload();
  await admin.getByRole('tablist', { name: 'Admin sections' }).getByRole('tab', { name: 'Courses' }).click();
  await admin.getByRole('tab', { name: 'Promo codes', exact: true }).click();
  const used = admin.locator('li', { hasText: code }).first();
  await expect(used).toContainText('1 used');
  await expect(used).toContainText(`For ${creator}`);
  await used.getByRole('button', { name: /See who used it/ }).click();
  await expect(used.getByRole('list', { name: 'Paid orders' })).toContainText(code);

  // Money › Discounts: the order with its student, and what the creator is owed.
  const commission = Math.floor(discounted * 10) / 100; // 10% of what the student paid, in rupees
  await admin.getByRole('tablist', { name: 'Admin sections' }).getByRole('tab', { name: 'Money' }).click();
  await admin.getByRole('tab', { name: 'Discounts', exact: true }).click();
  await admin.getByRole('radio', { name: 'All time' }).click();
  await expect(admin.getByText('Used a promo code', { exact: true })).toBeVisible();
  await admin.getByRole('searchbox', { name: 'Search orders' }).fill(code);
  await expect(admin.getByRole('list', { name: 'Paid orders' }).getByRole('listitem')).toHaveCount(1);
  const creatorRow = admin.locator('li', { hasText: creator }).first();
  await expect(creatorRow).toContainText(
    `Owe ₹${commission.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`,
  );
  await shot(admin, '7-discounts');
  await creatorRow.getByRole('button', { name: 'Pay' }).click();
  await admin.getByLabel('Paid (₹)').fill(String(commission));
  await admin.getByRole('button', { name: 'Record payment' }).click();
  await expect(creatorRow).toContainText('All paid');
  await shot(admin, '8-discounts-paid');
  expect(errors).toEqual([]);
});

test('a code switched off after it was applied is dropped at Buy, and the student can still buy', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'one admin session per run');
  test.setTimeout(90_000);
  const code = `OFF${Date.now().toString(36).toUpperCase().slice(-6)}`;
  const course = '/c/dsa-2025-cse-core';

  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'librarian', '/admin');
  await admin.getByRole('tablist', { name: 'Admin sections' }).getByRole('tab', { name: 'Courses' }).click();
  await admin.getByRole('tab', { name: 'Promo codes', exact: true }).click();
  await admin.getByRole('button', { name: 'New code' }).click();
  await admin.getByPlaceholder('DIWALI20').fill(code);
  await admin.getByLabel('Percent off').fill('20');
  await admin.getByRole('button', { name: 'Save and switch on' }).click();
  const row = admin.locator('li', { hasText: code }).first();
  await expect(row.getByText('running')).toBeVisible();

  const student = await (await browser.newContext()).newPage();
  await signIn(student, unique('stale'), course);
  const buy = student.getByRole('button', { name: /Buy for ₹/ }).first();
  const fullPrice = rupees((await buy.textContent()) ?? '');
  await buy.click();
  await student.getByRole('button', { name: 'Have a promo code?' }).click();
  await student.getByLabel('Promo code').fill(code);
  await student.getByRole('button', { name: 'Apply' }).click();
  await expect(student.getByText(code, { exact: true })).toBeVisible();
  const pay = student.getByRole('button', { name: /^Pay ₹/ });
  expect(rupees((await pay.textContent()) ?? '')).toBeLessThan(fullPrice);

  // The admin ends the code while the slip is still open.
  await row.getByRole('button', { name: 'Switch off' }).click();
  await expect(row.getByText('draft')).toBeVisible();

  // Pay: the slip drops the code, says why, and shows the normal total instead of charging it.
  await pay.click();
  await expect(student.getByRole('status').filter({ hasText: 'removed' })).toContainText(
    'its validity is now over',
  );
  await expect(pay).toHaveText(new RegExp(`Pay ₹${fullPrice}`));
  await pay.click();
  await expect(student.getByText("It's on your")).toBeVisible({ timeout: 20_000 });
});
