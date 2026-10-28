/**
 * HTTP-level tests: Route Handlers are invoked directly with real Request objects, so the full
 * stack (CSRF guard, session cookies, RBAC, validation, error envelopes) is exercised.
 */
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { POST as adminLogin } from '@/app/api/v1/admin/auth/login/route';
import { GET as dashboard } from '@/app/api/v1/admin/dashboard/route';
import { GET as getSettings } from '@/app/api/v1/admin/settings/[key]/route';
import { GET as getAdminOrder } from '@/app/api/v1/admin/orders/[id]/route';
import { POST as addItem } from '@/app/api/v1/cart/items/route';
import { POST as checkout } from '@/app/api/v1/checkout/route';
import { GET as health } from '@/app/api/v1/health/route';
import { createProduct, createUser, seedReferenceData } from '../support/fixtures';

const ctx = <P extends Record<string, string> = Record<string, never>>(params?: P) => ({ params: Promise.resolve((params ?? {}) as P) });

function request(path: string, init: { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string>; rawBody?: string } = {}) {
  const headers: Record<string, string> = { 'sec-fetch-site': 'same-origin', ...(init.headers ?? {}) };
  if (init.body !== undefined || init.rawBody !== undefined) headers['content-type'] = 'application/json';
  if (init.cookie) headers.cookie = init.cookie;
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init.method ?? (init.body !== undefined || init.rawBody !== undefined ? 'POST' : 'GET'),
    headers,
    body: init.rawBody ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });
}

function sessionCookie(res: Response): string {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith('mkj_session='));
  if (!raw) throw new Error('no session cookie');
  expect(raw).toMatch(/HttpOnly/i);
  expect(raw).toMatch(/SameSite=lax/i);
  return raw.split(';')[0]!;
}

let customer: { email: string; password: string };
let staff: { email: string; password: string };
let admin: { email: string; password: string };

beforeAll(async () => {
  await seedReferenceData();
  const c = await createUser({ role: 'customer' });
  const s = await createUser({ role: 'staff' });
  const a = await createUser({ role: 'admin' });
  customer = { email: c.user.email, password: c.password };
  staff = { email: s.user.email, password: s.password };
  admin = { email: a.user.email, password: a.password };
});

describe('API envelope & validation', () => {
  it('reports health with the database status', async () => {
    const res = await health(request('/api/v1/health'), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('returns 422 with field errors for invalid input', async () => {
    const res = await login(request('/api/v1/auth/login', { body: { email: 'not-an-email', password: '' } }), ctx());
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.fields).toHaveProperty('email');
  });

  it('returns 400 for malformed JSON and 415 for non-JSON bodies', async () => {
    expect((await login(request('/api/v1/auth/login', { rawBody: '{oops' }), ctx())).status).toBe(400);
    const form = new NextRequest('http://localhost:3000/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'sec-fetch-site': 'same-origin' }, body: 'email=a' });
    expect((await login(form, ctx())).status).toBe(415);
  });
});

describe('CSRF protection', () => {
  it('blocks cross-site mutations even with a valid session', async () => {
    const { variants } = await createProduct();
    const res = await addItem(request('/api/v1/cart/items', { body: { variantId: variants.M!.id }, headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' } }), ctx());
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('CSRF_REJECTED');
  });

  it('accepts same-origin requests and issues an httpOnly guest cart cookie', async () => {
    const { variants } = await createProduct();
    const res = await addItem(request('/api/v1/cart/items', { body: { variantId: variants.M!.id, quantity: 1 } }), ctx());
    expect(res.status).toBe(200);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('mkj_cart='));
    expect(cookie).toMatch(/HttpOnly/i);
  });
});

describe('admin authorisation', () => {
  it('requires authentication', async () => {
    const res = await dashboard(request('/api/v1/admin/dashboard'), ctx());
    expect(res.status).toBe(401);
  });

  it('forbids customers from every admin endpoint', async () => {
    const res = await login(request('/api/v1/auth/login', { body: customer }), ctx());
    const cookie = sessionCookie(res);
    expect((await dashboard(request('/api/v1/admin/dashboard', { cookie }), ctx())).status).toBe(403);
    expect((await getSettings(request('/api/v1/admin/settings/checkout', { cookie }), ctx({ key: 'checkout' }))).status).toBe(403);
    expect((await adminLogin(request('/api/v1/admin/auth/login', { body: customer }), ctx())).status).toBe(403);
  });

  it('lets staff work orders but not change settings', async () => {
    const res = await adminLogin(request('/api/v1/admin/auth/login', { body: staff }), ctx());
    const cookie = sessionCookie(res);
    expect((await dashboard(request('/api/v1/admin/dashboard', { cookie }), ctx())).status).toBe(200);
    expect((await getSettings(request('/api/v1/admin/settings/checkout', { cookie }), ctx({ key: 'checkout' }))).status).toBe(403);
  });

  it('lets admins read settings and rejects malformed ids with 404', async () => {
    const res = await adminLogin(request('/api/v1/admin/auth/login', { body: admin }), ctx());
    const cookie = sessionCookie(res);
    expect((await getSettings(request('/api/v1/admin/settings/checkout', { cookie }), ctx({ key: 'checkout' }))).status).toBe(200);
    expect((await getSettings(request('/api/v1/admin/settings/secrets', { cookie }), ctx({ key: 'secrets' }))).status).toBe(404);
    expect((await getAdminOrder(request('/api/v1/admin/orders/1%20OR%201=1', { cookie }), ctx({ id: '1 OR 1=1' }))).status).toBe(404);
  });
});

describe('checkout endpoint', () => {
  it('places a guest COD order end-to-end over HTTP', async () => {
    const { variants } = await createProduct({ price: 150_000, stock: { M: 2 } });
    const add = await addItem(request('/api/v1/cart/items', { body: { variantId: variants.M!.id, quantity: 1 } }), ctx());
    const cartCookie = add.headers.getSetCookie().find((c) => c.startsWith('mkj_cart='))!.split(';')[0]!;
    const res = await checkout(
      request('/api/v1/checkout', {
        cookie: cartCookie,
        body: {
          idempotencyKey: 'http-test-0123456789abcdef',
          contact: { name: 'Tanvir Ahmed', phone: '01811000002' },
          address: { addressLine: 'Flat 3B, Station Road', area: 'Tongi', division: 'Dhaka', district: 'Gazipur' },
          paymentMethod: 'cod',
          expectedTotal: 161_000,
        },
      }),
      ctx(),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toMatchObject({ next: { type: 'confirmation' }, reused: false });
    expect(json.data.accessToken).toEqual(expect.any(String));
  });
});
