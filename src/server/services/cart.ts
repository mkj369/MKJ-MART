import 'server-only';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '@/server/db';
import { cartItems, carts, colors, productImages, products, productVariants, sizes } from '@/server/db/schema';
import { AppError, badRequest, notFound } from '@/server/errors';
import { getSetting } from './settings';

export type CartLineIssue = 'unavailable' | 'out_of_stock' | 'insufficient_stock' | null;

export type CartLine = {
  id: string;
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  image: string | null;
  sku: string;
  sizeLabel: string | null;
  colorName: string | null;
  colorHex: string | null;
  unitPrice: number;
  compareAtPrice: number | null;
  quantity: number;
  lineTotal: number;
  stock: number;
  issue: CartLineIssue;
};

export type CartView = {
  id: string | null;
  lines: CartLine[];
  itemCount: number;
  subtotal: number;
  hasIssues: boolean;
};

export const EMPTY_CART: CartView = { id: null, lines: [], itemCount: 0, subtotal: 0, hasIssues: false };

/** Finds the cart for a signed-in user, or validates a guest cart id from the cookie. */
export async function findCartId(owner: { userId: string | null; guestCartId: string | null }): Promise<string | null> {
  if (owner.userId) {
    const [cart] = await db.select({ id: carts.id }).from(carts).where(eq(carts.userId, owner.userId)).limit(1);
    return cart?.id ?? null;
  }
  if (owner.guestCartId && /^[0-9a-f-]{36}$/i.test(owner.guestCartId)) {
    const [cart] = await db
      .select({ id: carts.id })
      .from(carts)
      .where(and(eq(carts.id, owner.guestCartId), isNull(carts.userId)))
      .limit(1);
    return cart?.id ?? null;
  }
  return null;
}

/** Total units in a cart (cheap query for the header badge). */
export async function getCartCount(cartId: string | null): Promise<number> {
  if (!cartId) return 0;
  const [row] = await db
    .select({ count: sql<number>`coalesce(sum(${cartItems.quantity}), 0)::int` })
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId));
  return row?.count ?? 0;
}

/** Returns an existing cart or creates one. `created` tells the caller to set the guest cookie. */
export async function ensureCart(owner: {
  userId: string | null;
  guestCartId: string | null;
}): Promise<{ cartId: string; created: boolean }> {
  const existing = await findCartId(owner);
  if (existing) return { cartId: existing, created: false };
  if (owner.userId) {
    await db.insert(carts).values({ userId: owner.userId }).onConflictDoNothing({ target: carts.userId });
    const [cart] = await db.select({ id: carts.id }).from(carts).where(eq(carts.userId, owner.userId)).limit(1);
    return { cartId: cart!.id, created: true };
  }
  const [cart] = await db.insert(carts).values({}).returning({ id: carts.id });
  return { cartId: cart!.id, created: true };
}

/** Loads cart lines with LIVE prices and stock (prices are never stored in the cart). */
export async function getCartView(cartId: string | null, tx: DbOrTx = db): Promise<CartView> {
  if (!cartId) return EMPTY_CART;
  const rows = await tx
    .select({
      id: cartItems.id,
      variantId: cartItems.variantId,
      quantity: cartItems.quantity,
      productId: products.id,
      productSlug: products.slug,
      productName: products.name,
      productStatus: products.status,
      price: products.price,
      compareAtPrice: products.compareAtPrice,
      sku: productVariants.sku,
      stock: productVariants.stock,
      variantActive: productVariants.isActive,
      colorId: productVariants.colorId,
      sizeLabel: sizes.label,
      colorName: colors.name,
      colorHex: colors.hex,
    })
    .from(cartItems)
    .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(sizes, eq(sizes.id, productVariants.sizeId))
    .leftJoin(colors, eq(colors.id, productVariants.colorId))
    .where(eq(cartItems.cartId, cartId))
    .orderBy(asc(cartItems.createdAt));

  const productIds = [...new Set(rows.map((r) => r.productId))];
  const images = productIds.length
    ? await tx
        .select({ productId: productImages.productId, url: productImages.url, colorId: productImages.colorId })
        .from(productImages)
        .where(sql`${productImages.productId} IN (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})`)
        .orderBy(asc(productImages.sortOrder))
    : [];

  const lines: CartLine[] = rows.map((r) => {
    const productImgs = images.filter((i) => i.productId === r.productId);
    const image = (productImgs.find((i) => r.colorId && i.colorId === r.colorId) ?? productImgs[0])?.url ?? null;
    let issue: CartLineIssue = null;
    if (r.productStatus !== 'active' || !r.variantActive) issue = 'unavailable';
    else if (r.stock <= 0) issue = 'out_of_stock';
    else if (r.stock < r.quantity) issue = 'insufficient_stock';
    return {
      id: r.id,
      variantId: r.variantId,
      productId: r.productId,
      productSlug: r.productSlug,
      productName: r.productName,
      image,
      sku: r.sku,
      sizeLabel: r.sizeLabel,
      colorName: r.colorName,
      colorHex: r.colorHex,
      unitPrice: r.price,
      compareAtPrice: r.compareAtPrice,
      quantity: r.quantity,
      lineTotal: r.price * r.quantity,
      stock: r.stock,
      issue,
    };
  });

  const purchasable = lines.filter((l) => l.issue === null);
  return {
    id: cartId,
    lines,
    itemCount: lines.reduce((sum, l) => sum + l.quantity, 0),
    subtotal: purchasable.reduce((sum, l) => sum + l.lineTotal, 0),
    hasIssues: lines.some((l) => l.issue !== null),
  };
}

