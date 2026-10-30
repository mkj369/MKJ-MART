import 'server-only';
import { after } from 'next/server';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '@/server/db';
import { notifications, orders, users } from '@/server/db/schema';
import { appUrl, smsConfig, smtpConfig } from '@/server/env';
import { log } from '@/server/logger';
import { getSetting } from '@/server/services/settings';
import { sendEmail } from './email';
import { sendSms } from './sms';
import {
  isSmsTemplate,
  renderEmail,
  renderSms,
  type EmailTemplateName,
  type SecretData,
  type SmsTemplateName,
  type TemplateContext,
  type TemplateData,
  type TemplateName,
} from './templates';

/**
 * Transactional notification outbox.
 *
 *   enqueueNotification(tx, …)   → written in the SAME transaction as the business change
 *   dispatchNotifications()      → delivers due messages; retries with backoff; safe to run concurrently
 *   scheduleNotificationDispatch → runs a dispatch right after the current HTTP response (Next `after`)
 *
 * A cron job (`/api/cron/send-notifications` or `npm run jobs:send-notifications`) is the safety net
 * that retries failures and catches anything a crashed process did not send.
 */

const MAX_ATTEMPTS = 6;
const BACKOFF_MINUTES = [1, 5, 15, 60, 180];
const CLAIM_LEASE_MINUTES = 10;

export function notificationsDisabled(): boolean {
  return process.env.NOTIFICATIONS_DISABLED === '1';
}

export async function templateContext(): Promise<TemplateContext> {
  const store = await getSetting('store');
  return {
    appUrl: appUrl(),
    store: {
      storeName: store.storeName,
      supportEmail: store.supportEmail,
      supportPhone: store.supportPhone,
      address: store.address,
      legalName: store.legalName,
    },
  };
}

type EnqueueInput<K extends TemplateName> = {
  template: K;
  recipient: string | null | undefined;
  data: TemplateData[K];
  secret?: SecretData;
  orderId?: string | null;
  userId?: string | null;
};

export async function enqueueNotification<K extends TemplateName>(tx: DbOrTx, input: EnqueueInput<K>): Promise<void> {
  if (notificationsDisabled() || !input.recipient) return;
  const channel = isSmsTemplate(input.template) ? 'sms' : 'email';
  const configured = channel === 'email' ? !!smtpConfig() : !!smsConfig();
  // SMS is optional: without a provider nothing is recorded. Email is core: unsent mail is recorded
  // as "skipped" so the admin can see exactly what customers did NOT receive.
  if (channel === 'sms' && !configured) return;
  const ctx = await templateContext();
  const subject = channel === 'email' ? renderEmail(input.template as EmailTemplateName, input.data as never, ctx, input.secret).subject : null;
  const hasSecret = !!input.secret && Object.keys(input.secret).length > 0;
  await tx.insert(notifications).values({
    channel,
    template: input.template,
    recipient: input.recipient.slice(0, 255),
    subject: subject?.slice(0, 255) ?? null,
    payload: input.data as Record<string, unknown>,
    secretPayload: configured && hasSecret ? input.secret : null,
    status: configured ? 'pending' : 'skipped',
    lastError: configured ? null : 'Email is not configured (SMTP_HOST / SMTP_FROM are not set).',
    orderId: input.orderId ?? null,
    userId: input.userId ?? null,
  });
}

/** Delivers one rendered message. Throws on any provider error. */
async function deliver(
  channel: 'email' | 'sms',
  template: TemplateName,
  recipient: string,
  payload: unknown,
  secret: SecretData,
  ctx: TemplateContext,
  id: string,
): Promise<string> {
  if (channel === 'email') {
    const message = renderEmail(template as EmailTemplateName, payload as never, ctx, secret);
    return (await sendEmail({ to: recipient, ...message })).messageId;
  }
  const text = renderSms(template as SmsTemplateName, payload as never, ctx);
  return (await sendSms(recipient, text, id)).providerMessageId;
}

export type DispatchResult = { sent: number; failed: number; retrying: number; skipped: number };

