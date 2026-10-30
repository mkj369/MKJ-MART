import { z } from 'zod';
import { route } from '@/server/http/api';
import { addToWishlist, getWishlist, getWishlistIds } from '@/server/services/wishlist';

export const GET = route(async (ctx) => {
  const user = ctx.requireUser();
  return { items: await getWishlist(user.id) };
});

export const POST = route(async (ctx) => {
  const user = ctx.requireUser();
  const { productId } = await ctx.body(z.object({ productId: z.uuid() }));
  await addToWishlist(user.id, productId);
  return { ids: await getWishlistIds(user.id) };
});
