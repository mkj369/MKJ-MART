import { expect, test } from '@playwright/test';

test.describe('guest shopping', () => {
  test('browse, add to bag, check out with Cash on Delivery and track the order', async ({ page, isMobile }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Quiet luxury');
    await expect(page.getByTestId('demo-notice')).toBeVisible();

    await page.goto('/shop?q=tee');
    await page.getByRole('link', { name: 'Heavyweight Cotton Tee' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Heavyweight Cotton Tee' })).toBeVisible();

    // Size is required.
    await page.getByTestId('add-to-bag').click();
    await expect(page.getByText('Please choose a size.')).toBeVisible();
    await page.getByRole('button', { name: 'Size M', exact: true }).click();
    await page.getByTestId('add-to-bag').click();

    const drawer = page.getByRole('dialog');
    await expect(drawer).toContainText('Heavyweight Cotton Tee');
    await expect(page.getByTestId('cart-count')).toHaveText('1');
    await drawer.getByRole('link', { name: 'Checkout' }).click();

    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
    await page.getByLabel('Full name').fill('Shirin Akter');
    await page.getByLabel('Mobile number').fill('01921000111');
    await page.getByLabel('Division').selectOption('Dhaka');
    await page.getByLabel('District').selectOption('Gazipur');
    await page.getByLabel('Area / Thana').fill('Tongi');
    await page.getByLabel('Street address').fill('House 4, College Road');
    // ৳1,150 + ৳110 Dhaka Suburbs delivery
    await expect(page.getByTestId('checkout-total')).toHaveText('৳1,260');
    await page.getByTestId('place-order').click();

    await expect(page.getByRole('heading', { name: /Thank you, Shirin/ })).toBeVisible();
    const orderNumber = (await page.getByTestId('order-number').textContent())!.trim();
    expect(orderNumber).toMatch(/^MKJ-\d{6}-[A-Z0-9]{5}$/);
    await expect(page.getByText('Cash on Delivery').first()).toBeVisible();
    if (!isMobile) await expect(page.getByTestId('cart-count')).toHaveCount(0);

    // Public tracking with order number + phone (accepts +880 format).
    await page.goto('/track-order');
    await page.getByLabel('Order number').fill(orderNumber);
    await page.getByLabel('Mobile number').fill('+8801921000111');
    await page.getByRole('button', { name: 'Track' }).click();
    await expect(page.getByText(orderNumber).last()).toBeVisible();
    await expect(page.getByText('Order placed with Cash on Delivery.')).toBeVisible();
  });

  test('filters and empty states', async ({ page }) => {
    await page.goto('/shop?category=panjabi');
    await expect(page.getByTestId('product-card')).toHaveCount(2);
    await page.goto('/shop?q=nothing-matches-this');
    await expect(page.getByText('Nothing matches — yet')).toBeVisible();
    await page.goto('/products/does-not-exist');
    await expect(page.getByText('This page has moved on.')).toBeVisible();
  });
});
