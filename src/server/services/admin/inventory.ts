import 'server-only';
import { and, asc, count, desc, eq, gt, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/server/db';
import { colors, productImages, products, productVariants, sizes, stockMovements, users } from '@/server/db/schema';
import { notFound, validationError } from '@/server/errors';
import type { StockAdjustmentInput } from '@/lib/validation/admin';
import { recordEvent } from '../events';
import { getSetting } from '../settings';

export type InventoryFilter = 'all' | 'low' | 'out';

export async function listInventory(query: { q?: string; filter?: InventoryFilter; page?: number; pageSize?: number }) {
  const { lowStockThreshold } = await getSetting('checkout');
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, query.pageSize ?? 25);
  const conditions: SQL[] = [eq(productVariants.isActive, true)];
  if (query.filter === 'low') conditions.push(gt(productVariants.stock, 0), lte(productVariants.stock, lowStockThreshold));
  if (query.filter === 'out') conditions.push(eq(productVariants.stock, 0));
  if (query.q) {
    const like = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(or(ilike(products.name, like), ilike(productVariants.sku, like))!);
  }
  const where = and(...conditions);

  const [rows, [totalRow], [summary]] = await Promise.all([
    db
      .select({
        variantId: productVariants.id,
        sku: productVariants.sku,
        stock: productVariants.stock,
        productId: products.id,
        productName: products.name,
        productStatus: products.status,
        sizeLabel: sizes.label,
        colorName: colors.name,
        colorHex: colors.hex,
        updatedAt: productVariants.updatedAt,
        image: sql<string | null>`(select url from product_images i where i.product_id = products.id order by i.sort_order limit 1)`,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(sizes, eq(sizes.id, productVariants.sizeId))
      .leftJoin(colors, eq(colors.id, productVariants.colorId))
      .where(where)
      .orderBy(asc(productVariants.stock), asc(products.name), asc(sizes.sortOrder))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ value: count() })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(where),
    db
      .select({
        total: sql<number>`count(*)::int`,
        units: sql<number>`coalesce(sum(${productVariants.stock}), 0)::int`,
        low: sql<number>`count(*) filter (where ${productVariants.stock} > 0 and ${productVariants.stock} <= ${lowStockThreshold})::int`,
        out: sql<number>`count(*) filter (where ${productVariants.stock} = 0)::int`,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(productVariants.isActive, true), sql`${products.status} <> 'archived'`)),
  ]);

  return { items: rows, total: totalRow?.value ?? 0, page, pageSize, summary: summary!, lowStockThreshold };
}

/** Applies a stock change atomically with a ledger entry. */
export async function adjustStock(input: StockAdjustmentInput, actorId: string) {
  const { lowStockThreshold } = await getSetting('checkout');
  return db.transaction(async (tx) => {
    const [variant] = await tx
      .select({ id: productVariants.id, stock: productVariants.stock, sku: productVariants.sku, productId: productVariants.productId })
      .from(productVariants)
      .where(eq(productVariants.id, input.variantId))
      .for('update');
    if (!variant) throw notFound('Variant not found.');
    const newStock = input.mode === 'set' ? input.value : variant.stock + input.value;
    if (newStock < 0) throw validationError({ value: `Stock cannot go below zero (currently ${variant.stock}).` });
    const delta = newStock - variant.stock;
    if (delta === 0) return { stock: variant.stock, delta: 0 };
    await tx.update(productVariants).set({ stock: newStock, updatedAt: new Date() }).where(eq(productVariants.id, variant.id));
    await tx.insert(stockMovements).values({
      variantId: variant.id,
      delta,
      stockAfter: newStock,
      reason: input.reason,
      note: input.note,
      actorId,
    });
    if (newStock <= lowStockThreshold && variant.stock > lowStockThreshold) {
      await recordEvent(tx, 'inventory.low_stock', variant.productId, { sku: variant.sku, stock: newStock });
    }
    return { stock: newStock, delta };
  });
}

export async function listStockMovements(variantId: string, limit = 30) {
  return db
    .select({
      id: stockMovements.id,
      delta: stockMovements.delta,
      stockAfter: stockMovements.stockAfter,
      reason: stockMovements.reason,
      note: stockMovements.note,
      createdAt: stockMovements.createdAt,
      actorName: users.name,
    })
    .from(stockMovements)
    .leftJoin(users, eq(users.id, stockMovements.actorId))
    .where(eq(stockMovements.variantId, variantId))
    .orderBy(desc(stockMovements.createdAt))
    .limit(limit);
}
