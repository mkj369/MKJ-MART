import { route } from '@/server/http/api';
import { deleteAddress, updateAddress } from '@/server/services/account';
import { addressSchema } from '@/lib/validation/store';

export const PATCH = route<{ id: string }>(async (ctx) => {
  const user = ctx.requireUser();
  return updateAddress(user.id, ctx.params.id, await ctx.body(addressSchema));
});

export const DELETE = route<{ id: string }>(async (ctx) => {
  const user = ctx.requireUser();
  await deleteAddress(user.id, ctx.params.id);
  return { ok: true };
});
