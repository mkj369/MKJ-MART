import 'server-only';
import { and, asc, desc, eq, exists, gt, gte, ilike, inArray, isNotNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/server/db';
import {
  categories,
  collectionProducts,
  collections,
  colors,
  productImages,
  products,
  productVariants,
  sizes,
} from '@/server/db/schema';
import type { ProductQuery } from '@/lib/validation/store';

export type ImageRef = { url: string; alt: string };

export type ProductCard = {
  id: string;
  slug: string;
  name: string;
  price: number;
  compareAtPrice: number | null;
  image: ImageRef | null;
  hoverImage: ImageRef | null;
  categoryName: string | null;
  isNew: boolean;
  inStock: boolean;
  colors: { name: string; hex: string }[];
};

export type ProductListResult = {
  items: ProductCard[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const NEW_ARRIVAL_DAYS = 30;

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Resolves a category slug to its id plus all descendant ids (categories are a shallow tree). */
async function categoryIdsForSlug(slug: string): Promise<string[]> {
  const all = await db
    .select({ id: categories.id, slug: categories.slug, parentId: categories.parentId })
    .from(categories)
    .where(eq(categories.isActive, true));
  const root = all.find((c) => c.slug === slug);
  if (!root) return [];
  const ids = new Set([root.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of all) {
      if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) {
        ids.add(c.id);
        grew = true;
      }
    }
  }
  return [...ids];
}

/**
 * NOTE: correlated subqueries are written with explicit table qualifiers. Drizzle renders column
 * references unqualified in single-table selects, which would silently bind to the inner table.
 */
function inStockExists() {
  return sql`exists (select 1 from product_variants v where v.product_id = products.id and v.is_active and v.stock > 0)`;
}

/** Builds product cards (images, colours, stock) for a set of product rows in 2 batched queries. */
async function hydrateCards(
  rows: {
    id: string;
    slug: string;
    name: string;
    price: number;
    compareAtPrice: number | null;
    createdAt: Date;
    categoryName: string | null;
  }[],
): Promise<ProductCard[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [images, variantRows] = await Promise.all([
    db
      .select({ productId: productImages.productId, url: productImages.url, alt: productImages.alt })
      .from(productImages)
      .where(inArray(productImages.productId, ids))
      .orderBy(asc(productImages.productId), asc(productImages.sortOrder), asc(productImages.createdAt)),
    db
      .select({
        productId: productVariants.productId,
        stock: productVariants.stock,
        colorName: colors.name,
        colorHex: colors.hex,
      })
      .from(productVariants)
      .leftJoin(colors, eq(colors.id, productVariants.colorId))
      .where(and(inArray(productVariants.productId, ids), eq(productVariants.isActive, true))),
  ]);

  const newSince = Date.now() - NEW_ARRIVAL_DAYS * 24 * 60 * 60 * 1000;
  return rows.map((row) => {
    const productImagesList = images.filter((i) => i.productId === row.id);
    const variants = variantRows.filter((v) => v.productId === row.id);
    const colorMap = new Map<string, string>();
    for (const v of variants) if (v.colorName && v.colorHex) colorMap.set(v.colorName, v.colorHex);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      price: row.price,
      compareAtPrice: row.compareAtPrice,
      categoryName: row.categoryName,
      image: productImagesList[0] ? { url: productImagesList[0].url, alt: productImagesList[0].alt || row.name } : null,
      hoverImage: productImagesList[1]
        ? { url: productImagesList[1].url, alt: productImagesList[1].alt || row.name }
        : null,
      isNew: row.createdAt.getTime() >= newSince,
      inStock: variants.some((v) => v.stock > 0),
      colors: [...colorMap].map(([name, hex]) => ({ name, hex })),
    };
  });
}

const cardColumns = {
  id: products.id,
  slug: products.slug,
  name: products.name,
  price: products.price,
  compareAtPrice: products.compareAtPrice,
  createdAt: products.createdAt,
  categoryName: categories.name,
};

/** Storefront product search with filters, sorting and pagination. Only ACTIVE products are visible. */
export async function listProducts(query: ProductQuery): Promise<ProductListResult> {
  const pageSize = Math.min(Math.max(query.pageSize, 1), 48);
  const page = Math.max(query.page, 1);
  const conditions: SQL[] = [eq(products.status, 'active')];

  if (query.category) {
    const ids = await categoryIdsForSlug(query.category);
    if (ids.length === 0) return { items: [], total: 0, page, pageSize, totalPages: 0 };
    conditions.push(inArray(products.categoryId, ids));
  }

  if (query.collection) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(collectionProducts)
          .innerJoin(collections, eq(collections.id, collectionProducts.collectionId))
          .where(
            and(
              eq(collectionProducts.productId, products.id),
              eq(collections.slug, query.collection),
              eq(collections.isActive, true),
            ),
          ),
      ),
    );
  }

  if (query.size.length > 0) {
    const labels = query.size.map((s) => s.toLowerCase());
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(productVariants)
          .innerJoin(sizes, eq(sizes.id, productVariants.sizeId))
          .where(
            and(
              eq(productVariants.productId, products.id),
              eq(productVariants.isActive, true),
              gt(productVariants.stock, 0),
              inArray(sql`lower(${sizes.label})`, labels),
            ),
          ),
      ),
    );
  }

  if (query.color.length > 0) {
    const names = query.color.map((c) => c.toLowerCase());
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(productVariants)
          .innerJoin(colors, eq(colors.id, productVariants.colorId))
          .where(
            and(
              eq(productVariants.productId, products.id),
              eq(productVariants.isActive, true),
              inArray(sql`lower(${colors.name})`, names),
            ),
          ),
      ),
    );
  }

  if (query.minPrice !== undefined) conditions.push(gte(products.price, query.minPrice * 100));
  if (query.maxPrice !== undefined) conditions.push(lte(products.price, query.maxPrice * 100));
  if (query.inStock) conditions.push(inStockExists());
  if (query.onSale) {
    conditions.push(isNotNull(products.compareAtPrice), sql`${products.compareAtPrice} > ${products.price}`);
  }

  if (query.q) {
    const terms = query.q
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .slice(0, 5);
    for (const term of terms) {
      const like = `%${escapeLike(term)}%`;
      conditions.push(
        or(
          ilike(products.name, like),
          ilike(products.description, like),
          sql`array_to_string(${products.tags}, ' ') ILIKE ${like}`,
          ilike(categories.name, like),
        )!,
      );
    }
  }

  const where = and(...conditions);
  const orderBy = (() => {
    switch (query.sort) {
      case 'newest':
        return [desc(products.createdAt), asc(products.id)];
      case 'price-asc':
        return [asc(products.price), desc(products.createdAt), asc(products.id)];
      case 'price-desc':
        return [desc(products.price), desc(products.createdAt), asc(products.id)];
      case 'bestselling':
        return [desc(products.soldCount), desc(products.createdAt), asc(products.id)];
      default:
        return [desc(products.isFeatured), desc(products.soldCount), desc(products.createdAt), asc(products.id)];
    }
  })();

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(where);
  const total = countRow?.count ?? 0;

  const rows = await db
    .select(cardColumns)
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(where)
    .orderBy(...orderBy)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    items: await hydrateCards(rows),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function getFeaturedProducts(limit = 8): Promise<ProductCard[]> {
  const rows = await db
    .select(cardColumns)
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(eq(products.status, 'active'), eq(products.isFeatured, true)))
    .orderBy(desc(products.soldCount), desc(products.createdAt))
    .limit(limit);
  return hydrateCards(rows);
}

