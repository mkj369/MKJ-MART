import { expect, test, type Page } from '@playwright/test';

/**
 * QA audit (2026-10-30): journeys the original suite did not cover — failed sign-ins, logout,
 * session persistence, bag quantity/removal, checkout validation, product management and more
 * staff restrictions.
 */
const PASSWORD = process.env.E2E_DEMO_PASSWORD!;

async function signIn(page: Page, path: string, email: string, password = PASSWORD) {
  await page.goto(path);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function addTeeToBag(page: Page) {
  await page.goto('/products/heavyweight-cotton-tee');
  await page.getByRole('button', { name: 'Size M', exact: true }).click();
  await page.getByTestId('add-to-bag').click();
  await expect(page.getByTestId('cart-count')).toHaveText('1');
}

test('wrong passwords are rejected for customers and staff, and nobody is signed in', async ({ page }) => {
  await signIn(page, '/login', 'customer@mkjmart.demo', 'Wrong-password-123');
  await expect(page.getByText('Incorrect email or password.')).toBeVisible();
  await page.goto('/account');
  await expect(page).toHaveURL(/\/login\?next=%2Faccount/);

  await signIn(page, '/admin/login', 'admin@mkjmart.demo', 'Wrong-password-123');
  await expect(page.getByText('Incorrect email or password.')).toBeVisible();
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login/);
});

test('a customer session survives a reload and ends on sign-out', async ({ page }) => {
  await signIn(page, '/login?next=%2Faccount', 'customer@mkjmart.demo');
  await expect(page.getByRole('heading', { name: /^Hello,/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: /^Hello,/ })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/account/orders');
  await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Forders/);
});

test('bag: increase, decrease and remove a line; the bag survives a reload', async ({ page }) => {
  await addTeeToBag(page);
  await page.goto('/cart');
  await page.getByRole('button', { name: 'Increase quantity' }).click();
  await expect(page.getByTestId('cart-count')).toHaveText('2');
  await page.reload();
  await expect(page.getByTestId('cart-count')).toHaveText('2');
  await page.getByRole('button', { name: 'Decrease quantity' }).click();
  await expect(page.getByTestId('cart-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Remove Heavyweight Cotton Tee' }).click();
  await expect(page.getByText('Your bag is empty')).toBeVisible();
  await expect(page.getByTestId('cart-count')).toHaveCount(0);
});

test('checkout validates the delivery form and places nothing until it is valid', async ({ page }) => {
  await addTeeToBag(page);
  await page.goto('/checkout');
  // Nothing can be submitted until a district is chosen (the summary says "Select district").
  await expect(page.getByTestId('place-order')).toBeDisabled();
  await page.getByLabel('Full name').fill('Validation Tester');
  await page.getByLabel('Mobile number').fill('12345');
  await page.getByLabel('Division').selectOption('Dhaka');
  await page.getByLabel('District').selectOption('Gazipur');
  await page.getByLabel('Area / Thana').fill('Tongi');
  await page.getByLabel('Street address').fill('House 4, College Road');
  await page.getByTestId('place-order').click();
  await expect(page.getByText('Enter a valid Bangladeshi mobile number (01XXXXXXXXX).')).toBeVisible();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByTestId('cart-count')).toHaveText('1');
});

test('admin creates a draft, adds a photo, publishes, archives and deletes a product', async ({ page }) => {
  const name = `QA Linen Overshirt ${Date.now()}`;
  await signIn(page, '/admin/login?next=%2Fadmin%2Fproducts%2Fnew', 'admin@mkjmart.demo');
  await expect(page).toHaveURL(/\/admin\/products\/new/);
  // Visible labels carry a required asterisk ("Name*"), so select by accessible name.
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await page.getByRole('textbox', { name: 'Price', exact: true }).fill('2450');
  await page.getByRole('button', { name: 'Generate' }).click();
  const generator = page.getByRole('dialog');
  await generator.getByRole('button', { name: 'M', exact: true }).click();
  await generator.getByLabel('Opening stock per variant').fill('5');
  await generator.getByRole('button', { name: 'Generate' }).click();

  // Publishing requires a photo: try it, then save as a draft instead.
  await page.getByLabel('Status').selectOption('active');
  await page.getByTestId('save-product').click();
  await expect(page.getByText('Add at least one image before publishing.').first()).toBeVisible();
  await page.getByLabel('Status').selectOption('draft');
  await page.getByTestId('save-product').click();
  await expect(page).toHaveURL(/\/admin\/products\/[0-9a-f-]{36}$/);
  const editorUrl = page.url();
  const slug = await page.getByLabel('URL slug').inputValue();
  // Hidden from the store. (The 404 page is streamed after the loading skeleton, so its HTTP status is 200 + noindex.)
  await page.goto(`/products/${slug}`);
  await expect(page.getByRole('heading', { level: 1, name: 'This page has moved on.' })).toBeVisible();

  await page.goto(editorUrl);
  await page.locator('input[type="file"]').setInputFiles('public/images/demo/products/hand-block-print-kurti.webp');
  await expect(page.getByRole('heading', { name: 'Images (1/12)' })).toBeVisible();
  await page.getByLabel('Status').selectOption('active');
  await page.getByTestId('save-product').click();
  await expect(page.getByText('Product saved')).toBeVisible();
  await page.goto(`/products/${slug}`);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

  await page.goto(editorUrl);
  await page.getByLabel('Status').selectOption('archived');
  await page.getByTestId('save-product').click();
  await expect(page.getByText('Product saved')).toBeVisible();
  await page.goto(`/products/${slug}`);
  await expect(page.getByRole('heading', { level: 1, name: 'This page has moved on.' })).toBeVisible();

  await page.goto(editorUrl);
  await page.getByRole('button', { name: 'Delete product' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Delete/ }).click();
  await expect(page).toHaveURL(/\/admin\/products$/);
  await expect(page.getByText(name)).toHaveCount(0);
});

test('staff are kept out of coupons, delivery zones and settings', async ({ page }) => {
  await signIn(page, '/admin/login', 'staff@mkjmart.demo');
  await expect(page).toHaveURL(/\/admin$/);
  for (const path of ['/admin/coupons', '/admin/shipping', '/admin/settings']) {
    await page.goto(path);
    await expect(page, `${path} must be refused`).toHaveURL(/\/admin\?denied=1/);
  }
});
