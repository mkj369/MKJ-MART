import { z } from 'zod';
import { route } from '@/server/http/api';
import { listCustomers } from '@/server/services/admin/customers';

export const GET = route(async (ctx) => {
  ctx.requirePermission('customers:view');
  return listCustomers(
    ctx.query(
      z.object({
        q: z.string().max(100).optional(),
        role: z.enum(['customer', 'staff', 'all']).optional(),
        status: z.enum(['active', 'blocked', 'all']).optional(),
        page: z.coerce.number().int().min(1).optional(),
      }),
    ),
  );
});
