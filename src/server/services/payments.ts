import 'server-only';
import { and, asc, count, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { orders, paymentTransactions } from '@/server/db/schema';
import { appUrl, sslcommerzConfig, type SslcommerzConfig } from '@/server/env';
import { AppError, badRequest, conflict, notFound } from '@/server/errors';
import { randomCode } from '@/server/auth/tokens';
import { log } from '@/server/logger';
import { scheduleNotificationDispatch } from '@/server/notifications';
import { queueOrderCancelledNotifications, queuePaymentReceivedNotifications } from '@/server/notifications/orders';
import {
  checkValidation,
  initiateSession,
  queryTransactionsByTranId,
  redact,
  SslcommerzError,
  validatePayment,
  verifyCallbackSignature,
} from '@/server/payments/sslcommerz';
import { formatBDT } from '@/lib/money';
import { recordEvent } from './events';
import { cancelOrderTx, getOrderForViewer, insertOrderEvent } from './orders';
import { deriveOrderAccessToken } from './order-token';

/**
 * SSLCommerz payment lifecycle.
 *
 *  - An order is marked PAID only after the server-to-server Validation API confirms status,
 *    tran_id, amount and currency. Browser redirects are never trusted on their own.
 *  - Failure/cancel notices change state only when their verify_sign is valid. Unsigned notices are
 *    reconciled with the Transaction Query API instead.
 *  - A failed or cancelled attempt does NOT cancel the order: the customer may retry until the
 *    payment window (PAYMENT_TIMEOUT_MINUTES) closes. The expiry job then reconciles with the
 *    gateway once more and only cancels (releasing stock) when no successful payment exists.
 *  - Every handler is idempotent: duplicate / out-of-order callbacks converge on the same state.
 */
export type PaymentOutcome = 'paid' | 'failed' | 'cancelled' | 'pending' | 'ignored';

export type CallbackResult = {
  outcome: PaymentOutcome;
  orderNumber: string | null;
  /** Guest access token so the browser can land on the order page after the gateway redirect. */
  accessToken: string | null;
};

type CallbackKind = 'success' | 'fail' | 'cancel' | 'ipn';
type Txn = typeof paymentTransactions.$inferSelect;
type OrderRow = typeof orders.$inferSelect;

const FAILURE_STATUSES = new Set(['FAILED', 'EXPIRED', 'UNATTEMPTED']);
const MAX_PAYMENT_ATTEMPTS = 6;
/** If the gateway cannot be reached, expiry waits this long past the window before cancelling anyway. */
const EXPIRY_GRACE_WHEN_UNREACHABLE_MS = 2 * 60 * 60 * 1000;

export async function processSslcommerzCallback(kind: CallbackKind, payload: Record<string, string>): Promise<CallbackResult> {
  const tranId = payload.tran_id?.trim();
  if (!tranId || tranId.length > 64) return { outcome: 'ignored', orderNumber: null, accessToken: null };

  const [row] = await db
    .select({ txn: paymentTransactions, order: orders })
    .from(paymentTransactions)
    .innerJoin(orders, eq(orders.id, paymentTransactions.orderId))
    .where(eq(paymentTransactions.tranId, tranId))
    .limit(1);
  if (!row) {
    log.warn('payment.callback_unknown_tran_id', { kind });
    return { outcome: 'ignored', orderNumber: null, accessToken: null };
  }

  const { txn, order } = row;
  const accessToken = order.idempotencyKey ? deriveOrderAccessToken(order.idempotencyKey, order.orderNumber) : null;
  const result = (outcome: PaymentOutcome): CallbackResult => ({ outcome, orderNumber: order.orderNumber, accessToken });

  if (txn.status === 'succeeded') return result('paid');
  const config = sslcommerzConfig();
  if (!config) return result('pending');

  const signature = verifyCallbackSignature(payload, config.storePassword);
  if (signature === 'invalid') {
    log.warn('payment.callback_bad_signature', { kind, orderNumber: order.orderNumber });
    return result(order.paymentStatus === 'paid' ? 'paid' : 'pending');
  }

  const gatewayStatus = (payload.status ?? '').toUpperCase();
  const claimsSuccess = (kind === 'success' || kind === 'ipn') && (gatewayStatus === 'VALID' || gatewayStatus === 'VALIDATED');
  if (claimsSuccess && payload.val_id) {
    const outcome = await settleWithValidation(config, txn, payload.val_id);
    if (outcome === 'paid') scheduleNotificationDispatch();
    return result(outcome);
  }

  const failure: 'failed' | 'cancelled' | null =
    kind === 'cancel' || gatewayStatus === 'CANCELLED' ? 'cancelled' : kind === 'fail' || FAILURE_STATUSES.has(gatewayStatus) ? 'failed' : null;
  if (!failure) return result('pending');

  if (signature === 'valid') {
    const reason = failure === 'cancelled' ? 'Payment cancelled by the customer.' : payload.error?.slice(0, 300) || 'Payment failed at the gateway.';
    await markAttemptFailed(txn.id, failure, reason, payload);
    return result(failure);
  }
  // Unsigned failure notice (e.g. a forged POST): never act on it — ask the gateway instead.
  const reconciled = await reconcileTransaction(config, txn);
  if (reconciled === 'paid') {
    scheduleNotificationDispatch();
    return result('paid');
  }
  return result(failure);
}

/** Confirms a val_id with the Validation API and records the outcome. */
async function settleWithValidation(config: SslcommerzConfig, txn: Txn, valId: string): Promise<'paid' | 'failed' | 'pending'> {
  let validation;
  try {
    validation = await validatePayment(config, valId);
  } catch (error) {
    // Gateway temporarily unreachable: keep the order pending; IPN, retry or the expiry job settles it.
    log.error('payment.validation_unreachable', { tranId: txn.tranId, error: error instanceof SslcommerzError ? error.message : error });
    return 'pending';
  }
  if (validation.status === 'INVALID_TRANSACTION') {
    log.warn('payment.validation_invalid_val_id', { tranId: txn.tranId });
    return 'pending';
  }
  const check = checkValidation(validation, { tranId: txn.tranId, amount: txn.amount });
  if (!check.ok) {
    await recordValidationRejection(txn.id, check.reason, validation);
    return 'failed';
  }
  await markPaid(txn.id, txn.orderId, validation, check.riskLevel, check.riskTitle);
  return 'paid';
}

async function markPaid(txnId: string, orderId: string, validation: Record<string, unknown>, riskLevel: number, riskTitle: string | null) {
  await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    const [txn] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, txnId)).for('update');
    if (!order || !txn || txn.status === 'succeeded') return;

    await tx
      .update(paymentTransactions)
      .set({
        status: 'succeeded',
        valId: String(validation.val_id ?? ''),
        bankTranId: validation.bank_tran_id ? String(validation.bank_tran_id) : null,
        cardType: validation.card_type ? String(validation.card_type) : null,
        gatewayResponse: redact(validation),
        failureReason: null,
      })
      .where(eq(paymentTransactions.id, txnId));

    const method = validation.card_type ? ` via ${String(validation.card_type)}` : '';
    if (order.paymentStatus === 'paid' || order.paymentStatus === 'refunded' || order.paymentStatus === 'partially_refunded') {
      // A second successful attempt for an order that is already paid: money captured twice.
      await insertOrderEvent(tx, {
        orderId,
        message: `Duplicate payment of ${formatBDT(txn.amount)} received${method} (transaction ${txn.tranId}). Refund it from the SSLCommerz merchant panel, then record the refund here.`,
        visibleToCustomer: false,
      });
      await recordEvent(tx, 'payment.succeeded', orderId, { orderNumber: order.orderNumber, amount: txn.amount, currency: 'BDT', provider: 'sslcommerz', duplicate: true });
      return;
    }

    const now = new Date();
    const [updated] = await tx
      .update(orders)
      .set({ paymentStatus: 'paid', paidAt: now, paymentExpiresAt: null })
      .where(eq(orders.id, orderId))
      .returning();

    if (order.status === 'cancelled') {
      // Paid after the reservation expired: money captured but stock was released. Needs a human.
      await insertOrderEvent(tx, {
        orderId,
        paymentStatus: 'paid',
        message: `Payment received${method} after the order was cancelled. Refund the customer or reinstate the order.`,
        visibleToCustomer: false,
      });
      await insertOrderEvent(tx, {
        orderId,
        paymentStatus: 'paid',
        message: 'We received your payment after this order expired. Our team will contact you about a refund.',
      });
    } else {
      await insertOrderEvent(tx, { orderId, paymentStatus: 'paid', message: `Payment received${method}.` });
      await queuePaymentReceivedNotifications(tx, updated!);
    }
    if (riskLevel > 0) {
      await insertOrderEvent(tx, {
        orderId,
        message: `SSLCommerz flagged this payment as HIGH RISK${riskTitle ? ` (${riskTitle})` : ''}. Hold the order and verify the customer before shipping.`,
        visibleToCustomer: false,
      });
    }
    await recordEvent(tx, 'payment.succeeded', orderId, {
      orderNumber: order.orderNumber,
      amount: txn.amount,
      currency: 'BDT',
      provider: 'sslcommerz',
      riskLevel,
    });
  });
}