async function loadPurchasableVariant(variantId: string) {
  const [variant] = await db
    .select({
      id: productVariants.id,
      stock: productVariants.stock,
      isActive: productVariants.isActive,
      productStatus: products.status,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(productVariants.id, variantId))
    .limit(1);
  if (!variant || !variant.isActive || variant.productStatus !== 'active') {
    throw notFound('This item is no longer available.');
  }
  return variant;
}

function stockError(available: number) {
  return new AppError(
    409,
    'INSUFFICIENT_STOCK',
    available <= 0 ? 'Sorry, this item is out of stock.' : `Only ${available} left in stock.`,
    { details: { available } },
  );
}

export async function addToCart(cartId: string, variantId: string, quantity: number): Promise<void> {
  const { maxQuantityPerItem } = await getSetting('checkout');
  const variant = await loadPurchasableVariant(variantId);
  const [existing] = await db
    .select({ id: cartItems.id, quantity: cartItems.quantity })
    .from(cartItems)
    .where(and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, variantId)))
    .limit(1);
  const desired = (existing?.quantity ?? 0) + quantity;
  if (desired > maxQuantityPerItem) {
    throw badRequest(`You can buy up to ${maxQuantityPerItem} of each item per order.`, 'QUANTITY_LIMIT');
  }
  if (desired > variant.stock) throw stockError(variant.stock - (existing?.quantity ?? 0));

  await db
    .insert(cartItems)
    .values({ cartId, variantId, quantity: desired })
    .onConflictDoUpdate({
      target: [cartItems.cartId, cartItems.variantId],
      set: { quantity: desired, updatedAt: new Date() },
    });
  await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));
}

export async function updateCartItem(cartId: string, itemId: string, quantity: number): Promise<void> {
  if (quantity === 0) return removeCartItem(cartId, itemId);
  const { maxQuantityPerItem } = await getSetting('checkout');
  if (quantity > maxQuantityPerItem) {
    throw badRequest(`You can buy up to ${maxQuantityPerItem} of each item per order.`, 'QUANTITY_LIMIT');
  }
  const [item] = await db
    .select({ id: cartItems.id, variantId: cartItems.variantId })
    .from(cartItems)
    .where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cartId)))
    .limit(1);
  if (!item) throw notFound('This item is no longer in your bag.');
  const variant = await loadPurchasableVariant(item.variantId);
  if (quantity > variant.stock) throw stockError(variant.stock);
  await db.update(cartItems).set({ quantity, updatedAt: new Date() }).where(eq(cartItems.id, item.id));
}

export async function removeCartItem(cartId: string, itemId: string): Promise<void> {
  await db.delete(cartItems).where(and(eq(cartItems.id, itemId), eq(cartItems.cartId, cartId)));
}

/**
 * Moves a guest cart into the user's cart after sign-in. Quantities are summed and capped by
 * stock and the per-item limit. The guest cart is deleted.
 */
export async function mergeGuestCartIntoUser(guestCartId: string | null, userId: string): Promise<void> {
  if (!guestCartId || !/^[0-9a-f-]{36}$/i.test(guestCartId)) return;
  const { maxQuantityPerItem } = await getSetting('checkout');
  await db.transaction(async (tx) => {
    const [guest] = await tx
      .select({ id: carts.id })
      .from(carts)
      .where(and(eq(carts.id, guestCartId), isNull(carts.userId)))
      .limit(1);
    if (!guest) return;
    await tx.insert(carts).values({ userId }).onConflictDoNothing({ target: carts.userId });
    const [userCart] = await tx.select({ id: carts.id }).from(carts).where(eq(carts.userId, userId)).limit(1);
    const guestItems = await tx
      .select({ variantId: cartItems.variantId, quantity: cartItems.quantity, stock: productVariants.stock })
      .from(cartItems)
      .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
      .where(eq(cartItems.cartId, guest.id));
    for (const item of guestItems) {
      const [existing] = await tx
        .select({ quantity: cartItems.quantity })
        .from(cartItems)
        .where(and(eq(cartItems.cartId, userCart!.id), eq(cartItems.variantId, item.variantId)))
        .limit(1);
      const quantity = Math.min((existing?.quantity ?? 0) + item.quantity, Math.max(item.stock, 1), maxQuantityPerItem);
      await tx
        .insert(cartItems)
        .values({ cartId: userCart!.id, variantId: item.variantId, quantity })
        .onConflictDoUpdate({ target: [cartItems.cartId, cartItems.variantId], set: { quantity, updatedAt: new Date() } });
    }
    await tx.delete(carts).where(eq(carts.id, guest.id));
  });
}

/** Re-adds items (e.g. from an unpaid/failed order) to a cart, capped by stock. */
export async function addLinesToCart(
  tx: DbOrTx,
  cartId: string,
  lines: { variantId: string | null; quantity: number }[],
): Promise<number> {
  let restored = 0;
  for (const line of lines) {
    if (!line.variantId) continue;
    const [variant] = await tx
      .select({ stock: productVariants.stock, isActive: productVariants.isActive, status: products.status })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(productVariants.id, line.variantId))
      .limit(1);
    if (!variant || !variant.isActive || variant.status !== 'active' || variant.stock <= 0) continue;
    const quantity = Math.min(line.quantity, variant.stock);
    await tx
      .insert(cartItems)
      .values({ cartId, variantId: line.variantId, quantity })
      .onConflictDoUpdate({ target: [cartItems.cartId, cartItems.variantId], set: { quantity, updatedAt: new Date() } });
    restored++;
  }
  return restored;
}
