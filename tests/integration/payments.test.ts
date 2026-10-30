import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/server/db';
import { notifications, orderEvents, orders, paymentTransactions, productVariants } from '@/server/db/schema';
import { addToCart, ensureCart, getCartView } from '@/server/services/cart';
import { getCheckoutQuote, placeOrder } from '@/server/services/checkout';
import { getOrderForViewer } from '@/server/services/orders';
import { expireStalePayments, processSslcommerzCallback, reconcileOrderPayment, retryOnlinePayment } from '@/server/services/payments';
import { getOrderAdmin, updateOrderStatus } from '@/server/services/admin/orders';
import { AppError } from '@/server/errors';
import { checkoutInput, createProduct, createUser, seedReferenceData } from '../support/fixtures';

/**
 * The SSLCommerz HTTP APIs (session init, Validation API, Transaction Query API) are mocked at the
 * fetch level with the response shapes from developer.sslcommerz.com/doc/v4; everything else
 * (orders, stock, callbacks, notifications outbox) runs against the real database.
 */
const STORE_PASSWORD = 'testpass';
type Validation = { status: string; tran_id?: string; amount?: string; currency_type?: string; currency_amount?: string; val_id?: string; risk_level?: string; risk_title?: string };
const okValidation = (tranId: string, amount: string): Validation => ({ status: 'VALID', tran_id: tranId, amount, currency_type: 'BDT', currency_amount: amount, val_id: `VAL-${tranId}`, risk_level: '0' });
let validationResponse: (tranId: string, amount: string) => Validation = okValidation;
let queryResponse: (tranId: string) => { APIConnect: string; no_of_trans_found: number; element: Validation[] } | 'unreachable' = () => ({ APIConnect: 'DONE', no_of_trans_found: 0, element: [] });
let initShouldFail = false;
const amounts = new Map<string, string>();

const md5 = (s: string) => createHash('md5').update(s).digest('hex');
/** Signs a callback exactly like SSLCommerz does (official SSLCOMMERZ_hash_verify algorithm). */
function signed(payload: Record<string, string>, password = STORE_PASSWORD): Record<string, string> {
  const keys = Object.keys(payload).sort();
  const data: Record<string, string> = { ...payload, store_passwd: md5(password) };
  const hashString = Object.keys(data).sort().map((k) => `${k}=${data[k]}`).join('&');
  return { ...payload, verify_key: keys.join(','), verify_sign: md5(hashString) };
}

beforeAll(async () => {
  process.env.SSLCOMMERZ_STORE_ID = 'teststore';
  process.env.SSLCOMMERZ_STORE_PASSWORD = STORE_PASSWORD;
  process.env.APP_URL = 'https://shop.example.com';
  await seedReferenceData();
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/gwprocess/v4/api.php')) {
      if (initShouldFail) return new Response(JSON.stringify({ status: 'FAILED', failedreason: 'Store is not active' }));
      const body = new URLSearchParams(init!.body as URLSearchParams);
      amounts.set(body.get('tran_id')!, body.get('total_amount')!);
      return new Response(JSON.stringify({ status: 'SUCCESS', sessionkey: 'S1', GatewayPageURL: `https://sandbox.sslcommerz.com/gw/${body.get('tran_id')}` }));
    }
    if (url.includes('/validator/api/validationserverAPI.php')) {
      const valId = new URL(url).searchParams.get('val_id')!;
      if (!valId.startsWith('VAL-')) return new Response(JSON.stringify({ status: 'INVALID_TRANSACTION' }));
      const tranId = valId.replace(/^VAL-/, '');
      return new Response(JSON.stringify(validationResponse(tranId, amounts.get(tranId) ?? '0')));
    }
    if (url.includes('/validator/api/merchantTransIDvalidationAPI.php')) {
      const response = queryResponse(new URL(url).searchParams.get('tran_id')!);
      if (response === 'unreachable') throw new TypeError('fetch failed');
      return new Response(JSON.stringify(response));
    }
    throw new Error(`Unexpected fetch ${url}`);
  });
});
afterEach(() => {
  initShouldFail = false;
  validationResponse = okValidation;
  queryResponse = () => ({ APIConnect: 'DONE', no_of_trans_found: 0, element: [] });
});
afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env.SSLCOMMERZ_STORE_ID;
  delete process.env.SSLCOMMERZ_STORE_PASSWORD;
  delete process.env.APP_URL;
});

