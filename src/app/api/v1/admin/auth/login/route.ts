import { route } from '@/server/http/api';
import { issueSessionCookie } from '@/server/http/helpers';
import { invalidateSession } from '@/server/auth/session';
import { login } from '@/server/services/auth';
import { loginSchema } from '@/lib/validation/store';

/** Staff sign-in. Customers are rejected even with a correct password. */
export const POST = route(async (ctx) => {
  const input = await ctx.body(loginSchema);
  const result = await login(input, { ipAddress: ctx.ip, userAgent: ctx.userAgent }, 'admin');
  await invalidateSession(ctx.sessionToken);
  issueSessionCookie(ctx, result.token, result.expiresAt);
  return { user: result.user };
});
