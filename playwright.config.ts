import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a PRODUCTION build (`npm run build` first) with an isolated,
 * freshly seeded database (see scripts/e2e-server.ts).
 *
 * In sandboxes without Playwright's bundled browsers, point PLAYWRIGHT_CHROMIUM_EXECUTABLE at a
 * Chromium binary (optionally with extra flags in PLAYWRIGHT_CHROMIUM_ARGS).
 */
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
const extraArgs = process.env.PLAYWRIGHT_CHROMIUM_ARGS?.split(' ').filter(Boolean) ?? [];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath, args: extraArgs },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /storefront\.spec\.ts/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npx tsx scripts/e2e-server.ts',
        url: `${baseURL}/api/v1/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
        stdout: 'pipe',
      },
});
