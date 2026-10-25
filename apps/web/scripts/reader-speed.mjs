/**
 * Reader speed on a simulated 4G phone (9 Mbps, 60 ms, 4x slower CPU):
 * open a file → first page visible, then page turns, then a jump to a far page.
 *   node scripts/reader-speed.mjs   (demo server on :8791; signs up a fresh student)
 */
import { chromium } from '@playwright/test';
const base = process.env.BASE_URL ?? 'http://localhost:8791';
const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, baseURL: base });
const p = await ctx.newPage();

await p.goto(`/sign-in?next=${encodeURIComponent('/c/dbms-2025-cse-core')}`);
await p.getByLabel('College email').fill(`speed${Date.now().toString(36)}`);
await p.getByRole('button', { name: 'Sign in', exact: true }).click();
await p.waitForURL((u) => u.pathname === '/c/dbms-2025-cse-core');
await p.getByRole('button', { name: /Buy for ₹/ }).click();
await p.getByText("It's on your").waitFor({ timeout: 20_000 });
await p.goto('/c/dbms-2025-cse-core');

const cdp = await ctx.newCDPSession(p);
await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 60,
  downloadThroughput: (9 * 1024 * 1024) / 8,
  uploadThroughput: (3 * 1024 * 1024) / 8,
});
await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU ?? 4) });

const img = p.getByRole('img', { name: 'Note page' });
const loaded = () =>
  p.waitForFunction(
    () =>
      document.querySelector('canvas[aria-label="Note page"]')?.width > 0 &&
      !document.querySelector('[aria-label="Loading page"]'),
    undefined,
    { polling: 16 },
  );
const out = {};
const timeline = [];
let t0 = 0;
p.on('requestfinished', async (r) => {
  if (!t0) return;
  const tm = r.timing();
  timeline.push(
    `${Math.round(tm.startTime - t0)}→${Math.round(tm.startTime - t0 + tm.responseEnd)}ms ${r.method()} ${r.url().replace(base, '').slice(0, 70)}`,
  );
});
let t = Date.now();
t0 = t;
await p.evaluate(() =>
  document.addEventListener(
    'pointerdown',
    () => {
      window.__down = Date.now();
    },
    { capture: true, once: true },
  ),
);
await p.locator('a[href^="/read/"]').first().click();
await img.waitFor();
await loaded();
out.openToFirstPage = Date.now() - (await p.evaluate(() => window.__down));
out.openIncludingClickWait = Date.now() - t;

await p.waitForTimeout(1500); // let the next pages prefetch, as a reader would be reading
const turns = [];
for (let n = 2; n <= 5; n++) {
  t = Date.now();
  await p.getByRole('button', { name: 'Next page' }).click();
  await p.waitForFunction((want) => document.querySelector('#page-no')?.value === String(want), n);
  await loaded();
  turns.push(Date.now() - t);
  await p.waitForTimeout(400);
}
out.pageTurnsMs = turns;

const pages = Number(
  (await p.locator('#page-no').evaluate((i) => i.parentElement?.textContent ?? '')).match(
    /\/\s*(\d+)/,
  )?.[1] ?? 0,
);
if (pages > 8) {
  t = Date.now();
  await p.locator('#page-no').fill(String(pages - 1));
  await p.locator('#page-no').press('Enter');
  await p.waitForFunction((want) => document.querySelector('#page-no')?.value === String(want), pages - 1);
  await loaded();
  out.jumpToFarPage = Date.now() - t;
}
console.log(JSON.stringify(out));
if (process.env.TIMELINE) console.log(timeline.slice(0, 25).join('\n'));
await b.close();
