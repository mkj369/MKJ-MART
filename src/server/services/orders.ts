import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { db, type DbOrTx, type Transaction } from '@/server/db';
import {
  couponRedemptions,
  coupons,
  orderEvents,
  orderItems,
  orders,
  paymentTransactions,
  products,
  productVariants,
  stockMovements,
} from '@/server/db/schema';
import { conflict, notFound } from '@/server/errors';
import { sha256Hex } from '@/server/auth/tokens';
import { maskPhone } from '@/lib/phone';
import type { OrderStatus, PaymentStatus } from '@/lib/order-status';
import { addLinesToCart } from './cart';
import { recordEvent } from './events';

export type OrderRow = typeof orders.$inferSelect;

/**
 * Guest order access token, derived from the client's idempotency key (known only to the browser
 * that placed the order). Deterministic, so duplicate submissions and payment callbacks can
 * re-issue the same link without storing the token itself.
 */
export function deriveOrderAccessToken(idempotencyKey: string, orderNumber: string): string {
  return createHmac('sha256', idempotencyKey).update(`order-access:${orderNumber}`).digest('base64url');
}

function tokenMatches(token: string | null | undefined, hash: string | null): boolean {
  if (!token || !hash || token.length > 200) return false;
  const a = Buffer.from(sha256Hex(token), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function insertOrderEvent(
  tx: DbOrTx,
  event: {
    orderId: string;
    message: string;
    status?: OrderStatus | null;
    paymentStatus?: PaymentStatus | null;
    visibleToCustomer?: boolean;
    actorId?: string | null;
  },
) {
  await tx.insert(orderEvents).values({
    orderId: event.orderId,
    message: event.message,
    status: event.status ?? null,
    paymentStatus: event.paymentStatus ?? null,
    visibleToCustomer: event.visibleToCustomer ?? true,
    actorId: event.actorId ?? null,
  });
}

/** Returns reserved stock to inventory exactly once per order (guarded by `stock_released`). */
export async function releaseOrderStock(
  tx: Transaction,
  order: OrderRow,
  actorId: string | null,
  reason: 'order_cancelled' | 'return' = 'order_cancelled',
) {
  if (order.stockReleased) return;
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  for (const item of items) {
    if (item.variantId) {
      const [updated] = await tx
        .update(productVariants)
        .set({ stock: sql`${productVariants.stock} + ${item.quantity}`, updatedAt: new Date() })
        .where(eq(productVariants.id, item.variantId))
        .returning({ stock: productVariants.stock });
      if (updated) {
        await tx.insert(stockMovements).values({
          variantId: item.variantId,
          delta: item.quantity,
          stockAfter: updated.stock,
          reason,
          orderId: order.id,
          actorId,
          note: `Released from ${order.orderNumber}`,
        });
      }
    }
    if (item.productId) {
      await tx
        .update(products)
        .set({ soldCount: sql`greatest(${products.soldCount} - ${item.quantity}, 0)` })
        .where(eq(products.id, item.productId));
    }
  }
  await tx.update(orders).set({ stockReleased: true }).where(eq(orders.id, order.id));
}

export async function releaseCouponRedemption(tx: Transaction, order: OrderRow) {
  if (!order.couponId) return;
  const removed = await tx
    .delete(couponRedemptions)
    .where(eq(couponRedemptions.orderId, order.id))
    .returning({ id: couponRedemptions.id });
  if (removed.length > 0) {
    await tx
      .update(coupons)
      .set({ usedCount: sql`greatest(${coupons.usedCount} - 1, 0)` })
      .where(eq(coupons.id, order.couponId));
  }
}

const CANCELLABLE: OrderStatus[] = ['pending', 'confirmed', 'processing'];

/**
 * Cancels an order inside a transaction: locks it, restocks items, releases the coupon and writes
 * timeline + outbox events. Idempotent for already-cancelled orders.
 */
export async function cancelOrderTx(
  tx: Transaction,
  orderId: string,
  options: { message: string; actorId?: string | null; paymentStatus?: PaymentStatus },
): Promise<OrderRow> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
  if (!order) throw notFound('Order not found.');
  if (order.status === 'cancelled') return order;
  if (!CANCELLABLE.includes(order.status)) throw conflict('This order can no longer be cancelled.', 'INVALID_TRANSITION');

  await releaseOrderStock(tx, order, options.actorId ?? null);
  await releaseCouponRedemption(tx, order);

  const paymentStatus: PaymentStatus =
    options.paymentStatus ?? (order.paymentStatus === 'pending' ? 'cancelled' : order.paymentStatus);
  const [updated] = await tx
    .update(orders)
    .set({ status: 'cancelled', paymentStatus, cancelledAt: new Date(), paymentExpiresAt: null })
    .where(eq(orders.id, orderId))
    .returning();
  await insertOrderEvent(tx, {
    orderId,
    status: 'cancelled',
    paymentStatus: paymentStatus !== order.paymentStatus ? paymentStatus : null,
    message: options.message,
    actorId: options.actorId,
  });
  await recordEvent(tx, 'order.cancelled', orderId, {
    orderNumber: order.orderNumber,
    previousStatus: order.status,
    reason: options.message,
  });
  return updated!;
}

// ─── Customer-facing views ────────────────────────────────────────────────────

export type OrderDetail = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  paymentMethod: OrderRow['paymentMethod'];
  paymentStatus: PaymentStatus;
  customerName: string;
  email: string | null;
  phone: string;
  address: { addressLine: string; area: string; district: string; division: string; postalCode: string | null };
  shippingZoneName: string;
  subtotal: number;
  discountTotal: number;
  shippingFee: number;
  total: number;
  couponCode: string | null;
  customerNote: string | null;
  courierName: string | null;
  trackingNumber: string | null;
  placedAt: Date;
  paidAt: Date | null;
  paymentExpiresAt: Date | null;
  isDemo: boolean;
  items: {
    id: string;
    productName: string;
    productSlug: string | null;
    variantLabel: string | null;
    sku: string;
    imageUrl: string | null;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }[];
  events: { id: string; status: OrderStatus | null; message: string; createdAt: Date }[];
  canCancel: boolean;
};

