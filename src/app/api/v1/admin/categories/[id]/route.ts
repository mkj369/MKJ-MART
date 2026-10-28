import { route } from '@/server/http/api';
import { deleteCategory, updateCategory } from '@/server/services/admin/taxonomy';
import { categoryInputSchema } from '@/lib/validation/admin';

export const PUT = route<{ id: string }>(async (ctx) => {
  ctx.requirePermission('catalog:manage');
  return updateCategory(ctx.params.id, await ctx.body(categoryInputSchema));
});

export const DELETE = route<{ id: string }>(async (ctx) => {
  ctx.requirePermission('catalog:manage');
  await deleteCategory(ctx.params.id);
  return { ok: true };
});
