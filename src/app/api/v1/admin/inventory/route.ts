import { z } from 'zod';
import { route } from '@/server/http/api';
import { listInventory } from '@/server/services/admin/inventory';

export const GET = route(async (ctx) => {
  ctx.requirePermission('inventory:manage');
  return listInventory(
    ctx.query(
      z.object({
        q: z.string().max(100).optional(),
        filter: z.enum(['all', 'low', 'out']).optional(),
        page: z.coerce.number().int().min(1).optional(),
      }),
    ),
  );
});
