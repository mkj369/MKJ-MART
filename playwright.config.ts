import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

// Demo accounts get a fresh random password per run (seeded by scripts/e2e-server.ts); nothing
// guessable is ever committed. Workers inherit it from the main process.
process.env.E2E_DEMO_PASSWORD ??= `E2e-${randomBytes(9).toString('base64url')}7`;

/**
 * End-to-end tests run against a PRODUCTION build (`npm run build` first) with an isolated,
 * freshly seeded database (see scripts/e2e-server.ts).
 *
 * In sandboxes without Playwright's bundled browsers, point PLAYWRIGHT_CHROMIUM_EXECUTABLE at a
 * Chromium binary (optionally with extra flags in PLAYWRIGHT_CHROMIUM_ARGS).
 */
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;
// preview-proxy project: a second instance with the header fallback behind a proxy that strips
// cookies (like the Arena preview), plus a control proxy in front of the normal instance.
const previewPort = 3200;
const previewProxyPort = 3201;
const controlProxyPort = Number(process.env.E2E_CONTROL_PROXY_PORT ?? 3101);
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
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } }, testIgnore: /preview-proxy\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /storefront\.spec\.ts/ },
    {
      name: 'preview-proxy',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 }, baseURL: `http://localhost:${previewProxyPort}` },
      testMatch: /preview-proxy\.spec\.ts/,
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: 'npx tsx scripts/e2e-server.ts',
          url: `${baseURL}/api/v1/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 240_000,
          stdout: 'pipe',
        },
        {
          command: 'npx tsx scripts/e2e-server.ts',
          url: `http://localhost:${previewPort}/api/v1/health`,
          env: {
            E2E_PORT: String(previewPort),
            E2E_SMTP_PORT: '3225',
            E2E_MAIL_HTTP_PORT: '3226',
            E2E_DB_NAME: 'mkj_e2e_preview',
            SESSION_HEADER_FALLBACK: 'true',
          },
          reuseExistingServer: !process.env.CI,
          timeout: 240_000,
        },
        {
          command: 'npx tsx scripts/cookie-stripping-proxy.ts',
          url: `http://localhost:${previewProxyPort}/api/v1/health`,
          env: { PROXY_PORT: String(previewProxyPort), PROXY_TARGET: `http://127.0.0.1:${previewPort}` },
          reuseExistingServer: !process.env.CI,
          timeout: 240_000,
        },
        {
          command: 'npx tsx scripts/cookie-stripping-proxy.ts',
          url: `http://localhost:${controlProxyPort}/api/v1/health`,
          env: { PROXY_PORT: String(controlProxyPort), PROXY_TARGET: `http://127.0.0.1:${port}` },
          reuseExistingServer: !process.env.CI,
          timeout: 240_000,
        },
      ],
});
