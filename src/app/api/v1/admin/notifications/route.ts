import { z } from 'zod';
import { route } from '@/server/http/api';
import { listRecentNotifications } from '@/server/notifications';

export const GET = route(async (ctx) => {
  ctx.requirePermission('settings:manage');
  const query = ctx.query(z.object({ status: z.enum(['pending', 'sent', 'failed', 'skipped']).optional() }));
  return listRecentNotifications({ status: query.status, limit: 100 });
});
