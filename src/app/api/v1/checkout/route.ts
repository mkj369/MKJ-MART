import { route } from '@/server/http/api';
import { currentCartId } from '@/server/http/helpers';
import { enforceRateLimit } from '@/server/rate-limit';
import { placeOrder } from '@/server/services/checkout';
import { checkoutSchema } from '@/lib/validation/store';

export const POST = route(async (ctx) => {
  const input = await ctx.body(checkoutSchema);
  await enforceRateLimit(`checkout:ip:${ctx.ip ?? 'unknown'}`, 20, 10 * 60);
  const result = await placeOrder(input, { userId: ctx.user?.id ?? null, cartId: await currentCartId(ctx) });
  return result;
});
