import 'server-only';
import { and, asc, count, desc, eq, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { db, type Transaction } from '@/server/db';
import {
  categories,
  collectionProducts,
  collections,
  colors,
  orderItems,
  productImages,
  products,
  productVariants,
  sizes,
  stockMovements,
} from '@/server/db/schema';
import { conflict, isUniqueViolation, notFound, validationError } from '@/server/errors';
import { slugify } from '@/lib/utils';
import type { ProductInput } from '@/lib/validation/admin';

export type AdminProductListQuery = {
  q?: string;
  status?: 'draft' | 'active' | 'archived' | 'all';
  categoryId?: string;
  page?: number;
  pageSize?: number;
};

export async function listProductsAdmin(query: AdminProductListQuery) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, query.pageSize ?? 20);
  const conditions: SQL[] = [];
  if (query.status && query.status !== 'all') conditions.push(eq(products.status, query.status));
  if (query.categoryId) conditions.push(eq(products.categoryId, query.categoryId));
  if (query.q) {
    const like = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(
      or(
        ilike(products.name, like),
        ilike(products.slug, like),
        sql`exists (select 1 from product_variants v where v.product_id = products.id and v.sku ilike ${like})`,
      )!,
    );
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, [totalRow], statusCounts] = await Promise.all([
    db
      .select({
        id: products.id,
        name: products.name,
        slug: products.slug,
        status: products.status,
        price: products.price,
        compareAtPrice: products.compareAtPrice,
        isFeatured: products.isFeatured,
        isDemo: products.isDemo,
        soldCount: products.soldCount,
        updatedAt: products.updatedAt,
        categoryName: categories.name,
        image: sql<string | null>`(select url from product_images i where i.product_id = products.id order by i.sort_order limit 1)`,
        totalStock: sql<number>`(select coalesce(sum(stock), 0)::int from product_variants v where v.product_id = products.id and v.is_active)`,
        variantCount: sql<number>`(select count(*)::int from product_variants v where v.product_id = products.id)`,
      })
      .from(products)
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .where(where)
      .orderBy(desc(products.updatedAt), asc(products.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(products).where(where),
    db.select({ status: products.status, value: count() }).from(products).groupBy(products.status),
  ]);

  return {
    items: rows,
    total: totalRow?.value ?? 0,
    page,
    pageSize,
    counts: Object.fromEntries(statusCounts.map((r) => [r.status, r.value])) as Record<string, number>,
  };
}

export async function getProductAdmin(id: string) {
  const product = await db.query.products.findFirst({
    where: eq(products.id, id),
    with: {
      images: { orderBy: [asc(productImages.sortOrder)] },
      variants: { orderBy: [asc(productVariants.createdAt)] },
      collections: true,
    },
  });
  if (!product) throw notFound('Product not found.');
  return {
    ...product,
    collectionIds: product.collections.map((c) => c.collectionId),
  };
}

async function uniqueSlug(tx: Transaction, base: string, excludeId?: string): Promise<string> {
  const root = base || 'product';
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const [hit] = await tx
      .select({ id: products.id })
      .from(products)
      .where(excludeId ? and(eq(products.slug, candidate), ne(products.id, excludeId)) : eq(products.slug, candidate))
      .limit(1);
    if (!hit) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

/** Checks foreign references up-front so admins get field-level messages instead of FK errors. */
async function validateReferences(tx: Transaction, input: ProductInput, productId?: string) {
  const fields: Record<string, string> = {};
  if (input.categoryId) {
    const [cat] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, input.categoryId)).limit(1);
    if (!cat) fields.categoryId = 'Category not found.';
  }
  if (input.collectionIds.length) {
    const found = await tx.select({ id: collections.id }).from(collections).where(inArray(collections.id, input.collectionIds));
    if (found.length !== new Set(input.collectionIds).size) fields.collectionIds = 'One or more collections were not found.';
  }
  const sizeIds = [...new Set(input.variants.map((v) => v.sizeId).filter((v): v is string => !!v))];
  const colorIds = [
    ...new Set(
      [...input.variants.map((v) => v.colorId), ...input.images.map((i) => i.colorId)].filter((v): v is string => !!v),
    ),
  ];
  if (sizeIds.length) {
    const found = await tx.select({ id: sizes.id }).from(sizes).where(inArray(sizes.id, sizeIds));
    if (found.length !== sizeIds.length) fields.variants = 'A selected size no longer exists.';
  }
  if (colorIds.length) {
    const found = await tx.select({ id: colors.id }).from(colors).where(inArray(colors.id, colorIds));
    if (found.length !== colorIds.length) fields.variants = 'A selected colour no longer exists.';
  }
  const skus = input.variants.map((v) => v.sku);
  const taken = await tx
    .select({ sku: productVariants.sku, productId: productVariants.productId })
    .from(productVariants)
    .where(inArray(productVariants.sku, skus));
  for (const t of taken) {
    if (t.productId !== productId) {
      const index = input.variants.findIndex((v) => v.sku === t.sku);
      fields[`variants.${index}.sku`] = 'This SKU is already used by another product.';
    }
  }
  if (Object.keys(fields).length) throw validationError(fields);
}

