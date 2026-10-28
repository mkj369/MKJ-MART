import { route } from '@/server/http/api';
import { listCouponsAdmin, saveCoupon } from '@/server/services/admin/coupons';
import { couponInputSchema } from '@/lib/validation/admin';

export const GET = route(async (ctx) => {
  ctx.requirePermission('coupons:manage');
  return listCouponsAdmin();
});

export const POST = route(async (ctx) => {
  ctx.requirePermission('coupons:manage');
  return saveCoupon(await ctx.body(couponInputSchema));
});
