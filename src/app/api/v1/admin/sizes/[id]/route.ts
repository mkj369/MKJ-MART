import { route } from '@/server/http/api';
import { deleteSize, saveSize } from '@/server/services/admin/taxonomy';
import { sizeInputSchema } from '@/lib/validation/admin';

export const PUT = route<{ id: string }>(async (ctx) => {
  ctx.requirePermission('catalog:manage');
  return saveSize(await ctx.body(sizeInputSchema), ctx.params.id);
});

export const DELETE = route<{ id: string }>(async (ctx) => {
  ctx.requirePermission('catalog:manage');
  await deleteSize(ctx.params.id);
  return { ok: true };
});