/** The gateway answered VALID but for a different amount/currency/transaction. Never mark paid. */
async function recordValidationRejection(txnId: string, reason: string, validation: Record<string, unknown>) {
  await db.transaction(async (tx) => {
    const [txn] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, txnId)).for('update');
    if (!txn || txn.status === 'succeeded') return;
    await tx
      .update(paymentTransactions)
      .set({ status: 'failed', failureReason: `Validation rejected: ${reason}`.slice(0, 500), gatewayResponse: redact(validation) })
      .where(eq(paymentTransactions.id, txnId));
    await insertOrderEvent(tx, {
      orderId: txn.orderId,
      message: `Payment validation rejected (${reason}). The order was NOT marked paid — check transaction ${txn.tranId} in the SSLCommerz merchant panel.`,
      visibleToCustomer: false,
    });
  });
  log.warn('payment.validation_rejected', { txnId, reason });
}

/** A signed failure/cancel notice: the attempt is over, but the order stays open for a retry. */
async function markAttemptFailed(txnId: string, kind: 'failed' | 'cancelled', reason: string, raw: Record<string, unknown>) {
  await db.transaction(async (tx) => {
    const [txn] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, txnId)).for('update');
    if (!txn || txn.status === 'succeeded' || txn.status === 'failed' || txn.status === 'cancelled' || txn.status === 'expired') return;
    await tx
      .update(paymentTransactions)
      .set({ status: kind, failureReason: reason.slice(0, 500), gatewayResponse: redact(raw) })
      .where(eq(paymentTransactions.id, txnId));

    const [order] = await tx.select().from(orders).where(eq(orders.id, txn.orderId)).for('update');
    if (order && order.status === 'pending' && order.paymentStatus !== 'paid') {
      await tx.update(orders).set({ paymentStatus: kind }).where(eq(orders.id, order.id));
      await insertOrderEvent(tx, {
        orderId: order.id,
        paymentStatus: kind,
        message:
          kind === 'cancelled'
            ? 'Online payment was cancelled. Your items are reserved for a short time — you can try paying again from this page.'
            : 'Online payment did not go through. Your items are reserved for a short time — you can try paying again from this page.',
      });
      await recordEvent(tx, 'payment.failed', order.id, { orderNumber: order.orderNumber, reason });
    }
  });
}

