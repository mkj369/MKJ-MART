import { route } from '@/server/http/api';
import { notFound } from '@/server/errors';
import { enforceRateLimit } from '@/server/rate-limit';
import { trackOrder } from '@/server/services/orders';
import { trackOrderSchema } from '@/lib/validation/store';

/** Public order tracking by order number + the phone used at checkout (rate limited, limited view). */
export const POST = route(async (ctx) => {
  await enforceRateLimit(`track:ip:${ctx.ip ?? 'unknown'}`, 30, 10 * 60);
  const input = await ctx.body(trackOrderSchema);
  const result = await trackOrder(input.orderNumber, input.phone);
  if (!result) throw notFound('We could not find an order with that number and phone. Please check and try again.');
  return result;
});
