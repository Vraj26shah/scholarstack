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

test('phone: swiping the drawer changes branch; past the last one it goes to Shelf', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'phone', 'touch only');
  // Start on the first branch (the drawer opens on the main programme by default).
  await page.goto('/');
  const first = await page.evaluate(async () => {
    const c = await (await fetch('/api/catalogue')).json();
    return c.branches.filter((b: { isCommon: boolean }) => !b.isCommon)[0].slug as string;
  });
  await page.goto(`/?batch=2025&branch=${first}#catalogue`);
  const tabs = page.getByRole('tablist', { name: 'Branch' });
  await expect(tabs.getByRole('tab').first()).toBeVisible({ timeout: 15_000 });
  const names = await tabs.getByRole('tab').allTextContents();
  const selected = () => tabs.getByRole('tab', { selected: true });
  await expect(selected()).toHaveText(names[0]!);
  const zone = page.locator('#branch-zone');
  await zone.scrollIntoViewIfNeeded();
  const at = async () => {
    const b = (await zone.boundingBox())!;
    return {
      y: Math.min(b.y + 140, page.viewportSize()!.height - 120),
      right: b.x + b.width - 24,
      left: b.x + 24,
    };
  };
  // Swipe left across the cards: next branch, and the page stays on the catalogue.
  let p = await at();
  await swipe(page, p.right, p.y, p.left);
  await expect(selected()).toHaveText(names[1]!);
  expect(new URL(page.url()).pathname).toBe('/');
  // Swipe right: back to the first branch.
  p = await at();
  await swipe(page, p.left, p.y, p.right);
  await expect(selected()).toHaveText(names[0]!);
  // Swiping on the row of branch tabs changes branch too.
  const row = (await tabs.boundingBox())!;
  await swipe(page, p.right, row.y + row.height / 2, p.left);
  await expect(selected()).toHaveText(names[1]!);
  // From the last branch, one more swipe goes on to the next section (Shelf).
  const last = await page.evaluate(async () => {
    const c = await (await fetch('/api/catalogue')).json();
    const own = c.branches.filter((b: { isCommon: boolean }) => !b.isCommon);
    return own[own.length - 1].slug as string;
  });
  await page.goto(`/?batch=2025&branch=${last}#catalogue`);
  await expect(selected()).toHaveText(names[names.length - 1]!, { timeout: 15_000 });
  await zone.scrollIntoViewIfNeeded();
  p = await at();
  await swipe(page, p.right, p.y, p.left);
  // (Shelf asks a signed-out visitor to sign in first.)
  await expect(page).toHaveURL(/shelf/, { timeout: 10_000 });
});
