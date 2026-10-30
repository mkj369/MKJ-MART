import { route } from '@/server/http/api';
import { issueSessionCookie } from '@/server/http/helpers';
import { resetPassword } from '@/server/services/auth';
import { resetPasswordSchema } from '@/lib/validation/store';

export const POST = route(async (ctx) => {
  const input = await ctx.body(resetPasswordSchema);
  const result = await resetPassword(input, { ipAddress: ctx.ip, userAgent: ctx.userAgent });
  issueSessionCookie(ctx, result.token, result.expiresAt);
  return { user: result.user };
});
