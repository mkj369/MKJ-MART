import { route } from '@/server/http/api';
import { getOrderAdmin, updateOrderStatus } from '@/server/services/admin/orders';
import { orderStatusUpdateSchema } from '@/lib/validation/admin';

export const POST = route<{ id: string }>(async (ctx) => {
  const user = ctx.requirePermission('orders:manage');
  await updateOrderStatus(ctx.params.id, await ctx.body(orderStatusUpdateSchema), user.id);
  return getOrderAdmin(ctx.params.id);
});
