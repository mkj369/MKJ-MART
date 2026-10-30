import { route } from '@/server/http/api';
import { requestPasswordReset } from '@/server/services/auth';
import { forgotPasswordSchema } from '@/lib/validation/store';

/** Always answers the same way, whether or not an account exists for the email. */
export const POST = route(async (ctx) => {
  const input = await ctx.body(forgotPasswordSchema);
  await requestPasswordReset(input, { ipAddress: ctx.ip, userAgent: ctx.userAgent });
  return { ok: true, message: 'If an account exists for that email, we have sent a link to reset the password.' };
});
