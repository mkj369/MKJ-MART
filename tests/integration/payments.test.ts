import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/server/db';
import { cartItems, orderEvents, orders, paymentTransactions, productVariants } from '@/server/db/schema';
import { addToCart, ensureCart, getCartView } from '@/server/services/cart';
import { placeOrder } from '@/server/services/checkout';
import { expireStalePayments, processSslcommerzCallback } from '@/server/services/payments';
import { updateOrderStatus } from '@/server/services/admin/orders';
import { AppError } from '@/server/errors';
import { checkoutInput, createProduct, createUser, seedReferenceData } from '../support/fixtures';

/**
 * The SSLCommerz HTTP API is mocked at the fetch level; everything else (orders, stock, events,
 * callbacks) runs against the real database.
 */
type Validation = { status: string; tran_id?: string; amount?: string; currency_type?: string; currency_amount?: string; val_id?: string; risk_level?: string };
let validationResponse: (tranId: string, amount: string) => Validation = (tranId, amount) => ({ status: 'VALID', tran_id: tranId, amount, currency_type: 'BDT', currency_amount: amount, val_id: 'VAL1', risk_level: '0' });
let initShouldFail = false;
const amounts = new Map<string, string>();

beforeAll(async () => {
  process.env.SSLCOMMERZ_STORE_ID = 'teststore';
  process.env.SSLCOMMERZ_STORE_PASSWORD = 'testpass';
  process.env.APP_URL = 'https://shop.example.com';
  await seedReferenceData();
});
afterAll(() => {
  delete process.env.SSLCOMMERZ_STORE_ID;
  delete process.env.SSLCOMMERZ_STORE_PASSWORD;
  delete process.env.APP_URL;
});

beforeAll(() => {
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
      const tranId = valId.replace(/^VAL-/, '');
      return new Response(JSON.stringify(validationResponse(tranId, amounts.get(tranId) ?? '0')));
    }
    throw new Error(`Unexpected fetch ${url}`);
  });
});
afterEach(() => {
  initShouldFail = false;
  validationResponse = (tranId, amount) => ({ status: 'VALID', tran_id: tranId, amount, currency_type: 'BDT', currency_amount: amount, val_id: 'VAL1', risk_level: '0' });
});
afterAll(() => vi.unstubAllGlobals());

async function onlineOrder(stock = 5) {
  const { variants } = await createProduct({ price: 250_000, stock: { M: stock } });
  const { cartId } = await ensureCart({ userId: null, guestCartId: null });
  await addToCart(cartId, variants.M!.id, 1);
  const result = await placeOrder(checkoutInput({ paymentMethod: 'sslcommerz' }), { userId: null, cartId });
  const [txn] = await db.select().from(paymentTransactions).where(eq(paymentTransactions.orderId, result.orderId));
  return { result, txn: txn!, variantId: variants.M!.id, cartId };
}
const order = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]!;
const stock = async (id: string) => (await db.select().from(productVariants).where(eq(productVariants.id, id)))[0]!.stock;

