import { route } from '@/server/http/api';
import { listStockMovements } from '@/server/services/admin/inventory';

export const GET = route<{ variantId: string }>(async (ctx) => {
  ctx.requirePermission('inventory:manage');
  return listStockMovements(ctx.params.variantId);
});
