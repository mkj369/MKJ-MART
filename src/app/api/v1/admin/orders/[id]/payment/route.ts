import { route } from '@/server/http/api';
import { getOrderAdmin, updateOrderPayment } from '@/server/services/admin/orders';
import { orderPaymentUpdateSchema } from '@/lib/validation/admin';

export const POST = route<{ id: string }>(async (ctx) => {
  const user = ctx.requirePermission('orders:manage');
  const input = await ctx.body(orderPaymentUpdateSchema);
  await updateOrderPayment(ctx.params.id, input.action, input.note, user.id);
  return getOrderAdmin(ctx.params.id);
});
