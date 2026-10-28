import { route } from '@/server/http/api';
import { deleteCollection, updateCollection } from '@/server/services/admin/taxonomy';
import { collectionInputSchema } from '@/lib/validation/admin';

export const PUT = route<{ id: string }>(async (ctx) => {
  ctx.requirePermission('catalog:manage');
  return updateCollection(ctx.params.id, await ctx.body(collectionInputSchema));
});

export const DELETE = route<{ id: string }>(async (ctx) => {
  ctx.requirePermission('catalog:manage');
  await deleteCollection(ctx.params.id);
  return { ok: true };
});