/**
 * Asks the gateway (Transaction Query API) about one transaction. Any VALID attempt is confirmed
 * with the Validation API and recorded. Returns 'unreachable' if the gateway could not be queried.
 */
async function reconcileTransaction(config: SslcommerzConfig, txn: Txn): Promise<'paid' | 'unpaid' | 'unreachable'> {
  if (txn.status === 'succeeded') return 'paid';
  let query;
  try {
    query = await queryTransactionsByTranId(config, txn.tranId);
  } catch (error) {
    log.warn('payment.reconcile_unreachable', { tranId: txn.tranId, error: error instanceof Error ? error.message : String(error) });
    return 'unreachable';
  }
  for (const element of query.elements) {
    const status = String(element.status ?? '').toUpperCase();
    if ((status === 'VALID' || status === 'VALIDATED') && element.val_id) {
      const outcome = await settleWithValidation(config, txn, String(element.val_id));
      if (outcome === 'paid') return 'paid';
      if (outcome === 'pending') return 'unreachable';
    }
  }
  return 'unpaid';
}

async function reconcileOrder(config: SslcommerzConfig, orderId: string): Promise<'paid' | 'unpaid' | 'unreachable'> {
  const txns = await db.select().from(paymentTransactions).where(eq(paymentTransactions.orderId, orderId)).orderBy(asc(paymentTransactions.createdAt));
  let unreachable = false;
  for (const txn of txns) {
    if (txn.status === 'succeeded') return 'paid';
    if (txn.status === 'initiated') continue; // no gateway session was ever created
    const outcome = await reconcileTransaction(config, txn);
    if (outcome === 'paid') return 'paid';
    if (outcome === 'unreachable') unreachable = true;
  }
  return unreachable ? 'unreachable' : 'unpaid';
}

