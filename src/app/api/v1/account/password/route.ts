import { route } from '@/server/http/api';
import { changePassword } from '@/server/services/account';
import { changePasswordSchema } from '@/lib/validation/store';

/** Changes the password and signs out all other devices. */
export const POST = route(async (ctx) => {
  const user = ctx.requireUser();
  await changePassword(user.id, ctx.session!.sessionId, await ctx.body(changePasswordSchema));
  return { ok: true };
});
