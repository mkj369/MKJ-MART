import { NextResponse } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';
import { frameAncestorsSources } from '@/lib/csp';
import {
  expiredCookieOptions,
  guestCartCookieOptions,
  sessionCookieOptions,
} from '@/server/auth/cookies';

const ENV_KEYS = ['COOKIE_SAMESITE', 'COOKIE_SECURE'] as const;
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function allCookieOptions() {
  return [sessionCookieOptions(new Date(Date.now() + 60_000)), guestCartCookieOptions(), expiredCookieOptions()];
}

describe('session / guest-cart cookie attributes', () => {
  it('default to HttpOnly, SameSite=Lax, not partitioned', () => {
    delete process.env.COOKIE_SAMESITE;
    process.env.COOKIE_SECURE = 'true';
    for (const options of allCookieOptions()) {
      expect(options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
      expect(options).not.toHaveProperty('partitioned');
    }
  });

  it('keep honouring COOKIE_SECURE=false for plain-HTTP local runs', () => {
    delete process.env.COOKIE_SAMESITE;
    process.env.COOKIE_SECURE = 'false';
    expect(sessionCookieOptions(new Date()).secure).toBe(false);
  });

  it('COOKIE_SAMESITE=none (iframe embedding) forces Secure and Partitioned', () => {
    process.env.COOKIE_SAMESITE = 'none';
    process.env.COOKIE_SECURE = 'false'; // must not be able to produce an invalid SameSite=None cookie
    for (const options of allCookieOptions()) {
      expect(options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'none', partitioned: true, path: '/' });
    }
  });

  it('accepts strict, and falls back to lax for unknown values', () => {
    process.env.COOKIE_SAMESITE = ' Strict ';
    expect(guestCartCookieOptions().sameSite).toBe('strict');
    process.env.COOKIE_SAMESITE = 'sometimes';
    expect(guestCartCookieOptions().sameSite).toBe('lax');
  });

  it('serialises SameSite=None with Partitioned and clears with the same attributes', () => {
    process.env.COOKIE_SAMESITE = 'none';
    const res = NextResponse.json({ ok: true });
    res.cookies.set('mkj_session', 'token', sessionCookieOptions(new Date(Date.now() + 60_000)));
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/mkj_session=token/);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=none/i);
    expect(setCookie).toMatch(/Partitioned/i);

    const cleared = NextResponse.json({ ok: true });
    cleared.cookies.set('mkj_session', '', expiredCookieOptions());
    const clearHeader = cleared.headers.get('set-cookie') ?? '';
    expect(clearHeader).toMatch(/Max-Age=0/i);
    expect(clearHeader).toMatch(/SameSite=none/i);
    expect(clearHeader).toMatch(/Partitioned/i);
  });
});

describe('CSP frame-ancestors', () => {
  it.each([
    [undefined, "'self'"],
    ['', "'self'"],
    ['   ', "'self'"],
    // Next.js / Docker Compose .env parsing turns CSP_FRAME_ANCESTORS='self' into a bare `self`.
    ['self', "'self'"],
    ["'self'", "'self'"],
    ['none', "'none'"],
    ["'none'", "'none'"],
    ['self https:', "'self' https:"],
    ['SELF https://shop.example.com', "'self' https://shop.example.com"],
  ])('%j → %s', (raw, expected) => {
    expect(frameAncestorsSources(raw)).toBe(expected);
  });

  it('leaves host sources that merely contain a keyword untouched', () => {
    expect(frameAncestorsSources('https://selfie.example')).toBe('https://selfie.example');
  });
});
