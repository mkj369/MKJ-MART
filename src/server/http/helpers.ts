import 'server-only';
import {
  GUEST_CART_COOKIE,
  guestCartCookieOptions,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '@/server/auth/session';
import { SESSION_CHECK_COOKIE, sessionCheckCookieOptions } from '@/server/auth/cookies';
import { ensureCart, findCartId } from '@/server/services/cart';
import type { ApiContext } from './api';

export function issueSessionCookie<P>(ctx: ApiContext<P>, token: string, expiresAt: Date) {
  ctx.setCookie(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  ctx.setCookie(SESSION_CHECK_COOKIE, '1', sessionCheckCookieOptions());
}

/** The current shopper's cart id (account cart when signed in, otherwise the guest cookie cart). */
export function currentCartId<P>(ctx: ApiContext<P>): Promise<string | null> {
  return findCartId({ userId: ctx.user?.id ?? null, guestCartId: ctx.guestCartId });
}

/** Like currentCartId, but creates a cart (and the guest cookie) when needed. */
export async function ensureCurrentCart<P>(ctx: ApiContext<P>): Promise<string> {
  const { cartId, created } = await ensureCart({ userId: ctx.user?.id ?? null, guestCartId: ctx.guestCartId });
  if (created && !ctx.user) ctx.setCookie(GUEST_CART_COOKIE, cartId, guestCartCookieOptions());
  return cartId;
}

/** Order access token supplied by guests (query string or JSON body). */
export function readOrderToken<P>(ctx: ApiContext<P>, body?: { token?: unknown }): string | null {
  const fromBody = typeof body?.token === 'string' ? body.token : null;
  return fromBody ?? ctx.req.nextUrl.searchParams.get('token');
}
