import { route } from '@/server/http/api';
import { deleteProduct, getProductAdmin, updateProduct } from '@/server/services/admin/products';
import { productInputSchema } from '@/lib/validation/admin';

export const GET = route<{ id: string }>(async (ctx) => {
  ctx.requirePermission('catalog:manage');
  return getProductAdmin(ctx.params.id);
});

export const PUT = route<{ id: string }>(async (ctx) => {
  const user = ctx.requirePermission('catalog:manage');
  return updateProduct(ctx.params.id, await ctx.body(productInputSchema), user.id);
});

export const DELETE = route<{ id: string }>(async (ctx) => {
  ctx.requirePermission('catalog:manage');
  await deleteProduct(ctx.params.id);
  return { ok: true };
});
