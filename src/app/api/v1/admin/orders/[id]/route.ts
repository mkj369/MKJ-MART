import { route } from '@/server/http/api';
import { getOrderAdmin } from '@/server/services/admin/orders';

export const GET = route<{ id: string }>(async (ctx) => {
  ctx.requirePermission('orders:manage');
  return getOrderAdmin(ctx.params.id);
});
