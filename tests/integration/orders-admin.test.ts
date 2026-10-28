import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { coupons, orders, productVariants, stockMovements } from '@/server/db/schema';
import { addToCart, ensureCart } from '@/server/services/cart';
import { placeOrder } from '@/server/services/checkout';
import { cancelOrderByCustomer, getOrderForViewer, trackOrder } from '@/server/services/orders';
import { updateOrderPayment, updateOrderStatus } from '@/server/services/admin/orders';
import { adjustStock } from '@/server/services/admin/inventory';
import { createProduct as createProductAdmin, deleteProduct, updateProduct, getProductAdmin } from '@/server/services/admin/products';
import { getDashboard } from '@/server/services/admin/dashboard';
import { AppError } from '@/server/errors';
import { checkoutInput, createCoupon, createProduct, createUser, seedReferenceData } from '../support/fixtures';
import { colors, sizes } from '@/server/db/schema';

let adminId: string;

async function newOrder(options: { quantity?: number; userId?: string | null; couponCode?: string; stock?: number } = {}) {
  const { variants } = await createProduct({ price: 100_000, stock: { M: options.stock ?? 10 } });
  const { cartId } = await ensureCart({ userId: options.userId ?? null, guestCartId: null });
  await addToCart(cartId, variants.M!.id, options.quantity ?? 2);
  const result = await placeOrder(checkoutInput({ couponCode: options.couponCode }), { userId: options.userId ?? null, cartId });
  return { ...result, variantId: variants.M!.id };
}

const stockOf = async (variantId: string) => (await db.select().from(productVariants).where(eq(productVariants.id, variantId)))[0]!.stock;
const orderOf = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]!;

async function code(promise: Promise<unknown>) {
  try {
    await promise;
    return null;
  } catch (e) {
    return (e as AppError).code;
  }
}

beforeAll(async () => {
  await seedReferenceData();
  adminId = (await createUser({ role: 'admin' })).user.id;
});

describe('order fulfilment (admin)', () => {
  it('walks the happy path and marks COD paid on delivery', async () => {
    const order = await newOrder();
    for (const status of ['confirmed', 'processing'] as const) await updateOrderStatus(order.orderId, { status, note: null, courierName: null, trackingNumber: null }, adminId);
    expect(await code(updateOrderStatus(order.orderId, { status: 'shipped', note: null, courierName: null, trackingNumber: null }, adminId))).toBe('VALIDATION_ERROR');
    await updateOrderStatus(order.orderId, { status: 'shipped', note: null, courierName: 'Pathao Courier', trackingNumber: 'PTH123' }, adminId);
    await updateOrderStatus(order.orderId, { status: 'delivered', note: null, courierName: null, trackingNumber: null }, adminId);
    const row = await orderOf(order.orderId);
    expect(row).toMatchObject({ status: 'delivered', paymentStatus: 'paid', courierName: 'Pathao Courier', trackingNumber: 'PTH123' });
    expect(row.deliveredAt).not.toBeNull();
  });

  it('rejects transitions outside the state machine', async () => {
    const order = await newOrder();
    expect(await code(updateOrderStatus(order.orderId, { status: 'delivered', note: null, courierName: null, trackingNumber: null }, adminId))).toBe('INVALID_TRANSITION');
    expect(await code(updateOrderStatus(order.orderId, { status: 'pending', note: null, courierName: null, trackingNumber: null }, adminId))).toBe('NO_CHANGE');
  });

  it('cancelling restocks items (with ledger) and releases the coupon', async () => {
    const coupon = await createCoupon({ value: 10, usageLimitPerCustomer: 1 });
    const order = await newOrder({ couponCode: coupon.code, quantity: 3 });
    expect(await stockOf(order.variantId)).toBe(7);
    await updateOrderStatus(order.orderId, { status: 'cancelled', note: 'Customer changed mind', courierName: null, trackingNumber: null }, adminId);
    expect(await stockOf(order.variantId)).toBe(10);
    const ledger = await db.select().from(stockMovements).where(eq(stockMovements.orderId, order.orderId));
    expect(ledger.map((l) => l.reason).sort()).toEqual(['order', 'order_cancelled']);
    expect((await db.select().from(coupons).where(eq(coupons.id, coupon.id)))[0]!.usedCount).toBe(0);
    // Cancelling twice is rejected and never double-restocks.
    expect(await code(updateOrderStatus(order.orderId, { status: 'cancelled', note: null, courierName: null, trackingNumber: null }, adminId))).toBe('NO_CHANGE');
    expect(await stockOf(order.variantId)).toBe(10);
  });

  it('records returns back into stock and allows a refund to be recorded', async () => {
    const order = await newOrder({ quantity: 1 });
    for (const status of ['confirmed', 'processing'] as const) await updateOrderStatus(order.orderId, { status, note: null, courierName: null, trackingNumber: null }, adminId);
    await updateOrderStatus(order.orderId, { status: 'shipped', note: null, courierName: 'RedX', trackingNumber: null }, adminId);
    await updateOrderStatus(order.orderId, { status: 'delivered', note: null, courierName: null, trackingNumber: null }, adminId);
    expect(await stockOf(order.variantId)).toBe(9);
    await updateOrderStatus(order.orderId, { status: 'returned', note: null, courierName: null, trackingNumber: null }, adminId);
    expect(await stockOf(order.variantId)).toBe(10);
    await updateOrderPayment(order.orderId, 'mark_refunded', 'bKash refund TX123', adminId);
    expect((await orderOf(order.orderId)).paymentStatus).toBe('refunded');
  });

  it('only allows manual payment marking for COD orders', async () => {
    const order = await newOrder();
    await updateOrderPayment(order.orderId, 'mark_paid', null, adminId);
    expect((await orderOf(order.orderId)).paymentStatus).toBe('paid');
    expect(await code(updateOrderPayment(order.orderId, 'mark_paid', null, adminId))).toBe('NO_CHANGE');
    expect(await code(updateOrderPayment(order.orderId, 'mark_refunded', null, adminId))).toBe('INVALID_TRANSITION');
  });
});

