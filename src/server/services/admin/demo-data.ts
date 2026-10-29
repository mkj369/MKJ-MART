import 'server-only';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, type Transaction } from '@/server/db';
import {
  categories,
  collectionProducts,
  collections,
  couponRedemptions,
  coupons,
  notifications,
  orderItems,
  orders,
  products,
  supportRequests,
  users,
} from '@/server/db/schema';
import { conflict } from '@/server/errors';
import { log } from '@/server/logger';

type DemoTable = typeof users | typeof products | typeof categories | typeof collections | typeof coupons | typeof orders | typeof supportRequests;

/** Counts of records flagged `is_demo` (created by `npm run db:seed -- --demo`). */
export async function getDemoDataSummary() {
  const countDemo = async (table: DemoTable) => {
    const [row] = await db.select({ value: sql<number>`count(*)::int` }).from(table).where(eq(table.isDemo, true));
    return row?.value ?? 0;
  };
  const [u, p, c, col, cp, o, sr] = await Promise.all([
    countDemo(users),
    countDemo(products),
    countDemo(categories),
    countDemo(collections),
    countDemo(coupons),
    countDemo(orders),
    countDemo(supportRequests),
  ]);
  return { users: u, products: p, categories: c, collections: col, coupons: cp, orders: o, supportRequests: sr, total: u + p + c + col + cp + o + sr };
}

export type PurgeResult = {
  orders: number;
  products: number;
  collections: number;
  coupons: number;
  categories: number;
  users: number;
  supportRequests: number;
  /** Demo records that real data depends on. They are KEPT (unpublished/disabled) and un-flagged. */
  kept: { products: string[]; coupons: string[]; collections: string[]; categories: string[]; users: string[] };
};

const ids = <T extends { id: string }>(rows: T[]) => rows.map((r) => r.id);

/**
 * Removes demo-flagged records so the store can go live with real data only — without ever
 * deleting or altering a real record:
 *  - only orders flagged demo are deleted; real orders and their history are untouched;
 *  - demo products sold in real orders are kept (archived) so the real orders' stock ledger survives;
 *  - demo coupons redeemed by real orders are kept (deactivated) so redemption history survives,
 *    and real coupons' usage counters are corrected for deleted demo orders;
 *  - demo collections curated with real products, and demo categories used by real products or
 *    holding real sub-categories, are kept;
 *  - demo accounts that placed real orders are kept but blocked.
 * Kept records lose their demo flag (they are now part of the real history) and are reported.
 * Must be run by a real (non-demo) administrator so nobody is locked out.
 */
