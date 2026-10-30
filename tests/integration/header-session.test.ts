/**
 * Preview header fallback (src/lib/session-transport.ts): when a hosting proxy strips the Cookie
 * header, the session and guest bag travel in x-mkj-* headers instead. Exercised through the real
 * route handlers. The fallback must be off by default and require DEMO_MODE=true.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { POST as logout } from '@/app/api/v1/auth/logout/route';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { POST as addItem } from '@/app/api/v1/cart/items/route';
import { createProduct, createUser, seedReferenceData } from '../support/fixtures';

const ctx = () => ({ params: Promise.resolve({} as Record<string, never>) });

function request(path: string, init: { body?: unknown; method?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'sec-fetch-site': 'same-origin', ...(init.headers ?? {}) };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

type MePayload = { data: { user: { email: string } | null; cartCount: number } };
const whoAmI = async (headers: Record<string, string>) => ((await (await me(request('/api/v1/auth/me', { headers }), ctx())).json()) as MePayload).data;
const cookieToken = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith('mkj_session='))!.split(';')[0]!.split('=')[1]!;

const saved = { fallback: process.env.SESSION_HEADER_FALLBACK, demo: process.env.DEMO_MODE };
afterEach(() => {
  for (const [key, value] of [['SESSION_HEADER_FALLBACK', saved.fallback], ['DEMO_MODE', saved.demo]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const enable = () => {
  process.env.SESSION_HEADER_FALLBACK = 'true';
  process.env.DEMO_MODE = 'true';
};

let variantId: string;
beforeAll(async () => {
  await seedReferenceData();
  variantId = (await createProduct({ price: 90_000, stock: { M: 20 } })).variants.M!.id;
});

describe('header session fallback (proxies that strip cookies)', () => {
  it('is off by default: no mirror header, and the request header is ignored', async () => {
    delete process.env.SESSION_HEADER_FALLBACK;
    const { user, password } = await createUser();
    const res = await login(request('/api/v1/auth/login', { body: { email: user.email, password } }), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get('x-mkj-set-session')).toBeNull();
    expect((await whoAmI({ 'x-mkj-session': cookieToken(res) })).user).toBeNull();
  });

  it('stays off unless DEMO_MODE=true (never on a real store)', async () => {
    process.env.SESSION_HEADER_FALLBACK = 'true';
    delete process.env.DEMO_MODE;
    const { user, password } = await createUser();
    const res = await login(request('/api/v1/auth/login', { body: { email: user.email, password } }), ctx());
    expect(res.headers.get('x-mkj-set-session')).toBeNull();
    expect((await whoAmI({ 'x-mkj-session': cookieToken(res) })).user).toBeNull();
  });

  it('when enabled: sign-in mirrors the token, the header authenticates, sign-out clears and revokes it', async () => {
    enable();
    const { user, password } = await createUser();
    const res = await login(request('/api/v1/auth/login', { body: { email: user.email, password } }), ctx());
    const token = res.headers.get('x-mkj-set-session');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).toBe(cookieToken(res));
    expect((await whoAmI({ 'x-mkj-session': token! })).user?.email).toBe(user.email);

    const out = await logout(request('/api/v1/auth/logout', { method: 'POST', headers: { 'x-mkj-session': token! } }), ctx());
    expect(out.status).toBe(200);
    expect(out.headers.get('x-mkj-set-session')).toBe('-');
    expect((await whoAmI({ 'x-mkj-session': token! })).user).toBeNull();
  });

  it('keeps CSRF protection: a cross-site request carrying the header is rejected', async () => {
    enable();
    const { user, password } = await createUser();
    const token = (await login(request('/api/v1/auth/login', { body: { email: user.email, password } }), ctx())).headers.get('x-mkj-set-session')!;
    const forged = await logout(request('/api/v1/auth/logout', { method: 'POST', headers: { 'x-mkj-session': token, 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' } }), ctx());
    expect(forged.status).toBe(403);
    expect((await whoAmI({ 'x-mkj-session': token })).user?.email).toBe(user.email);
  });

  it('ignores malformed values, and a real cookie always wins over the header', async () => {
    enable();
    expect((await whoAmI({ 'x-mkj-session': 'not a token; drop table' })).user).toBeNull();
    const a = await createUser();
    const b = await createUser();
    const resA = await login(request('/api/v1/auth/login', { body: { email: a.user.email, password: a.password } }), ctx());
    const resB = await login(request('/api/v1/auth/login', { body: { email: b.user.email, password: b.password } }), ctx());
    const viewer = await whoAmI({ cookie: `mkj_session=${cookieToken(resA)}`, 'x-mkj-session': resB.headers.get('x-mkj-set-session')! });
    expect(viewer.user?.email).toBe(a.user.email);
  });

  it('carries the guest bag in x-mkj-cart and merges it into the account at sign-in', async () => {
    enable();
    const first = await addItem(request('/api/v1/cart/items', { body: { variantId, quantity: 1 } }), ctx());
    expect(first.status).toBe(200);
    const cartId = first.headers.get('x-mkj-set-cart');
    expect(cartId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await addItem(request('/api/v1/cart/items', { body: { variantId, quantity: 1 }, headers: { 'x-mkj-cart': cartId! } }), ctx())).status).toBe(200);
    expect((await whoAmI({ 'x-mkj-cart': cartId! })).cartCount).toBe(2);

    const { user, password } = await createUser();
    const res = await login(request('/api/v1/auth/login', { body: { email: user.email, password }, headers: { 'x-mkj-cart': cartId! } }), ctx());
    expect(res.headers.get('x-mkj-set-cart')).toBe('-');
    expect((await whoAmI({ 'x-mkj-session': res.headers.get('x-mkj-set-session')! })).cartCount).toBe(2);
  });
});
