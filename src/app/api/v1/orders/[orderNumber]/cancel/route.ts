import { z } from 'zod';
import { route } from '@/server/http/api';
import { readOrderToken } from '@/server/http/helpers';
import { cancelOrderByCustomer } from '@/server/services/orders';

export const POST = route<{ orderNumber: string }>(async (ctx) => {
  const body = await ctx.body(z.object({ token: z.string().max(200).optional() }));
  return cancelOrderByCustomer(ctx.params.orderNumber.toUpperCase(), { userId: ctx.user?.id, token: readOrderToken(ctx, body) });
});
