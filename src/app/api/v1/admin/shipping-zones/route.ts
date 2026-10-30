import { route } from '@/server/http/api';
import { listShippingZonesAdmin, saveShippingZone } from '@/server/services/admin/shipping';
import { shippingZoneInputSchema } from '@/lib/validation/admin';

export const GET = route(async (ctx) => {
  ctx.requirePermission('shipping:manage');
  return listShippingZonesAdmin();
});

export const POST = route(async (ctx) => {
  ctx.requirePermission('shipping:manage');
  return saveShippingZone(await ctx.body(shippingZoneInputSchema));
});
