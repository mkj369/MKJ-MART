import { eq, inArray } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import {
  categories,
  collectionProducts,
  collections,
  couponRedemptions,
  coupons,
  orderItems,
  orders,
  products,
  stockMovements,
  supportRequests,
  users,
} from '@/server/db/schema';
import { createSession, validateSessionToken } from '@/server/auth/session';
import { login } from '@/server/services/auth';
import { addToCart, ensureCart } from '@/server/services/cart';
import { placeOrder } from '@/server/services/checkout';
import { getDemoDataSummary, purgeDemoData } from '@/server/services/admin/demo-data';
import { checkoutInput, createCoupon, createProduct, createUser, seedReferenceData, uid } from '../support/fixtures';

const meta = { ipAddress: '203.0.113.50', userAgent: 'vitest' };

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function buyOnce(variantId: string, options: { userId?: string | null; couponCode?: string } = {}) {
  const { cartId } = await ensureCart({ userId: options.userId ?? null, guestCartId: null });
  await addToCart(cartId, variantId, 1);
  return placeOrder(checkoutInput({ couponCode: options.couponCode }), { userId: options.userId ?? null, cartId });
}

beforeAll(seedReferenceData);

describe('demo accounts in production', () => {
  it('cannot sign in or keep a session unless DEMO_MODE=true', async () => {
    const { user, password } = await createUser({ role: 'admin', email: `demo-admin-${uid()}@mkjmart.demo` });
    await db.update(users).set({ isDemo: true }).where(eq(users.id, user.id));
    const session = await createSession(user, meta);

    await withEnv({ NODE_ENV: 'production', DEMO_MODE: undefined }, async () => {
      await expect(login({ email: user.email, password }, meta, 'admin')).rejects.toMatchObject({ code: 'DEMO_ACCOUNT_DISABLED' });
      expect(await validateSessionToken(session.token)).toBeNull();
    });
    await withEnv({ NODE_ENV: 'production', DEMO_MODE: 'true' }, async () => {
      await expect(login({ email: user.email, password }, meta, 'admin')).resolves.toMatchObject({ user: { id: user.id } });
    });
  });
});