/** Admin "Check with gateway": reconciles every attempt of an order and logs the result. */
export async function reconcileOrderPayment(orderId: string, actorId: string): Promise<{ outcome: 'paid' | 'unpaid' | 'unreachable' }> {
  const config = sslcommerzConfig();
  if (!config) throw badRequest('SSLCommerz is not configured on this server.', 'GATEWAY_NOT_CONFIGURED');
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) throw notFound('Order not found.');
  if (order.paymentMethod !== 'sslcommerz') throw conflict('This order was not paid online.', 'NOT_ONLINE_PAYMENT');
  const outcome = await reconcileOrder(config, orderId);
  await insertOrderEvent(db, {
    orderId,
    message:
      outcome === 'paid'
        ? 'Gateway check: a successful payment is recorded.'
        : outcome === 'unpaid'
          ? 'Gateway check: SSLCommerz reports no successful payment for this order.'
          : 'Gateway check failed: SSLCommerz could not be reached. Try again later.',
    actorId,
    visibleToCustomer: false,
  });
  if (outcome === 'paid') scheduleNotificationDispatch();
  return { outcome };
}

/** Called by the checkout path when the gateway session could not be created for a NEW order. */
export async function failPaymentInitiation(txnId: string, orderId: string, reason: string, raw?: unknown) {
  await db.transaction(async (tx) => {
    const [txn] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, txnId)).for('update');
    if (!txn || txn.status === 'succeeded') return;
    await tx
      .update(paymentTransactions)
      .set({ status: 'failed', failureReason: reason.slice(0, 500), gatewayResponse: redact((raw as Record<string, unknown>) ?? {}) })
      .where(eq(paymentTransactions.id, txnId));
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    if (order && order.status === 'pending' && order.paymentStatus !== 'paid') {
      await cancelOrderTx(tx, orderId, { message: 'The payment gateway could not be reached, so the order was cancelled and items released.', paymentStatus: 'failed' });
      await recordEvent(tx, 'payment.failed', orderId, { orderNumber: order.orderNumber, reason });
    }
  });
}

/**
 * Starts a NEW gateway session for an order whose earlier attempt failed or was abandoned, as long
 * as the payment window is still open. Previous attempts are reconciled first to avoid charging twice.
 */
export async function retryOnlinePayment(
  orderNumber: string,
  viewer: { userId?: string | null; token?: string | null },
): Promise<{ type: 'redirect'; url: string } | { type: 'paid' }> {
  const config = sslcommerzConfig();
  if (!config) throw badRequest('Online payment is currently unavailable.', 'PAYMENT_METHOD_UNAVAILABLE');
  const detail = await getOrderForViewer(orderNumber, viewer);
  if (!detail) throw notFound('Order not found.');

  if ((await reconcileOrder(config, detail.id)) === 'paid') {
    scheduleNotificationDispatch();
    return { type: 'paid' };
  }

  const created = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, detail.id)).for('update');
    if (!order || order.paymentMethod !== 'sslcommerz' || order.status !== 'pending' || order.paymentStatus === 'paid') {
      throw conflict('This order does not need an online payment.', 'PAYMENT_NOT_REQUIRED');
    }
    if (!order.paymentExpiresAt || order.paymentExpiresAt.getTime() <= Date.now()) {
      throw conflict('The payment window for this order has closed. Please place the order again.', 'PAYMENT_WINDOW_CLOSED');
    }
    const [{ value: attempts }] = await tx.select({ value: count() }).from(paymentTransactions).where(eq(paymentTransactions.orderId, order.id));
    if (attempts >= MAX_PAYMENT_ATTEMPTS) {
      throw conflict('Too many payment attempts for this order. Please contact customer care.', 'TOO_MANY_ATTEMPTS');
    }
    // Close any attempt still open so a late success for it is treated as a duplicate.
    await tx
      .update(paymentTransactions)
      .set({ status: 'cancelled', failureReason: 'Superseded by a new payment attempt' })
      .where(and(eq(paymentTransactions.orderId, order.id), inArray(paymentTransactions.status, ['initiated', 'pending'])));
    const [txn] = await tx
      .insert(paymentTransactions)
      .values({ orderId: order.id, provider: 'sslcommerz', tranId: `${order.orderNumber}-${randomCode(6)}`, amount: order.total, status: 'initiated' })
      .returning();
    await tx.update(orders).set({ paymentStatus: 'pending' }).where(eq(orders.id, order.id));
    return { order, txn: txn! };
  });

  try {
    const session = await initiateSession(config, {
      tranId: created.txn.tranId,
      amount: created.order.total,
      orderNumber: created.order.orderNumber,
      callbackBaseUrl: appUrl(),
      customer: {
        name: created.order.customerName,
        email: created.order.email ?? '',
        phone: created.order.phone,
        addressLine: created.order.addressLine,
        area: created.order.area,
        district: created.order.district,
        division: created.order.division,
        postalCode: created.order.postalCode,
      },
      productSummary: detail.items.map((i) => i.productName).join(', '),
      itemCount: detail.items.reduce((s, i) => s + i.quantity, 0),
    });
    await db
      .update(paymentTransactions)
      .set({ status: 'pending', gatewaySessionKey: session.sessionKey, gatewayResponse: session.raw })
      .where(eq(paymentTransactions.id, created.txn.id));
    return { type: 'redirect', url: session.gatewayUrl };
  } catch (error) {
    log.error('payment.retry_init_failed', { orderNumber, error: error instanceof Error ? error.message : String(error) });
    await db
      .update(paymentTransactions)
      .set({ status: 'failed', failureReason: 'Could not start the payment session.' })
      .where(eq(paymentTransactions.id, created.txn.id));
    await db.update(orders).set({ paymentStatus: 'failed' }).where(and(eq(orders.id, created.order.id), eq(orders.paymentStatus, 'pending')));
    throw new AppError(502, 'PAYMENT_INIT_FAILED', 'We could not reach the payment gateway. Please try again in a moment.');
  }
}

