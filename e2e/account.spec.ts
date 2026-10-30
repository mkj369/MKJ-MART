import { expect, test } from '@playwright/test';

test('customer registers, saves a wishlist item, checks out and sees the order in their history', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.test`;
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Farzana Hoque');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mobile number').fill('01722000222');
  await page.getByRole('textbox', { name: 'Password' }).fill('Secret1234');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Farzana' })).toBeVisible();

  // Wishlist
  await page.goto('/products/knitted-pique-polo');
  await page.getByRole('button', { name: /Save Knitted Piqué Polo to wishlist/ }).last().click();
  await expect(page.getByText('saved to your wishlist')).toBeVisible();
  await page.goto('/account/wishlist');
  await expect(page.getByTestId('wishlist-grid')).toContainText('Knitted Piqué Polo');

  // Checkout as a signed-in customer and save the address
  await page.goto('/products/knitted-pique-polo');
  await page.getByRole('button', { name: 'Size L', exact: true }).click();
  await page.getByTestId('add-to-bag').click();
  await page.getByRole('dialog').getByRole('link', { name: 'Checkout' }).click();
  await expect(page.getByLabel('Full name')).toHaveValue('Farzana Hoque');
  await expect(page.getByLabel('Mobile number')).toHaveValue('01722000222');
  await page.getByLabel('Division').selectOption('Chattogram');
  await page.getByLabel('District').selectOption('Chattogram');
  await page.getByLabel('Area / Thana').fill('Kotwali');
  await page.getByLabel('Street address').fill('22 Jamal Khan Road');
  await expect(page.getByTestId('checkout-total')).toHaveText('৳1,990'); // ৳1,850 + ৳140 outside Dhaka
  await page.getByTestId('place-order').click();
  await expect(page.getByRole('heading', { name: /Thank you, Farzana/ })).toBeVisible();
  const orderNumber = (await page.getByTestId('order-number').textContent())!.trim();

  await page.goto('/account/orders');
  await expect(page.getByTestId('order-history')).toContainText(orderNumber);
  await page.goto('/account/addresses');
  await expect(page.getByText('22 Jamal Khan Road')).toBeVisible();
});

test('protected pages redirect to sign-in', async ({ page }) => {
  await page.goto('/account/orders');
  await expect(page).toHaveURL(/\/login\?next=%2Faccount%2Forders/);
});