describe('customer order access', () => {
  it('lets the owner or token holder view an order, nobody else', async () => {
    const { user } = await createUser();
    const order = await newOrder({ userId: user.id });
    expect(await getOrderForViewer(order.orderNumber, { userId: user.id })).not.toBeNull();
    expect(await getOrderForViewer(order.orderNumber, { token: order.accessToken })).not.toBeNull();
    const { user: stranger } = await createUser();
    expect(await getOrderForViewer(order.orderNumber, { userId: stranger.id })).toBeNull();
    expect(await getOrderForViewer(order.orderNumber, { token: 'forged-token-value' })).toBeNull();
    expect(await getOrderForViewer(order.orderNumber, {})).toBeNull();
  });

  it('tracks by order number + phone with a limited, masked view', async () => {
    const order = await newOrder();
    const tracked = await trackOrder(order.orderNumber, '01712345678');
    expect(tracked).toMatchObject({ orderNumber: order.orderNumber, status: 'pending', phoneMasked: '017•••••678' });
    expect(tracked).not.toHaveProperty('address');
    expect(await trackOrder(order.orderNumber, '01812345678')).toBeNull();
  });

  it('allows customer cancellation only while pending', async () => {
    const order = await newOrder();
    const cancelled = await cancelOrderByCustomer(order.orderNumber, { token: order.accessToken });
    expect(cancelled.status).toBe('cancelled');
    expect(await stockOf(order.variantId)).toBe(10);

    const confirmed = await newOrder();
    await updateOrderStatus(confirmed.orderId, { status: 'confirmed', note: null, courierName: null, trackingNumber: null }, adminId);
    expect(await code(cancelOrderByCustomer(confirmed.orderNumber, { token: confirmed.accessToken }))).toBe('INVALID_TRANSITION');
  });
});

