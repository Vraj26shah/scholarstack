/**
 * Admin panel speed with a big library: sign in, open R2 → Website, compare everything,
 * and time how long each step takes plus how smooth scrolling the result is.
 *   DEMO_BULK=5000 pnpm start:demo (apps/api), then: BASE_URL=... node scripts/admin-speed.mjs
 */
import { chromium } from '@playwright/test';
const base = process.env.BASE_URL ?? 'http://localhost:8791';
const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, baseURL: base });
const p = await ctx.newPage();
const out = {};
await p.goto('/sign-in?next=%2Fadmin');
await p.getByLabel('College email').fill(process.env.ADMIN ?? 'admin');
await p.getByRole('button', { name: 'Sign in', exact: true }).click();
let t = Date.now();
await p.waitForURL((u) => u.pathname === '/admin');
await p.getByText('Working').first().waitFor({ timeout: 30_000 });
out.adminReady = Date.now() - t;
t = Date.now();
await p.getByRole('radio', { name: /Everything in R2/ }).click();
await p.getByRole('button', { name: 'Next: compare with the website' }).click();
await p.getByText('Not in any course').waitFor({ timeout: 60_000 });
await p.getByText('Not in any course').scrollIntoViewIfNeeded();
out.compareEverything = Date.now() - t;
out.domNodes = await p.evaluate(() => document.querySelectorAll('*').length);
out.longTasks = await p.evaluate(
  () =>
    new Promise((r) => {
      const seen = [];
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) seen.push(Math.round(e.duration));
      }).observe({ type: 'longtask', buffered: true });
      setTimeout(() => r(seen.sort((a, c) => c - a).slice(0, 5)), 300);
    }),
);
out.scroll = await p.evaluate(async () => {
  const frames = [];
  let last = performance.now();
  let y = 0;
  await new Promise((done) => {
    const step = (now) => {
      frames.push(now - last);
      last = now;
      y += 60;
      window.scrollTo(0, y);
      if (y < document.body.scrollHeight - innerHeight && frames.length < 400) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  });
  frames.sort((a, c) => a - c);
  return {
    frames: frames.length,
    p95ms: Math.round(frames[Math.floor(frames.length * 0.95)]),
    maxMs: Math.round(frames.at(-1)),
  };
});
if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT, fullPage: false });
out.bodyText = await p.evaluate(() =>
  (document.body.innerText.match(/\d[\d,]* (files?|new|not in)[^\n]{0,40}/gi) ?? []).slice(0, 12),
);
console.log(JSON.stringify(out));
await b.close();
