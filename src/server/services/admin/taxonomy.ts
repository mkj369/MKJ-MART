import 'server-only';
import { asc, eq, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { categories, collectionProducts, collections, colors, products, productVariants, sizes } from '@/server/db/schema';
import { conflict, isUniqueViolation, notFound, validationError } from '@/server/errors';
import { slugify } from '@/lib/utils';
import type { CategoryInput, CollectionInput } from '@/lib/validation/admin';

// ─── Categories ───────────────────────────────────────────────────────────────

export async function listCategoriesAdmin() {
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      description: categories.description,
      imageUrl: categories.imageUrl,
      parentId: categories.parentId,
      sortOrder: categories.sortOrder,
      isActive: categories.isActive,
      isDemo: categories.isDemo,
      productCount: sql<number>`(select count(*)::int from products p where p.category_id = categories.id)`,
    })
    .from(categories)
    .orderBy(asc(categories.sortOrder), asc(categories.name));
  const names = new Map(rows.map((r) => [r.id, r.name]));
  return rows.map((r) => ({ ...r, parentName: r.parentId ? (names.get(r.parentId) ?? null) : null }));
}

async function assertValidParent(parentId: string | null, selfId?: string) {
  if (!parentId) return;
  if (parentId === selfId) throw validationError({ parentId: 'A category cannot be its own parent.' });
  const [parent] = await db
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories)
    .where(eq(categories.id, parentId))
    .limit(1);
  if (!parent) throw validationError({ parentId: 'Parent category not found.' });
  // Keep the navigation two levels deep: a parent must itself be a top-level category.
  if (parent.parentId) throw validationError({ parentId: 'Choose a top-level category as the parent.' });
  if (selfId) {
    const [child] = await db.select({ id: categories.id }).from(categories).where(eq(categories.parentId, selfId)).limit(1);
    if (child) throw validationError({ parentId: 'This category has sub-categories, so it must stay top-level.' });
  }
}

function slugError(error: unknown): never {
  if (isUniqueViolation(error)) throw validationError({ slug: 'This URL slug is already in use.' });
  throw error;
}

export async function createCategory(input: CategoryInput) {
  await assertValidParent(input.parentId);
  try {
    const [row] = await db
      .insert(categories)
      .values({ ...input, slug: input.slug ?? slugify(input.name) })
      .returning();
    return row!;
  } catch (error) {
    slugError(error);
  }
}

export async function updateCategory(id: string, input: CategoryInput) {
  await assertValidParent(input.parentId, id);
  try {
    const [row] = await db
      .update(categories)
      .set({ ...input, slug: input.slug ?? slugify(input.name) })
      .where(eq(categories.id, id))
      .returning();
    if (!row) throw notFound('Category not found.');
    return row;
  } catch (error) {
    slugError(error);
  }
}

export async function deleteCategory(id: string) {
  const [used] = await db.select({ id: products.id }).from(products).where(eq(products.categoryId, id)).limit(1);
  if (used) throw conflict('Move or delete the products in this category first.', 'CATEGORY_IN_USE');
  const [deleted] = await db.delete(categories).where(eq(categories.id, id)).returning({ id: categories.id });
  if (!deleted) throw notFound('Category not found.');
}

// ─── Collections ──────────────────────────────────────────────────────────────

export async function listCollectionsAdmin() {
  return db
    .select({
      id: collections.id,
      name: collections.name,
      slug: collections.slug,
      description: collections.description,
      imageUrl: collections.imageUrl,
      isFeatured: collections.isFeatured,
      isActive: collections.isActive,
      sortOrder: collections.sortOrder,
      isDemo: collections.isDemo,
      productCount: sql<number>`(select count(*)::int from collection_products cp where cp.collection_id = collections.id)`,
    })
    .from(collections)
    .orderBy(asc(collections.sortOrder), asc(collections.name));
}

export async function createCollection(input: CollectionInput) {
  try {
    const [row] = await db
      .insert(collections)
      .values({ ...input, slug: input.slug ?? slugify(input.name) })
      .returning();
    return row!;
  } catch (error) {
    slugError(error);
  }
}

export async function updateCollection(id: string, input: CollectionInput) {
  try {
    const [row] = await db
      .update(collections)
      .set({ ...input, slug: input.slug ?? slugify(input.name) })
      .where(eq(collections.id, id))
      .returning();
    if (!row) throw notFound('Collection not found.');
    return row;
  } catch (error) {
    slugError(error);
  }
}

export async function deleteCollection(id: string) {
  const [deleted] = await db.delete(collections).where(eq(collections.id, id)).returning({ id: collections.id });
  if (!deleted) throw notFound('Collection not found.');
}

// ─── Sizes & colours ──────────────────────────────────────────────────────────

export async function listSizes() {
  return db
    .select({
      id: sizes.id,
      label: sizes.label,
      sortOrder: sizes.sortOrder,
      usage: sql<number>`(select count(*)::int from product_variants v where v.size_id = sizes.id)`,
    })
    .from(sizes)
    .orderBy(asc(sizes.sortOrder), asc(sizes.label));
}

export async function listColors() {
  return db
    .select({
      id: colors.id,
      name: colors.name,
      hex: colors.hex,
      usage: sql<number>`(select count(*)::int from product_variants v where v.color_id = colors.id)`,
    })
    .from(colors)
    .orderBy(asc(colors.name));
}

export async function saveSize(input: { label: string; sortOrder: number }, id?: string) {
  try {
    if (id) {
      const [row] = await db.update(sizes).set(input).where(eq(sizes.id, id)).returning();
      if (!row) throw notFound('Size not found.');
      return row;
    }
    const [row] = await db.insert(sizes).values(input).returning();
    return row!;
  } catch (error) {
    if (isUniqueViolation(error)) throw validationError({ label: 'This size already exists.' });
    throw error;
  }
}

export async function saveColor(input: { name: string; hex: string }, id?: string) {
  try {
    if (id) {
      const [row] = await db.update(colors).set(input).where(eq(colors.id, id)).returning();
      if (!row) throw notFound('Colour not found.');
      return row;
    }
    const [row] = await db.insert(colors).values(input).returning();
    return row!;
  } catch (error) {
    if (isUniqueViolation(error)) throw validationError({ name: 'This colour already exists.' });
    throw error;
  }
}

export async function deleteSize(id: string) {
  const [used] = await db.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.sizeId, id)).limit(1);
  if (used) throw conflict('This size is used by product variants.', 'SIZE_IN_USE');
  await db.delete(sizes).where(eq(sizes.id, id));
}

export async function deleteColor(id: string) {
  const [used] = await db.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.colorId, id)).limit(1);
  if (used) throw conflict('This colour is used by product variants.', 'COLOR_IN_USE');
  await db.delete(colors).where(eq(colors.id, id));
}
