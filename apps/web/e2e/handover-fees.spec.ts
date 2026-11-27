import { type Page, expect, test } from '@playwright/test';

const shots = process.env.SHOTS;
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `${shots}/desktop-${name}.png`, fullPage: true });
};

async function signIn(page: Page, username: string) {
  await page.goto('/sign-in?next=%2Fadmin');
  await page.locator('#email').fill(username);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => u.pathname !== '/sign-in');
}

test('restaurant fee, handover code and settling up, end to end', async ({ page }, info) => {
  // One demo admin plays student, restaurant and admin (admins may act as any restaurant).
  test.skip(info.project.name !== 'desktop', 'one admin session per run');
  test.setTimeout(120_000);
  await signIn(page, 'keeper');

  // Admin › Restaurant fees: ₹5 per order for the dhaba, from today.
  await page.goto('/admin?section=fees');
  await page.getByRole('button', { name: /Radha Rani Ka/ }).click();
  await page.getByRole('button', { name: 'Change fee' }).click();
  await page.getByLabel('₹ per order').fill('5');
  await page.getByPlaceholder('Note (what you agreed with the owner)').fill('Agreed at launch');
  await page.getByRole('button', { name: 'Save the fee' }).click();
  await expect(page.getByText('₹5 per order').first()).toBeVisible();
  await shot(page, 'fees-rule');

  // An order from the restaurant's page.
  await page.goto('/m/radha-rani-ka-dhaba');
  await page.getByRole('button', { name: 'Order now' }).click();
  await page.getByRole('button', { name: /^Add .*thali/ }).click();
  const bill = page.getByRole('complementary', { name: 'Order slip' });
  await bill
    .getByRole('radio', { name: /Pickup/ })
    .check()
    .catch(() => {});
  const deliver = bill.getByLabel('Deliver to');
  if (await deliver.isVisible().catch(() => false)) await deliver.fill('Block C, room 9');
  await bill.getByLabel('Name').fill('Kiran');
  await bill.getByLabel(/Mobile number/).fill('9123456780');
  await bill.getByRole('checkbox', { name: /is my number/ }).check();
  await bill.getByRole('button', { name: /Confirm order/ }).click();
  await expect(bill.getByText('Sent, waiting for the restaurant')).toBeVisible();
  const code = (await bill.locator('p.font-display').textContent())!.trim();

  // The restaurant: no number before accepting, then accept and mark ready.
  await page.goto('/orders');
  const ticket = page.getByRole('article', { name: `Order ${code}` });
  await expect(ticket.getByText('Their number shows once you accept.')).toBeVisible();
  await expect(ticket.getByRole('link', { name: /^Call / })).toHaveCount(0);
  await ticket.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(ticket.getByRole('link', { name: 'Call Kiran' })).toHaveAttribute('href', 'tel:+919123456780');
  await ticket.getByRole('button', { name: /^Ready/ }).click();
  await expect(ticket.getByLabel("Student's 4-digit code")).toBeVisible();

  // The student's slip shows the handover code.
  await page.goto('/m/radha-rani-ka-dhaba');
  const digits = page.getByLabel(/^Handover code/).first();
  await expect(digits).toBeVisible();
  const handover = (await digits.textContent())!.trim();
  expect(handover).toMatch(/^\d{4}$/);
  await shot(page, 'handover-code-student');

  // A wrong code is refused; the right one hands it over.
  await page.goto('/orders');
  const wrong = String((Number(handover) + 1) % 10000).padStart(4, '0');
  await ticket.getByLabel("Student's 4-digit code").fill(wrong);
  await ticket.getByRole('button', { name: '✓ Hand over' }).click();
  await expect(ticket.getByText(/not the student's code/)).toBeVisible();
  await ticket.getByLabel("Student's 4-digit code").fill(handover);
  await ticket.getByRole('button', { name: '✓ Hand over' }).click();
  await expect(page.getByText("✓ Handed over · student's code matched").first()).toBeVisible();
  await shot(page, 'handover-done');

  // The owner's own Fees tab shows the order's ₹5.
  await page.getByRole('tab', { name: 'Fees' }).click();
  await expect(page.getByText(code).first()).toBeVisible();
  await expect(page.getByText('You owe now')).toBeVisible();
  await shot(page, 'fees-owner');

  // The admin records the payment: settled.
  await page.goto('/admin?section=fees');
  await page.getByRole('button', { name: /Radha Rani Ka/ }).click();
  await expect(page.getByText(code).first()).toBeVisible();
  const owed = (await page
    .getByText('Owed now')
    .locator('xpath=following-sibling::p[1]')
    .textContent())!.trim();
  await page.getByRole('button', { name: 'Payment / adjustment' }).click();
  await page.getByLabel('Amount ₹').fill(owed.replace(/[₹,]/g, ''));
  await page.getByPlaceholder(/Note \(required\)/).fill('UPI ref 1234');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Payment received').first()).toBeVisible();
  await expect(page.getByText('Settled', { exact: true }).first()).toBeVisible();
  await shot(page, 'fees-admin');
});
