import 'server-only';
import { CART_HEADER, headerSessionsEnabled, SESSION_HEADER } from '@/lib/session-transport';
import { GUEST_CART_COOKIE, SESSION_COOKIE } from './session';

/**
 * Where the session token and guest-bag id come from: always the cookie; the `x-mkj-*` request
 * headers only when the preview header fallback is enabled and the cookie is absent
 * (see src/lib/session-transport.ts).
 */
type CookieReader = { get(name: string): { value: string } | undefined };

const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fromHeader(headers: Headers, name: string, pattern: RegExp): string | null {
  if (!headerSessionsEnabled()) return null;
  const value = headers.get(name)?.trim();
  return value && pattern.test(value) ? value : null;
}

export function sessionTokenFrom(cookies: CookieReader, headers: Headers): string | null {
  return cookies.get(SESSION_COOKIE)?.value || fromHeader(headers, SESSION_HEADER, TOKEN_RE);
}

export function guestCartIdFrom(cookies: CookieReader, headers: Headers): string | null {
  return cookies.get(GUEST_CART_COOKIE)?.value || fromHeader(headers, CART_HEADER, UUID_RE);
}
