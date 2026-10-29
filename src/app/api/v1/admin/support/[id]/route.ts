import { route } from '@/server/http/api';
import { getSupportAdmin, updateSupportRequest } from '@/server/services/support';
import { supportUpdateSchema } from '@/lib/validation/admin';

export const GET = route<{ id: string }>(async (ctx) => {
  ctx.requirePermission('support:manage');
  return getSupportAdmin(ctx.params.id);
});

export const PATCH = route<{ id: string }>(async (ctx) => {
  ctx.requirePermission('support:manage');
  const input = await ctx.body(supportUpdateSchema);
  await updateSupportRequest(ctx.params.id, { status: input.status, adminNote: input.adminNote });
  return getSupportAdmin(ctx.params.id);
});