export async function getProductCardsByIds(ids: string[]): Promise<ProductCard[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select(cardColumns)
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(inArray(products.id, ids), eq(products.status, 'active')));
  const cards = await hydrateCards(rows);
  return ids.map((id) => cards.find((c) => c.id === id)).filter((c): c is ProductCard => !!c);
}

// ─── Product detail ───────────────────────────────────────────────────────────

export type ProductDetail = {
  id: string;
  slug: string;
  name: string;
  description: string;
  material: string | null;
  careInstructions: string | null;
  price: number;
  compareAtPrice: number | null;
  tags: string[];
  category: { id: string; name: string; slug: string } | null;
  parentCategory: { id: string; name: string; slug: string } | null;
  images: { id: string; url: string; alt: string; colorId: string | null }[];
  variants: {
    id: string;
    sku: string;
    stock: number;
    size: { id: string; label: string; sortOrder: number } | null;
    color: { id: string; name: string; hex: string } | null;
  }[];
  sizes: { id: string; label: string; sortOrder: number }[];
  colors: { id: string; name: string; hex: string }[];
  totalStock: number;
};

export async function getProductBySlug(slug: string): Promise<ProductDetail | null> {
  const product = await db.query.products.findFirst({
    where: and(eq(products.slug, slug), eq(products.status, 'active')),
    with: {
      category: true,
      images: { orderBy: [asc(productImages.sortOrder), asc(productImages.createdAt)] },
      variants: { where: eq(productVariants.isActive, true), with: { size: true, color: true } },
    },
  });
  if (!product) return null;

  let parentCategory: ProductDetail['parentCategory'] = null;
  if (product.category?.parentId) {
    const [parent] = await db
      .select({ id: categories.id, name: categories.name, slug: categories.slug })
      .from(categories)
      .where(eq(categories.id, product.category.parentId))
      .limit(1);
    parentCategory = parent ?? null;
  }

  const variants = product.variants
    .map((v) => ({
      id: v.id,
      sku: v.sku,
      stock: v.stock,
      size: v.size ? { id: v.size.id, label: v.size.label, sortOrder: v.size.sortOrder } : null,
      color: v.color ? { id: v.color.id, name: v.color.name, hex: v.color.hex } : null,
    }))
    .sort((a, b) => (a.size?.sortOrder ?? 0) - (b.size?.sortOrder ?? 0));

  const sizeMap = new Map<string, { id: string; label: string; sortOrder: number }>();
  const colorMap = new Map<string, { id: string; name: string; hex: string }>();
  for (const v of variants) {
    if (v.size) sizeMap.set(v.size.id, v.size);
    if (v.color) colorMap.set(v.color.id, v.color);
  }

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    material: product.material,
    careInstructions: product.careInstructions,
    price: product.price,
    compareAtPrice: product.compareAtPrice,
    tags: product.tags,
    category: product.category
      ? { id: product.category.id, name: product.category.name, slug: product.category.slug }
      : null,
    parentCategory,
    images: product.images.map((i) => ({ id: i.id, url: i.url, alt: i.alt || product.name, colorId: i.colorId })),
    variants,
    sizes: [...sizeMap.values()].sort((a, b) => a.sortOrder - b.sortOrder),
    colors: [...colorMap.values()],
    totalStock: variants.reduce((sum, v) => sum + v.stock, 0),
  };
}

