import { route } from '@/server/http/api';
import { ensureCurrentCart } from '@/server/http/helpers';
import { addToCart, getCartView } from '@/server/services/cart';
import { addToCartSchema } from '@/lib/validation/store';

export const POST = route(async (ctx) => {
  const input = await ctx.body(addToCartSchema);
  const cartId = await ensureCurrentCart(ctx);
  await addToCart(cartId, input.variantId, input.quantity);
  return getCartView(cartId);
});
