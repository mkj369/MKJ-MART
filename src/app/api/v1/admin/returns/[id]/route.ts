import { route } from '@/server/http/api';
import { decideReturn, getReturnAdmin } from '@/server/services/returns';
import { returnDecisionSchema } from '@/lib/validation/admin';

export const GET = route<{ id: string }>(async (ctx) => {
  ctx.requirePermission('returns:manage');
  return getReturnAdmin(ctx.params.id);
});

/** approve | reject | receive (optionally restocking the returned units). */
export const PATCH = route<{ id: string }>(async (ctx) => {
  const user = ctx.requirePermission('returns:manage');
  await decideReturn(ctx.params.id, await ctx.body(returnDecisionSchema), user.id);
  return getReturnAdmin(ctx.params.id);
});