describe('demo data purge never removes real records', () => {
  it('keeps everything real data depends on, un-flags it, and removes the rest', async () => {
    // ── Demo catalogue ──
    const [demoParent] = await db.insert(categories).values({ name: 'Demo Women', slug: `demo-women-${uid()}`, isDemo: true }).returning();
    const [demoLeaf] = await db.insert(categories).values({ name: 'Demo Sarees', slug: `demo-sarees-${uid()}`, parentId: demoParent!.id, isDemo: true }).returning();
    const [realChild] = await db.insert(categories).values({ name: 'Real Kurtis', slug: `real-kurtis-${uid()}`, parentId: demoParent!.id }).returning();
    const soldDemo = await createProduct({ name: 'Demo product sold for real', stock: { M: 5 } });
    const unsoldDemo = await createProduct({ name: 'Demo product never sold', stock: { M: 5 } });
    const real = await createProduct({ name: 'Real product', stock: { M: 5 } });
    await db.update(products).set({ isDemo: true, categoryId: demoLeaf!.id }).where(inArray(products.id, [soldDemo.product.id, unsoldDemo.product.id]));
    await db.update(products).set({ categoryId: realChild!.id }).where(eq(products.id, real.product.id));
    const [demoCollection] = await db.insert(collections).values({ name: 'Demo edit', slug: `demo-edit-${uid()}`, isDemo: true }).returning();
    const [demoOnlyCollection] = await db.insert(collections).values({ name: 'Demo only', slug: `demo-only-${uid()}`, isDemo: true }).returning();
    await db.insert(collectionProducts).values([
      { collectionId: demoCollection!.id, productId: real.product.id },
      { collectionId: demoOnlyCollection!.id, productId: unsoldDemo.product.id },
    ]);
    const demoCoupon = await createCoupon({ code: `DEMO${uid()}`.toUpperCase(), type: 'fixed', value: 1_000, isDemo: true });
    const unusedDemoCoupon = await createCoupon({ code: `DEMOX${uid()}`.toUpperCase(), type: 'fixed', value: 1_000, isDemo: true });
    const realCoupon = await createCoupon({ code: `REAL${uid()}`.toUpperCase(), type: 'fixed', value: 1_000 });

    // ── Accounts ──
    const { user: demoShopper } = await createUser({ email: `shopper-${uid()}@mkjmart.demo` });
    const { user: demoIdle } = await createUser({ email: `idle-${uid()}@mkjmart.demo` });
    const { user: realAdmin } = await createUser({ role: 'admin' });
    const { user: demoAdmin } = await createUser({ role: 'admin', email: `admin-${uid()}@mkjmart.demo` });
    await db.update(users).set({ isDemo: true }).where(eq(users.id, demoAdmin.id));

    // ── Orders ──
    // A REAL order (not flagged) that bought a demo product with a demo coupon, linked to an account
    // that is flagged demo. Live checkouts by demo accounts are demo orders themselves (see
    // checkout.test.ts), so the order is placed first and the account flagged afterwards, as in
    // older data or an account re-flagged later; the purge must still keep both.
    const realOrder = await buyOnce(soldDemo.variants.M!.id, { userId: demoShopper.id, couponCode: demoCoupon.code });
    await db.update(users).set({ isDemo: true }).where(inArray(users.id, [demoShopper.id, demoIdle.id]));
    // A DEMO order that used a REAL coupon.
    const demoOrder = await buyOnce(real.variants.M!.id, { couponCode: realCoupon.code });
    await db.update(orders).set({ isDemo: true }).where(eq(orders.id, demoOrder.orderId));
    expect((await db.select().from(coupons).where(eq(coupons.id, realCoupon.id)))[0]!.usedCount).toBe(1);
    await db.insert(supportRequests).values({ ticketNumber: `SR-${uid()}`.toUpperCase(), name: 'Demo', email: 'x@mkjmart.demo', topic: 'other', message: 'demo ticket', isDemo: true });
    const realLedgerBefore = await db.select().from(stockMovements).where(eq(stockMovements.orderId, realOrder.orderId));
    expect(realLedgerBefore.length).toBeGreaterThan(0);

    // A demo administrator may not run the purge (they would delete themselves).
    await expect(purgeDemoData(demoAdmin.id)).rejects.toMatchObject({ code: 'DEMO_ACTOR' });

    const result = await purgeDemoData(realAdmin.id);

    // Real order: untouched, with items, coupon redemption and stock ledger intact.
    const [orderAfter] = await db.select().from(orders).where(eq(orders.id, realOrder.orderId));
    expect(orderAfter).toMatchObject({ isDemo: false, userId: demoShopper.id });
    expect((await db.select().from(orderItems).where(eq(orderItems.orderId, realOrder.orderId)))[0]!.productId).toBe(soldDemo.product.id);
    expect(await db.select().from(couponRedemptions).where(eq(couponRedemptions.orderId, realOrder.orderId))).toHaveLength(1);
    expect(await db.select().from(stockMovements).where(eq(stockMovements.orderId, realOrder.orderId))).toHaveLength(realLedgerBefore.length);

    // Kept (un-flagged) because real data depends on them.
    expect((await db.select().from(products).where(eq(products.id, soldDemo.product.id)))[0]).toMatchObject({ isDemo: false, status: 'archived' });
    expect((await db.select().from(coupons).where(eq(coupons.id, demoCoupon.id)))[0]).toMatchObject({ isDemo: false, isActive: false });
    expect((await db.select().from(collections).where(eq(collections.id, demoCollection!.id)))[0]).toMatchObject({ isDemo: false });
    expect((await db.select().from(users).where(eq(users.id, demoShopper.id)))[0]).toMatchObject({ isDemo: false, status: 'blocked' });
    expect((await db.select().from(categories).where(eq(categories.id, realChild!.id)))[0]!.parentId).toBe(demoParent!.id);
    expect(result.kept.products).toEqual(['Demo product sold for real']);

    // Removed.
    expect(await db.select().from(orders).where(eq(orders.id, demoOrder.orderId))).toHaveLength(0);
    expect(await db.select().from(products).where(eq(products.id, unsoldDemo.product.id))).toHaveLength(0);
    expect(await db.select().from(coupons).where(eq(coupons.id, unusedDemoCoupon.id))).toHaveLength(0);
    expect(await db.select().from(collections).where(eq(collections.id, demoOnlyCollection!.id))).toHaveLength(0);
    expect(await db.select().from(users).where(inArray(users.id, [demoIdle.id, demoAdmin.id]))).toHaveLength(0);
    // The real coupon gets back the use consumed by the deleted demo order.
    expect((await db.select().from(coupons).where(eq(coupons.id, realCoupon.id)))[0]!.usedCount).toBe(0);
    // Real records untouched.
    expect(await db.select().from(products).where(eq(products.id, real.product.id))).toHaveLength(1);
    expect((await getDemoDataSummary()).total).toBe(0);
  });
});