describe('catalogue & inventory management', () => {
  async function options() {
    const [m] = await db.select().from(sizes).where(eq(sizes.label, 'M'));
    const [l] = await db.select().from(sizes).where(eq(sizes.label, 'L'));
    const [black] = await db.select().from(colors).where(eq(colors.name, 'Black'));
    return { m: m!.id, l: l!.id, black: black!.id };
  }

  it('creates a product with variants and an opening-stock ledger', async () => {
    const o = await options();
    const created = await createProductAdmin(
      {
        name: 'Linen Shirt',
        slug: undefined,
        description: 'Breathable',
        material: null,
        careInstructions: null,
        categoryId: null,
        price: 265_000,
        compareAtPrice: 325_000,
        status: 'draft',
        isFeatured: false,
        tags: ['linen'],
        collectionIds: [],
        images: [],
        variants: [
          { sku: 'LIN-BLK-M', sizeId: o.m, colorId: o.black, stock: 4, isActive: true },
          { sku: 'LIN-BLK-L', sizeId: o.l, colorId: o.black, stock: 0, isActive: true },
        ],
      },
      adminId,
    );
    expect(created.slug).toBe('linen-shirt');
    const product = await getProductAdmin(created.id);
    expect(product.variants).toHaveLength(2);
    const ledger = await db.select().from(stockMovements).where(eq(stockMovements.variantId, product.variants.find((v) => v.sku === 'LIN-BLK-M')!.id));
    expect(ledger).toMatchObject([{ delta: 4, reason: 'initial' }]);
  });

  it('applies stock edits as deltas so concurrent sales are not overwritten', async () => {
    const o = await options();
    const created = await createProductAdmin(
      { name: `Polo ${Date.now()}`, slug: undefined, description: '', material: null, careInstructions: null, categoryId: null, price: 185_000, compareAtPrice: null, status: 'active', isFeatured: false, tags: [], collectionIds: [], images: [{ url: '/images/demo/products/knitted-pique-polo.webp', alt: '', colorId: null }], variants: [{ sku: `POLO-${Date.now()}`, sizeId: o.m, colorId: o.black, stock: 10, isActive: true }] },
      adminId,
    );
    const loaded = await getProductAdmin(created.id);
    const variant = loaded.variants[0]!;
    // A customer buys 3 while the admin has the editor open (baseline 10).
    await db.update(productVariants).set({ stock: 7 }).where(eq(productVariants.id, variant.id));
    await updateProduct(
      created.id,
      { name: loaded.name, slug: loaded.slug, description: '', material: null, careInstructions: null, categoryId: null, price: 185_000, compareAtPrice: null, status: 'active', isFeatured: false, tags: [], collectionIds: [], images: [{ id: loaded.images[0]!.id, url: loaded.images[0]!.url, alt: '', colorId: null }], variants: [{ id: variant.id, sku: variant.sku, sizeId: o.m, colorId: o.black, stock: 15, stockBaseline: 10, isActive: true }] },
      adminId,
    );
    expect(await stockOf(variant.id)).toBe(12); // 7 + (15 - 10), not 15
  });

  it('rejects duplicate SKUs across products and blocks deleting ordered products', async () => {
    const order = await newOrder();
    const [variant] = await db.select().from(productVariants).where(eq(productVariants.id, order.variantId));
    const o = await options();
    const result = await createProductAdmin(
      { name: 'Clash', slug: undefined, description: '', material: null, careInstructions: null, categoryId: null, price: 1000, compareAtPrice: null, status: 'draft', isFeatured: false, tags: [], collectionIds: [], images: [], variants: [{ sku: variant!.sku, sizeId: o.m, colorId: null, stock: 1, isActive: true }] },
      adminId,
    ).catch((e: AppError) => e);
    expect((result as AppError).fields?.['variants.0.sku']).toMatch(/already used/);
    expect(await code(deleteProduct(variant!.productId))).toBe('PRODUCT_HAS_ORDERS');
  });

  it('adjusts stock with validation and a ledger entry', async () => {
    const { variants } = await createProduct({ stock: { M: 5 } });
    expect(await adjustStock({ variantId: variants.M!.id, mode: 'delta', value: 7, reason: 'restock', note: 'PO-1' }, adminId)).toMatchObject({ stock: 12, delta: 7 });
    expect(await adjustStock({ variantId: variants.M!.id, mode: 'set', value: 3, reason: 'correction', note: null }, adminId)).toMatchObject({ stock: 3, delta: -9 });
    expect(await code(adjustStock({ variantId: variants.M!.id, mode: 'delta', value: -4, reason: 'correction', note: null }, adminId))).toBe('VALIDATION_ERROR');
  });

  it('computes dashboard metrics excluding cancelled orders', async () => {
    const before = await getDashboard(30);
    const kept = await newOrder({ quantity: 1 });
    const dropped = await newOrder({ quantity: 1 });
    await updateOrderStatus(dropped.orderId, { status: 'cancelled', note: null, courierName: null, trackingNumber: null }, adminId);
    const after = await getDashboard(30);
    expect(after.orders - before.orders).toBe(1);
    expect(after.sales - before.sales).toBe((await orderOf(kept.orderId)).total);
    expect(after.series).toHaveLength(30);
  });
});
