import { NextResponse, type NextRequest } from 'next/server';
import { frameAncestorsSources } from '@/lib/csp';
import { headerSessionsEnabled, SESSION_HEADER } from '@/lib/session-transport';

/**
 * Runs before page routes:
 *  1. Production Content-Security-Policy with a per-request nonce (Next.js applies it to its scripts).
 *  2. Fast redirects for signed-out visitors to protected areas. This is a convenience only — every
 *     protected page and API re-validates the session and role on the server.
 */
const SESSION_COOKIE = 'mkj_session';

function contentSecurityPolicy(nonce: string, isDev: boolean): string {
  const frameAncestors = frameAncestorsSources(process.env.CSP_FRAME_ANCESTORS);
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
  ].join('; ');
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // The preview header fallback (src/lib/session-transport.ts) carries the session in a header.
  const hasSession = request.cookies.has(SESSION_COOKIE) || (headerSessionsEnabled() && request.headers.has(SESSION_HEADER));

  if (pathname.startsWith('/admin') && pathname !== '/admin/login' && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/admin/login';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  if (pathname.startsWith('/account') && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  // CSP is enforced in production builds; development tooling (HMR, React debugging) needs eval.
  if (process.env.NODE_ENV !== 'production') return NextResponse.next();

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = contentSecurityPolicy(nonce, false);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|media|images|favicon.ico|robots.txt|sitemap.xml).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
