/**
 * Speed check on a simulated mid-range phone over 4G (9 Mbps, 60 ms, 4x slower CPU):
 * home → course cards, card → course page, back, and bytes transferred, cold and warm.
 *   node scripts/perf-check.mjs   (demo server on :8791)
 */
import { chromium } from '@playwright/test';
const base = process.env.BASE_URL ?? 'http://localhost:8791';
const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
// Simulate a typical Indian 4G phone connection: ~9 Mbps down, 60 ms RTT, 4x slower CPU.
await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 60,
  downloadThroughput: (9 * 1024 * 1024) / 8,
  uploadThroughput: (3 * 1024 * 1024) / 8,
});
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const run = async (label) => {
  const out = {};
  let t = Date.now();
  await p.goto(`${base}/?batch=2025`, { waitUntil: 'domcontentloaded' });
  await p.locator('a[href^="/c/"]').first().waitFor();
  out.homeToCards = Date.now() - t;
  out.lcp = await p.evaluate(
    () =>
      new Promise((r) => {
        new PerformanceObserver((l) => {
          const e = l.getEntries();
          r(Math.round(e[e.length - 1].startTime));
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        setTimeout(() => r(-1), 3000);
      }),
  );
  const card = p.locator('a[href^="/c/"]').first();
  await card.hover();
  await p.waitForTimeout(400);
  t = Date.now();
  await card.click();
  await p.locator('h1').first().waitFor();
  await p.getByRole('heading', { name: 'Peek at page one' }).waitFor();
  out.cardToCourse = Date.now() - t;
  t = Date.now();
  await p.goBack();
  await p.locator('a[href^="/c/"]').first().waitFor();
  out.backToHome = Date.now() - t;
  const res = await p.evaluate(() =>
    performance.getEntriesByType('resource').reduce((a, e) => a + (e.transferSize || 0), 0),
  );
  out.transferKB = Math.round(res / 1024);
  console.log(label, JSON.stringify(out));
};
await run('cold');
await run('warm');
await b.close();
