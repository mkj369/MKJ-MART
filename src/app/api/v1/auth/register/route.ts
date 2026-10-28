import { route } from '@/server/http/api';
import { issueSessionCookie } from '@/server/http/helpers';
import { GUEST_CART_COOKIE } from '@/server/auth/session';
import { registerCustomer } from '@/server/services/auth';
import { mergeGuestCartIntoUser } from '@/server/services/cart';
import { registerSchema } from '@/lib/validation/store';

export const POST = route(async (ctx) => {
  const input = await ctx.body(registerSchema);
  const result = await registerCustomer(input, { ipAddress: ctx.ip, userAgent: ctx.userAgent });
  await mergeGuestCartIntoUser(ctx.guestCartId, result.user.id);
  if (ctx.guestCartId) ctx.deleteCookie(GUEST_CART_COOKIE);
  issueSessionCookie(ctx, result.token, result.expiresAt);
  return { user: result.user };
});
