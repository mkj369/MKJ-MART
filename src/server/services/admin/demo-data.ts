import 'server-only';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { categories, collections, coupons, orders, products, users } from '@/server/db/schema';

/** Counts of records flagged `is_demo` (created by `npm run db:seed -- --demo`). */
export async function getDemoDataSummary() {
  const countDemo = async (table: typeof users | typeof products | typeof categories | typeof collections | typeof coupons | typeof orders) => {
    const [row] = await db.select({ value: sql<number>`count(*)::int` }).from(table).where(eq(table.isDemo, true));
    return row?.value ?? 0;
  };
  const [u, p, c, col, cp, o] = await Promise.all([
    countDemo(users),
    countDemo(products),
    countDemo(categories),
    countDemo(collections),
    countDemo(coupons),
    countDemo(orders),
  ]);
  return { users: u, products: p, categories: c, collections: col, coupons: cp, orders: o, total: u + p + c + col + cp + o };
}

/**
 * Removes all demo-flagged records so the store can go live with real data only.
 * Real orders keep their item snapshots even if they reference demo products. The acting admin is
 * never deleted (to avoid locking them out), and demo categories still used by real products stay.
 */
export async function purgeDemoData(actorId: string) {
  return db.transaction(async (tx) => {
    const deletedOrders = await tx.delete(orders).where(eq(orders.isDemo, true)).returning({ id: orders.id });
    const deletedProducts = await tx.delete(products).where(eq(products.isDemo, true)).returning({ id: products.id });
    const deletedCollections = await tx.delete(collections).where(eq(collections.isDemo, true)).returning({ id: collections.id });
    const deletedCoupons = await tx.delete(coupons).where(eq(coupons.isDemo, true)).returning({ id: coupons.id });

    // Categories: delete children before parents; keep any still referenced by real products.
    const demoCats = await tx.select({ id: categories.id, parentId: categories.parentId }).from(categories).where(eq(categories.isDemo, true));
    const inUse = new Set(
      (
        await tx
          .select({ id: products.categoryId })
          .from(products)
          .where(demoCats.length ? inArray(products.categoryId, demoCats.map((c) => c.id)) : sql`false`)
      ).map((r) => r.id),
    );
    const parentsOfKept = new Set(demoCats.filter((c) => inUse.has(c.id) && c.parentId).map((c) => c.parentId!));
    const removable = demoCats.filter((c) => !inUse.has(c.id) && !parentsOfKept.has(c.id));
    const children = removable.filter((c) => c.parentId).map((c) => c.id);
    const roots = removable.filter((c) => !c.parentId).map((c) => c.id);
    if (children.length) await tx.delete(categories).where(inArray(categories.id, children));
    if (roots.length) await tx.delete(categories).where(inArray(categories.id, roots));

    const deletedUsers = await tx
      .delete(users)
      .where(and(eq(users.isDemo, true), ne(users.id, actorId)))
      .returning({ id: users.id });

    return {
      orders: deletedOrders.length,
      products: deletedProducts.length,
      collections: deletedCollections.length,
      coupons: deletedCoupons.length,
      categories: children.length + roots.length,
      users: deletedUsers.length,
      keptCategories: demoCats.length - children.length - roots.length,
    };
  });
}
