import { route } from '@/server/http/api';
import { listColors, saveColor } from '@/server/services/admin/taxonomy';
import { colorInputSchema } from '@/lib/validation/admin';

export const GET = route(async (ctx) => {
  ctx.requirePermission('catalog:manage');
  return listColors();
});

export const POST = route(async (ctx) => {
  ctx.requirePermission('catalog:manage');
  return saveColor(await ctx.body(colorInputSchema));
});
