import { z } from 'zod';
import { route } from '@/server/http/api';
import { listOrdersForUser } from '@/server/services/orders';

export const GET = route(async (ctx) => {
  const user = ctx.requireUser();
  const { page } = ctx.query(z.object({ page: z.coerce.number().int().min(1).max(1000).optional().default(1) }));
  return listOrdersForUser(user.id, page);
});
