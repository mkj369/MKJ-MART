import { afterEach, describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, verifyPassword } from '@/server/auth/password';
import { clientIp, isSameOriginRequest } from '@/server/http/request';
import { checkoutSchema, parseProductQuery, registerSchema } from '@/lib/validation/store';
import { productInputSchema } from '@/lib/validation/admin';
import { zodFieldErrors } from '@/lib/validation/common';

describe('password hashing', () => {
  it('hashes with scrypt and verifies', async () => {
    const hash = await hashPassword('correct horse 1');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse 1', hash)).toBe(true);
    expect(await verifyPassword('wrong horse 1', hash)).toBe(false);
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
  });
  it('salts every hash', async () => {
    expect(await hashPassword('same-pass-1')).not.toBe(await hashPassword('same-pass-1'));
  });
  it('detects outdated parameters', async () => {
    const hash = await hashPassword('x1234567');
    expect(needsRehash(hash)).toBe(false);
    expect(needsRehash(hash.replace(/^scrypt\$\d+/, 'scrypt$1024'))).toBe(true);
  });
});

describe('CSRF origin checks', () => {
  const h = (init: Record<string, string>) => new Headers(init);
  it('allows same-origin browser requests and non-browser clients', () => {
    expect(isSameOriginRequest(h({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
    expect(isSameOriginRequest(h({}))).toBe(true);
    expect(isSameOriginRequest(h({ origin: 'http://localhost:3000', host: 'localhost:3000' }))).toBe(true);
  });
  it('rejects cross-site requests', () => {
    expect(isSameOriginRequest(h({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }))).toBe(false);
    expect(isSameOriginRequest(h({ 'sec-fetch-site': 'same-site' }))).toBe(false);
    expect(isSameOriginRequest(h({ origin: 'https://evil.example', host: 'shop.example.com' }))).toBe(false);
    expect(isSameOriginRequest(h({ origin: 'null', host: 'shop.example.com' }))).toBe(false);
  });
  it('honours the proxy-forwarded host', () => {
    expect(isSameOriginRequest(h({ origin: 'https://shop.example.com', host: 'localhost:3000', 'x-forwarded-host': 'shop.example.com' }))).toBe(true);
  });
});

describe('client IP extraction', () => {
  afterEach(() => {
    delete process.env.TRUST_PROXY;
  });
  it('uses the right-most hop behind a trusted proxy', () => {
    process.env.TRUST_PROXY = 'true';
    expect(clientIp(new Headers({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }))).toBe('203.0.113.9');
  });
  it('falls back to the first entry without a trusted proxy', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }))).toBe('198.51.100.1');
    expect(clientIp(new Headers())).toBeNull();
  });
});

describe('validation schemas', () => {
  it('normalises registration input', () => {
    const parsed = registerSchema.parse({ name: '  Ayesha Rahman ', email: ' Ayesha@Example.COM ', phone: '+8801711000001', password: 'secret123' });
    expect(parsed).toMatchObject({ name: 'Ayesha Rahman', email: 'ayesha@example.com', phone: '01711000001' });
  });
  it('rejects weak passwords and bad phones', () => {
    const result = registerSchema.safeParse({ name: 'A B', email: 'a@b.co', phone: '123', password: 'password' });
    expect(result.success).toBe(false);
    if (!result.success) expect(Object.keys(zodFieldErrors(result.error))).toEqual(expect.arrayContaining(['phone', 'password']));
  });
  it('requires the district to belong to the division at checkout', () => {
    const result = checkoutSchema.safeParse({
      idempotencyKey: 'abcdefghijklmnop12',
      contact: { name: 'Test User', phone: '01712345678' },
      address: { addressLine: 'House 1, Road 1', area: 'Zindabazar', division: 'Dhaka', district: 'Sylhet' },
      paymentMethod: 'cod',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(zodFieldErrors(result.error)['address.district']).toBeDefined();
  });
  it('rejects unknown payment methods', () => {
    const result = checkoutSchema.safeParse({
      idempotencyKey: 'abcdefghijklmnop12',
      contact: { name: 'Test User', phone: '01712345678' },
      address: { addressLine: 'House 1, Road 1', area: 'Kotwali', division: 'Sylhet', district: 'Sylhet' },
      paymentMethod: 'bitcoin',
    });
    expect(result.success).toBe(false);
  });
  it('enforces product rules (compare-at > price, unique SKUs, images to publish, local image URLs)', () => {
    const result = productInputSchema.safeParse({
      name: 'Tee',
      categoryId: null,
      price: 100_000,
      compareAtPrice: 90_000,
      status: 'active',
      images: [{ url: 'https://evil.example/x.png' }],
      variants: [
        { sku: 'a-1', sizeId: null, colorId: null, stock: 1 },
        { sku: 'A-1', sizeId: null, colorId: null, stock: 1 },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = zodFieldErrors(result.error);
      expect(fields.compareAtPrice).toBeDefined();
      expect(fields['images.0.url']).toBeDefined();
      expect(fields['variants.1.sku']).toBe('Duplicate SKU.');
    }
  });
  it('parses catalogue URLs defensively', () => {
    expect(parseProductQuery(new URLSearchParams('size=M&size=L&sort=price-asc&page=2'))).toMatchObject({ size: ['M', 'L'], sort: 'price-asc', page: 2 });
    expect(parseProductQuery({ sort: 'DROP TABLE', page: '-1', pageSize: '10000' })).toMatchObject({ sort: 'featured', page: 1, pageSize: 12 });
  });
});
