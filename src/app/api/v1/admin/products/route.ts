import { z } from 'zod';
import { route } from '@/server/http/api';
import { createProduct, listProductsAdmin } from '@/server/services/admin/products';
import { productInputSchema } from '@/lib/validation/admin';

export const GET = route(async (ctx) => {
  ctx.requirePermission('catalog:manage');
  const query = ctx.query(
    z.object({
      q: z.string().max(100).optional(),
      status: z.enum(['draft', 'active', 'archived', 'all']).optional(),
      categoryId: z.uuid().optional(),
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(100).optional(),
    }),
  );
  return listProductsAdmin(query);
});

export const POST = route(async (ctx) => {
  const user = ctx.requirePermission('catalog:manage');
  return createProduct(await ctx.body(productInputSchema), user.id);
});