export type ExpiryResult = { checked: number; expired: number; paid: number; deferred: number };

/**
 * Cancels online-payment orders whose payment window elapsed, releasing reserved stock — but only
 * after asking the gateway whether a payment exists (a missed IPN must not lose a paid order).
 * Run every few minutes (cron → POST /api/cron/expire-payments, or `npm run jobs:expire-payments`).
 */
export async function expireStalePayments(now = new Date()): Promise<ExpiryResult> {
  const stale = await db
    .select({ id: orders.id, paymentExpiresAt: orders.paymentExpiresAt })
    .from(orders)
    .where(
      and(
        eq(orders.paymentMethod, 'sslcommerz'),
        eq(orders.status, 'pending'),
        inArray(orders.paymentStatus, ['pending', 'unpaid', 'failed', 'cancelled']),
        lt(orders.paymentExpiresAt, now),
      ),
    )
    .orderBy(asc(orders.paymentExpiresAt))
    .limit(100);

  const config = sslcommerzConfig();
  const result: ExpiryResult = { checked: stale.length, expired: 0, paid: 0, deferred: 0 };
  for (const { id, paymentExpiresAt } of stale) {
    if (config) {
      const outcome = await reconcileOrder(config, id);
      if (outcome === 'paid') {
        result.paid++;
        continue;
      }
      if (outcome === 'unreachable' && paymentExpiresAt && now.getTime() - paymentExpiresAt.getTime() < EXPIRY_GRACE_WHEN_UNREACHABLE_MS) {
        result.deferred++;
        continue;
      }
    }
    const cancelled = await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, id)).for('update');
      if (!order || order.status !== 'pending' || order.paymentStatus === 'paid') return false;
      await tx
        .update(paymentTransactions)
        .set({ status: 'expired', failureReason: 'Payment window elapsed' })
        .where(and(eq(paymentTransactions.orderId, id), sql`${paymentTransactions.status} IN ('initiated','pending')`));
      const message = 'Payment was not completed in time, so the order was cancelled and items released.';
      const updated: OrderRow = await cancelOrderTx(tx, id, {
        message,
        paymentStatus: order.paymentStatus === 'failed' ? 'failed' : 'cancelled',
      });
      await queueOrderCancelledNotifications(tx, updated, 'Payment was not completed in time, so the reserved items were released.');
      return true;
    });
    if (cancelled) result.expired++;
  }
  if (result.expired > 0) scheduleNotificationDispatch();
  return result;
}

/** Orders with an open online-payment window (used by the storefront to offer "Pay now"). */
export function canRetryPayment(order: { paymentMethod: string; status: string; paymentStatus: string; paymentExpiresAt: Date | null }): boolean {
  return (
    !!sslcommerzConfig() &&
    order.paymentMethod === 'sslcommerz' &&
    order.status === 'pending' &&
    order.paymentStatus !== 'paid' &&
    !!order.paymentExpiresAt &&
    order.paymentExpiresAt.getTime() > Date.now()
  );
}
