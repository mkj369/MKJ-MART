import 'server-only';
import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db, type Transaction } from '@/server/db';
import { orderItems, orders, products, productVariants, refunds, returnRequestItems, returnRequests, stockMovements, users } from '@/server/db/schema';
import { conflict, notFound, validationError } from '@/server/errors';
import { randomCode } from '@/server/auth/tokens';
import { enqueueNotification, scheduleNotificationDispatch } from '@/server/notifications';
import { orderLinks } from '@/server/notifications/orders';
import { enforceRateLimit } from '@/server/rate-limit';
import {
  canTransitionReturn,
  computeReturnEligibility,
  RETURN_REASON_LABEL,
  RETURN_STATUS_LABEL,
  type ReturnReason,
  type ReturnStatus,
} from '@/lib/returns';
import type { ReturnDecisionInput } from '@/lib/validation/admin';
import type { ReturnRequestInput } from '@/lib/validation/store';
import { recordEvent } from './events';
import { getOrderForViewer, insertOrderEvent } from './orders';
import { getSetting } from './settings';

/**
 * Returns workflow:  requested → approved → received → refunded   (or → rejected / withdrawn)
 *  - Customers request returns for delivered orders inside the return window (Settings → Returns).
 *  - Staff approve/decline, mark parcels received (optionally restocking) and record the refund,
 *    which is paid OUTSIDE the platform and then recorded with its reference (see recordRefund).
 */

type ReturnRow = typeof returnRequests.$inferSelect;
type OrderRow = typeof orders.$inferSelect;

async function notifyCustomer(tx: Transaction, order: OrderRow, request: ReturnRow, status: ReturnStatus, note: string | null) {
  const settings = await getSetting('notifications');
  if (!settings.emailReturnUpdates || !order.email) return;
  const returnsSettings = await getSetting('returns');
  const { orderUrl, secret } = orderLinks(order);
  await enqueueNotification(tx, {
    template: 'return_update',
    recipient: order.email,
    data: {
      name: order.customerName,
      requestNumber: request.requestNumber,
      orderNumber: order.orderNumber,
      status,
      note,
      instructions: status === 'approved' ? returnsSettings.instructions || null : null,
      orderUrl,
    },
    secret,
    orderId: order.id,
    userId: order.userId,
  });
}

// ─── Customer ─────────────────────────────────────────────────────────────────

export async function createReturnRequest(
  orderNumber: string,
  viewer: { userId?: string | null; token?: string | null },
  input: ReturnRequestInput,
  meta: { ipAddress: string | null },
): Promise<{ requestNumber: string }> {
  await enforceRateLimit(`return:ip:${meta.ipAddress ?? 'unknown'}`, 10, 60 * 60);
  const detail = await getOrderForViewer(orderNumber, viewer);
  if (!detail) throw notFound('Order not found.');

  const ids = input.items.map((i) => i.orderItemId);
  if (new Set(ids).size !== ids.length) throw validationError({ items: 'Each item can only be listed once.' });
  const known = new Set(detail.items.map((i) => i.id));
  if (!ids.every((id) => known.has(id))) throw validationError({ items: 'One of the items is not part of this order.' });

  const settings = await getSetting('returns');
  const result = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, detail.id)).for('update');
    if (!order) throw notFound('Order not found.');
    // Re-evaluate under the order lock so two concurrent requests cannot over-claim items.
    const existing = await tx.select().from(returnRequests).where(eq(returnRequests.orderId, order.id));
    const existingItems = existing.length
      ? await tx.select().from(returnRequestItems).where(inArray(returnRequestItems.returnRequestId, existing.map((r) => r.id)))
      : [];
    const eligibility = computeReturnEligibility({
      status: order.status,
      deliveredAt: order.deliveredAt,
      items: detail.items.map((i) => ({ id: i.id, quantity: i.quantity })),
      returns: existing.map((r) => ({
        status: r.status,
        items: existingItems.filter((i) => i.returnRequestId === r.id).map((i) => ({ orderItemId: i.orderItemId, quantity: i.quantity })),
      })),
      settings,
    });
    if (!eligibility.eligible) throw conflict(eligibility.reason ?? 'This order cannot be returned online.', 'RETURN_NOT_ALLOWED');
    for (const item of input.items) {
      if (item.quantity > (eligibility.remaining[item.orderItemId] ?? 0)) {
        throw validationError({ items: 'You selected more units than can be returned.' });
      }
    }

    const [request] = await tx
      .insert(returnRequests)
      .values({
        requestNumber: `RT-${randomCode(7)}`,
        orderId: order.id,
        userId: viewer.userId ?? order.userId ?? null,
        reason: input.reason,
        customerNote: input.note,
        isDemo: order.isDemo,
      })
      .returning();
    await tx.insert(returnRequestItems).values(input.items.map((i) => ({ returnRequestId: request!.id, orderItemId: i.orderItemId, quantity: i.quantity })));
    const units = input.items.reduce((s, i) => s + i.quantity, 0);
    await insertOrderEvent(tx, {
      orderId: order.id,
      message: `Return ${request!.requestNumber} requested for ${units} item${units === 1 ? '' : 's'} (${RETURN_REASON_LABEL[input.reason].toLowerCase()}).`,
      actorId: viewer.userId ?? null,
    });
    await recordEvent(tx, 'return.requested', order.id, { orderNumber: order.orderNumber, requestNumber: request!.requestNumber, units, reason: input.reason });
    await notifyCustomer(tx, order, request!, 'requested', null);
    const notify = await getSetting('notifications');
    if (notify.staffEmail && notify.staffNewReturn) {
      await enqueueNotification(tx, {
        template: 'staff_new_return',
        recipient: notify.staffEmail,
        data: { requestNumber: request!.requestNumber, returnId: request!.id, orderNumber: order.orderNumber, reason: RETURN_REASON_LABEL[input.reason] },
        orderId: order.id,
      });
    }
    return { requestNumber: request!.requestNumber };
  });
  scheduleNotificationDispatch();
  return result;
}