async function onlineOrder(stock = 5, price = 250_000) {
  const { variants } = await createProduct({ price, stock: { M: stock } });
  const { cartId } = await ensureCart({ userId: null, guestCartId: null });
  await addToCart(cartId, variants.M!.id, 1);
  const result = await placeOrder(checkoutInput({ paymentMethod: 'sslcommerz' }), { userId: null, cartId });
  const [txn] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.orderId, result.orderId));
  return { result, txn: txn!, variantId: variants.M!.id, cartId };
}
const order = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]!;
const txnOf = async (id: string) => (await db.select().from(paymentTransactions).where(eq(paymentTransactions.id, id)))[0]!;
const stock = async (id: string) => (await db.select().from(productVariants).where(eq(productVariants.id, id)))[0]!.stock;
const events = async (orderId: string) => db.select().from(orderEvents).where(eq(orderEvents.orderId, orderId));
const adminId = async () => (await createUser({ role: 'admin' })).user.id;

describe('SSLCommerz: initiation & validation', () => {
  it('creates a pending order, reserves stock and redirects to the gateway', async () => {
    const { result, txn, variantId } = await onlineOrder();
    expect(result.next).toEqual({ type: 'redirect', url: `https://sandbox.sslcommerz.com/gw/${txn.tranId}` });
    expect(await order(result.orderId)).toMatchObject({ status: 'pending', paymentStatus: 'pending', paymentMethod: 'sslcommerz' });
    expect(txn.status).toBe('pending');
    expect(txn.tranId.length).toBeLessThanOrEqual(30); // SSLCommerz limit
    expect(amounts.get(txn.tranId)).toBe('2570.00'); // ৳2,500 + ৳70 Dhaka delivery
    expect(await stock(variantId)).toBe(4);
  });

  it('marks the order paid only after server-side validation, idempotently, and queues the confirmation', async () => {
    const { result, txn } = await onlineOrder();
    const payload = signed({ tran_id: txn.tranId, val_id: `VAL-${txn.tranId}`, status: 'VALID', amount: '2570.00' });
    expect((await processSslcommerzCallback('success', payload)).outcome).toBe('paid');
    expect((await processSslcommerzCallback('ipn', payload)).outcome).toBe('paid');
    expect(await order(result.orderId)).toMatchObject({ paymentStatus: 'paid', status: 'pending' });
    expect((await events(result.orderId)).filter((e) => e.paymentStatus === 'paid')).toHaveLength(1);
    // SMTP is not configured in this test: the confirmation is recorded honestly as "skipped", never "sent".
    const [mail] = await db.select().from(notifications).where(and(eq(notifications.orderId, result.orderId), eq(notifications.template, 'order_confirmation')));
    expect(mail).toMatchObject({ status: 'skipped', channel: 'email' });
    await updateOrderStatus(result.orderId, { status: 'confirmed', note: null, courierName: null, trackingNumber: null }, await adminId());
  });

  it('never marks paid when the validated amount differs (tampering) — order stays reserved, staff alerted', async () => {
    const { result, txn, variantId } = await onlineOrder();
    validationResponse = (tranId) => ({ status: 'VALID', tran_id: tranId, amount: '10.00', currency_type: 'BDT', currency_amount: '10.00', val_id: 'X' });
    const outcome = await processSslcommerzCallback('success', { tran_id: txn.tranId, val_id: `VAL-${txn.tranId}`, status: 'VALID' });
    expect(outcome.outcome).toBe('failed');
    expect((await order(result.orderId)).paymentStatus).not.toBe('paid');
    expect((await txnOf(txn.id)).status).toBe('failed');
    expect(await stock(variantId)).toBe(4);
    expect((await events(result.orderId)).some((e) => !e.visibleToCustomer && e.message.includes('validation rejected'))).toBe(true);
  });

  it('ignores a forged success POST whose val_id the gateway does not know, and success POSTs without a val_id', async () => {
    const { result, txn } = await onlineOrder();
    expect((await processSslcommerzCallback('success', { tran_id: txn.tranId, val_id: 'FORGED', status: 'VALID' })).outcome).toBe('pending');
    expect((await processSslcommerzCallback('success', { tran_id: txn.tranId, status: 'VALID' })).outcome).toBe('pending');
    expect((await order(result.orderId)).paymentStatus).toBe('pending');
    expect((await txnOf(txn.id)).status).toBe('pending');
  });

  it('rejects callbacks whose verify_sign does not match the store password', async () => {
    const { result, txn } = await onlineOrder();
    const forged = signed({ tran_id: txn.tranId, status: 'CANCELLED' }, 'wrong-password');
    expect((await processSslcommerzCallback('cancel', forged)).outcome).toBe('pending');
    expect(await order(result.orderId)).toMatchObject({ status: 'pending', paymentStatus: 'pending' });
  });

  it('flags HIGH RISK payments for manual verification', async () => {
    const { result, txn } = await onlineOrder();
    validationResponse = (tranId, amount) => ({ ...okValidation(tranId, amount), risk_level: '1', risk_title: 'Risky' });
    await processSslcommerzCallback('ipn', { tran_id: txn.tranId, val_id: `VAL-${txn.tranId}`, status: 'VALID' });
    expect((await order(result.orderId)).paymentStatus).toBe('paid');
    expect((await getOrderAdmin(result.orderId)).riskFlagged).toBe(true);
  });

  it('refuses online payment outside the gateway limits (৳10 – ৳5,00,000)', async () => {
    const { variants } = await createProduct({ price: 50_000_100, stock: { M: 1 } }); // ৳5,00,001 (inclusive upper limit is ৳5,00,000)
    const { cartId } = await ensureCart({ userId: null, guestCartId: null });
    await addToCart(cartId, variants.M!.id, 1);
    const quote = await getCheckoutQuote(cartId, { district: 'Dhaka', couponCode: undefined }, { userId: null });
    expect(quote.paymentMethods.find((m) => m.method === 'sslcommerz')).toMatchObject({ available: false });
    const error = await placeOrder(checkoutInput({ paymentMethod: 'sslcommerz' }), { userId: null, cartId }).catch((e: AppError) => e);
    expect((error as AppError).code).toBe('AMOUNT_OUT_OF_RANGE');
    expect(await stock(variants.M!.id)).toBe(1);
  });

  it('ignores callbacks for unknown transactions', async () => {
    expect((await processSslcommerzCallback('ipn', { tran_id: 'NOPE', status: 'VALID', val_id: 'x' })).outcome).toBe('ignored');
  });
});

