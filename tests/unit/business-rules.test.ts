import { describe, expect, it } from 'vitest';
import { evaluateCoupon, type Coupon } from '@/server/services/coupons';
import { resolveZone, shippingFeeFor, type ShippingZone } from '@/server/services/shipping';
import { canTransition, ORDER_TRANSITIONS, transitionBlockedByPayment } from '@/lib/order-status';
import { can, isStaffRole } from '@/lib/permissions';

const baseCoupon: Coupon = {
  id: 'c1',
  code: 'WELCOME10',
  description: null,
  type: 'percentage',
  value: 10,
  minOrderAmount: 200_000,
  maxDiscountAmount: 50_000,
  startsAt: null,
  endsAt: null,
  usageLimit: null,
  usageLimitPerCustomer: 1,
  usedCount: 0,
  isActive: true,
  isDemo: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const now = new Date('2026-10-28T12:00:00Z');

describe('coupon rules', () => {
  it('applies a percentage discount, rounded down, capped by maxDiscount', () => {
    expect(evaluateCoupon(baseCoupon, { subtotal: 230_000, now, customerRedemptions: 0 })).toEqual({ ok: true, discount: 23_000 });
    expect(evaluateCoupon(baseCoupon, { subtotal: 1_000_000, now, customerRedemptions: 0 })).toEqual({ ok: true, discount: 50_000 });
    expect(evaluateCoupon({ ...baseCoupon, maxDiscountAmount: null, minOrderAmount: 0 }, { subtotal: 999, now, customerRedemptions: 0 })).toEqual({ ok: true, discount: 99 });
  });
  it('never discounts more than the subtotal for fixed coupons', () => {
    const fixed = { ...baseCoupon, type: 'fixed' as const, value: 500_000, minOrderAmount: 0, maxDiscountAmount: null };
    expect(evaluateCoupon(fixed, { subtotal: 120_000, now, customerRedemptions: 0 })).toEqual({ ok: true, discount: 120_000 });
  });
  it.each([
    [null, 'NOT_FOUND'],
    [{ ...baseCoupon, isActive: false }, 'INACTIVE'],
    [{ ...baseCoupon, startsAt: new Date('2026-11-01') }, 'NOT_STARTED'],
    [{ ...baseCoupon, endsAt: new Date('2026-10-01') }, 'EXPIRED'],
    [{ ...baseCoupon, usageLimit: 5, usedCount: 5 }, 'USAGE_LIMIT'],
  ])('rejects invalid coupons (%#)', (coupon, code) => {
    const result = evaluateCoupon(coupon as Coupon | null, { subtotal: 500_000, now, customerRedemptions: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(code);
  });
  it('enforces per-customer limits and minimum spend', () => {
    const limited = evaluateCoupon(baseCoupon, { subtotal: 500_000, now, customerRedemptions: 1 });
    expect(limited.ok === false && limited.code).toBe('CUSTOMER_LIMIT');
    const small = evaluateCoupon(baseCoupon, { subtotal: 150_000, now, customerRedemptions: 0 });
    expect(small.ok === false && small.code).toBe('MIN_ORDER');
    expect(small.ok === false && small.reason).toContain('৳2,000');
  });
});

const zone = (z: Partial<ShippingZone>): ShippingZone => ({
  id: z.name ?? 'z',
  name: 'Zone',
  fee: 10_000,
  estimatedDays: '2 days',
  districts: [],
  isDefault: false,
  isActive: true,
  sortOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...z,
});

describe('delivery zones', () => {
  const zones = [zone({ name: 'Dhaka', fee: 7_000, districts: ['Dhaka'] }), zone({ name: 'Suburbs', fee: 11_000, districts: ['Gazipur'] }), zone({ name: 'Rest', fee: 14_000, isDefault: true })];
  it('maps districts to their zone and falls back to the default', () => {
    expect(resolveZone(zones, 'Gazipur')?.name).toBe('Suburbs');
    expect(resolveZone(zones, 'Sylhet')?.name).toBe('Rest');
    expect(resolveZone(zones, undefined)?.name).toBe('Rest');
  });
  it('ignores inactive zones and returns null without a default', () => {
    expect(resolveZone([zone({ name: 'Dhaka', districts: ['Dhaka'], isActive: false })], 'Dhaka')).toBeNull();
  });
  it('makes delivery free at the threshold', () => {
    expect(shippingFeeFor({ fee: 11_000 }, 499_999, 500_000)).toEqual({ fee: 11_000, free: false });
    expect(shippingFeeFor({ fee: 11_000 }, 500_000, 500_000)).toEqual({ fee: 0, free: true });
    expect(shippingFeeFor({ fee: 11_000 }, 9_999_999, null)).toEqual({ fee: 11_000, free: false });
  });
});

describe('order state machine', () => {
  it('allows only the documented transitions', () => {
    expect(canTransition('pending', 'confirmed')).toBe(true);
    expect(canTransition('pending', 'shipped')).toBe(false);
    expect(canTransition('delivered', 'cancelled')).toBe(false);
    expect(canTransition('shipped', 'returned')).toBe(true);
    expect(ORDER_TRANSITIONS.cancelled).toEqual([]);
  });
  it('blocks fulfilment of unpaid online orders but allows cancellation', () => {
    expect(transitionBlockedByPayment('sslcommerz', 'pending', 'confirmed')).toBe(true);
    expect(transitionBlockedByPayment('sslcommerz', 'pending', 'cancelled')).toBe(false);
    expect(transitionBlockedByPayment('sslcommerz', 'paid', 'confirmed')).toBe(false);
    expect(transitionBlockedByPayment('cod', 'unpaid', 'confirmed')).toBe(false);
  });
});

describe('role permissions', () => {
  it('denies customers everything in the admin', () => {
    expect(isStaffRole('customer')).toBe(false);
    expect(can('customer', 'dashboard:view')).toBe(false);
  });
  it('gives staff operations but not configuration', () => {
    expect(can('staff', 'orders:manage')).toBe(true);
    expect(can('staff', 'catalog:manage')).toBe(true);
    expect(can('staff', 'settings:manage')).toBe(false);
    expect(can('staff', 'customers:manage')).toBe(false);
    expect(can('staff', 'coupons:manage')).toBe(false);
  });
  it('gives admins everything', () => {
    expect(can('admin', 'settings:manage')).toBe(true);
    expect(can('admin', 'customers:manage')).toBe(true);
  });
});
