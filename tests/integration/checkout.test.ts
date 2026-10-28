import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { cartItems, couponRedemptions, coupons, orderEvents, orders, productVariants, stockMovements } from '@/server/db/schema';
import { addToCart, ensureCart, getCartView } from '@/server/services/cart';
import { getCheckoutQuote, placeOrder } from '@/server/services/checkout';
import { updateSetting, getSetting } from '@/server/services/settings';
import { AppError } from '@/server/errors';
import { checkoutInput, createCoupon, createProduct, createUser, seedReferenceData } from '../support/fixtures';

async function cartWith(variantId: string, quantity: number, userId: string | null = null) {
  const { cartId } = await ensureCart({ userId, guestCartId: null });
  await addToCart(cartId, variantId, quantity);
  return cartId;
}

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

beforeAll(async () => {
  await seedReferenceData();
});

describe('placing a Cash on Delivery order', () => {
  it('recomputes totals server-side, reserves stock with a ledger entry and empties the cart', async () => {
    const { variants } = await createProduct({ price: 115_000, stock: { M: 5 } });
    const cartId = await cartWith(variants.M!.id, 2);
    const quote = await getCheckoutQuote(cartId, { district: 'Gazipur', couponCode: undefined }, { userId: null });
    expect(quote).toMatchObject({ subtotal: 230_000, shippingFee: 11_000, total: 241_000 });

    const result = await placeOrder(checkoutInput({ address: { addressLine: 'House 1, Road 2', area: 'Tongi', division: 'Dhaka', district: 'Gazipur', postalCode: undefined }, expectedTotal: 241_000 }), { userId: null, cartId });
    expect(result.next).toEqual({ type: 'confirmation' });
    expect(result.orderNumber).toMatch(/^MKJ-\d{6}-[2-9A-HJ-NP-Z]{5}$/);

    const [order] = await db.select().from(orders).where(eq(orders.id, result.orderId));
    expect(order).toMatchObject({ status: 'pending', paymentMethod: 'cod', paymentStatus: 'unpaid', subtotal: 230_000, shippingFee: 11_000, total: 241_000, shippingZoneName: 'Dhaka Suburbs' });

    const [variant] = await db.select().from(productVariants).where(eq(productVariants.id, variants.M!.id));
    expect(variant!.stock).toBe(3);
    const ledger = await db.select().from(stockMovements).where(eq(stockMovements.orderId, result.orderId));
    expect(ledger).toMatchObject([{ delta: -2, stockAfter: 3, reason: 'order' }]);
    expect((await getCartView(cartId)).lines).toHaveLength(0);
    const events = await db.select().from(orderEvents).where(eq(orderEvents.orderId, result.orderId));
    expect(events.length).toBeGreaterThan(0);
  });

  it('applies free delivery at the configured threshold', async () => {
    const { variants } = await createProduct({ price: 600_000, stock: { M: 3 } });
    const cartId = await cartWith(variants.M!.id, 1);
    const quote = await getCheckoutQuote(cartId, { district: 'Sylhet', couponCode: undefined }, { userId: null });
    expect(quote).toMatchObject({ subtotal: 600_000, shippingFee: 0, freeShipping: true, total: 600_000 });
    expect(quote.zone?.name).toBe('Outside Dhaka');
  });

  it('returns the original order for a duplicate submission (idempotency)', async () => {
    const { variants } = await createProduct({ stock: { M: 5 } });
    const cartId = await cartWith(variants.M!.id, 1);
    const input = checkoutInput();
    const first = await placeOrder(input, { userId: null, cartId });
    const second = await placeOrder(input, { userId: null, cartId });
    expect(second.orderId).toBe(first.orderId);
    expect(second.reused).toBe(true);
    expect(second.accessToken).toBe(first.accessToken);
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(orders).where(eq(orders.idempotencyKey, input.idempotencyKey));
    expect(count).toBe(1);
  });

  it('handles concurrent duplicate submissions without creating two orders', async () => {
    const { variants } = await createProduct({ stock: { M: 5 } });
    const cartId = await cartWith(variants.M!.id, 2);
    const input = checkoutInput();
    const results = await Promise.allSettled([placeOrder(input, { userId: null, cartId }), placeOrder(input, { userId: null, cartId }), placeOrder(input, { userId: null, cartId })]);
    const ok = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof placeOrder>>> => r.status === 'fulfilled');
    expect(ok.length).toBe(3);
    expect(new Set(ok.map((r) => r.value.orderId)).size).toBe(1);
    const [variant] = await db.select().from(productVariants).where(eq(productVariants.id, variants.M!.id));
    expect(variant!.stock).toBe(3);
  });

  it('never oversells: parallel checkouts for the last units', async () => {
    const { variants } = await createProduct({ stock: { M: 3 } });
    const carts = await Promise.all(Array.from({ length: 6 }, () => cartWith(variants.M!.id, 1)));
    const results = await Promise.allSettled(carts.map((cartId) => placeOrder(checkoutInput(), { userId: null, cartId })));
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(succeeded).toHaveLength(3);
    expect(failed).toHaveLength(3);
    for (const f of failed) expect((f.reason as AppError).code).toBe('STOCK_UNAVAILABLE');
    const [variant] = await db.select().from(productVariants).where(eq(productVariants.id, variants.M!.id));
    expect(variant!.stock).toBe(0);
  });

  it('rejects the order when the total changed since the customer saw it', async () => {
    const { variants } = await createProduct({ price: 100_000, stock: { M: 5 } });
    const cartId = await cartWith(variants.M!.id, 1);
    const error = await expectAppError(placeOrder(checkoutInput({ expectedTotal: 90_000 }), { userId: null, cartId }), 'PRICE_CHANGED');
    expect((error.details as { total: number }).total).toBe(107_000);
    const [variant] = await db.select().from(productVariants).where(eq(productVariants.id, variants.M!.id));
    expect(variant!.stock).toBe(5); // nothing reserved
  });

  it('rejects items that became unavailable or out of stock after being added', async () => {
    const { variants } = await createProduct({ stock: { M: 2 } });
    const cartId = await cartWith(variants.M!.id, 2);
    await db.update(productVariants).set({ stock: 1 }).where(eq(productVariants.id, variants.M!.id));
    const error = await expectAppError(placeOrder(checkoutInput(), { userId: null, cartId }), 'STOCK_UNAVAILABLE');
    expect((error.details as { problems: { available: number }[] }).problems[0]!.available).toBe(1);
    const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(cartItems).where(eq(cartItems.cartId, cartId));
    expect(count!.n).toBe(1); // cart untouched
  });

  it('rejects an empty cart', async () => {
    const { cartId } = await ensureCart({ userId: null, guestCartId: null });
    await expectAppError(placeOrder(checkoutInput(), { userId: null, cartId }), 'CART_EMPTY');
  });
});