function toDetail(order: OrderRow, items: (typeof orderItems.$inferSelect)[], events: (typeof orderEvents.$inferSelect)[]): OrderDetail {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    customerName: order.customerName,
    email: order.email,
    phone: order.phone,
    address: {
      addressLine: order.addressLine,
      area: order.area,
      district: order.district,
      division: order.division,
      postalCode: order.postalCode,
    },
    shippingZoneName: order.shippingZoneName,
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    shippingFee: order.shippingFee,
    total: order.total,
    couponCode: order.couponCode,
    customerNote: order.customerNote,
    courierName: order.courierName,
    trackingNumber: order.trackingNumber,
    placedAt: order.placedAt,
    paidAt: order.paidAt,
    paymentExpiresAt: order.paymentExpiresAt,
    isDemo: order.isDemo,
    items: items.map((i) => ({
      id: i.id,
      productName: i.productName,
      productSlug: i.productSlug,
      variantLabel: i.variantLabel,
      sku: i.sku,
      imageUrl: i.imageUrl,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      lineTotal: i.lineTotal,
    })),
    events: events
      .filter((e) => e.visibleToCustomer)
      .map((e) => ({ id: e.id, status: e.status, message: e.message, createdAt: e.createdAt })),
    canCancel: order.status === 'pending' && order.paymentStatus !== 'paid',
  };
}

async function loadOrderWithRelations(where: ReturnType<typeof eq>) {
  const [order] = await db.select().from(orders).where(where).limit(1);
  if (!order) return null;
  const [items, events] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, order.id)).orderBy(asc(orderItems.productName)),
    db.select().from(orderEvents).where(eq(orderEvents.orderId, order.id)).orderBy(asc(orderEvents.createdAt)),
  ]);
  return { order, items, events };
}

