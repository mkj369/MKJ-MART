import { route } from '@/server/http/api';
import { listSupportAdmin } from '@/server/services/support';
import { supportListQuerySchema } from '@/lib/validation/admin';

export const GET = route(async (ctx) => {
  ctx.requirePermission('support:manage');
  return listSupportAdmin(ctx.query(supportListQuerySchema));
});