describe('SSLCommerz: failed, cancelled and abandoned payments', () => {
  it('a signed cancel keeps the order reserved so the customer can retry with a NEW transaction', async () => {
    const { result, txn, variantId } = await onlineOrder();
    const outcome = await processSslcommerzCallback('cancel', signed({ tran_id: txn.tranId, status: 'CANCELLED' }));
    expect(outcome).toMatchObject({ outcome: 'cancelled', orderNumber: result.orderNumber, accessToken: result.accessToken });
    expect(await order(result.orderId)).toMatchObject({ status: 'pending', paymentStatus: 'cancelled' });
    expect((await txnOf(txn.id)).status).toBe('cancelled');
    expect(await stock(variantId)).toBe(4); // still reserved

    const viewer = { token: result.accessToken };
    expect((await getOrderForViewer(result.orderNumber, viewer))!.canRetryPayment).toBe(true);
    const retry = await retryOnlinePayment(result.orderNumber, viewer);
    expect(retry.type).toBe('redirect');
    const txns = await db.select().from(paymentTransactions).where(eq(paymentTransactions.orderId, result.orderId));
    expect(txns).toHaveLength(2);
    const fresh = txns.find((t) => t.id !== txn.id)!;
    expect(fresh).toMatchObject({ status: 'pending' });
    expect(retry).toEqual({ type: 'redirect', url: `https://sandbox.sslcommerz.com/gw/${fresh.tranId}` });
    expect((await order(result.orderId)).paymentStatus).toBe('pending');

    // The retry succeeds.
    await processSslcommerzCallback('ipn', { tran_id: fresh.tranId, val_id: `VAL-${fresh.tranId}`, status: 'VALID' });
    expect((await order(result.orderId)).paymentStatus).toBe('paid');
  });

  it('an UNSIGNED failure notice changes nothing unless the gateway confirms it (reconciliation)', async () => {
    const { result, txn } = await onlineOrder();
    expect((await processSslcommerzCallback('fail', { tran_id: txn.tranId, status: 'FAILED' })).outcome).toBe('failed');
    expect(await order(result.orderId)).toMatchObject({ status: 'pending', paymentStatus: 'pending' });
    expect((await txnOf(txn.id)).status).toBe('pending');
  });

  it('an unsigned failure for a transaction the gateway reports as VALID records the payment', async () => {
    const { result, txn } = await onlineOrder();
    queryResponse = (tranId) => ({ APIConnect: 'DONE', no_of_trans_found: 1, element: [okValidation(tranId, amounts.get(tranId)!)] });
    expect((await processSslcommerzCallback('fail', { tran_id: txn.tranId, status: 'FAILED' })).outcome).toBe('paid');
    expect((await order(result.orderId)).paymentStatus).toBe('paid');
  });

  it('refuses a retry once the payment window has closed', async () => {
    const { result } = await onlineOrder();
    await db.update(orders).set({ paymentExpiresAt: new Date(Date.now() - 1_000) }).where(eq(orders.id, result.orderId));
    await expect(retryOnlinePayment(result.orderNumber, { token: result.accessToken })).rejects.toMatchObject({ code: 'PAYMENT_WINDOW_CLOSED' });
  });

  it('records a duplicate payment for staff to refund instead of silently accepting it', async () => {
    const { result, txn } = await onlineOrder();
    await processSslcommerzCallback('cancel', signed({ tran_id: txn.tranId, status: 'CANCELLED' }));
    await retryOnlinePayment(result.orderNumber, { token: result.accessToken });
    const fresh = (await db.select().from(paymentTransactions).where(eq(paymentTransactions.orderId, result.orderId))).find((t) => t.id !== txn.id)!;
    await processSslcommerzCallback('ipn', { tran_id: fresh.tranId, val_id: `VAL-${fresh.tranId}`, status: 'VALID' });
    // A late success for the first (superseded) attempt arrives too.
    await processSslcommerzCallback('ipn', { tran_id: txn.tranId, val_id: `VAL-${txn.tranId}`, status: 'VALID' });
    expect((await txnOf(txn.id)).status).toBe('succeeded');
    expect((await events(result.orderId)).some((e) => !e.visibleToCustomer && e.message.startsWith('Duplicate payment'))).toBe(true);
    expect((await events(result.orderId)).filter((e) => e.paymentStatus === 'paid')).toHaveLength(1);
  });

  it('blocks fulfilment while payment is outstanding', async () => {
    const { result } = await onlineOrder();
    await expect(updateOrderStatus(result.orderId, { status: 'confirmed', note: null, courierName: null, trackingNumber: null }, await adminId())).rejects.toMatchObject({
      code: 'PAYMENT_REQUIRED',
    });
  });

  it('when the gateway is down at checkout: no order is kept, stock is released and the bag restored', async () => {
    initShouldFail = true;
    const { variants } = await createProduct({ price: 250_000, stock: { M: 5 } });
    const { cartId } = await ensureCart({ userId: null, guestCartId: null });
    await addToCart(cartId, variants.M!.id, 2);
    const error = await placeOrder(checkoutInput({ paymentMethod: 'sslcommerz' }), { userId: null, cartId }).catch((e: AppError) => e);
    expect((error as AppError).code).toBe('PAYMENT_INIT_FAILED');
    expect(await stock(variants.M!.id)).toBe(5);
    expect((await getCartView(cartId)).itemCount).toBe(2);
  });
});

