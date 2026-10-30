import { route } from '@/server/http/api';
import { createAddress, listAddresses } from '@/server/services/account';
import { addressSchema } from '@/lib/validation/store';

export const GET = route(async (ctx) => listAddresses(ctx.requireUser().id));

export const POST = route(async (ctx) => {
  const user = ctx.requireUser();
  return createAddress(user.id, await ctx.body(addressSchema));
});
