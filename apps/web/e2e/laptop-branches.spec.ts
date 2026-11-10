import { type Page, expect, test } from '@playwright/test';

async function openFirstBranch(page: Page) {
  await page.goto('/');
  const first = await page.evaluate(async () => {
    const c = await (await fetch('/api/catalogue')).json();
    return c.branches.filter((b: { isCommon: boolean }) => !b.isCommon)[0].slug as string;
  });
  await page.goto(`/?batch=2025&branch=${first}#catalogue`);
  const tabs = page.getByRole('tablist', { name: 'Branch' });
  await expect(tabs.getByRole('tab').first()).toBeVisible({ timeout: 15_000 });
  const names = await tabs.getByRole('tab').allTextContents();
  return { tabs, names, selected: () => tabs.getByRole('tab', { selected: true }) };
}

test('laptop: the ‹ › buttons, arrow keys and a trackpad swipe change branch', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'laptop only');
  const { tabs, names, selected } = await openFirstBranch(page);
  await expect(selected()).toHaveText(names[0]!);

  // The buttons beside the drawer's title.
  const nav = page.getByRole('navigation', { name: 'Change branch' });
  await expect(nav).toBeVisible();
  await nav.getByRole('button', { name: /^Next branch/ }).click();
  await expect(selected()).toHaveText(names[1]!);
  await nav.getByRole('button', { name: /^Previous branch/ }).click();
  await expect(selected()).toHaveText(names[0]!);
  await expect(nav.getByRole('button', { name: /^Previous branch/ })).toHaveCount(0);

  // Arrow keys on the tab row.
  await tabs.getByRole('tab', { selected: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(selected()).toHaveText(names[1]!);
  await expect(selected()).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(selected()).toHaveText(names[0]!);

  // A two-finger sideways swipe over the courses: next branch, and only one.
  const cards = page.locator('#drawer-cards');
  await cards.scrollIntoViewIfNeeded();
  const box = (await cards.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 60);
  await page.mouse.wheel(260, 0);
  await expect(selected()).toHaveText(names[1]!);
  await page.waitForTimeout(700);
  await expect(selected()).toHaveText(names[1]!);
  // Swiping the other way goes back.
  await page.mouse.wheel(-260, 0);
  await expect(selected()).toHaveText(names[0]!);
  // Up-and-down scrolling never changes branch.
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 120);
  await page.waitForTimeout(400);
  await expect(selected()).toHaveText(names[0]!);
});

test('the drawer shows a bundle-shaped skeleton while its pack loads', async ({ page }) => {
  let release: () => void = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route(/\/api\/bundles\?/, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/?batch=2025#catalogue');
  const skeleton = page.locator('section[aria-label="Loading bundles"]');
  await expect(skeleton).toBeVisible({ timeout: 15_000 });
  release();
  await expect(skeleton).toHaveCount(0);
});

test('a bundle page shows its own skeleton while it loads', async ({ page }) => {
  await page.goto('/');
  const slug = await page.evaluate(async () => {
    const list = await (await fetch('/api/bundles')).json();
    return (list[0]?.slug ?? '') as string;
  });
  test.skip(!slug, 'no bundles in the demo');
  let release: () => void = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route(new RegExp(`/api/bundles/${slug}`), async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(`/b/${slug}`);
  await expect(page.getByLabel('Loading bundle', { exact: true })).toBeVisible({ timeout: 15_000 });
  release();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
