import { route } from '@/server/http/api';
import { createCategory, listCategoriesAdmin } from '@/server/services/admin/taxonomy';
import { categoryInputSchema } from '@/lib/validation/admin';

export const GET = route(async (ctx) => {
  ctx.requirePermission('catalog:manage');
  return listCategoriesAdmin();
});

export const POST = route(async (ctx) => {
  ctx.requirePermission('catalog:manage');
  return createCategory(await ctx.body(categoryInputSchema));
});
