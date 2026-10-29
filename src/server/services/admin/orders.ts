import 'server-only';
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/server/db';
import { orderEvents, orderItems, orders, paymentTransactions, refunds, returnRequests, users } from '@/server/db/schema';
import { AppError, conflict, notFound, validationError } from '@/server/errors';
import { formatBDT } from '@/lib/money';
import { REFUND_METHOD_LABEL } from '@/lib/returns';
import { enqueueNotification, listNotificationsForOrder, scheduleNotificationDispatch } from '@/server/notifications';
import { queueOrderCancelledNotifications, queueOrderStatusNotifications } from '@/server/notifications/orders';
import {
  canTransition,
  ORDER_STATUS_LABEL,
  transitionBlockedByPayment,
  type OrderStatus,
  type PaymentStatus,
} from '@/lib/order-status';
import type { OrderStatusUpdateInput, RefundInput } from '@/lib/validation/admin';
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
  const [items, events, transactions, customer, notificationRows, returnRows, refundRows] = await Promise.all([
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
        riskLevel: sql<string | null>`${paymentTransactions.gatewayResponse}->>'risk_level'`,
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
    listNotificationsForOrder(id),
    db
      .select({ id: returnRequests.id, requestNumber: returnRequests.requestNumber, status: returnRequests.status, createdAt: returnRequests.createdAt })
      .from(returnRequests)
      .where(eq(returnRequests.orderId, id))
      .orderBy(desc(returnRequests.createdAt)),
    db
      .select({
        id: refunds.id,
        amount: refunds.amount,
        method: refunds.method,
        reference: refunds.reference,
        note: refunds.note,
        createdAt: refunds.createdAt,
        returnRequestId: refunds.returnRequestId,
        actorName: users.name,
      })
      .from(refunds)
      .leftJoin(users, eq(users.id, refunds.actorId))
      .where(eq(refunds.orderId, id))
      .orderBy(desc(refunds.createdAt)),
  ]);
  const riskFlagged = transactions.some((t) => t.status === 'succeeded' && t.riskLevel === '1');
  return { order, items, events, transactions, customer, notifications: notificationRows, returns: returnRows, refunds: refundRows, riskFlagged };
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

    if (to === 'returned') {
      const [{ value: requests }] = await tx
        .select({ value: count() })
        .from(returnRequests)
        .where(and(eq(returnRequests.orderId, id), sql`${returnRequests.status} IN ('requested','approved','received','refunded')`));
      if (requests > 0) {
        throw conflict('This order has a return request. Process the return from the Returns page instead, so stock is not counted twice.', 'RETURN_IN_PROGRESS');
      }
    }

    if (to === 'cancelled') {
      const updated = await cancelOrderTx(tx, id, { message: input.note ? `Cancelled: ${input.note}` : 'Cancelled by MKJ Store.', actorId });
      await recordEvent(tx, 'order.status_changed', id, { orderNumber: order.orderNumber, from: order.status, to });
      await queueOrderCancelledNotifications(tx, updated, input.note ? input.note : 'Please contact us if you have any questions.');
      return;
    }

    const now = new Date();
    const patch: Partial<typeof orders.$inferInsert> = { status: to };
    if (to === 'confirmed') patch.confirmedAt = now;
    if (to === 'shipped') {
      patch.shippedAt = now;
      patch.courierName = input.courierName ?? order.courierName;
      patch.trackingNumber = input.trackingNumber ?? order.trackingNumber;
      patch.trackingUrl = input.trackingUrl ?? order.trackingUrl;
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
    const [updated] = await tx.update(orders).set(patch).where(eq(orders.id, id)).returning();

    const customerMessages: Partial<Record<OrderStatus, string>> = {
      confirmed: 'Your order has been confirmed.',
      processing: 'Your order is being packed.',
      shipped: `Your order has been handed to ${patch.courierName ?? 'our courier'}${patch.trackingNumber ? ` (tracking ${patch.trackingNumber})` : ''}.`,
      delivered: 'Your order has been delivered. Thank you for shopping with MKJ Store.',
      returned: 'Your parcel was returned to us.',
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
    await queueOrderStatusNotifications(tx, updated!, to);
  }).then((value) => {
    scheduleNotificationDispatch();
    return value;
  });
}

/** Lets staff fix courier / tracking details after shipping without changing the status. */
export async function updateOrderShipping(id: string, input: { courierName: string | null; trackingNumber: string | null; trackingUrl: string | null }, actorId: string) {
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, id)).for('update');
    if (!order) throw notFound('Order not found.');
    if (order.status !== 'shipped' && order.status !== 'delivered') throw conflict('Tracking details can be edited once the order has shipped.', 'INVALID_TRANSITION');
    if (!input.courierName) throw validationError({ courierName: 'Courier is required.' });
    await tx.update(orders).set({ courierName: input.courierName, trackingNumber: input.trackingNumber, trackingUrl: input.trackingUrl }).where(eq(orders.id, id));
    await insertOrderEvent(tx, {
      orderId: id,
      message: `Tracking updated: ${input.courierName}${input.trackingNumber ? ` · ${input.trackingNumber}` : ''}.`,
      actorId,
    });
  });
}

