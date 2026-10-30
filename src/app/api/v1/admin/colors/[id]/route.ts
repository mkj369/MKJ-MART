import { route } from '@/server/http/api';
import { deleteColor, saveColor } from '@/server/services/admin/taxonomy';
import { colorInputSchema } from '@/lib/validation/admin';

export const PUT = route<{ id: string }>(async (ctx) => {
  ctx.requirePermission('catalog:manage');
  return saveColor(await ctx.body(colorInputSchema), ctx.params.id);
});

export const DELETE = route<{ id: string }>(async (ctx) => {
  ctx.requirePermission('catalog:manage');
  await deleteColor(ctx.params.id);
  return { ok: true };
});