export async function dispatchNotifications(limit = 20): Promise<DispatchResult> {
  const result: DispatchResult = { sent: 0, failed: 0, retrying: 0, skipped: 0 };
  // 1) Claim a batch with a short lease (no transaction is held open while talking to providers).
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: notifications.id,
        channel: notifications.channel,
        template: notifications.template,
        recipient: notifications.recipient,
        payload: notifications.payload,
        secretPayload: notifications.secretPayload,
        attempts: notifications.attempts,
        orderIsDemo: orders.isDemo,
        userIsDemo: users.isDemo,
      })
      .from(notifications)
      .leftJoin(orders, eq(orders.id, notifications.orderId))
      .leftJoin(users, eq(users.id, notifications.userId))
      .where(and(eq(notifications.status, 'pending'), lte(notifications.nextAttemptAt, new Date())))
      .orderBy(asc(notifications.createdAt))
      .limit(limit)
      .for('update', { of: notifications, skipLocked: true });
    if (rows.length === 0) return [];
    await tx
      .update(notifications)
      .set({
        attempts: sql`${notifications.attempts} + 1`,
        nextAttemptAt: sql`now() + make_interval(mins => ${CLAIM_LEASE_MINUTES})`,
      })
      .where(
        inArray(
          notifications.id,
          rows.map((r) => r.id),
        ),
      );
    return rows.map((r) => ({ ...r, attempts: r.attempts + 1 }));
  });
  if (claimed.length === 0) return result;

  const ctx = await templateContext();
  for (const row of claimed) {
    const final = { secretPayload: null, updatedAt: new Date() };
    if (row.orderIsDemo || row.userIsDemo) {
      await db.update(notifications).set({ ...final, status: 'skipped', lastError: 'Demo record — not sent.' }).where(eq(notifications.id, row.id));
      result.skipped++;
      continue;
    }
    const configured = row.channel === 'email' ? !!smtpConfig() : !!smsConfig();
    if (!configured) {
      await db
        .update(notifications)
        .set({ ...final, status: 'skipped', lastError: `${row.channel === 'email' ? 'Email' : 'SMS'} provider is no longer configured.` })
        .where(eq(notifications.id, row.id));
      result.skipped++;
      continue;
    }
    try {
      const providerMessageId = await deliver(
        row.channel,
        row.template as TemplateName,
        row.recipient,
        row.payload,
        (row.secretPayload ?? {}) as SecretData,
        ctx,
        row.id,
      );
      await db
        .update(notifications)
        .set({ ...final, status: 'sent', sentAt: new Date(), providerMessageId: providerMessageId.slice(0, 255) || null, lastError: null })
        .where(eq(notifications.id, row.id));
      result.sent++;
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      if (row.attempts >= MAX_ATTEMPTS) {
        await db.update(notifications).set({ ...final, status: 'failed', lastError: message }).where(eq(notifications.id, row.id));
        result.failed++;
        log.error('notification.failed', { id: row.id, channel: row.channel, template: row.template, attempts: row.attempts, error: message });
      } else {
        const delay = BACKOFF_MINUTES[Math.min(row.attempts - 1, BACKOFF_MINUTES.length - 1)]!;
        await db
          .update(notifications)
          .set({ lastError: message, nextAttemptAt: new Date(Date.now() + delay * 60_000), updatedAt: new Date() })
          .where(eq(notifications.id, row.id));
        result.retrying++;
        log.warn('notification.retry', { id: row.id, channel: row.channel, template: row.template, attempts: row.attempts, inMinutes: delay, error: message });
      }
    }
  }
  return result;
}

/** Runs a dispatch after the current response is sent (or soon, outside a request). Never throws. */
export function scheduleNotificationDispatch(): void {
  if (notificationsDisabled() || process.env.NODE_ENV === 'test') return;
  const run = async () => {
    try {
      await dispatchNotifications();
    } catch (error) {
      log.error('notification.dispatch_error', { error });
    }
  };
  try {
    after(run);
  } catch {
    setTimeout(() => void run(), 0);
  }
}

/**
 * Sends immediately, bypassing the outbox — for messages that carry a short-lived secret that must
 * never be stored (password-reset links). A row is still recorded for auditing, without the secret.
 */