/**
 * Manual payment bookkeeping for Cash on Delivery: record cash received before delivery is marked.
 * Online payments are only ever confirmed by the gateway's Validation API.
 */
export async function updateOrderPayment(id: string, action: 'mark_paid', note: string | null, actorId: string) {
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, id)).for('update');
    if (!order) throw notFound('Order not found.');
    if (action !== 'mark_paid') throw conflict('Unsupported action.', 'BAD_REQUEST');
    if (order.paymentMethod !== 'cod') {
      throw conflict('Online payments are confirmed automatically by the payment gateway.', 'GATEWAY_MANAGED');
    }
    if (order.paymentStatus === 'paid') throw conflict('This order is already marked as paid.', 'NO_CHANGE');
    if (order.status === 'cancelled') throw conflict('Cancelled orders cannot be marked as paid.', 'INVALID_TRANSITION');
    await tx.update(orders).set({ paymentStatus: 'paid', paidAt: new Date() }).where(eq(orders.id, id));
    await insertOrderEvent(tx, { orderId: id, paymentStatus: 'paid', message: note ? `Payment received: ${note}` : 'Payment received.', actorId });
  });
}

/**
 * Records a refund that has ALREADY been paid outside the platform (SSLCommerz merchant panel,
 * bKash/Nagad, bank transfer, cash). Never moves money and never pretends to. Keeps a ledger and
 * moves the payment status to partially_refunded / refunded.
 */
export async function recordRefund(orderId: string, input: RefundInput, actorId: string) {
  const outcome = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    if (!order) throw notFound('Order not found.');
    if (order.paymentStatus !== 'paid' && order.paymentStatus !== 'partially_refunded') {
      throw conflict('Only paid orders can be refunded.', 'INVALID_TRANSITION');
    }
    const refundable = order.total - order.refundedTotal;
    if (input.amount > refundable) {
      throw validationError({ amount: `At most ${formatBDT(refundable)} can still be refunded on this order.` });
    }
    let returnRequestId: string | null = null;
    if (input.returnRequestId) {
      const [request] = await tx.select().from(returnRequests).where(eq(returnRequests.id, input.returnRequestId)).for('update');
      if (!request || request.orderId !== orderId) throw notFound('Return request not found for this order.');
      if (request.status !== 'received' && request.status !== 'refunded') {
        throw conflict('Mark the returned items as received before recording the refund.', 'INVALID_TRANSITION');
      }
      returnRequestId = request.id;
    } else if (order.status !== 'cancelled' && order.status !== 'returned' && !input.note) {
      // Goodwill / partial refunds on an active order must say why.
      throw validationError({ note: 'Add a note explaining this refund (it is not linked to a return or cancellation).' });
    }

    await tx.insert(refunds).values({
      orderId,
      returnRequestId,
      amount: input.amount,
      method: input.method,
      reference: input.reference ?? null,
      note: input.note ?? null,
      actorId,
    });
    const refundedTotal = order.refundedTotal + input.amount;
    const paymentStatus = refundedTotal >= order.total ? 'refunded' : 'partially_refunded';
    const [updated] = await tx.update(orders).set({ refundedTotal, paymentStatus }).where(eq(orders.id, orderId)).returning();
    if (returnRequestId) {
      await tx.update(returnRequests).set({ status: 'refunded', refundedAt: new Date() }).where(eq(returnRequests.id, returnRequestId));
    }
    const method = REFUND_METHOD_LABEL[input.method];
    await insertOrderEvent(tx, {
      orderId,
      paymentStatus,
      message: `Refund of ${formatBDT(input.amount)} issued via ${method}.`,
      actorId,
    });
    if (input.reference || input.note) {
      await insertOrderEvent(tx, {
        orderId,
        message: `Refund details — reference: ${input.reference ?? 'n/a'}${input.note ? `; note: ${input.note}` : ''}`,
        actorId,
        visibleToCustomer: false,
      });
    }
    await recordEvent(tx, 'order.refunded', orderId, { orderNumber: order.orderNumber, amount: input.amount, method: input.method, refundedTotal });
    if (updated!.email) {
      await enqueueNotification(tx, {
        template: 'refund_recorded',
        recipient: updated!.email,
        data: { name: updated!.customerName, orderNumber: updated!.orderNumber, amount: input.amount, method: input.method, reference: input.reference ?? null },
        orderId,
        userId: updated!.userId,
      });
    }
    return { refundedTotal, paymentStatus };
  });
  scheduleNotificationDispatch();
  return outcome;
}

export async function updateAdminNote(id: string, adminNote: string | null) {
  const [row] = await db.update(orders).set({ adminNote }).where(eq(orders.id, id)).returning({ id: orders.id });
  if (!row) throw notFound('Order not found.');
}