/** Customers may withdraw a request until staff act on it. */
export async function withdrawReturnRequest(orderNumber: string, requestNumber: string, viewer: { userId?: string | null; token?: string | null }) {
  const detail = await getOrderForViewer(orderNumber, viewer);
  if (!detail) throw notFound('Order not found.');
  await db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(returnRequests)
      .where(and(eq(returnRequests.orderId, detail.id), eq(returnRequests.requestNumber, requestNumber)))
      .for('update');
    if (!request) throw notFound('Return request not found.');
    if (request.status !== 'requested') throw conflict('This return is already being processed. Please contact customer care.', 'INVALID_TRANSITION');
    await tx.update(returnRequests).set({ status: 'cancelled', decidedAt: new Date() }).where(eq(returnRequests.id, request.id));
    await insertOrderEvent(tx, { orderId: detail.id, message: `Return ${request.requestNumber} withdrawn by the customer.`, actorId: viewer.userId ?? null });
  });
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export async function listReturnsAdmin(query: { status: ReturnStatus | 'all' | 'open'; page: number }) {
  const pageSize = 20;
  const page = Math.max(1, query.page);
  const conditions: SQL[] = [];
  if (query.status === 'open') conditions.push(inArray(returnRequests.status, ['requested', 'approved', 'received']));
  else if (query.status !== 'all') conditions.push(eq(returnRequests.status, query.status));
  const where = conditions.length ? and(...conditions) : undefined;
  const [rows, [total], statusCounts] = await Promise.all([
    db
      .select({
        id: returnRequests.id,
        requestNumber: returnRequests.requestNumber,
        status: returnRequests.status,
        reason: returnRequests.reason,
        createdAt: returnRequests.createdAt,
        isDemo: returnRequests.isDemo,
        orderId: orders.id,
        orderNumber: orders.orderNumber,
        customerName: orders.customerName,
        units: sql<number>`(select coalesce(sum(ri.quantity), 0)::int from return_request_items ri where ri.return_request_id = return_requests.id)`,
        refunded: sql<number>`(select coalesce(sum(r.amount), 0)::int from refunds r where r.return_request_id = return_requests.id)`,
      })
      .from(returnRequests)
      .innerJoin(orders, eq(orders.id, returnRequests.orderId))
      .where(where)
      .orderBy(desc(returnRequests.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(returnRequests).where(where),
    db.select({ status: returnRequests.status, value: count() }).from(returnRequests).groupBy(returnRequests.status),
  ]);
  return {
    items: rows.map((r) => ({ ...r, reason: r.reason as ReturnReason })),
    total: total?.value ?? 0,
    page,
    pageSize,
    counts: Object.fromEntries(statusCounts.map((r) => [r.status, r.value])) as Partial<Record<ReturnStatus, number>>,
  };
}

export async function getReturnAdmin(id: string) {
  const [request] = await db.select().from(returnRequests).where(eq(returnRequests.id, id)).limit(1);
  if (!request) throw notFound('Return request not found.');
  const [[order], items, refundRows] = await Promise.all([
    db.select().from(orders).where(eq(orders.id, request.orderId)).limit(1),
    db
      .select({
        orderItemId: orderItems.id,
        productName: orderItems.productName,
        variantLabel: orderItems.variantLabel,
        sku: orderItems.sku,
        imageUrl: orderItems.imageUrl,
        unitPrice: orderItems.unitPrice,
        orderedQuantity: orderItems.quantity,
        quantity: returnRequestItems.quantity,
        variantId: orderItems.variantId,
      })
      .from(returnRequestItems)
      .innerJoin(orderItems, eq(orderItems.id, returnRequestItems.orderItemId))
      .where(eq(returnRequestItems.returnRequestId, id))
      .orderBy(asc(orderItems.productName)),
    db
      .select({ id: refunds.id, amount: refunds.amount, method: refunds.method, reference: refunds.reference, createdAt: refunds.createdAt, actorName: users.name })
      .from(refunds)
      .leftJoin(users, eq(users.id, refunds.actorId))
      .where(eq(refunds.returnRequestId, id))
      .orderBy(desc(refunds.createdAt)),
  ]);
  if (!order) throw notFound('Order not found.');
  const itemValue = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  // Pro-rate the order discount over the returned units; delivery fees are not refunded by default.
  const discountShare = order.subtotal > 0 ? Math.round((order.discountTotal * itemValue) / order.subtotal) : 0;
  const suggestedRefund = Math.max(0, Math.min(itemValue - discountShare, order.total - order.refundedTotal));
  return {
    request: { ...request, reason: request.reason as ReturnReason },
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      total: order.total,
      refundedTotal: order.refundedTotal,
      customerName: order.customerName,
      email: order.email,
      phone: order.phone,
      deliveredAt: order.deliveredAt,
    },
    items,
    refunds: refundRows,
    suggestedRefund,
  };
}

async function restockReturnedItems(tx: Transaction, request: ReturnRow, order: OrderRow, actorId: string) {
  const items = await tx
    .select({ variantId: orderItems.variantId, productId: orderItems.productId, quantity: returnRequestItems.quantity })
    .from(returnRequestItems)
    .innerJoin(orderItems, eq(orderItems.id, returnRequestItems.orderItemId))
    .where(eq(returnRequestItems.returnRequestId, request.id));
  for (const item of items) {
    if (!item.variantId) continue; // product deleted since: nothing to restock
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
        reason: 'return',
        orderId: order.id,
        actorId,
        note: `Return ${request.requestNumber} (${order.orderNumber})`,
      });
    }
    if (item.productId) {
      await tx
        .update(products)
        .set({ soldCount: sql`greatest(${products.soldCount} - ${item.quantity}, 0)` })
        .where(eq(products.id, item.productId));
    }
  }
}

