import { defineConfig, devices } from '@playwright/test';

const port = process.env.E2E_PORT ?? '8787';
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

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
    baseURL,
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /app-mode\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } },
    },
    // Phones get the website. The student app's screens (the Android app) have their own suite,
    // previewed in the browser with ss_app_preview (what "?app=on" sets).
    { name: 'phone', testIgnore: /app-mode\.spec\.ts/, use: { ...devices['Pixel 7'] } },
    {
      name: 'phone-app',
      testMatch: /app-mode\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        storageState: {
          cookies: [],
          origins: [{ origin: baseURL, localStorage: [{ name: 'ss_app_preview', value: '1' }] }],
        },
      },
    },
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
