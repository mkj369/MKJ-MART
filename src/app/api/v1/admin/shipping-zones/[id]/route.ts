import { route } from '@/server/http/api';
import { deleteShippingZone, saveShippingZone } from '@/server/services/admin/shipping';
import { shippingZoneInputSchema } from '@/lib/validation/admin';

export const PUT = route<{ id: string }>(async (ctx) => {
  ctx.requirePermission('shipping:manage');
  return saveShippingZone(await ctx.body(shippingZoneInputSchema), ctx.params.id);
});

export const DELETE = route<{ id: string }>(async (ctx) => {
  ctx.requirePermission('shipping:manage');
  await deleteShippingZone(ctx.params.id);
  return { ok: true };
});
