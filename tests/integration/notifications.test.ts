import { createServer, type IncomingMessage, type Server } from 'node:http';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { notifications, orders, sessions, userTokens, users } from '@/server/db/schema';
import { createSession, validateSessionToken } from '@/server/auth/session';
import { dispatchNotifications } from '@/server/notifications';
import { addToCart, ensureCart } from '@/server/services/cart';
import { placeOrder } from '@/server/services/checkout';
import { login, registerCustomer, requestPasswordReset, resetPassword, isResetTokenValid } from '@/server/services/auth';
import { updateOrderStatus } from '@/server/services/admin/orders';
import { clearSettingsCache, updateSetting, DEFAULT_SETTINGS } from '@/server/services/settings';
import { AppError } from '@/server/errors';
import { checkoutInput, createProduct, createUser, seedReferenceData, uid } from '../support/fixtures';
import { startMailServer } from '../support/mail-server';

/**
 * Email is delivered over real SMTP to a local smtp-server; SMS to a local HTTP gateway. Nothing is
 * mocked between the outbox and the network — what is asserted is what a provider would receive.
 */
let mail: Awaited<ReturnType<typeof startMailServer>>;
let smsServer: Server;
const smsRequests: { url: string; headers: IncomingMessage['headers']; body: string }[] = [];
let smsReply = { status: 200, body: '{"response_code":202,"success_message":"SMS Submitted Successfully"}' };
const meta = { ipAddress: '203.0.113.7', userAgent: 'vitest' };

beforeAll(async () => {
  await seedReferenceData();
  mail = await startMailServer({ rejectRecipients: ['bounce@example.test'] });
  mail.useForApp();
  smsServer = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      smsRequests.push({ url: req.url ?? '', headers: req.headers, body });
      res.writeHead(smsReply.status, { 'content-type': 'application/json' });
      res.end(smsReply.body);
    });
  });
  await new Promise<void>((resolve) => smsServer.listen(0, '127.0.0.1', resolve));
  const port = (smsServer.address() as { port: number }).port;
  process.env.SMS_PROVIDER = 'http';
  process.env.SMS_HTTP_URL = `http://127.0.0.1:${port}/api/smsapi`;
  process.env.SMS_HTTP_PARAMS = JSON.stringify({ api_key: '{{api_key}}', senderid: '{{sender_id}}', number: '{{to}}', message: '{{message}}' });
  process.env.SMS_HTTP_API_KEY = 'test-api-key';
  process.env.SMS_SENDER_ID = '8809600000000';
  process.env.SMS_HTTP_SUCCESS_PATTERN = '"response_code":202';
  process.env.APP_URL = 'https://shop.example.com';
});
afterAll(async () => {
  await mail.close();
  await new Promise<void>((resolve) => smsServer.close(() => resolve()));
  for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_REQUIRE_TLS', 'SMTP_FROM', 'SMS_PROVIDER', 'SMS_HTTP_URL', 'SMS_HTTP_PARAMS', 'SMS_HTTP_API_KEY', 'SMS_SENDER_ID', 'SMS_HTTP_SUCCESS_PATTERN', 'APP_URL']) {
    delete process.env[key];
  }
});
beforeEach(async () => {
  clearSettingsCache();
  await updateSetting('notifications', { ...DEFAULT_SETTINGS.notifications, staffEmail: 'orders@shop.example' });
  smsReply = { status: 200, body: '{"response_code":202,"success_message":"SMS Submitted Successfully"}' };
});

async function codOrder(contact: Partial<{ name: string; email: string; phone: string }> = {}) {
  const { variants } = await createProduct({ price: 150_000, stock: { M: 5 } });
  const { cartId } = await ensureCart({ userId: null, guestCartId: null });
  await addToCart(cartId, variants.M!.id, 1);
  const base = checkoutInput();
  return placeOrder({ ...base, contact: { ...base.contact, ...contact } }, { userId: null, cartId });
}
const rowsFor = (orderId: string) => db.select().from(notifications).where(eq(notifications.orderId, orderId));
const inboxFor = (address: string) => mail.inbox.filter((m) => m.to.includes(address));