describe('coupons at checkout', () => {
  it('redeems a coupon atomically and enforces the per-customer limit by phone', async () => {
    const coupon = await createCoupon({ value: 10, minOrderAmount: 0, usageLimitPerCustomer: 1 });
    const { variants } = await createProduct({ price: 200_000, stock: { M: 10 } });

    const cart1 = await cartWith(variants.M!.id, 1);
    const first = await placeOrder(checkoutInput({ couponCode: coupon.code }), { userId: null, cartId: cart1 });
    const [order] = await db.select().from(orders).where(eq(orders.id, first.orderId));
    expect(order).toMatchObject({ discountTotal: 20_000, couponCode: coupon.code, total: 200_000 - 20_000 + 7_000 });
    const [updated] = await db.select().from(coupons).where(eq(coupons.id, coupon.id));
    expect(updated!.usedCount).toBe(1);

    const cart2 = await cartWith(variants.M!.id, 1);
    const error = await expectAppError(placeOrder(checkoutInput({ couponCode: coupon.code }), { userId: null, cartId: cart2 }), 'COUPON_INVALID');
    expect(error.fields?.couponCode).toMatch(/already used/);

    // A different customer can still use it.
    const other = await placeOrder(checkoutInput({ couponCode: coupon.code, contact: { name: 'Karim Mia', phone: '01812345678', email: undefined } }), { userId: null, cartId: cart2 });
    expect(other.orderId).toBeDefined();
    const redemptions = await db.select().from(couponRedemptions).where(eq(couponRedemptions.couponId, coupon.id));
    expect(redemptions).toHaveLength(2);
  });

  it('respects the global usage limit under concurrency', async () => {
    const coupon = await createCoupon({ value: 5, usageLimit: 1, usageLimitPerCustomer: null });
    const { variants } = await createProduct({ stock: { M: 10 } });
    const carts = await Promise.all([cartWith(variants.M!.id, 1), cartWith(variants.M!.id, 1), cartWith(variants.M!.id, 1)]);
    const results = await Promise.allSettled(
      carts.map((cartId, i) => placeOrder(checkoutInput({ couponCode: coupon.code, contact: { name: 'Buyer Name', phone: `0171000000${i}`, email: undefined } }), { userId: null, cartId })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [updated] = await db.select().from(coupons).where(eq(coupons.id, coupon.id));
    expect(updated!.usedCount).toBe(1);
  });
});

describe('checkout settings', () => {
  it('blocks guest checkout when disabled, but allows signed-in customers', async () => {
    const original = await getSetting('checkout');
    await updateSetting('checkout', { ...original, guestCheckoutEnabled: false });
    try {
      const { variants } = await createProduct({ stock: { M: 5 } });
      const guestCart = await cartWith(variants.M!.id, 1);
      await expectAppError(placeOrder(checkoutInput(), { userId: null, cartId: guestCart }), 'UNAUTHENTICATED');
      const { user } = await createUser();
      const userCart = await cartWith(variants.M!.id, 1, user.id);
      const result = await placeOrder(checkoutInput(), { userId: user.id, cartId: userCart });
      const [order] = await db.select().from(orders).where(eq(orders.id, result.orderId));
      expect(order!.userId).toBe(user.id);
    } finally {
      await updateSetting('checkout', original);
    }
  });

  it('enforces the Cash on Delivery order limit', async () => {
    const original = await getSetting('checkout');
    await updateSetting('checkout', { ...original, codMaxOrderAmount: 100_000 });
    try {
      const { variants } = await createProduct({ price: 150_000, stock: { M: 5 } });
      const cartId = await cartWith(variants.M!.id, 1);
      await expectAppError(placeOrder(checkoutInput(), { userId: null, cartId }), 'COD_LIMIT_EXCEEDED');
    } finally {
      await updateSetting('checkout', original);
    }
  });

  it('refuses online payment when the gateway is not configured', async () => {
    const { variants } = await createProduct({ stock: { M: 5 } });
    const cartId = await cartWith(variants.M!.id, 1);
    await expectAppError(placeOrder(checkoutInput({ paymentMethod: 'sslcommerz' }), { userId: null, cartId }), 'PAYMENT_METHOD_UNAVAILABLE');
  });
});