describe('SSLCommerz online payment', () => {
  it('creates a pending order, reserves stock and redirects to the gateway', async () => {
    const { result, txn, variantId } = await onlineOrder();
    expect(result.next).toEqual({ type: 'redirect', url: `https://sandbox.sslcommerz.com/gw/${txn.tranId}` });
    expect(await order(result.orderId)).toMatchObject({ status: 'pending', paymentStatus: 'pending', paymentMethod: 'sslcommerz' });
    expect(txn.status).toBe('pending');
    expect(amounts.get(txn.tranId)).toBe('2570.00'); // ৳2,500 + ৳70 Dhaka delivery
    expect(await stock(variantId)).toBe(4);
  });

  it('marks the order paid only after server-side validation, idempotently', async () => {
    const { result, txn } = await onlineOrder();
    const payload = { tran_id: txn.tranId, val_id: `VAL-${txn.tranId}`, status: 'VALID', amount: '2570.00' };
    expect((await processSslcommerzCallback('success', payload)).outcome).toBe('paid');
    expect((await processSslcommerzCallback('ipn', payload)).outcome).toBe('paid');
    expect(await order(result.orderId)).toMatchObject({ paymentStatus: 'paid', status: 'pending' });
    const paidEvents = (await db.select().from(orderEvents).where(eq(orderEvents.orderId, result.orderId))).filter((e) => e.paymentStatus === 'paid');
    expect(paidEvents).toHaveLength(1);
    // Paid online orders can now be fulfilled.
    const { user: admin } = await createUser({ role: 'admin' });
    await updateOrderStatus(result.orderId, { status: 'confirmed', note: null, courierName: null, trackingNumber: null }, admin.id);
  });

  it('does not trust a forged success callback whose validation amount differs', async () => {
    const { result, txn, variantId } = await onlineOrder();
    validationResponse = (tranId) => ({ status: 'VALID', tran_id: tranId, amount: '10.00', currency_type: 'BDT', currency_amount: '10.00', val_id: 'X' });
    const outcome = await processSslcommerzCallback('success', { tran_id: txn.tranId, val_id: `VAL-${txn.tranId}`, status: 'VALID' });
    expect(outcome.outcome).toBe('failed');
    expect(await order(result.orderId)).toMatchObject({ status: 'cancelled', paymentStatus: 'failed' });
    expect(await stock(variantId)).toBe(5);
  });

  it('a success POST without a validation id never marks an order paid', async () => {
    const { result, txn } = await onlineOrder();
    expect((await processSslcommerzCallback('success', { tran_id: txn.tranId, status: 'VALID' })).outcome).toBe('pending');
    expect((await order(result.orderId)).paymentStatus).toBe('pending');
  });

  it('cancels the order and releases stock when the customer cancels payment', async () => {
    const { result, txn, variantId } = await onlineOrder();
    const outcome = await processSslcommerzCallback('cancel', { tran_id: txn.tranId, status: 'CANCELLED' });
    expect(outcome).toMatchObject({ outcome: 'cancelled', orderNumber: result.orderNumber, accessToken: result.accessToken });
    expect(await order(result.orderId)).toMatchObject({ status: 'cancelled', paymentStatus: 'cancelled' });
    expect(await stock(variantId)).toBe(5);
  });

  it('blocks fulfilment while payment is outstanding', async () => {
    const { result } = await onlineOrder();
    const { user: admin } = await createUser({ role: 'admin' });
    await expect(updateOrderStatus(result.orderId, { status: 'confirmed', note: null, courierName: null, trackingNumber: null }, admin.id)).rejects.toMatchObject({ code: 'PAYMENT_REQUIRED' });
  });

  it('when the gateway is down: no order is kept, stock is released and the bag restored', async () => {
    initShouldFail = true;
    const { variants } = await createProduct({ price: 250_000, stock: { M: 5 } });
    const { cartId } = await ensureCart({ userId: null, guestCartId: null });
    await addToCart(cartId, variants.M!.id, 2);
    const error = await placeOrder(checkoutInput({ paymentMethod: 'sslcommerz' }), { userId: null, cartId }).catch((e: AppError) => e);
    expect((error as AppError).code).toBe('PAYMENT_INIT_FAILED');
    expect(await stock(variants.M!.id)).toBe(5);
    expect((await getCartView(cartId)).itemCount).toBe(2);
    const cancelled = await db.select().from(orders).where(eq(orders.status, 'cancelled'));
    expect(cancelled.some((o) => o.paymentStatus === 'failed')).toBe(true);
  });

  it('expires unpaid orders after the payment window and flags late payments for review', async () => {
    const { result, txn, variantId } = await onlineOrder();
    await db.update(orders).set({ paymentExpiresAt: new Date(Date.now() - 60_000) }).where(eq(orders.id, result.orderId));
    expect(await expireStalePayments()).toBeGreaterThanOrEqual(1);
    expect(await order(result.orderId)).toMatchObject({ status: 'cancelled' });
    expect(await stock(variantId)).toBe(5);
    // The customer completes payment anyway: money is recorded, staff are alerted.
    expect((await processSslcommerzCallback('ipn', { tran_id: txn.tranId, val_id: `VAL-${txn.tranId}`, status: 'VALID' })).outcome).toBe('paid');
    expect(await order(result.orderId)).toMatchObject({ status: 'cancelled', paymentStatus: 'paid' });
    const events = await db.select().from(orderEvents).where(eq(orderEvents.orderId, result.orderId));
    expect(events.some((e) => !e.visibleToCustomer && e.message.includes('Refund the customer or reinstate'))).toBe(true);
  });

  it('ignores callbacks for unknown transactions', async () => {
    expect(await processSslcommerzCallback('success', { tran_id: 'NOPE', val_id: 'X', status: 'VALID' })).toEqual({ outcome: 'ignored', orderNumber: null, accessToken: null });
    expect(await db.select().from(cartItems).limit(1)).toBeDefined();
  });
});
