import 'server-only';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { orders, paymentTransactions } from '@/server/db/schema';
import { sslcommerzConfig } from '@/server/env';
import { checkValidation, redact, SslcommerzError, validatePayment } from '@/server/payments/sslcommerz';
import { recordEvent } from './events';
import { cancelOrderTx, deriveOrderAccessToken, insertOrderEvent } from './orders';

export type PaymentOutcome = 'paid' | 'failed' | 'cancelled' | 'pending' | 'ignored';

export type CallbackResult = {
  outcome: PaymentOutcome;
  orderNumber: string | null;
  /** Guest access token so the browser can land on the order page after the gateway redirect. */
  accessToken: string | null;
};

type CallbackKind = 'success' | 'fail' | 'cancel' | 'ipn';

/**
 * Handles every SSLCommerz callback (browser redirects and IPN). Idempotent: repeated or
 * out-of-order callbacks converge on the same final state. A payment is only marked PAID after
 * the server-side Validation API confirms status, tran_id, amount and currency.
 */
export async function processSslcommerzCallback(kind: CallbackKind, payload: Record<string, string>): Promise<CallbackResult> {
  const tranId = payload.tran_id?.trim();
  if (!tranId || tranId.length > 64) return { outcome: 'ignored', orderNumber: null, accessToken: null };

  const [row] = await db
    .select({ txn: paymentTransactions, order: orders })
    .from(paymentTransactions)
    .innerJoin(orders, eq(orders.id, paymentTransactions.orderId))
    .where(eq(paymentTransactions.tranId, tranId))
    .limit(1);
  if (!row) return { outcome: 'ignored', orderNumber: null, accessToken: null };

  const { txn, order } = row;
  const accessToken = order.idempotencyKey ? deriveOrderAccessToken(order.idempotencyKey, order.orderNumber) : null;
  const result = (outcome: PaymentOutcome): CallbackResult => ({ outcome, orderNumber: order.orderNumber, accessToken });

  if (txn.status === 'succeeded') return result('paid');

  const gatewayStatus = (payload.status ?? '').toUpperCase();
  const claimsSuccess = (kind === 'success' || kind === 'ipn') && (gatewayStatus === 'VALID' || gatewayStatus === 'VALIDATED');

  if (claimsSuccess && payload.val_id) {
    const config = sslcommerzConfig();
    if (!config) return result('pending');
    let validation;
    try {
      validation = await validatePayment(config, payload.val_id);
    } catch (error) {
      // Gateway temporarily unreachable: keep the order pending; the IPN or a retry will settle it.
      console.error('[payments] validation failed', error instanceof SslcommerzError ? error.message : error);
      return result('pending');
    }
    const check = checkValidation(validation, { tranId: txn.tranId, amount: txn.amount });
    if (!check.ok) {
      await markFailed(txn.id, order.id, `Validation rejected: ${check.reason}`, validation, 'failed');
      return result('failed');
    }
    await markPaid(txn.id, order.id, validation, check.riskLevel, check.riskTitle);
    return result('paid');
  }

  if (kind === 'cancel' || gatewayStatus === 'CANCELLED') {
    await markFailed(txn.id, order.id, 'Payment cancelled by the customer.', payload, 'cancelled');
    return result('cancelled');
  }
  if (kind === 'fail' || gatewayStatus === 'FAILED') {
    await markFailed(txn.id, order.id, payload.error || 'Payment failed at the gateway.', payload, 'failed');
    return result('failed');
  }
  return result('pending');
}

async function markPaid(
  txnId: string,
  orderId: string,
  validation: Record<string, unknown>,
  riskLevel: number,
  riskTitle: string | null,
) {
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

    const now = new Date();
    await tx
      .update(orders)
      .set({ paymentStatus: 'paid', paidAt: now, paymentExpiresAt: null })
      .where(eq(orders.id, orderId));

    const method = validation.card_type ? ` via ${String(validation.card_type)}` : '';
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
    }
    if (riskLevel > 0) {
      await insertOrderEvent(tx, {
        orderId,
        message: `Gateway flagged this payment as risky${riskTitle ? ` (${riskTitle})` : ''}. Verify before shipping.`,
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

async function markFailed(
  txnId: string,
  orderId: string,
  reason: string,
  raw: Record<string, unknown>,
  kind: 'failed' | 'cancelled',
) {
  await db.transaction(async (tx) => {
    const [txn] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, txnId)).for('update');
    if (!txn || txn.status === 'succeeded' || txn.status === 'failed' || txn.status === 'cancelled') return;
    await tx
      .update(paymentTransactions)
      .set({ status: kind, failureReason: reason.slice(0, 500), gatewayResponse: redact(raw) })
      .where(eq(paymentTransactions.id, txnId));

    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    if (order && order.status === 'pending' && order.paymentStatus !== 'paid') {
      await cancelOrderTx(tx, orderId, {
        message:
          kind === 'cancelled'
            ? 'Online payment was cancelled, so the order was cancelled and items released.'
            : 'Online payment failed, so the order was cancelled and items released.',
        paymentStatus: kind,
      });
      await recordEvent(tx, 'payment.failed', orderId, { orderNumber: order.orderNumber, reason });
    }
  });
}

/** Called by the payment init path when the gateway session could not be created. */
export async function failPaymentInitiation(txnId: string, orderId: string, reason: string, raw?: unknown) {
  await markFailed(txnId, orderId, reason, (raw as Record<string, unknown>) ?? {}, 'failed');
}

/**
 * Cancels online-payment orders whose payment window elapsed, releasing reserved stock.
 * Run every few minutes (cron → POST /api/cron/expire-payments, or `npm run jobs:expire-payments`).
 */
export async function expireStalePayments(now = new Date()): Promise<number> {
  const stale = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.paymentMethod, 'sslcommerz'),
        eq(orders.status, 'pending'),
        inArray(orders.paymentStatus, ['pending', 'unpaid']),
        lt(orders.paymentExpiresAt, now),
      ),
    )
    .limit(200);

  let expired = 0;
  for (const { id } of stale) {
    await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, id)).for('update');
      if (!order || order.status !== 'pending' || order.paymentStatus === 'paid') return;
      await tx
        .update(paymentTransactions)
        .set({ status: 'expired', failureReason: 'Payment window elapsed' })
        .where(and(eq(paymentTransactions.orderId, id), sql`${paymentTransactions.status} IN ('initiated','pending')`));
      await cancelOrderTx(tx, id, {
        message: 'Payment was not completed in time, so the order was cancelled and items released.',
        paymentStatus: 'cancelled',
      });
      expired++;
    });
  }
  return expired;
}
