import 'server-only';
import { asc, eq } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db';
import { orderItems, orders } from '@/server/db/schema';
import { appUrl } from '@/server/env';
import type { OrderStatus } from '@/lib/order-status';
import { getSetting } from '@/server/services/settings';
import { deriveOrderAccessToken } from '@/server/services/order-token';
import { enqueueNotification } from './index';
import type { SecretData } from './templates';

/**
 * Decides which customer / staff notifications an order event produces, based on the
 * Admin → Settings → Notifications switches. All functions run INSIDE the caller's transaction.
 */
type OrderRow = typeof orders.$inferSelect;

/** Signed-in customers get a plain link (login required); guests get their private order link. */
export function orderLinks(order: OrderRow): { orderUrl: string | null; secret: SecretData } {
  const base = appUrl();
  if (order.userId) return { orderUrl: `${base}/orders/${encodeURIComponent(order.orderNumber)}`, secret: {} };
  if (order.idempotencyKey) {
    const token = deriveOrderAccessToken(order.idempotencyKey, order.orderNumber);
    return { orderUrl: null, secret: { orderUrl: `${base}/orders/${encodeURIComponent(order.orderNumber)}?token=${encodeURIComponent(token)}` } };
  }
  return { orderUrl: null, secret: {} };
}

async function confirmationData(tx: DbOrTx, order: OrderRow, paid: boolean) {
  const items = await tx
    .select({ name: orderItems.productName, variant: orderItems.variantLabel, quantity: orderItems.quantity, lineTotal: orderItems.lineTotal })
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.productName));
  const { orderUrl, secret } = orderLinks(order);
  return {
    data: {
      name: order.customerName,
      orderNumber: order.orderNumber,
      items,
      subtotal: order.subtotal,
      discount: order.discountTotal,
      shipping: order.shippingFee,
      total: order.total,
      paymentMethod: order.paymentMethod,
      paid,
      address: [order.addressLine, order.area, order.district].filter(Boolean).join(', '),
      zone: order.shippingZoneName,
      orderUrl,
    },
    secret,
    itemCount: items.reduce((s, i) => s + i.quantity, 0),
  };
}

async function staffNewOrder(tx: DbOrTx, order: OrderRow, itemCount: number) {
  const settings = await getSetting('notifications');
  if (!settings.staffEmail || !settings.staffNewOrder) return;
  await enqueueNotification(tx, {
    template: 'staff_new_order',
    recipient: settings.staffEmail,
    data: { orderNumber: order.orderNumber, orderId: order.id, customerName: order.customerName, total: order.total, paymentMethod: order.paymentMethod, itemCount },
    orderId: order.id,
  });
}

/** Cash on Delivery order placed. (Online orders notify only once payment is confirmed.) */
export async function queueOrderPlacedNotifications(tx: DbOrTx, order: OrderRow) {
  const settings = await getSetting('notifications');
  const { data, secret, itemCount } = await confirmationData(tx, order, false);
  if (settings.emailOrderUpdates) {
    await enqueueNotification(tx, { template: 'order_confirmation', recipient: order.email, data, secret, orderId: order.id, userId: order.userId });
  }
  if (settings.smsOrderUpdates) {
    await enqueueNotification(tx, {
      template: 'sms_order_confirmation',
      recipient: order.phone,
      data: { orderNumber: order.orderNumber, total: order.total, paid: false },
      orderId: order.id,
      userId: order.userId,
    });
  }
  await staffNewOrder(tx, order, itemCount);
}

/** Online payment confirmed by the gateway's Validation API. */
export async function queuePaymentReceivedNotifications(tx: DbOrTx, order: OrderRow) {
  const settings = await getSetting('notifications');
  const { data, secret, itemCount } = await confirmationData(tx, order, true);
  if (settings.emailOrderUpdates) {
    await enqueueNotification(tx, { template: 'order_confirmation', recipient: order.email, data, secret, orderId: order.id, userId: order.userId });
  }
  if (settings.smsOrderUpdates) {
    await enqueueNotification(tx, {
      template: 'sms_order_confirmation',
      recipient: order.phone,
      data: { orderNumber: order.orderNumber, total: order.total, paid: true },
      orderId: order.id,
      userId: order.userId,
    });
  }
  await staffNewOrder(tx, order, itemCount);
}

const EMAIL_STATUSES: OrderStatus[] = ['confirmed', 'shipped', 'delivered', 'returned'];
const SMS_STATUSES: OrderStatus[] = ['confirmed', 'shipped', 'delivered'];

/** Fulfilment status changed by staff. `order` must reflect the NEW state (courier, tracking…). */
export async function queueOrderStatusNotifications(tx: DbOrTx, order: OrderRow, to: OrderStatus) {
  const settings = await getSetting('notifications');
  const { orderUrl, secret } = orderLinks(order);
  if (settings.emailOrderUpdates && EMAIL_STATUSES.includes(to)) {
    await enqueueNotification(tx, {
      template: 'order_status',
      recipient: order.email,
      data: {
        name: order.customerName,
        orderNumber: order.orderNumber,
        status: to,
        courierName: order.courierName,
        trackingNumber: order.trackingNumber,
        trackingUrl: order.trackingUrl,
        orderUrl,
      },
      secret,
      orderId: order.id,
      userId: order.userId,
    });
  }
  if (settings.smsOrderUpdates && SMS_STATUSES.includes(to)) {
    await enqueueNotification(tx, {
      template: 'sms_order_status',
      recipient: order.phone,
      data: { orderNumber: order.orderNumber, status: to, courierName: order.courierName, trackingNumber: order.trackingNumber },
      orderId: order.id,
      userId: order.userId,
    });
  }
}

export async function queueOrderCancelledNotifications(tx: DbOrTx, order: OrderRow, reason: string) {
  const settings = await getSetting('notifications');
  const { orderUrl, secret } = orderLinks(order);
  if (settings.emailOrderUpdates) {
    await enqueueNotification(tx, {
      template: 'order_cancelled',
      recipient: order.email,
      data: { name: order.customerName, orderNumber: order.orderNumber, reason, wasPaid: order.paymentStatus === 'paid', orderUrl },
      secret,
      orderId: order.id,
      userId: order.userId,
    });
  }
  if (settings.smsOrderUpdates) {
    await enqueueNotification(tx, {
      template: 'sms_order_cancelled',
      recipient: order.phone,
      data: { orderNumber: order.orderNumber },
      orderId: order.id,
      userId: order.userId,
    });
  }
}
