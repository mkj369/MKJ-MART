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

/**
 * Non-secret marker ("1") set next to every new session cookie, with the same attributes but
 * readable by JavaScript and short-lived. After signing in, the browser checks it to tell apart
 * "the browser did not keep cookies" from "cookies are not reaching the server" (see confirmSession).
 */
export const SESSION_CHECK_COOKIE = 'mkj_cookie_check';

export function sessionCheckCookieOptions() {
  return { ...baseCookieOptions(), httpOnly: false, maxAge: 300 };
}
