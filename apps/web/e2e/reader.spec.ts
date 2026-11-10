import { type Page, expect, test } from '@playwright/test';

const unique = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function buyAndOpen(page: Page) {
  await page.goto(`/sign-in?next=${encodeURIComponent('/c/dbms-2025-cse-core')}`);
  await page.locator('#email').fill(unique('reader'));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((u) => u.pathname === '/c/dbms-2025-cse-core');
  await page
    .getByRole('button', { name: /Buy for ₹/ })
    .first()
    .click();
  await expect(page.getByText("It's on your")).toBeVisible({ timeout: 20_000 });
  await page.goto('/c/dbms-2025-cse-core');
  await page.locator('a[href^="/read/"]').first().click();
  await page.waitForURL(/\/read\//);
  await expect(page.getByRole('img', { name: 'Note page' })).toBeVisible({ timeout: 15_000 });
}

test('move from a Unit 1 file to a Unit 2 file without losing the reader', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await buyAndOpen(page);
  const contents = page.getByRole('navigation', { name: 'Units and files' });
  await expect(page.getByText(/Protected · your name/)).toHaveCount(0);

  // Any unit opens, not only the one being read.
  const unit2 = contents.getByRole('button', { name: /SQL and relational algebra/ });
  await expect(unit2).toHaveAttribute('aria-expanded', 'false');
  await unit2.click();
  await expect(unit2).toHaveAttribute('aria-expanded', 'true');
  const first = page.url();
  await contents.getByRole('link', { name: /Unit-2-SQL-notes/ }).click();
  await page.waitForURL((u) => u.href !== first);
  await expect(page.getByRole('img', { name: 'Note page' })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  await expect(page.getByText('Reading somewhere else?')).toHaveCount(0);
  await expect(page.getByText('Paused.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByLabel('Page number')).toHaveValue('2');

  // And back to Unit 1.
  await contents.getByRole('button', { name: /ER and relational model/ }).click();
  await contents.getByRole('link').filter({ hasText: /ER/ }).first().click();
  await expect(page.getByRole('img', { name: 'Note page' })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1200);
  await expect(page.getByText('Reading somewhere else?')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('full screen: zoom with the wheel, the buttons and keys, and Ask AI is there', async ({
  page,
}, info) => {
  // Phones pinch instead; their full-screen toolbar drops the zoom buttons to stay on one row.
  test.skip(info.project.name === 'phone', 'desktop zoom controls');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await buyAndOpen(page);
  await page.getByRole('button', { name: 'View this page full screen' }).click();
  const reset = page.getByRole('button', { name: 'Reset zoom' });
  await expect(reset).toHaveText('100%');
  await expect(page.getByRole('button', { name: 'Ask AI' })).toBeVisible();

  const canvas = page.getByRole('img', { name: 'Note page' });
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await page.mouse.wheel(0, -300);
  await expect.poll(async () => Number.parseInt((await reset.textContent()) ?? '0', 10)).toBeGreaterThan(100);
  const wider = (await canvas.boundingBox())!.width;
  expect(wider).toBeGreaterThan(box.width);

  await reset.click();
  await expect(reset).toHaveText('100%');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(reset).toHaveText('110%');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(reset).toHaveText('125%');
  await page.keyboard.press('0');
  await expect(reset).toHaveText('100%');

  // Pages still turn in full screen, and the AI sheet opens on top of it.
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByLabel('Page number')).toHaveValue('2');
  await page.getByRole('button', { name: 'Ask AI' }).click();
  await expect(page.getByRole('dialog', { name: 'Ask about this page' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await expect(page.getByRole('button', { name: 'View this page full screen' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('phone: a sideways swipe on the page turns it; up and down still scroll', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'touch only');
  await buyAndOpen(page);
  const cdp = await page.context().newCDPSession(page);
  const swipe = async (x1: number, y1: number, x2: number, y2: number) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] });
    for (let i = 1; i <= 8; i++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x1 + ((x2 - x1) * i) / 8, y: y1 + ((y2 - y1) * i) / 8 }],
      });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const box = (await page.getByRole('img', { name: 'Note page' }).boundingBox())!;
  const y = box.y + Math.min(box.height / 2, 300);
  await swipe(box.x + box.width - 30, y, box.x + 30, y + 4);
  await expect(page.getByLabel('Page number')).toHaveValue('2');
  await swipe(box.x + 30, y, box.x + box.width - 30, y + 4);
  await expect(page.getByLabel('Page number')).toHaveValue('1');
  const before = await page.evaluate(() => window.scrollY);
  await swipe(box.x + box.width / 2, y + 150, box.x + box.width / 2, y - 150);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
});

test('full screen fits the whole page above the toolbar and holds still while zooming', async ({ page }) => {
  await buyAndOpen(page);
  await page.getByRole('button', { name: 'View this page full screen' }).click();
  const canvas = page.getByRole('img', { name: 'Note page' });
  const scroller = page.locator('.reader-immersive');
  await page.waitForTimeout(400);
  // At 100% nothing scrolls: the page is fully on screen.
  const fits = await scroller.evaluate(
    (el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1,
  );
  expect(fits).toBe(true);
  const page1 = (await canvas.boundingBox())!;
  const bar = (await page.getByRole('button', { name: 'Next page' }).boundingBox())!;
  expect(page1.y + page1.height).toBeLessThanOrEqual(bar.y);
  // A small zoom never makes the page keep re-sizing itself (that was the flicker).
  await page.mouse.move(page1.x + page1.width / 2, page1.y + page1.height / 2);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -8);
    await page.waitForTimeout(120);
    const sizes = await canvas.evaluate(async (c) => {
      const seen = new Set<number>();
      for (let f = 0; f < 15; f++) {
        await new Promise((r) => requestAnimationFrame(r));
        seen.add(Math.round(c.getBoundingClientRect().width));
      }
      return seen.size;
    });
    expect(sizes).toBe(1);
  }
});
