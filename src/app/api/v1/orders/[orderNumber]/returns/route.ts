import { route } from '@/server/http/api';
import { readOrderToken } from '@/server/http/helpers';
import { createReturnRequest } from '@/server/services/returns';
import { returnRequestSchema } from '@/lib/validation/store';

/** Order owner (signed in) or holder of the guest order link may request a return. */
export const POST = route<{ orderNumber: string }>(async (ctx) => {
  const input = await ctx.body(returnRequestSchema);
  return createReturnRequest(ctx.params.orderNumber.toUpperCase(), { userId: ctx.user?.id, token: readOrderToken(ctx, input) }, input, {
    ipAddress: ctx.ip,
  });
});