/** True when every unit of the order has come back through received/refunded returns. */
async function orderFullyReturned(tx: Transaction, orderId: string): Promise<boolean> {
  const result = await tx.execute<{ open: number }>(sql`
    SELECT count(*)::int AS open FROM order_items oi
    WHERE oi.order_id = ${orderId}
      AND oi.quantity > coalesce((
        SELECT sum(ri.quantity) FROM return_request_items ri
        JOIN return_requests rr ON rr.id = ri.return_request_id
        WHERE ri.order_item_id = oi.id AND rr.status IN ('received', 'refunded')
      ), 0)
  `);
  return Number(result.rows[0]?.open ?? 1) === 0;
}

export async function decideReturn(id: string, input: ReturnDecisionInput, actorId: string) {
  await db.transaction(async (tx) => {
    const [request] = await tx.select().from(returnRequests).where(eq(returnRequests.id, id)).for('update');
    if (!request) throw notFound('Return request not found.');
    const [order] = await tx.select().from(orders).where(eq(orders.id, request.orderId)).for('update');
    if (!order) throw notFound('Order not found.');
    const to: ReturnStatus = input.action === 'approve' ? 'approved' : input.action === 'reject' ? 'rejected' : 'received';
    if (!canTransitionReturn(request.status, to)) {
      throw conflict(`A return that is "${RETURN_STATUS_LABEL[request.status]}" cannot be ${to}.`, 'INVALID_TRANSITION');
    }
    if (to === 'rejected' && !input.customerNote) {
      throw validationError({ customerNote: 'Tell the customer why the return was declined.' });
    }

    const now = new Date();
    const patch: Partial<typeof returnRequests.$inferInsert> = { status: to, updatedAt: now };
    if (input.adminNote !== undefined) patch.adminNote = input.adminNote;
    if (to === 'approved' || to === 'rejected') {
      patch.decidedAt = now;
      patch.resolutionNote = input.customerNote ?? null;
    }
    if (to === 'received') {
      patch.receivedAt = now;
      if (input.customerNote) patch.resolutionNote = input.customerNote;
      if (input.restock) {
        await restockReturnedItems(tx, request, order, actorId);
        patch.restocked = true;
      }
    }
    const [updated] = await tx.update(returnRequests).set(patch).where(eq(returnRequests.id, id)).returning();

    const messages: Record<'approved' | 'rejected' | 'received', string> = {
      approved: `Return ${request.requestNumber} approved.`,
      rejected: `Return ${request.requestNumber} declined${input.customerNote ? `: ${input.customerNote}` : '.'}`,
      received: `Returned items for ${request.requestNumber} received${input.restock ? ' and restocked' : ''}.`,
    };
    await insertOrderEvent(tx, { orderId: order.id, message: messages[to as 'approved' | 'rejected' | 'received'], actorId });
    if (to === 'received' && (await orderFullyReturned(tx, order.id)) && order.status === 'delivered') {
      await tx.update(orders).set({ status: 'returned', stockReleased: true }).where(eq(orders.id, order.id));
      await insertOrderEvent(tx, { orderId: order.id, status: 'returned', message: 'All items from this order have been returned.', actorId });
    }
    await recordEvent(tx, 'return.updated', order.id, { orderNumber: order.orderNumber, requestNumber: request.requestNumber, status: to });
    await notifyCustomer(tx, order, updated!, to, input.customerNote ?? null);
  });
  scheduleNotificationDispatch();
}

export async function countOpenReturns(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(returnRequests).where(inArray(returnRequests.status, ['requested', 'approved', 'received']));
  return row?.value ?? 0;
}

