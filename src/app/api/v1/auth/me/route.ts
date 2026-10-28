import { route } from '@/server/http/api';
import { currentCartId } from '@/server/http/helpers';
import { getCartView } from '@/server/services/cart';
import { getWishlistIds } from '@/server/services/wishlist';

/** Session bootstrap: who am I, how many items are in my bag, what is on my wishlist. */
export const GET = route(async (ctx) => {
  const cart = await getCartView(await currentCartId(ctx));
  return {
    user: ctx.user,
    cartCount: cart.itemCount,
    wishlistIds: ctx.user ? await getWishlistIds(ctx.user.id) : [],
  };
});
