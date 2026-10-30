import { SESSION_CHECK_COOKIE } from '@/server/auth/cookies';
import { SESSION_COOKIE } from '@/server/auth/session';
import { route } from '@/server/http/api';
import { currentCartId } from '@/server/http/helpers';
import { log } from '@/server/logger';
import { getCartView } from '@/server/services/cart';
import { getWishlistIds } from '@/server/services/wishlist';

const PROBES = new Set(['visible', 'missing', 'blocked']);

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return 'invalid';
  }
}

/** Session bootstrap: who am I, how many items are in my bag, what is on my wishlist. */
export const GET = route(async (ctx) => {
  const cart = await getCartView(await currentCartId(ctx));
  const payload = {
    user: ctx.user,
    cartCount: cart.itemCount,
    wishlistIds: ctx.user ? await getWishlistIds(ctx.user.id) : [],
  };
  const params = ctx.req.nextUrl.searchParams;
  if (params.get('check') !== '1') return payload;

  // Post-sign-in confirmation (confirmSession in auth-forms): report which cookies arrived, and
  // log the failure with enough context to tell a browser that blocks cookies from a proxy that strips them.
  const sessionCheck = {
    sessionReceived: ctx.req.cookies.has(SESSION_COOKIE),
    probeReceived: ctx.req.cookies.has(SESSION_CHECK_COOKIE),
  };
  if (!ctx.user) {
    const probe = params.get('probe') ?? '';
    log.warn('auth.session_check_failed', {
      probe: PROBES.has(probe) ? probe : 'unknown',
      ...sessionCheck,
      fetchSite: ctx.req.headers.get('sec-fetch-site'),
      pageHost: hostOf(ctx.req.headers.get('origin') ?? ctx.req.headers.get('referer')),
      requestHost: ctx.req.headers.get('host'),
      forwardedHost: ctx.req.headers.get('x-forwarded-host'),
    });
  }
  return { ...payload, sessionCheck };
});
