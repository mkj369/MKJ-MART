import 'server-only';
import { cookieSameSite, cookieSecure } from '@/server/env';

/**
 * Attributes shared by every cookie the app sets (session and guest cart).
 *
 * With COOKIE_SAMESITE=none the cookies must also be `Secure` (browsers reject SameSite=None
 * otherwise) and `Partitioned` (CHIPS), so browsers that block third-party cookies still keep a
 * separate cookie jar for the embedding site instead of silently dropping the session.
 */
export function baseCookieOptions() {
  const sameSite = cookieSameSite();
  if (sameSite === 'none') {
    return { httpOnly: true, secure: true, sameSite, partitioned: true, path: '/' } as const;
  }
  return { httpOnly: true, secure: cookieSecure(), sameSite, path: '/' } as const;
}

export function sessionCookieOptions(expiresAt: Date) {
  return { ...baseCookieOptions(), expires: expiresAt };
}

export function guestCartCookieOptions() {
  return { ...baseCookieOptions(), maxAge: 60 * 24 * 60 * 60 }; // 60 days
}

/**
 * Clearing a cookie must repeat its attributes: a SameSite=None or Partitioned cookie is left in
 * place by a bare `Set-Cookie: name=; Max-Age=0`, which would make sign-out silently fail.
 */
export function expiredCookieOptions() {
  return { ...baseCookieOptions(), maxAge: 0 };
}
