import { z } from 'zod';
import { route } from '@/server/http/api';
import { ensureCurrentCart, readOrderToken } from '@/server/http/helpers';
import { getCartView } from '@/server/services/cart';
import { restoreOrderToCart } from '@/server/services/orders';

/** After a failed or cancelled online payment, put the order's items back into the bag. */
export const POST = route<{ orderNumber: string }>(async (ctx) => {
  const body = await ctx.body(z.object({ token: z.string().max(200).optional() }));
  const cartId = await ensureCurrentCart(ctx);
  const restored = await restoreOrderToCart(ctx.params.orderNumber.toUpperCase(), { userId: ctx.user?.id, token: readOrderToken(ctx, body) }, cartId);
  return { restored, cart: await getCartView(cartId) };
});
