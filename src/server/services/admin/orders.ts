import 'server-only';
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/server/db';
import { orderEvents, orderItems, orders, paymentTransactions, users } from '@/server/db/schema';
import { AppError, conflict, notFound } from '@/server/errors';
import {
  canTransition,
  ORDER_STATUS_LABEL,
  transitionBlockedByPayment,
  type OrderStatus,
  type PaymentStatus,
} from '@/lib/order-status';
import type { OrderStatusUpdateInput } from '@/lib/validation/admin';
import { recordEvent } from '../events';
import { cancelOrderTx, insertOrderEvent, releaseOrderStock } from '../orders';

export async function listOrdersAdmin(query: {
  q?: string;
  status?: OrderStatus | 'all';
  payment?: PaymentStatus | 'all';
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, query.pageSize ?? 20);
  const conditions: SQL[] = [];
  if (query.status && query.status !== 'all') conditions.push(eq(orders.status, query.status));
  if (query.payment && query.payment !== 'all') conditions.push(eq(orders.paymentStatus, query.payment));
  if (query.q) {
    const term = query.q.trim();
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(
      or(
        ilike(orders.orderNumber, like),
        ilike(orders.customerName, like),
        ilike(orders.phone, like),
        ilike(orders.email, like),
      )!,
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, [totalRow], statusCounts] = await Promise.all([
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        customerName: orders.customerName,
        phone: orders.phone,
        district: orders.district,
        status: orders.status,
        paymentMethod: orders.paymentMethod,
        paymentStatus: orders.paymentStatus,
        total: orders.total,
        placedAt: orders.placedAt,
        isDemo: orders.isDemo,
        userId: orders.userId,
        itemCount: sql<number>`(select coalesce(sum(oi.quantity), 0)::int from order_items oi where oi.order_id = orders.id)`,
      })
      .from(orders)
      .where(where)
      .orderBy(desc(orders.placedAt), asc(orders.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(orders).where(where),
    db.select({ status: orders.status, value: count() }).from(orders).groupBy(orders.status),
  ]);

  return {
    items: rows,
    total: totalRow?.value ?? 0,
    page,
    pageSize,
    counts: Object.fromEntries(statusCounts.map((r) => [r.status, r.value])) as Partial<Record<OrderStatus, number>>,
  };
}

export async function getOrderAdmin(id: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  if (!order) throw notFound('Order not found.');
  const [items, events, transactions, customer] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, id)).orderBy(asc(orderItems.productName)),
    db
      .select({
        id: orderEvents.id,
        status: orderEvents.status,
        paymentStatus: orderEvents.paymentStatus,
        message: orderEvents.message,
        visibleToCustomer: orderEvents.visibleToCustomer,
        createdAt: orderEvents.createdAt,
        actorName: users.name,
      })
      .from(orderEvents)
      .leftJoin(users, eq(users.id, orderEvents.actorId))
      .where(eq(orderEvents.orderId, id))
      .orderBy(desc(orderEvents.createdAt)),
    db
      .select({
        id: paymentTransactions.id,
        tranId: paymentTransactions.tranId,
        amount: paymentTransactions.amount,
        status: paymentTransactions.status,
        valId: paymentTransactions.valId,
        bankTranId: paymentTransactions.bankTranId,
        cardType: paymentTransactions.cardType,
        failureReason: paymentTransactions.failureReason,
        createdAt: paymentTransactions.createdAt,
        updatedAt: paymentTransactions.updatedAt,
      })
      .from(paymentTransactions)
      .where(eq(paymentTransactions.orderId, id))
      .orderBy(desc(paymentTransactions.createdAt)),
    order.userId
      ? db
          .select({ id: users.id, name: users.name, email: users.email, phone: users.phone })
          .from(users)
          .where(eq(users.id, order.userId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);
  return { order, items, events, transactions, customer };
}

/**
 * Moves an order through the fulfilment state machine. Enforces allowed transitions, blocks
 * fulfilment of unpaid online orders, restocks on cancel/return and records customer-visible events.
 */
