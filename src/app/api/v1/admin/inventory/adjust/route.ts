import { route } from '@/server/http/api';
import { adjustStock } from '@/server/services/admin/inventory';
import { stockAdjustmentSchema } from '@/lib/validation/admin';

export const POST = route(async (ctx) => {
  const user = ctx.requirePermission('inventory:manage');
  return adjustStock(await ctx.body(stockAdjustmentSchema), user.id);
});
