import { z } from 'zod';
import { route } from '@/server/http/api';
import { readOrderToken } from '@/server/http/helpers';
import { enforceRateLimit } from '@/server/rate-limit';
import { retryOnlinePayment } from '@/server/services/payments';

/** Starts a new SSLCommerz session for a pending online order whose earlier attempt failed. */
export const POST = route<{ orderNumber: string }>(async (ctx) => {
  const body = await ctx.body(z.object({ token: z.string().max(200).optional() }));
  await enforceRateLimit(`pay-retry:ip:${ctx.ip ?? 'unknown'}`, 20, 10 * 60);
  return retryOnlinePayment(ctx.params.orderNumber.toUpperCase(), { userId: ctx.user?.id, token: readOrderToken(ctx, body) });
});