export async function getRelatedProducts(product: ProductDetail, limit = 4): Promise<ProductCard[]> {
  const categoryIds = [product.category?.id, product.parentCategory?.id].filter((v): v is string => !!v);
  const rows = await db
    .select(cardColumns)
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(
      and(
        eq(products.status, 'active'),
        sql`${products.id} <> ${product.id}`,
        categoryIds.length
          ? or(inArray(products.categoryId, categoryIds), inArray(categories.parentId, categoryIds))
          : undefined,
      ),
    )
    .orderBy(desc(products.soldCount), desc(products.createdAt))
    .limit(limit);
  if (rows.length < limit) {
    const extra = await db
      .select(cardColumns)
      .from(products)
      .leftJoin(categories, eq(categories.id, products.categoryId))
      .where(
        and(
          eq(products.status, 'active'),
          sql`${products.id} <> ${product.id}`,
          rows.length ? sql`${products.id} NOT IN (${sql.join(rows.map((r) => sql`${r.id}`), sql`, `)})` : undefined,
        ),
      )
      .orderBy(desc(products.isFeatured), desc(products.soldCount))
      .limit(limit - rows.length);
    rows.push(...extra);
  }
  return hydrateCards(rows);
}

// ─── Taxonomy ─────────────────────────────────────────────────────────────────

