import { z } from 'zod';
import { route } from '@/server/http/api';
import { getOrderAdmin, updateOrderShipping } from '@/server/services/admin/orders';
import { orderStatusUpdateSchema } from '@/lib/validation/admin';

const shippingSchema = orderStatusUpdateSchema.pick({ courierName: true, trackingNumber: true, trackingUrl: true }).extend({
  courierName: z.string().trim().min(1, 'Courier is required.').max(80),
});

export const PUT = route<{ id: string }>(async (ctx) => {
  const user = ctx.requirePermission('orders:manage');
  const input = await ctx.body(shippingSchema);
  await updateOrderShipping(ctx.params.id, { courierName: input.courierName, trackingNumber: input.trackingNumber ?? null, trackingUrl: input.trackingUrl ?? null }, user.id);
  return getOrderAdmin(ctx.params.id);
});
