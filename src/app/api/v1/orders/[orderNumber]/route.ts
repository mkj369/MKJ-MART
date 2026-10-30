import { route } from '@/server/http/api';
import { readOrderToken } from '@/server/http/helpers';
import { notFound } from '@/server/errors';
import { getOrderForViewer } from '@/server/services/orders';

/** Visible to the signed-in owner, or to anyone holding the order's private access token (guests). */
export const GET = route<{ orderNumber: string }>(async (ctx) => {
  const order = await getOrderForViewer(ctx.params.orderNumber.toUpperCase(), {
    userId: ctx.user?.id,
    token: readOrderToken(ctx),
  });
  if (!order) throw notFound('Order not found.');
  return order;
});
