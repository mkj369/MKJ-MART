import { route } from '@/server/http/api';
import { enforceRateLimit } from '@/server/rate-limit';
import { getOrderAdmin } from '@/server/services/admin/orders';
import { reconcileOrderPayment } from '@/server/services/payments';

/** Asks SSLCommerz (Transaction Query API) whether this order was paid. */
export const POST = route<{ id: string }>(async (ctx) => {
  const user = ctx.requirePermission('orders:manage');
  await enforceRateLimit(`reconcile:${user.id}`, 30, 10 * 60);
  const { outcome } = await reconcileOrderPayment(ctx.params.id, user.id);
  return { outcome, order: await getOrderAdmin(ctx.params.id) };
});
