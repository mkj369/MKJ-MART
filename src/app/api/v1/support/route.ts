import { route } from '@/server/http/api';
import { createSupportRequest } from '@/server/services/support';
import { supportRequestSchema } from '@/lib/validation/store';

export const POST = route(async (ctx) => {
  const input = await ctx.body(supportRequestSchema);
  return createSupportRequest(input, { ipAddress: ctx.ip, userId: ctx.user?.id ?? null });
});
