import { z } from 'zod';
import { route } from '@/server/http/api';
import { getDashboard } from '@/server/services/admin/dashboard';

export const GET = route(async (ctx) => {
  ctx.requirePermission('dashboard:view');
  const { days } = ctx.query(z.object({ days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d)).optional().default(30) }));
  return getDashboard(days);
});
