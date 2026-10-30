import { route } from '@/server/http/api';
import { currentCartId } from '@/server/http/helpers';
import { notFound } from '@/server/errors';
import { getCartView, removeCartItem, updateCartItem } from '@/server/services/cart';
import { updateCartItemSchema } from '@/lib/validation/store';

export const PATCH = route<{ itemId: string }>(async (ctx) => {
  const input = await ctx.body(updateCartItemSchema);
  const cartId = await currentCartId(ctx);
  if (!cartId) throw notFound('Your bag is empty.');
  await updateCartItem(cartId, ctx.params.itemId, input.quantity);
  return getCartView(cartId);
});

export const DELETE = route<{ itemId: string }>(async (ctx) => {
  const cartId = await currentCartId(ctx);
  if (!cartId) throw notFound('Your bag is empty.');
  await removeCartItem(cartId, ctx.params.itemId);
  return getCartView(cartId);
});
