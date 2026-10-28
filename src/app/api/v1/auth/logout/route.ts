import { route } from '@/server/http/api';
import { invalidateSession, SESSION_COOKIE } from '@/server/auth/session';

export const POST = route(async (ctx) => {
  await invalidateSession(ctx.req.cookies.get(SESSION_COOKIE)?.value);
  ctx.deleteCookie(SESSION_COOKIE);
  return { ok: true };
});
