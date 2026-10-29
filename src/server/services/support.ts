import 'server-only';
import { and, count, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { db } from '@/server/db';
import { orders, supportRequests } from '@/server/db/schema';
import { conflict, notFound } from '@/server/errors';
import { randomCode } from '@/server/auth/tokens';
import { log } from '@/server/logger';
import { enqueueNotification, scheduleNotificationDispatch } from '@/server/notifications';
import { enforceRateLimit } from '@/server/rate-limit';
import { SUPPORT_TOPIC_LABEL, type SupportRequestInput } from '@/lib/validation/store';
import { recordEvent } from './events';
import { getSetting } from './settings';

export type SupportStatus = (typeof supportRequests.$inferSelect)['status'];

/**
 * Contact form → support inbox. Spam defences: honeypot field, per-IP rate limit, length limits.
 * The customer gets an acknowledgement with a reference number; staff get an alert (if configured).
 */
export async function createSupportRequest(
  input: SupportRequestInput,
  meta: { ipAddress: string | null; userId: string | null },
): Promise<{ ticketNumber: string }> {
  const settings = await getSetting('support');
  if (!settings.contactFormEnabled) throw conflict('The contact form is currently unavailable. Please email or call us instead.', 'CONTACT_FORM_DISABLED');
  await enforceRateLimit(`support:ip:${meta.ipAddress ?? 'unknown'}`, 5, 60 * 60);
  const ticketNumber = `SR-${randomCode(7)}`;
  if (input.website) {
    // Honeypot filled in: almost certainly a bot. Pretend success without storing anything.
    log.warn('support.honeypot_triggered', {});
    return { ticketNumber };
  }
  const notify = await getSetting('notifications');
  await db.transaction(async (tx) => {
    const [ticket] = await tx
      .insert(supportRequests)
      .values({
        ticketNumber,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        orderNumber: input.orderNumber,
        topic: input.topic,
        message: input.message,
        userId: meta.userId,
        ipAddress: meta.ipAddress?.slice(0, 64) ?? null,
      })
      .returning();
    await recordEvent(tx, 'support.created', ticket!.id, { ticketNumber, topic: input.topic });
    if (input.email) {
      await enqueueNotification(tx, {
        template: 'support_received',
        recipient: input.email,
        data: { name: input.name, ticketNumber, responseTime: settings.responseTime, message: input.message },
        userId: meta.userId,
      });
    }
    if (notify.staffEmail && notify.staffNewSupport) {
      await enqueueNotification(tx, {
        template: 'staff_new_support',
        recipient: notify.staffEmail,
        data: { ticketNumber, ticketId: ticket!.id, name: input.name, topic: SUPPORT_TOPIC_LABEL[input.topic], excerpt: input.message.slice(0, 600) },
      });
    }
  });
  scheduleNotificationDispatch();
  return { ticketNumber };
}

export async function listSupportAdmin(query: { status: SupportStatus | 'all' | 'active'; page: number }) {
  const pageSize = 25;
  const page = Math.max(1, query.page);
  const conditions: SQL[] = [];
  if (query.status === 'active') conditions.push(inArray(supportRequests.status, ['open', 'in_progress']));
  else if (query.status !== 'all') conditions.push(eq(supportRequests.status, query.status));
  const where = conditions.length ? and(...conditions) : undefined;
  const [rows, [total], statusCounts] = await Promise.all([
    db
      .select({
        id: supportRequests.id,
        ticketNumber: supportRequests.ticketNumber,
        name: supportRequests.name,
        email: supportRequests.email,
        phone: supportRequests.phone,
        topic: supportRequests.topic,
        status: supportRequests.status,
        orderNumber: supportRequests.orderNumber,
        createdAt: supportRequests.createdAt,
        isDemo: supportRequests.isDemo,
      })
      .from(supportRequests)
      .where(where)
      .orderBy(desc(supportRequests.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(supportRequests).where(where),
    db.select({ status: supportRequests.status, value: count() }).from(supportRequests).groupBy(supportRequests.status),
  ]);
  return {
    items: rows,
    total: total?.value ?? 0,
    page,
    pageSize,
    counts: Object.fromEntries(statusCounts.map((r) => [r.status, r.value])) as Partial<Record<SupportStatus, number>>,
  };
}

export async function getSupportAdmin(id: string) {
  const [ticket] = await db.select().from(supportRequests).where(eq(supportRequests.id, id)).limit(1);
  if (!ticket) throw notFound('Support request not found.');
  const [order] = ticket.orderNumber
    ? await db.select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status }).from(orders).where(eq(orders.orderNumber, ticket.orderNumber)).limit(1)
    : [];
  return { ticket, order: order ?? null };
}

export async function updateSupportRequest(id: string, input: { status: SupportStatus; adminNote?: string | null }) {
  const [row] = await db
    .update(supportRequests)
    .set({
      status: input.status,
      ...(input.adminNote !== undefined ? { adminNote: input.adminNote } : {}),
      resolvedAt: input.status === 'resolved' ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(supportRequests.id, id))
    .returning({ id: supportRequests.id });
  if (!row) throw notFound('Support request not found.');
}

export async function countOpenSupport(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(supportRequests).where(inArray(supportRequests.status, ['open', 'in_progress']));
  return row?.value ?? 0;
}