export type CategoryNode = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  productCount: number;
  children: CategoryNode[];
};

/** Active categories as a tree with active-product counts (children counted into parents). */
export async function getCategoryTree(): Promise<CategoryNode[]> {
  const rows = await db
    .select({
      id: categories.id,
      name: categories.name,
      slug: categories.slug,
      description: categories.description,
      imageUrl: categories.imageUrl,
      parentId: categories.parentId,
      sortOrder: categories.sortOrder,
      productCount: sql<number>`(
        SELECT count(*)::int FROM products p WHERE p.category_id = categories.id AND p.status = 'active'
      )`,
    })
    .from(categories)
    .where(eq(categories.isActive, true))
    .orderBy(asc(categories.sortOrder), asc(categories.name));

  const nodes = new Map<string, CategoryNode & { parentId: string | null }>();
  for (const r of rows) nodes.set(r.id, { ...r, children: [] });
  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  for (const root of roots) root.productCount += root.children.reduce((s, c) => s + c.productCount, 0);
  return roots;
}

export async function getCategoryBySlug(slug: string) {
  const [category] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.slug, slug), eq(categories.isActive, true)))
    .limit(1);
  return category ?? null;
}

export async function getCollections(options: { featuredOnly?: boolean } = {}) {
  return db
    .select({
      id: collections.id,
      name: collections.name,
      slug: collections.slug,
      description: collections.description,
      imageUrl: collections.imageUrl,
      isFeatured: collections.isFeatured,
      productCount: sql<number>`(
        SELECT count(*)::int FROM collection_products cp
        INNER JOIN products p ON p.id = cp.product_id
        WHERE cp.collection_id = collections.id AND p.status = 'active'
      )`,
    })
    .from(collections)
    .where(and(eq(collections.isActive, true), options.featuredOnly ? eq(collections.isFeatured, true) : undefined))
    .orderBy(asc(collections.sortOrder), asc(collections.name));
}

export async function getCollectionBySlug(slug: string) {
  const [collection] = await db
    .select()
    .from(collections)
    .where(and(eq(collections.slug, slug), eq(collections.isActive, true)))
    .limit(1);
  return collection ?? null;
}

/** Sizes/colours/price range available across the active catalogue, for filter UIs. */
export async function getCatalogFacets() {
  const [sizeRows, colorRows, priceRow] = await Promise.all([
    db
      .selectDistinct({ label: sizes.label, sortOrder: sizes.sortOrder })
      .from(sizes)
      .innerJoin(productVariants, eq(productVariants.sizeId, sizes.id))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(products.status, 'active'), eq(productVariants.isActive, true)))
      .orderBy(asc(sizes.sortOrder)),
    db
      .selectDistinct({ name: colors.name, hex: colors.hex })
      .from(colors)
      .innerJoin(productVariants, eq(productVariants.colorId, colors.id))
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(products.status, 'active'), eq(productVariants.isActive, true)))
      .orderBy(asc(colors.name)),
    db
      .select({ min: sql<number | null>`min(${products.price})`, max: sql<number | null>`max(${products.price})` })
      .from(products)
      .where(eq(products.status, 'active')),
  ]);
  return {
    sizes: sizeRows.map((s) => s.label),
    colors: colorRows,
    priceRange: {
      min: priceRow[0]?.min != null ? Math.floor(Number(priceRow[0].min) / 100) : 0,
      max: priceRow[0]?.max != null ? Math.ceil(Number(priceRow[0].max) / 100) : 0,
    },
  };
}

/** True when any demo-flagged catalogue data exists (drives the storefront "demo store" notice). */
export async function hasDemoCatalog(): Promise<boolean> {
  const [row] = await db
    .select({ exists: sql<boolean>`exists(select 1 from ${products} where ${products.isDemo} = true)` })
    .from(sql`(select 1) as one`);
  return !!row?.exists;
}