export async function sendEmailNow<K extends EmailTemplateName>(input: {
  template: K;
  recipient: string;
  data: TemplateData[K];
  /** Version of `data` that is safe to store (secret fields removed). */
  storedData: Record<string, unknown>;
  userId?: string | null;
}): Promise<'sent' | 'failed' | 'skipped'> {
  const ctx = await templateContext();
  const message = renderEmail(input.template, input.data, ctx);
  const base = {
    channel: 'email' as const,
    template: input.template,
    recipient: input.recipient.slice(0, 255),
    subject: message.subject.slice(0, 255),
    payload: input.storedData,
    userId: input.userId ?? null,
    attempts: 1,
  };
  if (!smtpConfig()) {
    await db.insert(notifications).values({ ...base, attempts: 0, status: 'skipped', lastError: 'Email is not configured (SMTP_HOST / SMTP_FROM are not set).' });
    log.warn('notification.email_not_configured', { template: input.template });
    return 'skipped';
  }
  try {
    const { messageId } = await sendEmail({ to: input.recipient, ...message });
    await db.insert(notifications).values({ ...base, status: 'sent', sentAt: new Date(), providerMessageId: messageId.slice(0, 255) || null });
    return 'sent';
  } catch (error) {
    const lastError = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    await db.insert(notifications).values({ ...base, status: 'failed', lastError });
    log.error('notification.send_now_failed', { template: input.template, error: lastError });
    return 'failed';
  }
}

export async function listNotificationsForOrder(orderId: string) {
  return db
    .select({
      id: notifications.id,
      channel: notifications.channel,
      template: notifications.template,
      recipient: notifications.recipient,
      subject: notifications.subject,
      status: notifications.status,
      attempts: notifications.attempts,
      lastError: notifications.lastError,
      sentAt: notifications.sentAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(eq(notifications.orderId, orderId))
    .orderBy(asc(notifications.createdAt));
}

/** Admin "send test" — real delivery through the configured provider, reported honestly. */
export async function sendTestMessage(channel: 'email' | 'sms', to: string, requestedBy: string): Promise<{ status: 'sent' | 'failed' | 'skipped'; error: string | null }> {
  const ctx = await templateContext();
  const configured = channel === 'email' ? !!smtpConfig() : !!smsConfig();
  const template = channel === 'email' ? 'test_message' : 'sms_test_message';
  const base = { channel, template, recipient: to.slice(0, 255), payload: { requestedBy }, attempts: 1 } as const;
  if (!configured) {
    const error = channel === 'email' ? 'Email is not configured (SMTP_HOST / SMTP_FROM are not set).' : 'SMS is not configured (SMS_PROVIDER is not set).';
    return { status: 'skipped', error };
  }
  try {
    const providerMessageId =
      channel === 'email'
        ? (await sendEmail({ to, ...renderEmail('test_message', { requestedBy }, ctx) })).messageId
        : (await sendSms(to, renderSms('sms_test_message', { requestedBy }, ctx), crypto.randomUUID())).providerMessageId;
    await db.insert(notifications).values({ ...base, status: 'sent', sentAt: new Date(), providerMessageId: providerMessageId.slice(0, 255) || null });
    return { status: 'sent', error: null };
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    await db.insert(notifications).values({ ...base, status: 'failed', lastError: message });
    return { status: 'failed', error: message };
  }
}

export async function listRecentNotifications(filter: { status?: 'pending' | 'sent' | 'failed' | 'skipped'; limit?: number }) {
  return db
    .select({
      id: notifications.id,
      channel: notifications.channel,
      template: notifications.template,
      recipient: notifications.recipient,
      subject: notifications.subject,
      status: notifications.status,
      attempts: notifications.attempts,
      lastError: notifications.lastError,
      orderId: notifications.orderId,
      sentAt: notifications.sentAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(filter.status ? eq(notifications.status, filter.status) : undefined)
    .orderBy(sql`${notifications.createdAt} DESC`)
    .limit(Math.min(filter.limit ?? 50, 200));
}

export async function notificationStats() {
  const rows = await db
    .select({ status: notifications.status, channel: notifications.channel, value: sql<number>`count(*)::int` })
    .from(notifications)
    .where(sql`${notifications.createdAt} > now() - interval '7 days'`)
    .groupBy(notifications.status, notifications.channel);
  return rows;
}