export async function purgeDemoData(actorId: string): Promise<PurgeResult> {
  const result = await db.transaction(async (tx) => {
    const [actor] = await tx.select({ isDemo: users.isDemo }).from(users).where(eq(users.id, actorId)).limit(1);
    if (!actor || actor.isDemo) {
      throw conflict(
        'Sign in with your own administrator account (create one with `npm run admin:create`) before removing demo data — demo accounts are deleted too.',
        'DEMO_ACTOR',
      );
    }
    const kept: PurgeResult['kept'] = { products: [], coupons: [], collections: [], categories: [], users: [] };

    // 1) Orders --------------------------------------------------------------------------------
    const demoOrders = ids(await tx.select({ id: orders.id }).from(orders).where(eq(orders.isDemo, true)));
    if (demoOrders.length) {
      // Real coupons redeemed by demo orders: give the usage back before the redemptions disappear.
      const usage = await tx
        .select({ couponId: couponRedemptions.couponId, uses: sql<number>`count(*)::int` })
        .from(couponRedemptions)
        .innerJoin(coupons, eq(coupons.id, couponRedemptions.couponId))
        .where(and(inArray(couponRedemptions.orderId, demoOrders), eq(coupons.isDemo, false)))
        .groupBy(couponRedemptions.couponId);
      for (const u of usage) {
        await tx
          .update(coupons)
          .set({ usedCount: sql`greatest(${coupons.usedCount} - ${u.uses}, 0)` })
          .where(eq(coupons.id, u.couponId));
      }
      await tx.delete(notifications).where(inArray(notifications.orderId, demoOrders));
      await tx.delete(orders).where(inArray(orders.id, demoOrders));
    }

    // 2) Products ------------------------------------------------------------------------------
    const demoProducts = await tx.select({ id: products.id, name: products.name }).from(products).where(eq(products.isDemo, true));
    const soldForReal = new Set(
      demoProducts.length
        ? (
            await tx
              .selectDistinct({ id: orderItems.productId })
              .from(orderItems)
              .where(inArray(orderItems.productId, ids(demoProducts)))
          ).map((r) => r.id)
        : [],
    );
    const keepProducts = demoProducts.filter((p) => soldForReal.has(p.id));
    const dropProducts = demoProducts.filter((p) => !soldForReal.has(p.id));
    if (keepProducts.length) {
      await tx.update(products).set({ isDemo: false, status: 'archived', isFeatured: false }).where(inArray(products.id, ids(keepProducts)));
      kept.products = keepProducts.map((p) => p.name);
    }
    if (dropProducts.length) await tx.delete(products).where(inArray(products.id, ids(dropProducts)));

    // 3) Collections ---------------------------------------------------------------------------
    const demoCollections = await tx.select({ id: collections.id, name: collections.name }).from(collections).where(eq(collections.isDemo, true));
    const curatedWithReal = new Set(
      demoCollections.length
        ? (
            await tx
              .selectDistinct({ id: collectionProducts.collectionId })
              .from(collectionProducts)
              .innerJoin(products, eq(products.id, collectionProducts.productId))
              .where(and(inArray(collectionProducts.collectionId, ids(demoCollections)), eq(products.isDemo, false)))
          ).map((r) => r.id)
        : [],
    );
    const keepCollections = demoCollections.filter((c) => curatedWithReal.has(c.id));
    const dropCollections = demoCollections.filter((c) => !curatedWithReal.has(c.id));
    if (keepCollections.length) {
      await tx.update(collections).set({ isDemo: false }).where(inArray(collections.id, ids(keepCollections)));
      kept.collections = keepCollections.map((c) => c.name);
    }
    if (dropCollections.length) await tx.delete(collections).where(inArray(collections.id, ids(dropCollections)));

    // 4) Coupons -------------------------------------------------------------------------------
    const demoCoupons = await tx.select({ id: coupons.id, code: coupons.code }).from(coupons).where(eq(coupons.isDemo, true));
    const redeemedForReal = new Set(
      demoCoupons.length
        ? (
            await tx
              .selectDistinct({ id: couponRedemptions.couponId })
              .from(couponRedemptions)
              .where(inArray(couponRedemptions.couponId, ids(demoCoupons)))
          ).map((r) => r.id)
        : [],
    );
    const keepCoupons = demoCoupons.filter((c) => redeemedForReal.has(c.id));
    const dropCoupons = demoCoupons.filter((c) => !redeemedForReal.has(c.id));
    if (keepCoupons.length) {
      await tx.update(coupons).set({ isDemo: false, isActive: false }).where(inArray(coupons.id, ids(keepCoupons)));
      kept.coupons = keepCoupons.map((c) => c.code);
    }
    if (dropCoupons.length) await tx.delete(coupons).where(inArray(coupons.id, ids(dropCoupons)));

    // 5) Categories ----------------------------------------------------------------------------
    const categoryResult = await purgeDemoCategories(tx);
    kept.categories = categoryResult.kept;

    // 6) Support requests & accounts --------------------------------------------------------------
    const deletedSupport = await tx.delete(supportRequests).where(eq(supportRequests.isDemo, true)).returning({ id: supportRequests.id });

    const demoUsers = await tx.select({ id: users.id, email: users.email }).from(users).where(eq(users.isDemo, true));
    const withRealOrders = new Set(
      demoUsers.length
        ? (await tx.selectDistinct({ id: orders.userId }).from(orders).where(inArray(orders.userId, ids(demoUsers)))).map((r) => r.id)
        : [],
    );
    const keepUsers = demoUsers.filter((u) => withRealOrders.has(u.id));
    const dropUsers = demoUsers.filter((u) => !withRealOrders.has(u.id));
    if (keepUsers.length) {
      await tx.update(users).set({ isDemo: false, status: 'blocked' }).where(inArray(users.id, ids(keepUsers)));
      kept.users = keepUsers.map((u) => u.email);
    }
    if (dropUsers.length) {
      await tx.delete(notifications).where(inArray(notifications.userId, ids(dropUsers)));
      await tx.delete(users).where(inArray(users.id, ids(dropUsers)));
    }

    return {
      orders: demoOrders.length,
      products: dropProducts.length,
      collections: dropCollections.length,
      coupons: dropCoupons.length,
      categories: categoryResult.deleted,
      users: dropUsers.length,
      supportRequests: deletedSupport.length,
      kept,
    };
  });
  log.info('demo_data.purged', { actorId, ...result });
  return result;
}

/** Deletes demo categories bottom-up, keeping any that a real product or real sub-category needs. */
async function purgeDemoCategories(tx: Transaction): Promise<{ deleted: number; kept: string[] }> {
  const all = await tx.select({ id: categories.id, name: categories.name, parentId: categories.parentId, isDemo: categories.isDemo }).from(categories);
  const used = new Set(
    (await tx.selectDistinct({ id: products.categoryId }).from(products)).map((r) => r.id).filter((id): id is string => !!id),
  );
  // A category must stay if it is real, used by any remaining product, or is an ancestor of one that stays.
  const keep = new Set<string>(all.filter((c) => !c.isDemo || used.has(c.id)).map((c) => c.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of all) {
      if (keep.has(c.id) && c.parentId && !keep.has(c.parentId)) {
        keep.add(c.parentId);
        changed = true;
      }
    }
  }
  const drop = all.filter((c) => c.isDemo && !keep.has(c.id));
  const keptDemo = all.filter((c) => c.isDemo && keep.has(c.id));
  // Children first so ON DELETE SET NULL never re-parents anything that survives.
  const depth = (c: (typeof all)[number]): number => {
    let d = 0;
    let parent = c.parentId;
    while (parent && d < 20) {
      parent = all.find((x) => x.id === parent)?.parentId ?? null;
      d++;
    }
    return d;
  };
  for (const c of [...drop].sort((a, b) => depth(b) - depth(a))) {
    await tx.delete(categories).where(eq(categories.id, c.id));
  }
  if (keptDemo.length) await tx.update(categories).set({ isDemo: false }).where(inArray(categories.id, ids(keptDemo)));
  return { deleted: drop.length, kept: keptDemo.map((c) => c.name) };
}
