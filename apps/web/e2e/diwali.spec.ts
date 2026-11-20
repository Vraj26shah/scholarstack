import { type Page, expect, test } from '@playwright/test';

/**
 * A Diwali sale end to end through the real UI: the admin switches on "Diwali offer" (20% off every
 * bundle) and a DIWALI10 code; a student sees the banner and the sale price, adds the code on top,
 * and pays exactly the price shown. Plus: on a phone, the tab bar always shows where you are.
 */
const SHOTS = process.env.E2E_SHOTS; // folder for review screenshots (optional)
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/diwali-${name}.png`, fullPage: false });
};
const unique = (p: string) => `${p}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const rupees = (text: string) => Number((text.match(/₹\s?([\d,]+)/)?.[1] ?? '').replace(/,/g, ''));

async function signIn(page: Page, username: string, next: string) {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.locator('#email').fill(username);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => u.pathname === next.split('?')[0]);
}

async function adminSection(admin: Page, group: string, tab: string) {
  await admin.getByRole('tablist', { name: 'Admin sections' }).getByRole('tab', { name: group }).click();
  await admin.getByRole('tab', { name: tab, exact: true }).click();
}

test('Diwali: 20% off every bundle, a DIWALI10 code on top, and the student pays exactly that', async ({
  browser,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'one admin session per run');
  test.setTimeout(120_000);
  const bundlePage = '/b/cse-sem-3-pack';
  const code = `DIWALI${Date.now().toString(36).toUpperCase().slice(-4)}`;

  // A student's price before the sale.
  const student = await (await browser.newContext()).newPage();
  await signIn(student, unique('diwali'), bundlePage);
  const buy = student.getByRole('button', { name: /Get all \d+ for ₹/ });
  await expect(buy).toBeVisible();
  const before = rupees((await buy.textContent()) ?? '');
  expect(before).toBeGreaterThan(1);

  // The admin: the offer (20% off all bundles) and the code (10% off bundles).
  const admin = await (await browser.newContext()).newPage();
  await signIn(admin, 'librarian', '/admin');
  await adminSection(admin, 'Courses', 'Offers');
  await admin.getByRole('button', { name: 'New offer' }).click();
  await admin.getByLabel('Name students see').fill('Diwali offer');
  await admin.getByLabel('Percent off').fill('20');
  await admin
    .getByRole('radiogroup', { name: 'What the offer covers' })
    .getByRole('radio', { name: 'All bundles' })
    .click();
  await shot(admin, '1-admin-offer');
  await admin.getByRole('button', { name: 'Save and switch on' }).click();
  await expect(admin.locator('li', { hasText: 'Diwali offer' }).first()).toBeVisible();

  await adminSection(admin, 'Courses', 'Promo codes');
  await admin.getByRole('button', { name: 'New code' }).click();
  await admin.getByPlaceholder('DIWALI20').fill(code);
  await admin.getByLabel('Percent off').fill('10');
  await shot(admin, '2-admin-code');
  await admin.getByRole('button', { name: 'Save and switch on' }).click();
  await expect(admin.locator('li', { hasText: code }).first().getByText('running')).toBeVisible();

  // The student: the banner on the catalogue, then the sale price on the bundle.
  await student.goto('/#catalogue');
  await expect(student.getByText(/Diwali offer/).first()).toBeVisible();
  await shot(student, '3-banner');
  await student.goto(bundlePage);
  await expect(buy).toBeVisible();
  const onSale = rupees((await buy.textContent()) ?? '');
  expect(onSale).toBeLessThan(before);
  await shot(student, '4-bundle-on-sale');

  // The slip shows the offer line; the code comes off the sale price.
  await buy.click();
  await expect(student.getByRole('dialog').getByText('Diwali offer')).toBeVisible();
  await student.getByRole('button', { name: 'Have a promo code?' }).click();
  await student.getByLabel('Promo code').fill(code.toLowerCase());
  await student.getByRole('button', { name: 'Apply' }).click();
  await expect(student.getByText(code, { exact: true })).toBeVisible();
  const pay = student.getByRole('button', { name: /^Pay ₹/ });
  const withCode = rupees((await pay.textContent()) ?? '');
  expect(withCode).toBe(Math.floor((onSale * 90) / 100));
  await shot(student, '5-code-applied');

  // Payment is for exactly that amount, and the bundle is theirs.
  await pay.click();
  await expect(student.getByRole('heading', { name: /on your shelf/ })).toBeVisible({ timeout: 20_000 });
  await expect(student.getByText(`₹${withCode}`).first()).toBeVisible();
  await shot(student, '6-paid');

  // Leave the shared demo server as it was: the sale ends and the code is switched off, so other
  // journeys see normal prices and no running code.
  await admin.reload();
  await adminSection(admin, 'Courses', 'Offers');
  await admin
    .locator('li', { hasText: 'Diwali offer' })
    .first()
    .getByRole('button', { name: 'End now' })
    .click();
  await expect(admin.locator('li', { hasText: 'Diwali offer' }).first().getByText('ended')).toBeVisible({
    timeout: 10_000,
  });
  await adminSection(admin, 'Courses', 'Promo codes');
  const row = admin.locator('li', { hasText: code }).first();
  await row.getByRole('button', { name: 'Switch off' }).click();
  await expect(row.getByText('draft')).toBeVisible();
});

test('on a phone the tab bar always shows where you are, even for a first-time visitor', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone', 'phones only');
  const bar = page.getByRole('navigation', { name: 'App' });
  await page.goto('/');
  await expect(bar.getByRole('link', { name: 'Catalogue' })).toHaveAttribute('aria-current', 'page');
  await shot(page, '7-phone-first-open');
  await page.goto('/b/cse-sem-3-pack');
  await expect(bar.getByRole('link', { name: 'Catalogue' })).toHaveAttribute('aria-current', 'page');
  await page.goto('/contribute');
  await expect(bar.getByRole('link', { name: 'Contribute' })).toHaveAttribute('aria-current', 'page');
  await expect(bar.getByRole('link', { name: 'Catalogue' })).not.toHaveAttribute('aria-current', 'page');
});