async function syncImages(tx: Transaction, productId: string, images: ProductInput['images']) {
  const existing = await tx.select({ id: productImages.id }).from(productImages).where(eq(productImages.productId, productId));
  const keep = new Set(images.map((i) => i.id).filter(Boolean));
  const remove = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
  if (remove.length) await tx.delete(productImages).where(inArray(productImages.id, remove));
  for (const [index, image] of images.entries()) {
    if (image.id && existing.some((e) => e.id === image.id)) {
      await tx
        .update(productImages)
        .set({ url: image.url, alt: image.alt, colorId: image.colorId, sortOrder: index })
        .where(eq(productImages.id, image.id));
    } else {
      await tx.insert(productImages).values({ productId, url: image.url, alt: image.alt, colorId: image.colorId, sortOrder: index });
    }
  }
}

async function syncCollections(tx: Transaction, productId: string, collectionIds: string[]) {
  await tx.delete(collectionProducts).where(eq(collectionProducts.productId, productId));
  if (collectionIds.length) {
    await tx
      .insert(collectionProducts)
      .values([...new Set(collectionIds)].map((collectionId, index) => ({ collectionId, productId, sortOrder: index })));
  }
}

async function syncVariants(tx: Transaction, productId: string, variants: ProductInput['variants'], actorId: string) {
  const existing = await tx.select().from(productVariants).where(eq(productVariants.productId, productId)).for('update');
  const existingById = new Map(existing.map((v) => [v.id, v]));
  const incomingIds = new Set(variants.map((v) => v.id).filter(Boolean));

  // Variants removed in the editor: delete if never ordered, otherwise deactivate (keeps history).
  for (const old of existing) {
    if (incomingIds.has(old.id)) continue;
    const [ordered] = await tx.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.variantId, old.id)).limit(1);
    if (ordered) await tx.update(productVariants).set({ isActive: false }).where(eq(productVariants.id, old.id));
    else await tx.delete(productVariants).where(eq(productVariants.id, old.id));
  }

  for (const [index, v] of variants.entries()) {
    if (v.id) {
      const old = existingById.get(v.id);
      if (!old) throw validationError({ [`variants.${index}.sku`]: 'This variant no longer exists. Reload the page.' });
      const delta = v.stockBaseline !== undefined ? v.stock - v.stockBaseline : v.stock - old.stock;
      const newStock = old.stock + delta;
      if (newStock < 0) {
        throw validationError({
          [`variants.${index}.stock`]: `Stock changed while you were editing (now ${old.stock}). Reload and try again.`,
        });
      }
      await tx
        .update(productVariants)
        .set({ sku: v.sku, sizeId: v.sizeId, colorId: v.colorId, isActive: v.isActive, stock: newStock })
        .where(eq(productVariants.id, v.id));
      if (delta !== 0) {
        await tx.insert(stockMovements).values({
          variantId: v.id,
          delta,
          stockAfter: newStock,
          reason: 'adjustment',
          actorId,
          note: 'Updated in product editor',
        });
      }
    } else {
      const [created] = await tx
        .insert(productVariants)
        .values({ productId, sku: v.sku, sizeId: v.sizeId, colorId: v.colorId, stock: v.stock, isActive: v.isActive })
        .returning({ id: productVariants.id });
      if (v.stock > 0) {
        await tx.insert(stockMovements).values({
          variantId: created!.id,
          delta: v.stock,
          stockAfter: v.stock,
          reason: 'initial',
          actorId,
          note: 'Initial stock',
        });
      }
    }
  }
}