/** Owner (signed-in) or holder of the order's access token may view an order. */
export async function getOrderForViewer(
  orderNumber: string,
  viewer: { userId?: string | null; token?: string | null },
): Promise<OrderDetail | null> {
  if (!/^[A-Z0-9-]{6,32}$/.test(orderNumber)) return null;
  const loaded = await loadOrderWithRelations(eq(orders.orderNumber, orderNumber));
  if (!loaded) return null;
  const { order } = loaded;
  const isOwner = !!viewer.userId && order.userId === viewer.userId;
  if (!isOwner && !tokenMatches(viewer.token, order.accessTokenHash)) return null;
  return toDetail(order, loaded.items, loaded.events);
}

export async function listOrdersForUser(userId: string, page = 1, pageSize = 10) {
  const where = eq(orders.userId, userId);
  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        paymentMethod: orders.paymentMethod,
        paymentStatus: orders.paymentStatus,
        total: orders.total,
        placedAt: orders.placedAt,
        itemCount: sql<number>`(SELECT coalesce(sum(oi.quantity), 0)::int FROM order_items oi WHERE oi.order_id = orders.id)`,
        firstImage: sql<string | null>`(SELECT oi.image_url FROM order_items oi WHERE oi.order_id = orders.id ORDER BY oi.product_name LIMIT 1)`,
      })
      .from(orders)
      .where(where)
      .orderBy(desc(orders.placedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(orders).where(where),
  ]);
  return { items: rows, total: totalRow?.value ?? 0, page, pageSize };
}

/** Public tracking by order number + phone. Returns a deliberately limited view (no address). */
export async function trackOrder(orderNumber: string, phone: string) {
  const loaded = await loadOrderWithRelations(eq(orders.orderNumber, orderNumber));
  if (!loaded || loaded.order.phone !== phone) return null;
  const { order, items, events } = loaded;
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    total: order.total,
    placedAt: order.placedAt,
    district: order.district,
    phoneMasked: maskPhone(order.phone),
    courierName: order.courierName,
    trackingNumber: order.trackingNumber,
    itemCount: items.reduce((s, i) => s + i.quantity, 0),
    events: events
      .filter((e) => e.visibleToCustomer)
      .map((e) => ({ id: e.id, status: e.status, message: e.message, createdAt: e.createdAt })),
  };
}

/** Customers may cancel their own order while it is still pending and unpaid. */
export async function cancelOrderByCustomer(
  orderNumber: string,
  viewer: { userId?: string | null; token?: string | null },
): Promise<OrderDetail> {
  const detail = await getOrderForViewer(orderNumber, viewer);
  if (!detail) throw notFound('Order not found.');
  if (!detail.canCancel) throw conflict('This order can no longer be cancelled online. Please contact customer care.', 'INVALID_TRANSITION');
  await db.transaction(async (tx) => {
    // Re-check under lock: status could have changed since the read above.
    const [locked] = await tx.select().from(orders).where(eq(orders.id, detail.id)).for('update');
    if (!locked || locked.status !== 'pending' || locked.paymentStatus === 'paid') {
      throw conflict('This order can no longer be cancelled online. Please contact customer care.', 'INVALID_TRANSITION');
    }
    await cancelOrderTx(tx, detail.id, { message: 'Cancelled by the customer.', actorId: viewer.userId ?? null });
    if (locked.paymentMethod === 'sslcommerz') {
      await tx
        .update(paymentTransactions)
        .set({ status: 'cancelled', failureReason: 'Order cancelled by customer' })
        .where(and(eq(paymentTransactions.orderId, detail.id), sql`${paymentTransactions.status} IN ('initiated','pending')`));
    }
  });
  return (await getOrderForViewer(orderNumber, viewer))!;
}

/** After a failed/cancelled online payment, puts the order's items back into the shopper's bag. */
export async function restoreOrderToCart(
  orderNumber: string,
  viewer: { userId?: string | null; token?: string | null },
  cartId: string,
): Promise<number> {
  const detail = await getOrderForViewer(orderNumber, viewer);
  if (!detail) throw notFound('Order not found.');
  if (detail.status !== 'cancelled') throw conflict('Only cancelled orders can be restored to your bag.');
  const items = await db
    .select({ variantId: orderItems.variantId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, detail.id));
  return db.transaction((tx) => addLinesToCart(tx, cartId, items));
}