describe('order notifications (email over SMTP, SMS over HTTP)', () => {
  it('delivers the COD confirmation, a staff alert and an SMS — with customer input escaped', async () => {
    const email = `buyer-${uid()}@example.test`;
    const order = await codOrder({ name: 'Nadia<script>alert(1)</script> Islam', email, phone: '01712345678' });
    const queued = await rowsFor(order.orderId);
    expect(queued.map((n) => n.template).sort()).toEqual(['order_confirmation', 'sms_order_confirmation', 'staff_new_order']);
    expect(queued.every((n) => n.status === 'pending')).toBe(true);
    // The guest's private order link is held only until delivery.
    expect(queued.find((n) => n.template === 'order_confirmation')!.secretPayload).toMatchObject({ orderUrl: expect.stringContaining('?token=') });

    const result = await dispatchNotifications();
    expect(result.sent).toBeGreaterThanOrEqual(3);

    const [customerMail] = inboxFor(email);
    expect(customerMail!.subject).toBe(`Order ${order.orderNumber} received`);
    expect(customerMail!.text).toContain(order.orderNumber);
    expect(customerMail!.text).toContain(`https://shop.example.com/orders/${order.orderNumber}?token=`);
    expect(customerMail!.html).toContain('Nadia');
    expect(customerMail!.html).not.toContain('<script>');
    expect(customerMail!.html).toContain('&lt;script&gt;');
    expect(inboxFor('orders@shop.example').some((m) => m.subject.startsWith(`New order ${order.orderNumber}`))).toBe(true);

    const sms = smsRequests.find((r) => r.body.includes(order.orderNumber))!;
    expect(JSON.parse(sms.body)).toMatchObject({ api_key: 'test-api-key', senderid: '8809600000000', number: '8801712345678' });
    expect(JSON.parse(sms.body).message).toMatch(/^MKJ Store: order MKJ-\d{6}-[A-Z0-9]{5} received \(Tk 1570\)/);

    const after = await rowsFor(order.orderId);
    expect(after.every((n) => n.status === 'sent' && n.sentAt && n.secretPayload === null)).toBe(true);
  });

  it('retries with backoff when the provider rejects, then gives up as failed (never "sent")', async () => {
    const order = await codOrder({ email: 'bounce@example.test' });
    for (let attempt = 1; attempt <= 6; attempt++) {
      await db.update(notifications).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(and(eq(notifications.orderId, order.orderId), eq(notifications.status, 'pending')));
      await dispatchNotifications();
      const [row] = (await rowsFor(order.orderId)).filter((n) => n.template === 'order_confirmation');
      expect(row!.attempts).toBe(attempt);
      if (attempt < 6) {
        expect(row!.status).toBe('pending');
        expect(row!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
        expect(row!.lastError).toMatch(/550|reject|Mailbox/i);
      } else {
        expect(row!.status).toBe('failed');
        expect(row!.secretPayload).toBeNull();
      }
    }
  });

  it('treats an SMS gateway reply without the success marker as a failure', async () => {
    smsReply = { status: 200, body: '{"response_code":1007,"error_message":"Balance Insufficient"}' };
    const order = await codOrder();
    await dispatchNotifications();
    const sms = (await rowsFor(order.orderId)).find((n) => n.template === 'sms_order_confirmation')!;
    expect(sms.status).toBe('pending');
    expect(sms.lastError).toContain('Balance Insufficient');
  });

  it('sends shipped updates with courier and tracking link, by email and SMS', async () => {
    const email = `ship-${uid()}@example.test`;
    const order = await codOrder({ email });
    await dispatchNotifications();
    const { user: admin } = await createUser({ role: 'admin' });
    for (const status of ['confirmed', 'processing'] as const) await updateOrderStatus(order.orderId, { status, note: null, courierName: null, trackingNumber: null }, admin.id);
    await updateOrderStatus(order.orderId, { status: 'shipped', note: null, courierName: 'Pathao Courier', trackingNumber: 'PTH123', trackingUrl: 'https://merchant.pathao.com/tracking?consignment_id=PTH123' }, admin.id);
    await dispatchNotifications();
    const shipped = inboxFor(email).find((m) => m.subject === `Order ${order.orderNumber}: Shipped`)!;
    expect(shipped.text).toContain('Pathao Courier');
    expect(shipped.text).toContain('PTH123');
    expect(shipped.html).toContain('https://merchant.pathao.com/tracking?consignment_id=PTH123');
    expect(smsRequests.some((r) => r.body.includes(`order ${order.orderNumber} has shipped with Pathao Courier, tracking PTH123`))).toBe(true);
  });

  it('never messages demo records and records unconfigured email as "skipped"', async () => {
    const demo = await codOrder({ email: `demo-${uid()}@example.test` });
    await db.update(orders).set({ isDemo: true }).where(eq(orders.id, demo.orderId));
    await dispatchNotifications();
    expect((await rowsFor(demo.orderId)).every((n) => n.status === 'skipped' && n.lastError === 'Demo record — not sent.')).toBe(true);

    const host = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    try {
      const order = await codOrder({ email: `nosmtp-${uid()}@example.test` });
      const confirmation = (await rowsFor(order.orderId)).find((n) => n.template === 'order_confirmation')!;
      expect(confirmation).toMatchObject({ status: 'skipped' });
      expect(confirmation.lastError).toContain('not configured');
      expect(confirmation.secretPayload).toBeNull();
    } finally {
      process.env.SMTP_HOST = host;
    }
  });

  it('welcomes new customers by email', async () => {
    const email = `new-${uid()}@example.test`;
    await registerCustomer({ name: 'Farzana Akter', email, password: 'Sunrise2025', phone: undefined }, meta);
    await dispatchNotifications();
    expect(inboxFor(email).map((m) => m.subject)).toContain('Welcome to MKJ Store');
  });
});

describe('password reset', () => {
  const linkFrom = (text: string) => /https:\/\/shop\.example\.com\/reset-password\?token=([A-Za-z0-9_%-]+)/.exec(text)?.[1];

  it('emails a single-use link, revokes every session and signs the customer in afresh', async () => {
    const { user, password } = await createUser({ role: 'customer', email: `reset-${uid()}@example.test` });
    const oldSession = await createSession(user, meta);
    await requestPasswordReset({ email: user.email }, meta);

    const message = inboxFor(user.email).find((m) => m.subject === 'Reset your MKJ Store password')!;
    const token = decodeURIComponent(linkFrom(message.text)!);
    expect(token.length).toBeGreaterThanOrEqual(40);
    // Only a hash is stored; the outbox row has no link.
    const [stored] = await db.select().from(userTokens).where(eq(userTokens.userId, user.id));
    expect(stored!.tokenHash).not.toContain(token);
    const [audit] = await db.select().from(notifications).where(and(eq(notifications.userId, user.id), eq(notifications.template, 'password_reset')));
    expect(audit!.status).toBe('sent');
    expect(JSON.stringify(audit!.payload)).not.toContain(token);

    expect(await isResetTokenValid(token)).toBe(true);
    const result = await resetPassword({ token, password: 'BrandNew2026' }, meta);
    expect(result.user.id).toBe(user.id);
    expect(await validateSessionToken(oldSession.token)).toBeNull();
    expect((await db.select().from(sessions).where(eq(sessions.userId, user.id))).length).toBe(1);
    await expect(login({ email: user.email, password }, meta)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(login({ email: user.email, password: 'BrandNew2026' }, meta)).resolves.toBeTruthy();

    // Single use.
    expect(await isResetTokenValid(token)).toBe(false);
    await expect(resetPassword({ token, password: 'Another2026x' }, meta)).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' });
    await dispatchNotifications();
    expect(inboxFor(user.email).some((m) => m.subject === 'Your MKJ Store password was changed')).toBe(true);
  });

  it('expires links and invalidates older links when a new one is requested', async () => {
    const { user } = await createUser({ role: 'customer', email: `expire-${uid()}@example.test` });
    await requestPasswordReset({ email: user.email }, meta);
    const first = decodeURIComponent(linkFrom(inboxFor(user.email).at(-1)!.text)!);
    await requestPasswordReset({ email: user.email }, meta);
    const second = decodeURIComponent(linkFrom(inboxFor(user.email).at(-1)!.text)!);
    expect(await isResetTokenValid(first)).toBe(false);
    expect(await isResetTokenValid(second)).toBe(true);
    await db.update(userTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(userTokens.userId, user.id));
    await expect(resetPassword({ token: second, password: 'BrandNew2026' }, meta)).rejects.toBeInstanceOf(AppError);
  });

  it('does not reveal whether an account exists, skips staff accounts and caps emails per address', async () => {
    const before = mail.inbox.length;
    await expect(requestPasswordReset({ email: `nobody-${uid()}@example.test` }, meta)).resolves.toBeUndefined();
    const { user: staff } = await createUser({ role: 'staff', email: `staff-${uid()}@example.test` });
    await expect(requestPasswordReset({ email: staff.email }, meta)).resolves.toBeUndefined();
    expect(mail.inbox.length).toBe(before);

    const { user } = await createUser({ role: 'customer', email: `spam-${uid()}@example.test` });
    for (let i = 0; i < 5; i++) await requestPasswordReset({ email: user.email }, { ...meta, ipAddress: `198.51.100.${i}` });
    expect(inboxFor(user.email)).toHaveLength(3);
    expect((await db.select().from(users).where(eq(users.id, user.id)))[0]!.status).toBe('active');
  });
});
