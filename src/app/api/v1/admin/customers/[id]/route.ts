import { route } from '@/server/http/api';
import { getCustomer, updateCustomer } from '@/server/services/admin/customers';
import { customerUpdateSchema } from '@/lib/validation/admin';

export const GET = route<{ id: string }>(async (ctx) => {
  ctx.requirePermission('customers:view');
  return getCustomer(ctx.params.id);
});

export const PATCH = route<{ id: string }>(async (ctx) => {
  const user = ctx.requirePermission('customers:manage');
  return updateCustomer(ctx.params.id, await ctx.body(customerUpdateSchema), user);
});
