import { route } from '@/server/http/api';
import { currentCartId } from '@/server/http/helpers';
import { getCheckoutQuote } from '@/server/services/checkout';
import { quoteSchema } from '@/lib/validation/store';

/** Live order summary for the checkout page: delivery fee by district, coupon, totals, payment options. */
export const POST = route(async (ctx) => {
  const input = await ctx.body(quoteSchema);
  return getCheckoutQuote(await currentCartId(ctx), input, { userId: ctx.user?.id ?? null });
});