describe('SSLCommerz: expiry & reconciliation job', () => {
  it('checks the gateway before expiring: a payment whose IPN was missed is recorded, not cancelled', async () => {
    const { result, variantId } = await onlineOrder();
    await db.update(orders).set({ paymentExpiresAt: new Date(Date.now() - 60_000) }).where(eq(orders.id, result.orderId));
    queryResponse = (tranId) => ({ APIConnect: 'DONE', no_of_trans_found: 1, element: [okValidation(tranId, amounts.get(tranId)!)] });
    const summary = await expireStalePayments();
    expect(summary.paid).toBeGreaterThanOrEqual(1);
    expect(await order(result.orderId)).toMatchObject({ status: 'pending', paymentStatus: 'paid' });
    expect(await stock(variantId)).toBe(4);
  });

  it('cancels unpaid orders after the window, releases stock, notifies, and flags late payments for review', async () => {
    const { result, txn, variantId } = await onlineOrder();
    await db.update(orders).set({ paymentExpiresAt: new Date(Date.now() - 60_000) }).where(eq(orders.id, result.orderId));
    const summary = await expireStalePayments();
    expect(summary.expired).toBeGreaterThanOrEqual(1);
    expect(await order(result.orderId)).toMatchObject({ status: 'cancelled' });
    expect((await txnOf(txn.id)).status).toBe('expired');
    expect(await stock(variantId)).toBe(5);
    expect((await db.select().from(notifications).where(eq(notifications.orderId, result.orderId))).some((n) => n.template === 'order_cancelled')).toBe(true);
    // The customer completes payment anyway: money is recorded, staff are alerted.
    expect((await processSslcommerzCallback('ipn', { tran_id: txn.tranId, val_id: `VAL-${txn.tranId}`, status: 'VALID' })).outcome).toBe('paid');
    expect(await order(result.orderId)).toMatchObject({ status: 'cancelled', paymentStatus: 'paid' });
    expect((await events(result.orderId)).some((e) => !e.visibleToCustomer && e.message.includes('after the order was cancelled'))).toBe(true);
  });

  it('defers expiry while the gateway is unreachable, then cancels after the grace period', async () => {
    const { result } = await onlineOrder();
    queryResponse = () => 'unreachable';
    await db.update(orders).set({ paymentExpiresAt: new Date(Date.now() - 60_000) }).where(eq(orders.id, result.orderId));
    expect((await expireStalePayments()).deferred).toBeGreaterThanOrEqual(1);
    expect((await order(result.orderId)).status).toBe('pending');
    await db.update(orders).set({ paymentExpiresAt: new Date(Date.now() - 3 * 60 * 60_000) }).where(eq(orders.id, result.orderId));
    await expireStalePayments();
    expect((await order(result.orderId)).status).toBe('cancelled');
  });

  it('lets staff check an order with the gateway on demand', async () => {
    const { result } = await onlineOrder();
    const admin = await adminId();
    expect((await reconcileOrderPayment(result.orderId, admin)).outcome).toBe('unpaid');
    queryResponse = (tranId) => ({ APIConnect: 'DONE', no_of_trans_found: 1, element: [okValidation(tranId, amounts.get(tranId)!)] });
    expect((await reconcileOrderPayment(result.orderId, admin)).outcome).toBe('paid');
    expect((await order(result.orderId)).paymentStatus).toBe('paid');
  });
});
