import { route } from '@/server/http/api';
import { createCollection, listCollectionsAdmin } from '@/server/services/admin/taxonomy';
import { collectionInputSchema } from '@/lib/validation/admin';

export const GET = route(async (ctx) => {
  ctx.requirePermission('catalog:manage');
  return listCollectionsAdmin();
});

export const POST = route(async (ctx) => {
  ctx.requirePermission('catalog:manage');
  return createCollection(await ctx.body(collectionInputSchema));
});
