import { route } from '@/server/http/api';
import { deleteCoupon, saveCoupon } from '@/server/services/admin/coupons';
import { couponInputSchema } from '@/lib/validation/admin';

export const PUT = route<{ id: string }>(async (ctx) => {
  ctx.requirePermission('coupons:manage');
  return saveCoupon(await ctx.body(couponInputSchema), ctx.params.id);
});

export const DELETE = route<{ id: string }>(async (ctx) => {
  ctx.requirePermission('coupons:manage');
  await deleteCoupon(ctx.params.id);
  return { ok: true };
});
