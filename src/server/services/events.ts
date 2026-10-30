import 'server-only';
import { createHmac } from 'node:crypto';
import { and, asc, eq, isNull, lt, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '@/server/db';
import { domainEvents } from '@/server/db/schema';
import { ecosystemWebhook } from '@/server/env';

/**
 * Transactional outbox. Events are written in the same DB transaction as the change they describe,
 * so other MKJ Ecosystem services never miss (or receive phantom) events. A dispatcher delivers them
 * to ECOSYSTEM_WEBHOOK_URL, signed with HMAC-SHA256.
 */
export type DomainEventType =
  | 'order.placed'
  | 'order.status_changed'
  | 'order.cancelled'
  | 'payment.succeeded'
  | 'payment.failed'
  | 'customer.registered'
  | 'customer.password_reset'
  | 'order.refunded'
  | 'return.requested'
  | 'return.updated'
  | 'support.created'
  | 'inventory.low_stock';

export async function recordEvent(
  tx: DbOrTx,
  type: DomainEventType,
  aggregateId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.insert(domainEvents).values({ type, aggregateId, payload });
}

export function signPayload(body: string, secret: string, timestamp: number): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

const MAX_ATTEMPTS = 10;

/** Delivers pending events in order. Safe to call concurrently (row locks with SKIP LOCKED). */
export async function dispatchPendingEvents(limit = 50): Promise<{ delivered: number; failed: number; skipped: boolean }> {
  const webhook = ecosystemWebhook();
  if (!webhook) return { delivered: 0, failed: 0, skipped: true };

  let delivered = 0;
  let failed = 0;
  await db.transaction(async (tx) => {
    const batch = await tx
      .select()
      .from(domainEvents)
      .where(and(isNull(domainEvents.dispatchedAt), lt(domainEvents.attempts, MAX_ATTEMPTS)))
      .orderBy(asc(domainEvents.createdAt))
      .limit(limit)
      .for('update', { skipLocked: true });

    for (const event of batch) {
      const body = JSON.stringify({
        id: event.id,
        type: event.type,
        aggregateId: event.aggregateId,
        occurredAt: event.createdAt.toISOString(),
        source: 'mkj-mart',
        data: event.payload,
      });
      const timestamp = Math.floor(Date.now() / 1000);
      try {
        const response = await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-mkj-event': event.type,
            'x-mkj-timestamp': String(timestamp),
            'x-mkj-signature': `sha256=${signPayload(body, webhook.secret, timestamp)}`,
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        await tx.update(domainEvents).set({ dispatchedAt: new Date(), attempts: event.attempts + 1, lastError: null }).where(eq(domainEvents.id, event.id));
        delivered++;
      } catch (error) {
        await tx
          .update(domainEvents)
          .set({ attempts: sql`${domainEvents.attempts} + 1`, lastError: String(error).slice(0, 500) })
          .where(eq(domainEvents.id, event.id));
        failed++;
        break; // preserve ordering: retry from this event next run
      }
    }
  });
  return { delivered, failed, skipped: false };
}
