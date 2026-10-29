import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { orders, productVariants, returnRequests, stockMovements, supportRequests } from '@/server/db/schema';
import { addToCart, ensureCart } from '@/server/services/cart';
import { placeOrder } from '@/server/services/checkout';
import { getOrderForViewer } from '@/server/services/orders';
import { recordRefund, updateOrderStatus } from '@/server/services/admin/orders';
import { createReturnRequest, decideReturn, getReturnAdmin, withdrawReturnRequest } from '@/server/services/returns';
import { createSupportRequest } from '@/server/services/support';
import { clearSettingsCache, DEFAULT_SETTINGS, updateSetting } from '@/server/services/settings';
import { checkoutInput, createProduct, createUser, seedReferenceData } from '../support/fixtures';

let adminId: string;
let ipCounter = 0;
const meta = () => ({ ipAddress: `192.0.2.${++ipCounter % 250}` });

beforeAll(async () => {
  await seedReferenceData();
  adminId = (await createUser({ role: 'admin' })).user.id;
});
beforeEach(async () => {
  clearSettingsCache();
  await updateSetting('returns', DEFAULT_SETTINGS.returns);
});

/** A delivered COD order with two lines: 2 × A and 1 × B. */
async function deliveredOrder(userId: string | null = null) {
  const a = await createProduct({ price: 200_000, stock: { M: 10 } });
  const b = await createProduct({ price: 100_000, stock: { M: 10 } });
  const { cartId } = await ensureCart({ userId, guestCartId: null });
  await addToCart(cartId, a.variants.M!.id, 2);
  await addToCart(cartId, b.variants.M!.id, 1);
  const placed = await placeOrder(checkoutInput(), { userId, cartId });
  for (const status of ['confirmed', 'processing'] as const) await updateOrderStatus(placed.orderId, { status, note: null, courierName: null, trackingNumber: null }, adminId);
  await updateOrderStatus(placed.orderId, { status: 'shipped', note: null, courierName: 'Steadfast Courier', trackingNumber: 'SF1' }, adminId);
  await updateOrderStatus(placed.orderId, { status: 'delivered', note: null, courierName: null, trackingNumber: null }, adminId);
  const viewer = { token: placed.accessToken, userId };
  const detail = (await getOrderForViewer(placed.orderNumber, viewer))!;
  const lineA = detail.items.find((i) => i.quantity === 2)!;
  const lineB = detail.items.find((i) => i.quantity === 1)!;
  return { placed, viewer, detail, lineA, lineB, variantA: a.variants.M!.id, variantB: b.variants.M!.id };
}
const stockOf = async (variantId: string) => (await db.select().from(productVariants).where(eq(productVariants.id, variantId)))[0]!.stock;
const orderOf = async (id: string) => (await db.select().from(orders).where(eq(orders.id, id)))[0]!;

