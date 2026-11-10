import { type Page, expect, test } from '@playwright/test';

const unique = (p: string) => `${p}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Signs in through the form and returns where the site sent the student. */
async function signIn(page: Page, username: string) {
  await page.goto('/sign-in');
  await page.locator('#email').fill(username);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => u.pathname === '/');
}

const catalogueInView = (page: Page) =>
  page.evaluate(() => {
    const top = document.getElementById('catalogue')?.getBoundingClientRect().top ?? 9999;
    return Math.abs(top) < 120;
  });

test('signed out: the home page opens on the hero, even from a #catalogue address or a refresh', async ({
  page,
}) => {
  await page.goto('/?batch=2025#catalogue');
  await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
  // The #catalogue comes off, so the next refresh opens on the hero too (the drawer choice stays).
  await expect(page).toHaveURL(/\/\?batch=2025$/);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(40);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
  // Asking for the catalogue still goes there.
  await page.getByRole('link', { name: /Find your notes/ }).click();
  await expect.poll(() => catalogueInView(page), { timeout: 5_000 }).toBe(true);
});

test('signed in on a phone: the site opens on the catalogue, after sign-in and on every refresh', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone', 'phones only');
  await signIn(page, unique('landing.e2e'));
  await expect(page).toHaveURL(/#catalogue$/);
  await expect.poll(() => catalogueInView(page), { timeout: 5_000 }).toBe(true);
  await page.goto('/');
  await expect(page).toHaveURL(/#catalogue$/);
  await expect.poll(() => catalogueInView(page), { timeout: 5_000 }).toBe(true);
  await page.reload();
  await expect.poll(() => catalogueInView(page), { timeout: 5_000 }).toBe(true);
  await expect(
    page.getByRole('navigation', { name: 'App' }).getByRole('link', { name: 'Catalogue' }),
  ).toHaveAttribute('aria-current', 'page');
});

test('signed in on a laptop: the home page opens where the address says', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'laptops only');
  await signIn(page, unique('landing.e2e'));
  await expect.poll(() => catalogueInView(page), { timeout: 5_000 }).toBe(true);
  await page.goto('/');
  await page.waitForTimeout(800);
  await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
});
