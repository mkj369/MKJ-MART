import { route } from '@/server/http/api';
import { getOrderAdmin, recordRefund } from '@/server/services/admin/orders';
import { refundInputSchema } from '@/lib/validation/admin';

/** Records a refund that was already paid outside the platform. Administrators only. */
export const POST = route<{ id: string }>(async (ctx) => {
  const user = ctx.requirePermission('refunds:manage');
  await recordRefund(ctx.params.id, await ctx.body(refundInputSchema), user.id);
  return getOrderAdmin(ctx.params.id);
});
