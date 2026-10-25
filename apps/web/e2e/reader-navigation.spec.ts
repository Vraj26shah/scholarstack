import { expect, test } from '@playwright/test';

const unique = (p: string) => `${p}${Date.now() % 1_000_000}${Math.floor(Math.random() * 100)}`;

test('a student can move to any module while reading, including in full screen', async ({
  page,
  isMobile,
}) => {
  await page.goto('/sign-in?next=%2Fc%2Fdbms-2025-cse-core');
  await page.locator('#email').fill(unique('nav'));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/c\//);
  await page.getByRole('button', { name: /Buy for ₹/ }).click();
  await expect(page.getByText("It's on your")).toBeVisible({ timeout: 20_000 });

  // Start reading a Module 1 file.
  await page.goto('/c/dbms-2025-cse-core');
  await page.locator('a[href^="/read/"]').first().click();
  await expect(page.getByRole('img', { name: 'Note page' })).toBeVisible({ timeout: 15_000 });

  // The page always fits the screen width (no sideways scrolling on phones).
  const fits = await page.evaluate(() => {
    const c = document.querySelector('main canvas');
    return !!c && c.getBoundingClientRect().right <= window.innerWidth + 1;
  });
  expect(fits).toBe(true);

  // Collapsed modules hide their files completely (not focusable, not clickable underneath).
  const sidebar = page.getByRole('navigation', { name: 'Units and files' }).first();
  const collapsed = sidebar.locator('ul[inert]');
  expect(await collapsed.count()).toBeGreaterThan(0);

  // Open Module 2 from the sidebar.
  await sidebar.getByRole('button', { name: /SQL and relational algebra/ }).click();
  await sidebar.getByRole('link', { name: /Unit-2-SQL-notes/ }).click();
  await expect(page.locator('header')).toContainText('Unit-2-SQL-notes.pdf');
  await expect(page.getByRole('img', { name: 'Note page' })).toBeVisible({ timeout: 15_000 });

  // Full screen: wheel zoom, AI button, and the contents panel still reach every module.
  await page.getByRole('button', { name: 'View this page full screen' }).click();
  const zoom = page.getByRole('button', { name: 'Reset zoom' });
  await expect(zoom).toHaveText('100%');
  if (isMobile) {
    await page.getByRole('button', { name: 'Zoom in' }).click();
  } else {
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, -120);
  }
  await expect(zoom).not.toHaveText('100%');
  await expect(page.getByRole('button', { name: 'Ask AI' })).toBeVisible();
  await page.getByRole('button', { name: 'All modules and files' }).click();
  await page
    .getByRole('dialog')
    .getByRole('link', { name: /Unit-4-Transactions-notes/ })
    .click();
  await expect(page.locator('header')).toContainText('Unit-4-Transactions-notes.pdf');
  await expect(page.locator('.reader-immersive')).toHaveCount(1);

  // On the last page the next file is offered.
  await page.getByRole('button', { name: 'Exit full screen' }).click();
  const total = Number(
    (await page.getByLabel('Page number').locator('..').innerText()).match(/\/\s*(\d+)/)?.[1],
  );
  await page.getByLabel('Page number').fill(String(total));
  await page.getByLabel('Page number').press('Enter');
  await expect(page.getByText('You finished this file · up next')).toBeVisible({ timeout: 15_000 });
});

test('Back in the reader returns to where the student came from, not always the shelf', async ({ page }) => {
  await page.goto('/sign-in?next=%2Fc%2Fdbms-2025-cse-core');
  await page.locator('#email').fill(unique('back'));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/c\//);
  await page.getByRole('button', { name: /Buy for ₹/ }).click();
  await expect(page.getByText("It's on your")).toBeVisible({ timeout: 20_000 });

  // From the course page: open a file, switch to another file, then Back → the course page.
  await page.goto('/c/dbms-2025-cse-core');
  await page.locator('a[href^="/read/"]').first().click();
  await expect(page.getByRole('img', { name: 'Note page' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'All modules and files' }).click();
  await page.getByRole('dialog').locator('a[href^="/read/"]').nth(1).click();
  await expect(page.getByRole('img', { name: 'Note page' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Back to course' }).click();
  await expect(page).toHaveURL(/\/c\/dbms-2025-cse-core$/);

  // From the shelf: Back → the shelf.
  await page.goto('/shelf');
  await page.getByRole('link', { name: /Pick up where you left off/ }).click();
  await expect(page.getByRole('img', { name: 'Note page' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Back to my shelf' }).click();
  await expect(page).toHaveURL(/\/shelf$/);
});

test('the phone tab bar offers the toolbox; the account is behind the profile picture', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'the tab bar is phone-only');
  await page.goto('/sign-in?next=%2Fshelf');
  await page.locator('#email').fill(unique('tabs'));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/shelf/);
  const bar = page.getByRole('navigation', { name: 'App' });
  await expect(bar.getByRole('link', { name: 'Shelf' })).toHaveAttribute('aria-current', 'page');
  await expect(bar.getByRole('link', { name: 'Account' })).toHaveCount(0);
  await bar.getByRole('link', { name: 'Toolbox' }).click();
  await expect(page).toHaveURL(/#toolbox$/);
  await expect(bar.getByRole('link', { name: 'Toolbox' })).toHaveAttribute('aria-current', 'page');
  // The bar is docked to the bottom edge, full width.
  const box = await bar.boundingBox();
  const vp = page.viewportSize()!;
  expect(Math.round(box!.x)).toBe(0);
  expect(Math.round(box!.width)).toBe(vp.width);
  expect(Math.round(box!.y + box!.height)).toBe(vp.height);
  await page.getByRole('link', { name: 'Your account' }).click();
  await expect(page).toHaveURL(/\/account$/);
});
