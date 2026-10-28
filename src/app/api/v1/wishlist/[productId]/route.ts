import { route } from '@/server/http/api';
import { removeFromWishlist, getWishlistIds } from '@/server/services/wishlist';

export const DELETE = route<{ productId: string }>(async (ctx) => {
  const user = ctx.requireUser();
  await removeFromWishlist(user.id, ctx.params.productId);
  return { ids: await getWishlistIds(user.id) };
});
