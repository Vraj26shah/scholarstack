import { defineConfig, devices } from '@playwright/test';

const port = process.env.E2E_PORT ?? '8787';

/**
 * End-to-end tests run against the demo server (in-memory API + built site),
 * so they need no real Supabase, Cloudflare or Razorpay.
 *   pnpm build:demo && pnpm test:e2e
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${port}`,
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm --filter @ss/api start:demo',
        env: { WEB_DIST: '../web/dist', PORT: port },
        url: `http://localhost:${port}/api/catalogue`,
        reuseExistingServer: false,
        timeout: 60_000,
      },
});
