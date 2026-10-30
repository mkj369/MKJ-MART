import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { products, wishlistItems } from '@/server/db/schema';
import { AppError, notFound } from '@/server/errors';
import { getProductCardsByIds } from './catalog';

const MAX_WISHLIST = 100;

export async function getWishlistIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ productId: wishlistItems.productId })
    .from(wishlistItems)
    .where(eq(wishlistItems.userId, userId))
    .orderBy(desc(wishlistItems.createdAt));
  return rows.map((r) => r.productId);
}

export async function getWishlist(userId: string) {
  return getProductCardsByIds(await getWishlistIds(userId));
}

export async function addToWishlist(userId: string, productId: string) {
  const [product] = await db
    .select({ id: products.id, status: products.status })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (!product || product.status !== 'active') throw notFound('This product is no longer available.');
  const ids = await getWishlistIds(userId);
  if (!ids.includes(productId) && ids.length >= MAX_WISHLIST) {
    throw new AppError(400, 'WISHLIST_LIMIT', `Your wishlist can hold up to ${MAX_WISHLIST} items.`);
  }
  await db.insert(wishlistItems).values({ userId, productId }).onConflictDoNothing();
}

export async function removeFromWishlist(userId: string, productId: string) {
  await db.delete(wishlistItems).where(and(eq(wishlistItems.userId, userId), eq(wishlistItems.productId, productId)));
}
