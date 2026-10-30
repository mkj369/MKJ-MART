import { expect, test, type Page } from '@playwright/test';

/**
 * Regression for the Arena preview (2026-10-30): its proxy strips the Cookie header, so the
 * session and guest bag never reached the server. This project runs the app with the header
 * fallback (SESSION_HEADER_FALLBACK=true) behind scripts/cookie-stripping-proxy.ts, which drops
 * Cookie and Referer exactly like the observed preview path.
 */
const PASSWORD = process.env.E2E_DEMO_PASSWORD!;
const CONTROL_PROXY = `http://localhost:${process.env.E2E_CONTROL_PROXY_PORT ?? 3101}`;

async function signIn(page: Page, url: string, email: string) {
  await page.goto(url);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('guest bag and Cash on Delivery checkout work without cookies', async ({ page }) => {
  await page.goto('/products/heavyweight-cotton-tee');
  await page.getByRole('button', { name: 'Size M', exact: true }).click();
  await page.getByTestId('add-to-bag').click();
  await expect(page.getByTestId('cart-count')).toHaveText('1');

  await page.goto('/cart'); // a full page load cannot carry custom headers: the page re-syncs itself
  await expect(page.getByTestId('cart-count')).toHaveText('1');
  await page.getByTestId('checkout-link').click();
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  await page.getByLabel('Full name').fill('Proxy Tester');
  await page.getByLabel('Mobile number').fill('01921000222');
  await page.getByLabel('Division').selectOption('Dhaka');
  await page.getByLabel('District').selectOption('Dhaka');
  await page.getByLabel('Area / Thana').fill('Mirpur');
  await page.getByLabel('Street address').fill('House 9, Road 3');
  await page.getByTestId('place-order').click();
  await expect(page.getByRole('heading', { name: /Thank you, Proxy/ })).toBeVisible();
  await expect(page.getByTestId('cart-count')).toHaveCount(0);
});

test('a customer signs in, stays signed in across navigation and reloads, and signs out', async ({ page }) => {
  await signIn(page, '/login?next=%2Faccount', 'customer@mkjmart.demo');
  await expect(page.getByRole('heading', { name: /^Hello,/ })).toBeVisible();
  await page.getByRole('link', { name: 'Orders' }).first().click();
  await expect(page).toHaveURL(/\/account\/orders/);
  await page.reload();
  await expect(page).toHaveURL(/\/account\/orders/);
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: /^Hello,/ })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/account');
  await expect(page).toHaveURL(/\/login\?next=%2Faccount/);
});

test('a new customer registers and lands in their account (the first failure seen in the preview)', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Preview Newcomer');
  await page.getByLabel('Email').fill(`preview-${Date.now()}@example.test`);
  await page.getByLabel('Mobile number').fill('01722000333');
  await page.getByRole('textbox', { name: 'Password' }).fill('Secret1234');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Preview' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hello, Preview' })).toBeVisible();
});

test('admin reaches the dashboard after a reload; staff restrictions still apply', async ({ page }) => {
  await signIn(page, '/admin/login?next=%2Fadmin', 'admin@mkjmart.demo');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await page.goto('/admin/orders');
  await expect(page).toHaveURL(/\/admin\/orders/);
  await page.getByRole('button', { name: 'Sign out' }).click();

  await signIn(page, '/admin/login?next=%2Fadmin', 'staff@mkjmart.demo');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await page.goto('/admin/settings');
  await expect(page).toHaveURL(/\/admin\?denied=1/);
});

test('without the fallback the sign-in form says cookies are being stripped (no silent loop)', async ({ page }) => {
  await signIn(page, `${CONTROL_PROXY}/login?next=%2Faccount`, 'customer@mkjmart.demo');
  await expect(page.getByText(/cookies from this site are not reaching the server/)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
