import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSession } from '@/server/auth/session';
import { createUser, seedReferenceData } from '../support/fixtures';

/**
 * Authorization matrix: EVERY handler under src/app/api/v1/admin is discovered from the filesystem
 * and called as anonymous, customer, staff and admin. New routes are covered automatically; a route
 * that forgets its permission check fails this test.
 */
type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const ADMIN_API = path.resolve('src/app/api/v1/admin');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** Routes only administrators (not staff) may use. Anything else under /admin is staff-accessible. */
const ADMIN_ONLY: { pattern: RegExp; methods?: string[] }[] = [
  { pattern: /^settings\// },
  { pattern: /^coupons(\/|$)/ },
  { pattern: /^shipping-zones(\/|$)/ },
  { pattern: /^demo-data$/ },
  { pattern: /^notifications(\/|$)/ },
  { pattern: /^orders\/\[id\]\/refunds$/ },
  { pattern: /^customers\/\[id\]$/, methods: ['PATCH'] },
];
const PUBLIC = new Set(['auth/login']);

function routeFiles(dir: string, base = ''): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    const rel = base ? `${base}/${entry}` : entry;
    if (statSync(full).isDirectory()) return routeFiles(full, rel);
    return entry === 'route.ts' ? [base] : [];
  });
}

function paramsFor(route: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [, name] of route.matchAll(/\[([^\]]+)\]/g)) params[name!] = name === 'key' ? 'store' : randomUUID();
  return params;
}

function request(route: string, method: string, cookie?: string) {
  const headers: Record<string, string> = { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const url = `http://localhost:3000/api/v1/admin/${route.replace(/\[([^\]]+)\]/g, 'x')}`;
  return new NextRequest(url, { method, headers, body: method === 'GET' || method === 'DELETE' ? undefined : '{}' });
}

const cookies: Record<'customer' | 'staff' | 'admin', string> = { customer: '', staff: '', admin: '' };

beforeAll(async () => {
  await seedReferenceData();
  for (const role of ['customer', 'staff', 'admin'] as const) {
    const { user } = await createUser({ role });
    cookies[role] = `mkj_session=${(await createSession(user)).token}`;
  }
});

describe('admin API authorization matrix', () => {
  const routes = routeFiles(ADMIN_API).sort();

  it('discovers every admin route file', () => {
    expect(routes.length).toBeGreaterThanOrEqual(30);
    expect(routes).toContain('orders/[id]/refunds');
    expect(routes).toContain('returns/[id]');
    expect(routes).toContain('support/[id]');
  });

  it.each(routes.filter((r) => !PUBLIC.has(r)))('%s: anonymous → 401, customer → 403, staff/admin per permission', async (route) => {
    const mod = (await import(path.join(ADMIN_API, route, 'route.ts'))) as Partial<Record<(typeof METHODS)[number], Handler>>;
    const methods = METHODS.filter((m) => typeof mod[m] === 'function');
    expect(methods.length).toBeGreaterThan(0);
    for (const method of methods) {
      const call = (cookie?: string) => mod[method]!(request(route, method, cookie), { params: Promise.resolve(paramsFor(route)) });
      const anonymous = await call();
      expect(anonymous.status, `${method} ${route} as anonymous`).toBe(401);
      const customer = await call(cookies.customer);
      expect(customer.status, `${method} ${route} as customer`).toBe(403);

      const adminOnly = ADMIN_ONLY.some((rule) => rule.pattern.test(route) && (!rule.methods || rule.methods.includes(method)));
      const staff = await call(cookies.staff);
      if (adminOnly) expect(staff.status, `${method} ${route} as staff`).toBe(403);
      else expect([401, 403], `${method} ${route} as staff`).not.toContain(staff.status);
      const admin = await call(cookies.admin);
      expect([401, 403], `${method} ${route} as admin`).not.toContain(admin.status);
    }
  });
});

describe('cron endpoints', () => {
  it.each(['expire-payments', 'send-notifications', 'dispatch-events'])('%s requires the bearer secret', async (job) => {
    const { POST } = (await import(path.resolve('src/app/api/cron', job, 'route.ts'))) as { POST: (req: NextRequest) => Promise<Response> };
    const call = (auth?: string) => POST(new NextRequest(`http://localhost:3000/api/cron/${job}`, { method: 'POST', headers: auth ? { authorization: auth } : {} }));
    delete process.env.CRON_SECRET;
    expect((await call('Bearer anything')).status).toBe(503);
    process.env.CRON_SECRET = 'a-very-long-cron-secret-value';
    try {
      expect((await call()).status).toBe(401);
      expect((await call('Bearer wrong-secret-value-of-same-len')).status).toBe(401);
      expect((await call('Bearer a-very-long-cron-secret-value')).status).toBe(200);
    } finally {
      delete process.env.CRON_SECRET;
    }
  });
});
