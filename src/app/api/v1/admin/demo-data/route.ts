import { route } from '@/server/http/api';
import { getDemoDataSummary, purgeDemoData } from '@/server/services/admin/demo-data';

export const GET = route(async (ctx) => {
  ctx.requirePermission('settings:manage');
  return getDemoDataSummary();
});

/** Irreversibly removes every demo-flagged record (products, orders, demo accounts, coupons…). */
export const DELETE = route(async (ctx) => {
  const user = ctx.requirePermission('settings:manage');
  return purgeDemoData(user.id);
});
