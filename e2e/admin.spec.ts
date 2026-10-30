import { expect, test, type Page } from '@playwright/test';

const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD!;

async function adminSignIn(page: Page, email: string, password: string) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('admin confirms and ships an order; stock and timeline update', async ({ page }) => {
  await adminSignIn(page, 'admin@mkjmart.demo', DEMO_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await page.goto('/admin/orders?status=pending');
  await page.locator('table a[href^="/admin/orders/"]').first().click();
  await expect(page.getByText('Fulfilment')).toBeVisible();
  await page.getByTestId('order-action-confirmed').click();
  await expect(page.getByText('Your order has been confirmed.')).toBeVisible();

  await page.getByTestId('order-action-processing').click();
  await expect(page.getByTestId('order-action-shipped')).toBeVisible();
  await page.getByTestId('order-action-shipped').click();
  await page.getByLabel('Courier').fill('Pathao Courier');
  await page.getByLabel('Tracking number').fill('PTH-E2E-1');
  await page.getByRole('dialog').getByRole('button', { name: 'Mark as shipped' }).click();
  await expect(page.getByText(/handed to Pathao Courier \(tracking PTH-E2E-1\)/)).toBeVisible();
});

test('admin can adjust inventory with a ledger entry', async ({ page }) => {
  await adminSignIn(page, 'admin@mkjmart.demo', DEMO_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.goto('/admin/inventory?q=MKJ-BG-TOT');
  await page.getByTestId('adjust-MKJ-BG-TOT-BLA-ONESIZE').click();
  await page.getByLabel('Change (e.g. 12 or -2)').fill('6');
  await page.getByRole('button', { name: 'Save adjustment' }).click();
  await expect(page.getByText(/stock is now/)).toBeVisible();
  await page.getByRole('button', { name: 'Stock history for MKJ-BG-TOT-BLA-ONESIZE' }).click();
  await expect(page.getByRole('dialog')).toContainText(/restock/i);
});

test('customers are blocked from the admin panel', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('customer@mkjmart.demo');
  await page.getByRole('textbox', { name: 'Password' }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Hello, Ayesha/ })).toBeVisible();
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login\?denied=1/);
  await expect(page.getByText('does not have access to the admin panel')).toBeVisible();
  const api = await page.request.get('/api/v1/admin/dashboard');
  expect(api.status()).toBe(403);
});

test('staff cannot open store settings', async ({ page }) => {
  await adminSignIn(page, 'staff@mkjmart.demo', DEMO_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  await page.goto('/admin/settings');
  await expect(page).toHaveURL(/\/admin\?denied=1/);
  await expect(page.getByText('doesn’t include access to that section')).toBeVisible();
});
