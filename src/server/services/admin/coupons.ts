import 'server-only';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { coupons } from '@/server/db/schema';
import { conflict, isUniqueViolation, notFound, validationError } from '@/server/errors';
import type { CouponInput } from '@/lib/validation/admin';

export async function listCouponsAdmin() {
  return db.select().from(coupons).orderBy(desc(coupons.isActive), desc(coupons.createdAt));
}

export async function saveCoupon(input: CouponInput, id?: string) {
  try {
    if (id) {
      const [row] = await db.update(coupons).set(input).where(eq(coupons.id, id)).returning();
      if (!row) throw notFound('Coupon not found.');
      return row;
    }
    const [row] = await db.insert(coupons).values(input).returning();
    return row!;
  } catch (error) {
    if (isUniqueViolation(error, 'coupons_code_key')) throw validationError({ code: 'This code already exists.' });
    throw error;
  }
}

/** Used coupons are kept for reporting; they can be deactivated instead of deleted. */
export async function deleteCoupon(id: string) {
  const [coupon] = await db.select().from(coupons).where(eq(coupons.id, id)).limit(1);
  if (!coupon) throw notFound('Coupon not found.');
  if (coupon.usedCount > 0) throw conflict('This coupon has been used. Deactivate it instead.', 'COUPON_USED');
  await db.delete(coupons).where(eq(coupons.id, id));
}
