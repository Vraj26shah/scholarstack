import { type Page, expect, test } from '@playwright/test';

/** A real touch swipe (Chrome DevTools touch events), in eight steps. */
async function swipe(page: Page, x1: number, y: number, x2: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y }] });
  for (let i = 1; i <= 8; i++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x1 + ((x2 - x1) * i) / 8, y: y + i / 2 }],
    });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
}

/** The catalogue's own branches, in order (names and slugs). */
async function branchList(page: Page) {
  return page.evaluate(async () => {
    const c = await (await fetch('/api/catalogue')).json();
    return (c.branches as { isCommon: boolean; slug: string; name: string }[])
      .filter((b) => !b.isCommon)
      .map((b) => ({ slug: b.slug, name: b.name }));
  });
}

// Phones pick the year with four buttons and the branch from a searchable sheet; swiping the
// courses sideways still changes branch, and the picker follows. Laptops keep the tab row.

test('phone: swiping the drawer changes branch (the picker follows); past the last one it goes to Shelf', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone', 'touch only');
  await page.goto('/');
  const list = await branchList(page);
  await page.goto(`/?batch=2025&branch=${list[0]!.slug}#catalogue`);
  const picker = page.locator('#catalogue').getByRole('button', { name: /^Branch:/ });
  await expect(picker).toBeVisible({ timeout: 15_000 });
  const shows = (name: string) => expect(picker).toHaveAttribute('aria-label', `Branch: ${name}`);
  await shows(list[0]!.name);
  const zone = page.locator('#drawer-cards');
  // A point on the course cards that is on screen (the branch area is taller than a phone).
  const at = async () => {
    await zone.scrollIntoViewIfNeeded();
    const b = (await zone.boundingBox())!;
    const vh = page.viewportSize()!.height;
    return {
      y: Math.max(140, Math.min(b.y + 80, vh - 180)),
      right: b.x + b.width - 24,
      left: b.x + 24,
    };
  };
  // Swipe left across the cards: next branch, and the page stays on the catalogue.
  let p = await at();
  await swipe(page, p.right, p.y, p.left);
  await shows(list[1]!.name);
  expect(new URL(page.url()).pathname).toBe('/');
  // Swipe right: back to the first branch.
  p = await at();
  await swipe(page, p.left, p.y, p.right);
  await shows(list[0]!.name);
  // From the last branch, one more swipe goes on to the next section (Shelf).
  const last = list[list.length - 1]!;
  await page.goto(`/?batch=2025&branch=${last.slug}#catalogue`);
  await shows(last.name);
  p = await at();
  await swipe(page, p.right, p.y, p.left);
  // (Shelf asks a signed-out visitor to sign in first.)
  await expect(page).toHaveURL(/shelf/, { timeout: 10_000 });
});

test('phone: year buttons and the branch sheet (search, pick, fits the screen)', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phones only; laptops keep the tab row');
  await page.goto('/?batch=2025#catalogue');
  const catalogue = page.locator('#catalogue');
  // The year: four buttons, the chosen one marked.
  const years = catalogue.getByRole('radiogroup', { name: 'Year' });
  await expect(years.getByRole('radio')).toHaveCount(4, { timeout: 15_000 });
  await years.getByRole('radio', { name: /^3rd year/ }).click();
  await expect(years.getByRole('radio', { name: /^3rd year/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page).toHaveURL(/batch=2024/);

  const picker = catalogue.getByRole('button', { name: /^Branch:/ });
  const before = (await picker.getAttribute('aria-label')) ?? '';
  await picker.click();
  const sheet = page.getByRole('dialog', { name: 'Branch' });
  await expect(sheet).toBeVisible();
  // The sheet never runs past the screen edges (the phone's own dropdown did).
  const box = (await sheet.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  const search = sheet.getByRole('textbox', { name: /Search branch/ });
  await search.fill('zzzz');
  await expect(sheet.getByText(/Nothing matches/)).toBeVisible();
  await search.fill('');
  const other = sheet.locator('ul button[aria-pressed="false"]').first();
  const name = (await other.innerText()).split('\n')[0]!.trim();
  await other.click();
  await expect(sheet).toHaveCount(0);
  await expect(picker).not.toHaveAttribute('aria-label', before);
  expect(await picker.getAttribute('aria-label')).toContain(name);
});
