import 'server-only';
import { and, eq, or, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '@/server/db';
import { couponRedemptions, coupons } from '@/server/db/schema';
import { formatBDT } from '@/lib/money';

export type Coupon = typeof coupons.$inferSelect;

export type CouponEvaluation =
  | { ok: true; discount: number }
  | {
      ok: false;
      code: 'NOT_FOUND' | 'INACTIVE' | 'NOT_STARTED' | 'EXPIRED' | 'USAGE_LIMIT' | 'CUSTOMER_LIMIT' | 'MIN_ORDER';
      reason: string;
    };

/**
 * Pure coupon rules. Discounts apply to the merchandise subtotal only (never to delivery) and can
 * never exceed it. Percentage discounts are rounded down to whole poisha and optionally capped.
 */
export function evaluateCoupon(
  coupon: Coupon | null | undefined,
  ctx: { subtotal: number; now: Date; customerRedemptions: number },
): CouponEvaluation {
  if (!coupon) return { ok: false, code: 'NOT_FOUND', reason: 'This coupon code is not valid.' };
  if (!coupon.isActive) return { ok: false, code: 'INACTIVE', reason: 'This coupon is no longer active.' };
  if (coupon.startsAt && ctx.now < coupon.startsAt) {
    return { ok: false, code: 'NOT_STARTED', reason: 'This coupon is not active yet.' };
  }
  if (coupon.endsAt && ctx.now > coupon.endsAt) {
    return { ok: false, code: 'EXPIRED', reason: 'This coupon has expired.' };
  }
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
    return { ok: false, code: 'USAGE_LIMIT', reason: 'This coupon has reached its usage limit.' };
  }
  if (coupon.usageLimitPerCustomer !== null && ctx.customerRedemptions >= coupon.usageLimitPerCustomer) {
    return { ok: false, code: 'CUSTOMER_LIMIT', reason: 'You have already used this coupon.' };
  }
  if (ctx.subtotal < coupon.minOrderAmount) {
    return {
      ok: false,
      code: 'MIN_ORDER',
      reason: `Spend ${formatBDT(coupon.minOrderAmount)} or more to use this coupon.`,
    };
  }
  let discount =
    coupon.type === 'percentage' ? Math.floor((ctx.subtotal * coupon.value) / 100) : Math.min(coupon.value, ctx.subtotal);
  if (coupon.maxDiscountAmount !== null) discount = Math.min(discount, coupon.maxDiscountAmount);
  discount = Math.max(0, Math.min(discount, ctx.subtotal));
  return { ok: true, discount };
}

/**
 * Loads a coupon (optionally row-locked inside a checkout transaction) plus how many times this
 * customer has redeemed it — matched by account OR phone, so guest checkout cannot bypass limits.
 */
export async function loadCouponForCustomer(
  tx: DbOrTx,
  code: string,
  customer: { userId: string | null; phone: string | null },
  options: { lock?: boolean } = {},
): Promise<{ coupon: Coupon | null; customerRedemptions: number }> {
  const normalized = code.trim().toUpperCase();
  const base = tx.select().from(coupons).where(eq(coupons.code, normalized)).limit(1);
  const [coupon] = options.lock ? await base.for('update') : await base;
  if (!coupon) return { coupon: null, customerRedemptions: 0 };

  const identity = [
    customer.userId ? eq(couponRedemptions.userId, customer.userId) : undefined,
    customer.phone ? eq(couponRedemptions.phone, customer.phone) : undefined,
  ].filter((c) => c !== undefined);
  if (identity.length === 0 || coupon.usageLimitPerCustomer === null) return { coupon, customerRedemptions: 0 };

  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(couponRedemptions)
    .where(and(eq(couponRedemptions.couponId, coupon.id), or(...identity)));
  return { coupon, customerRedemptions: row?.count ?? 0 };
}

export async function findCouponByCode(code: string): Promise<Coupon | null> {
  const [coupon] = await db.select().from(coupons).where(eq(coupons.code, code.trim().toUpperCase())).limit(1);
  return coupon ?? null;
}
