import { route } from '@/server/http/api';
import { getProfile, updateProfile } from '@/server/services/account';
import { profileSchema } from '@/lib/validation/store';

export const GET = route(async (ctx) => getProfile(ctx.requireUser().id));

export const PATCH = route(async (ctx) => {
  const user = ctx.requireUser();
  return updateProfile(user.id, await ctx.body(profileSchema));
});
