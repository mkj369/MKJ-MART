import { route } from '@/server/http/api';
import { issueSessionCookie } from '@/server/http/helpers';
import { GUEST_CART_COOKIE, invalidateSession, SESSION_COOKIE } from '@/server/auth/session';
import { login } from '@/server/services/auth';
import { mergeGuestCartIntoUser } from '@/server/services/cart';
import { loginSchema } from '@/lib/validation/store';

export const POST = route(async (ctx) => {
  const input = await ctx.body(loginSchema);
  const result = await login(input, { ipAddress: ctx.ip, userAgent: ctx.userAgent }, 'store');
  // Session fixation defence: drop any previous session before issuing the new one.
  await invalidateSession(ctx.req.cookies.get(SESSION_COOKIE)?.value);
  await mergeGuestCartIntoUser(ctx.guestCartId, result.user.id);
  if (ctx.guestCartId) ctx.deleteCookie(GUEST_CART_COOKIE);
  issueSessionCookie(ctx, result.token, result.expiresAt);
  return { user: result.user };
});
