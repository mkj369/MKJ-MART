import { route } from '@/server/http/api';
import { listOrdersAdmin } from '@/server/services/admin/orders';
import { orderListQuerySchema } from '@/lib/validation/admin';

export const GET = route(async (ctx) => {
  ctx.requirePermission('orders:manage');
  return listOrdersAdmin(ctx.query(orderListQuerySchema));
});
