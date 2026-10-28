import { route } from '@/server/http/api';
import { listSizes, saveSize } from '@/server/services/admin/taxonomy';
import { sizeInputSchema } from '@/lib/validation/admin';

export const GET = route(async (ctx) => {
  ctx.requirePermission('catalog:manage');
  return listSizes();
});

export const POST = route(async (ctx) => {
  ctx.requirePermission('catalog:manage');
  return saveSize(await ctx.body(sizeInputSchema));
});
