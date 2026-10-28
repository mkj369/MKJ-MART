import { route } from '@/server/http/api';
import { updateAdminNote } from '@/server/services/admin/orders';
import { orderNoteSchema } from '@/lib/validation/admin';

export const PUT = route<{ id: string }>(async (ctx) => {
  ctx.requirePermission('orders:manage');
  const { adminNote } = await ctx.body(orderNoteSchema);
  await updateAdminNote(ctx.params.id, adminNote);
  return { ok: true };
});