function mapUniqueErrors(error: unknown): never {
  if (isUniqueViolation(error, 'products_slug_key')) throw validationError({ slug: 'This URL slug is already in use.' });
  if (isUniqueViolation(error, 'product_variants_sku_key')) throw validationError({ variants: 'A SKU is already in use.' });
  if (isUniqueViolation(error, 'product_variants_option_key')) {
    throw validationError({ variants: 'Each size/colour combination can only be listed once (check inactive variants).' });
  }
  throw error;
}

export async function createProduct(input: ProductInput, actorId: string): Promise<{ id: string; slug: string }> {
  try {
    return await db.transaction(async (tx) => {
      await validateReferences(tx, input);
      const slug = input.slug ?? (await uniqueSlug(tx, slugify(input.name)));
      const [product] = await tx
        .insert(products)
        .values({
          name: input.name,
          slug,
          description: input.description,
          material: input.material,
          careInstructions: input.careInstructions,
          categoryId: input.categoryId,
          price: input.price,
          compareAtPrice: input.compareAtPrice,
          status: input.status,
          isFeatured: input.isFeatured,
          tags: input.tags,
        })
        .returning({ id: products.id, slug: products.slug });
      await syncVariants(tx, product!.id, input.variants.map((v) => ({ ...v, id: undefined })), actorId);
      await syncImages(tx, product!.id, input.images.map((i) => ({ ...i, id: undefined })));
      await syncCollections(tx, product!.id, input.collectionIds);
      return product!;
    });
  } catch (error) {
    mapUniqueErrors(error);
  }
}

export async function updateProduct(id: string, input: ProductInput, actorId: string): Promise<{ id: string; slug: string }> {
  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: products.id, slug: products.slug }).from(products).where(eq(products.id, id)).for('update');
      if (!existing) throw notFound('Product not found.');
      await validateReferences(tx, input, id);
      const slug = input.slug ?? existing.slug;
      const [product] = await tx
        .update(products)
        .set({
          name: input.name,
          slug,
          description: input.description,
          material: input.material,
          careInstructions: input.careInstructions,
          categoryId: input.categoryId,
          price: input.price,
          compareAtPrice: input.compareAtPrice,
          status: input.status,
          isFeatured: input.isFeatured,
          tags: input.tags,
        })
        .where(eq(products.id, id))
        .returning({ id: products.id, slug: products.slug });
      await syncVariants(tx, id, input.variants, actorId);
      await syncImages(tx, id, input.images);
      await syncCollections(tx, id, input.collectionIds);
      return product!;
    });
  } catch (error) {
    mapUniqueErrors(error);
  }
}

/** Hard-deletes a product only if it was never ordered; otherwise asks the admin to archive it. */
export async function deleteProduct(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [product] = await tx.select({ id: products.id }).from(products).where(eq(products.id, id)).for('update');
    if (!product) throw notFound('Product not found.');
    const [ordered] = await tx.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.productId, id)).limit(1);
    if (ordered) {
      throw conflict('This product appears in past orders. Archive it instead to keep order history intact.', 'PRODUCT_HAS_ORDERS');
    }
    await tx.delete(products).where(eq(products.id, id));
  });
}

/** Options needed by the product editor (categories, collections, sizes, colours). */
export async function getProductEditorOptions() {
  const [cats, cols, sizeRows, colorRows] = await Promise.all([
    db
      .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.name)),
    db.select({ id: collections.id, name: collections.name }).from(collections).orderBy(asc(collections.sortOrder)),
    db.select({ id: sizes.id, label: sizes.label }).from(sizes).orderBy(asc(sizes.sortOrder)),
    db.select({ id: colors.id, name: colors.name, hex: colors.hex }).from(colors).orderBy(asc(colors.name)),
  ]);
  const parents = new Map(cats.map((c) => [c.id, c.name]));
  return {
    categories: cats.map((c) => ({ id: c.id, name: c.parentId ? `${parents.get(c.parentId) ?? ''} › ${c.name}` : c.name })),
    collections: cols,
    sizes: sizeRows,
    colors: colorRows,
  };
}
