import { route } from '@/server/http/api';
import { listReturnsAdmin } from '@/server/services/returns';
import { returnListQuerySchema } from '@/lib/validation/admin';

export const GET = route(async (ctx) => {
  ctx.requirePermission('returns:manage');
  return listReturnsAdmin(ctx.query(returnListQuerySchema));
});