describe('returns & refunds', () => {
  it('runs request → approve → receive (restock with ledger) → refund, and closes the order when everything is back', async () => {
    const o = await deliveredOrder();
    expect(o.detail.returnEligibility).toMatchObject({ eligible: true });
    expect(await stockOf(o.variantA)).toBe(8);

    const first = await createReturnRequest(o.placed.orderNumber, o.viewer, { items: [{ orderItemId: o.lineA.id, quantity: 1 }], reason: 'size_fit', note: 'Too small', token: undefined }, meta());
    expect(first.requestNumber).toMatch(/^RT-[A-Z0-9]{7}$/);
    // One open request at a time.
    await expect(
      createReturnRequest(o.placed.orderNumber, o.viewer, { items: [{ orderItemId: o.lineB.id, quantity: 1 }], reason: 'damaged', note: null, token: undefined }, meta()),
    ).rejects.toMatchObject({ code: 'RETURN_NOT_ALLOWED' });

    const [request] = await db.select().from(returnRequests).where(eq(returnRequests.requestNumber, first.requestNumber));
    await expect(decideReturn(request!.id, { action: 'receive', restock: true, customerNote: null, adminNote: null }, adminId)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    await decideReturn(request!.id, { action: 'approve', restock: true, customerNote: 'Courier pickup tomorrow', adminNote: null }, adminId);
    await decideReturn(request!.id, { action: 'receive', restock: true, customerNote: null, adminNote: 'Unworn' }, adminId);
    expect(await stockOf(o.variantA)).toBe(9);
    const ledger = await db.select().from(stockMovements).where(eq(stockMovements.variantId, o.variantA));
    expect(ledger.some((m) => m.reason === 'return' && m.delta === 1 && m.note?.includes(first.requestNumber))).toBe(true);
    expect((await orderOf(o.placed.orderId)).status).toBe('delivered'); // partial return

    const view = await getReturnAdmin(request!.id);
    expect(view.suggestedRefund).toBe(200_000);
    await recordRefund(o.placed.orderId, { amount: view.suggestedRefund, method: 'bkash', reference: 'TRX9A1', note: null, returnRequestId: request!.id, confirmPaidOutside: true }, adminId);
    expect(await orderOf(o.placed.orderId)).toMatchObject({ paymentStatus: 'partially_refunded', refundedTotal: 200_000 });
    expect((await db.select().from(returnRequests).where(eq(returnRequests.id, request!.id)))[0]!.status).toBe('refunded');

    // Return the rest; the order becomes "returned" once every unit is back.
    const second = await createReturnRequest(
      o.placed.orderNumber,
      o.viewer,
      { items: [{ orderItemId: o.lineA.id, quantity: 1 }, { orderItemId: o.lineB.id, quantity: 1 }], reason: 'changed_mind', note: null, token: undefined },
      meta(),
    );
    const [r2] = await db.select().from(returnRequests).where(eq(returnRequests.requestNumber, second.requestNumber));
    await decideReturn(r2!.id, { action: 'approve', restock: true, customerNote: null, adminNote: null }, adminId);
    await decideReturn(r2!.id, { action: 'receive', restock: false, customerNote: 'One item arrived damaged', adminNote: null }, adminId);
    expect(await stockOf(o.variantB)).toBe(9); // not restocked
    expect((await orderOf(o.placed.orderId)).status).toBe('returned');
    const detail = (await getOrderForViewer(o.placed.orderNumber, o.viewer))!;
    expect(detail.returnEligibility?.eligible).toBe(false);
  });

  it('rejects over-claiming, foreign items, closed windows and strangers', async () => {
    const o = await deliveredOrder();
    await expect(
      createReturnRequest(o.placed.orderNumber, o.viewer, { items: [{ orderItemId: o.lineB.id, quantity: 2 }], reason: 'damaged', note: null, token: undefined }, meta()),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const other = await deliveredOrder();
    await expect(
      createReturnRequest(o.placed.orderNumber, o.viewer, { items: [{ orderItemId: other.lineB.id, quantity: 1 }], reason: 'damaged', note: null, token: undefined }, meta()),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      createReturnRequest(o.placed.orderNumber, { token: 'not-the-token' }, { items: [{ orderItemId: o.lineB.id, quantity: 1 }], reason: 'damaged', note: null, token: undefined }, meta()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await db.update(orders).set({ deliveredAt: new Date(Date.now() - 8 * 86_400_000) }).where(eq(orders.id, o.placed.orderId));
    await expect(
      createReturnRequest(o.placed.orderNumber, o.viewer, { items: [{ orderItemId: o.lineB.id, quantity: 1 }], reason: 'damaged', note: null, token: undefined }, meta()),
    ).rejects.toMatchObject({ code: 'RETURN_NOT_ALLOWED' });
    await updateSetting('returns', { ...DEFAULT_SETTINGS.returns, windowDays: 14 });
    await expect(
      createReturnRequest(o.placed.orderNumber, o.viewer, { items: [{ orderItemId: o.lineB.id, quantity: 1 }], reason: 'damaged', note: null, token: undefined }, meta()),
    ).resolves.toMatchObject({ requestNumber: expect.any(String) });
  });

  it('only delivered orders are returnable; customers may withdraw until staff act; declines need a reason', async () => {
    const { variants } = await createProduct({ stock: { M: 3 } });
    const { cartId } = await ensureCart({ userId: null, guestCartId: null });
    await addToCart(cartId, variants.M!.id, 1);
    const pending = await placeOrder(checkoutInput(), { userId: null, cartId });
    const pendingDetail = (await getOrderForViewer(pending.orderNumber, { token: pending.accessToken }))!;
    expect(pendingDetail.returnEligibility).toMatchObject({ eligible: false, reason: null });

    const o = await deliveredOrder();
    const r = await createReturnRequest(o.placed.orderNumber, o.viewer, { items: [{ orderItemId: o.lineB.id, quantity: 1 }], reason: 'quality', note: null, token: undefined }, meta());
    await withdrawReturnRequest(o.placed.orderNumber, r.requestNumber, o.viewer);
    const r2 = await createReturnRequest(o.placed.orderNumber, o.viewer, { items: [{ orderItemId: o.lineB.id, quantity: 1 }], reason: 'quality', note: null, token: undefined }, meta());
    const [row] = await db.select().from(returnRequests).where(eq(returnRequests.requestNumber, r2.requestNumber));
    await expect(decideReturn(row!.id, { action: 'reject', restock: true, customerNote: null, adminNote: null }, adminId)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await decideReturn(row!.id, { action: 'reject', restock: true, customerNote: 'Worn items cannot be returned.', adminNote: null }, adminId);
    await expect(withdrawReturnRequest(o.placed.orderNumber, r2.requestNumber, o.viewer)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' });
    const detail = (await getOrderForViewer(o.placed.orderNumber, o.viewer))!;
    expect(detail.returns.map((x) => x.status)).toEqual(['cancelled', 'rejected']);
    expect(detail.returns[1]!.resolutionNote).toBe('Worn items cannot be returned.');
  });

  it('blocks the direct "returned" transition while a return request exists (no double restock)', async () => {
    const o = await deliveredOrder();
    await createReturnRequest(o.placed.orderNumber, o.viewer, { items: [{ orderItemId: o.lineB.id, quantity: 1 }], reason: 'damaged', note: null, token: undefined }, meta());
    await expect(updateOrderStatus(o.placed.orderId, { status: 'returned', note: null, courierName: null, trackingNumber: null }, adminId)).rejects.toMatchObject({
      code: 'RETURN_IN_PROGRESS',
    });
  });
});

describe('support requests', () => {
  const input = { name: 'Rumana Haque', email: 'rumana@example.test', phone: undefined, orderNumber: null, topic: 'delivery' as const, message: 'When will my parcel arrive in Sylhet?' };

  it('stores a ticket with a reference, and silently drops honeypot submissions', async () => {
    const { ticketNumber } = await createSupportRequest(input, { ipAddress: '198.18.0.1', userId: null });
    expect(ticketNumber).toMatch(/^SR-[A-Z0-9]{7}$/);
    const [row] = await db.select().from(supportRequests).where(eq(supportRequests.ticketNumber, ticketNumber));
    expect(row).toMatchObject({ status: 'open', topic: 'delivery', email: 'rumana@example.test' });

    const bot = await createSupportRequest({ ...input, website: 'https://spam.example' }, { ipAddress: '198.18.0.2', userId: null });
    expect((await db.select().from(supportRequests).where(eq(supportRequests.ticketNumber, bot.ticketNumber))).length).toBe(0);
  });

  it('rate-limits submissions per IP', async () => {
    for (let i = 0; i < 5; i++) await createSupportRequest(input, { ipAddress: '198.18.0.9', userId: null });
    await expect(createSupportRequest(input, { ipAddress: '198.18.0.9', userId: null })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });
});