export async function updateOrderStatus(id: string, input: OrderStatusUpdateInput, actorId: string) {
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, id)).for('update');
    if (!order) throw notFound('Order not found.');
    const to = input.status;
    if (order.status === to) throw conflict(`The order is already ${ORDER_STATUS_LABEL[to].toLowerCase()}.`, 'NO_CHANGE');
    if (!canTransition(order.status, to)) {
      throw conflict(
        `An order cannot move from ${ORDER_STATUS_LABEL[order.status]} to ${ORDER_STATUS_LABEL[to]}.`,
        'INVALID_TRANSITION',
      );
    }
    if (transitionBlockedByPayment(order.paymentMethod, order.paymentStatus, to)) {
      throw new AppError(409, 'PAYMENT_REQUIRED', 'This order was placed with online payment, which has not been received yet.');
    }
    if (to === 'shipped' && !input.courierName && !order.courierName) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Add the courier before marking the order as shipped.', {
        fields: { courierName: 'Courier is required when shipping.' },
      });
    }

    if (to === 'cancelled') {
      await cancelOrderTx(tx, id, { message: input.note ? `Cancelled: ${input.note}` : 'Cancelled by MKJ Store.', actorId });
      await recordEvent(tx, 'order.status_changed', id, { orderNumber: order.orderNumber, from: order.status, to });
      return;
    }

    const now = new Date();
    const patch: Partial<typeof orders.$inferInsert> = { status: to };
    if (to === 'confirmed') patch.confirmedAt = now;
    if (to === 'shipped') {
      patch.shippedAt = now;
      patch.courierName = input.courierName ?? order.courierName;
      patch.trackingNumber = input.trackingNumber ?? order.trackingNumber;
    }
    if (to === 'delivered') {
      patch.deliveredAt = now;
      if (order.paymentMethod === 'cod' && order.paymentStatus === 'unpaid') {
        patch.paymentStatus = 'paid';
        patch.paidAt = now;
      }
    }
    if (to === 'returned') {
      await releaseOrderStock(tx, order, actorId, 'return');
    }
    await tx.update(orders).set(patch).where(eq(orders.id, id));

    const customerMessages: Partial<Record<OrderStatus, string>> = {
      confirmed: 'Your order has been confirmed.',
      processing: 'Your order is being packed.',
      shipped: `Your order has been handed to ${patch.courierName ?? 'our courier'}${patch.trackingNumber ? ` (tracking ${patch.trackingNumber})` : ''}.`,
      delivered: 'Your order has been delivered. Thank you for shopping with MKJ Store.',
      returned: 'Your return has been received.',
    };
    await insertOrderEvent(tx, {
      orderId: id,
      status: to,
      paymentStatus: patch.paymentStatus ?? null,
      message: customerMessages[to] ?? ORDER_STATUS_LABEL[to],
      actorId,
    });
    if (patch.paymentStatus === 'paid') {
      await insertOrderEvent(tx, { orderId: id, paymentStatus: 'paid', message: 'Cash collected on delivery.', actorId, visibleToCustomer: false });
    }
    if (input.note) {
      await insertOrderEvent(tx, { orderId: id, message: input.note, actorId, visibleToCustomer: false });
    }
    await recordEvent(tx, 'order.status_changed', id, { orderNumber: order.orderNumber, from: order.status, to });
  });
}

/**
 * Manual payment bookkeeping. COD orders can be marked paid (cash received). Refunds are recorded
 * here AFTER being made through the gateway dashboard / bKash / bank — this does not move money.
 */
export async function updateOrderPayment(id: string, action: 'mark_paid' | 'mark_refunded', note: string | null, actorId: string) {
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, id)).for('update');
    if (!order) throw notFound('Order not found.');
    if (action === 'mark_paid') {
      if (order.paymentMethod !== 'cod') {
        throw conflict('Online payments are confirmed automatically by the payment gateway.', 'GATEWAY_MANAGED');
      }
      if (order.paymentStatus === 'paid') throw conflict('This order is already marked as paid.', 'NO_CHANGE');
      if (order.status === 'cancelled') throw conflict('Cancelled orders cannot be marked as paid.', 'INVALID_TRANSITION');
      await tx.update(orders).set({ paymentStatus: 'paid', paidAt: new Date() }).where(eq(orders.id, id));
      await insertOrderEvent(tx, { orderId: id, paymentStatus: 'paid', message: note ? `Payment received: ${note}` : 'Payment received.', actorId });
    } else {
      if (order.paymentStatus !== 'paid') throw conflict('Only paid orders can be marked as refunded.', 'INVALID_TRANSITION');
      if (order.status !== 'cancelled' && order.status !== 'returned') {
        throw conflict('Cancel the order or record the return before refunding.', 'INVALID_TRANSITION');
      }
      await tx.update(orders).set({ paymentStatus: 'refunded' }).where(eq(orders.id, id));
      await insertOrderEvent(tx, { orderId: id, paymentStatus: 'refunded', message: note ? `Refund issued: ${note}` : 'Refund issued.', actorId });
    }
  });
}

export async function updateAdminNote(id: string, adminNote: string | null) {
  const [row] = await db.update(orders).set({ adminNote }).where(eq(orders.id, id)).returning({ id: orders.id });
  if (!row) throw notFound('Order not found.');
}
