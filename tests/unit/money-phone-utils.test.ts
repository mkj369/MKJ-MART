import { describe, expect, it } from 'vitest';
import { discountPercent, formatBDT, poishaToDecimalString, takaToPoisha } from '@/lib/money';
import { formatBdPhone, maskPhone, normalizeBdPhone } from '@/lib/phone';
import { safeRedirectPath, slugify } from '@/lib/utils';
import { districtBelongsToDivision, ALL_DISTRICTS, DIVISION_NAMES } from '@/lib/bd-geo';

describe('money (integer poisha)', () => {
  it('formats taka with the ৳ sign and grouping', () => {
    expect(formatBDT(125_000)).toBe('৳1,250');
    expect(formatBDT(125_050)).toBe('৳1,250.50');
    expect(formatBDT(0)).toBe('৳0');
    expect(formatBDT(-50_000)).toBe('−৳500');
    expect(formatBDT(1_250_000_00)).toBe('৳1,250,000');
  });
  it('parses user input into poisha and rejects invalid values', () => {
    expect(takaToPoisha('1,250.50')).toBe(125_050);
    expect(takaToPoisha('৳ 99')).toBe(9_900);
    expect(takaToPoisha(12.5)).toBe(1_250);
    expect(takaToPoisha('12.345')).toBeNull();
    expect(takaToPoisha('-5')).toBeNull();
    expect(takaToPoisha('abc')).toBeNull();
  });
  it('produces exact decimal strings for the gateway', () => {
    expect(poishaToDecimalString(218_000)).toBe('2180.00');
    expect(poishaToDecimalString(5)).toBe('0.05');
  });
  it('computes discount percentages', () => {
    expect(discountPercent(265_000, 325_000)).toBe(18);
    expect(discountPercent(100, null)).toBe(0);
    expect(discountPercent(100, 90)).toBe(0);
  });
});

describe('Bangladeshi phone numbers', () => {
  it.each([
    ['01712345678', '01712345678'],
    ['+8801712345678', '01712345678'],
    ['8801712345678', '01712345678'],
    ['+880 1712-345678', '01712345678'],
    ['01312345678', '01312345678'],
  ])('normalises %s', (input, expected) => expect(normalizeBdPhone(input)).toBe(expected));

  it.each(['01212345678', '0171234567', '017123456789', '12345', '', null])('rejects %s', (input) => {
    expect(normalizeBdPhone(input as string | null)).toBeNull();
  });
  it('formats and masks', () => {
    expect(formatBdPhone('01712345678')).toBe('01712-345678');
    expect(maskPhone('01712345678')).toBe('017•••••678');
  });
});

describe('safeRedirectPath (open-redirect protection)', () => {
  it('keeps same-site relative paths', () => {
    expect(safeRedirectPath('/account/orders?page=2')).toBe('/account/orders?page=2');
    expect(safeRedirectPath('/checkout')).toBe('/checkout');
  });
  it.each(['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'account', '/ok\nSet-Cookie: x=1', ''])(
    'rejects %j',
    (input) => expect(safeRedirectPath(input, '/fallback')).toBe('/fallback'),
  );
});

describe('slugify', () => {
  it('creates URL-safe slugs', () => {
    expect(slugify('Zari-Embroidered Silk Panjabi — Maroon')).toBe('zari-embroidered-silk-panjabi-maroon');
    expect(slugify('Shirts & Tees')).toBe('shirts-and-tees');
    expect(slugify('  Café Crème ')).toBe('cafe-creme');
  });
});

describe('Bangladesh geography', () => {
  it('has 8 divisions and 64 districts', () => {
    expect(DIVISION_NAMES).toHaveLength(8);
    expect(ALL_DISTRICTS).toHaveLength(64);
  });
  it('validates district/division pairs', () => {
    expect(districtBelongsToDivision('Gazipur', 'Dhaka')).toBe(true);
    expect(districtBelongsToDivision('Sylhet', 'Dhaka')).toBe(false);
    expect(districtBelongsToDivision('Dhaka', 'Atlantis')).toBe(false);
  });
});
