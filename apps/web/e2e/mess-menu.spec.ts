import { type Page, expect, test } from '@playwright/test';

// Pictures for review go here when SHOTS is set (e.g. SHOTS=../../shots pnpm test:e2e mess-menu).
const shots = process.env.SHOTS;
const shot = async (page: Page, name: string, project: string) => {
  if (shots) await page.screenshot({ path: `${shots}/${project}-${name}.png`, fullPage: true });
};

async function signIn(page: Page, username: string) {
  await page.goto('/sign-in?next=%2Fadmin');
  await page.locator('#email').fill(username);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => u.pathname !== '/sign-in');
}

test('mess menu: students see "coming soon"; an admin picks a mess, reads the day and reports a change', async ({
  page,
}, info) => {
  // Not signed in: the tool isn't launched yet.
  await page.goto('/tools/mess-menu');
  await expect(page.getByText('Coming soon')).toBeVisible();

  // Own demo admin (two-device limit): admins use tools before launch.
  await signIn(page, info.project.name === 'phone' ? 'reviewer' : 'keeper');
  await page.goto('/tools/mess-menu');
  await page.evaluate(() => localStorage.removeItem('ss_tool_mess_choice'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mess menu' })).toBeVisible();
  await expect(page.getByText('Admin preview.')).toBeVisible();
  await shot(page, 'mess-empty', info.project.name);

  // The picker searches, and splits hostellers from day scholars.
  await page.getByRole('button', { name: /Your mess/ }).click();
  await page.getByRole('radio', { name: 'Day scholars' }).click();
  await expect(page.getByRole('option')).toHaveCount(1);
  await page.getByRole('radio', { name: 'All' }).click();
  await page.getByRole('combobox').fill('safal');
  await expect(page.getByRole('option')).toHaveCount(1);
  await shot(page, 'mess-picker', info.project.name);
  await page.getByRole('combobox').press('Enter');

  // Hostel mess: four meals, honest about accuracy, unsure dishes marked.
  await expect(page.getByRole('heading', { name: 'Safal hostel mess' })).toBeVisible();
  await expect(page.getByText("This may not be exactly what's served.")).toBeVisible();
  await expect(page.getByRole('region', { name: 'Meals now' })).toBeVisible();
  const phone = info.project.name === 'phone';
  // The week grid, like the timetable: meals across, days down, today marked (phones start on Day).
  if (phone) await page.getByRole('tab', { name: 'Week' }).click();
  const grid = page.getByRole('table');
  for (const meal of ['Breakfast', 'Lunch', 'High tea', 'Dinner'])
    await expect(grid.getByRole('columnheader', { name: new RegExp(meal) })).toBeVisible();
  await expect(grid.getByRole('rowheader', { name: /^Mon/ })).toBeVisible();
  await expect(grid.locator('tr[aria-current="date"]')).toHaveCount(1);
  await expect(grid.getByText('Dal fry').first()).toBeVisible();
  await expect(grid.getByText('Kheer')).toHaveAttribute('title', /Hard to read/);
  await shot(page, 'mess-hostel', info.project.name);
  // One day at a time.
  await page.getByRole('tab', { name: 'Day' }).click();
  await page.getByRole('tab', { name: 'Monday' }).click();
  for (const meal of ['Breakfast', 'Lunch', 'High tea', 'Dinner'])
    await expect(page.getByRole('heading', { name: meal, exact: true })).toBeVisible();
  await shot(page, 'mess-hostel-day', info.project.name);

  // Restaurant: lunch and dinner only, the owner's prices.
  await page.getByRole('button', { name: /Your mess/ }).click();
  await page.getByRole('option', { name: /Radha Rani/ }).click();
  await expect(page.getByText('Menu as given by the owner.')).toBeVisible();
  await expect(page.getByText('Mess thali ₹80')).toBeVisible();
  await page.getByRole('tab', { name: 'Thursday' }).click();
  await expect(page.getByRole('heading', { name: 'Lunch', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Breakfast', exact: true })).toHaveCount(0);
  await expect(page.getByText('Chhole bhature').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Week' }).click();
  await expect(page.getByRole('table').getByRole('columnheader')).toHaveCount(3); // day, lunch, dinner
  await shot(page, 'mess-restaurant', info.project.name);

  // Ordering: today's thali with what's in it, a total, then WhatsApp with the order written out.
  await page.getByRole('link', { name: 'Order now' }).click();
  await expect(page.getByRole('heading', { name: /Order from Radha Rani/ })).toBeVisible();
  await page.getByRole('button', { name: /^Add .*thali/ }).click();
  await page.getByRole('button', { name: /^One more .*thali/ }).click();
  const order = page.getByRole('complementary', { name: 'Your order' });
  await expect(order.getByText('₹160').last()).toBeVisible();
  await order.getByRole('button', { name: 'Send order on WhatsApp' }).click();
  await expect(page.getByText('Where should they deliver?')).toBeVisible();
  await order.getByLabel('Deliver to').fill('Block B, room 214');
  const send = order.getByRole('link', { name: 'Send order on WhatsApp' });
  await expect(send).toHaveAttribute('href', /^https:\/\/wa\.me\/918517903810\?text=.*2%20%C3%97/);
  await expect(page.getByRole('link', { name: /Call \+91 85179 03810/ })).toHaveAttribute(
    'href',
    'tel:+918517903810',
  );
  await shot(page, 'mess-order', info.project.name);

  // Meal reminders live in the menu page itself.
  await expect(page.getByRole('heading', { name: 'Meal reminders' })).toBeVisible();

  // "Something changed? Tell us" reaches Admin › Campus › Menu reports.
  await page.getByRole('button', { name: 'Menu wrong or changed? Tell us' }).click();
  await page.locator('#mess-report select').nth(1).selectOption('dinner');
  await page.getByLabel("What's different?").fill('Thursday dinner had dal makhani too, thali is ₹90 now.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText("Thanks, we've got it.")).toBeVisible();

  await page.goto('/admin?section=mess-reports');
  await expect(page.getByText('Thursday dinner had dal makhani too').first()).toBeVisible();
  await shot(page, 'admin-reports', info.project.name);
  await page.goto('/admin?section=mess');
  await expect(page.getByText('Safal hostel mess')).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).first().click();
  await expect(page.getByText('Meals and times')).toBeVisible();
  await shot(page, 'admin-editor', info.project.name);

  // Admin › Reminders shows the numbers.
  await page.goto('/admin?section=reminders');
  await expect(page.getByText('Sent today')).toBeVisible();
  await shot(page, 'admin-reminders', info.project.name);
});
