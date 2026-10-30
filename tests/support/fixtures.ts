/** Test data builders for integration tests (each test file has its own database). */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { categories, colors, coupons, productImages, products, productVariants, shippingZones, sizes, users } from '@/server/db/schema';
import { hashPassword } from '@/server/auth/password';
import { clearSettingsCache } from '@/server/services/settings';
import type { CheckoutInput } from '@/lib/validation/store';
import type { Role } from '@/lib/permissions';

export const uid = () => randomBytes(4).toString('hex');

export async function seedReferenceData() {
  clearSettingsCache();
  await db.insert(sizes).values([
    { label: 'S', sortOrder: 20 },
    { label: 'M', sortOrder: 30 },
    { label: 'L', sortOrder: 40 },
  ]).onConflictDoNothing();
  await db.insert(colors).values([
    { name: 'Black', hex: '#111111' },
    { name: 'Ivory', hex: '#F2EDE3' },
  ]).onConflictDoNothing();
  await db.insert(shippingZones).values([
    { name: 'Inside Dhaka', fee: 7_000, estimatedDays: '1–2 days', districts: ['Dhaka'], sortOrder: 0 },
    { name: 'Dhaka Suburbs', fee: 11_000, estimatedDays: '2–3 days', districts: ['Gazipur', 'Narayanganj'], sortOrder: 1 },
    { name: 'Outside Dhaka', fee: 14_000, estimatedDays: '3–5 days', districts: [], isDefault: true, sortOrder: 2 },
  ]).onConflictDoNothing();
}

export async function createProduct(options: { price?: number; compareAtPrice?: number | null; stock?: Record<string, number>; status?: 'active' | 'draft' | 'archived'; name?: string } = {}) {
  const suffix = uid();
  let [category] = await db.select().from(categories).where(eq(categories.slug, 'test-category')).limit(1);
  if (!category) [category] = await db.insert(categories).values({ name: 'Test category', slug: 'test-category' }).returning();
  const [product] = await db
    .insert(products)
    .values({
      name: options.name ?? `Test Tee ${suffix}`,
      slug: `test-tee-${suffix}`,
      description: 'A test product',
      categoryId: category!.id,
      price: options.price ?? 100_000,
      compareAtPrice: options.compareAtPrice ?? null,
      status: options.status ?? 'active',
    })
    .returning();
  await db.insert(productImages).values({ productId: product!.id, url: '/images/demo/products/heavyweight-cotton-tee.webp', alt: 'test' });
  const stock = options.stock ?? { M: 10 };
  const sizeRows = await db.select().from(sizes);
  const [black] = await db.select().from(colors).where(eq(colors.name, 'Black')).limit(1);
  const variants: Record<string, typeof productVariants.$inferSelect> = {};
  for (const [label, qty] of Object.entries(stock)) {
    const size = sizeRows.find((s) => s.label === label)!;
    const [variant] = await db
      .insert(productVariants)
      .values({ productId: product!.id, sku: `T-${suffix}-${label}`.toUpperCase(), sizeId: size.id, colorId: black!.id, stock: qty })
      .returning();
    variants[label] = variant!;
  }
  return { product: product!, variants };
}

export async function createUser(options: { role?: Role; email?: string; password?: string; status?: 'active' | 'blocked'; phone?: string | null; isDemo?: boolean } = {}) {
  const password = options.password ?? 'Passw0rd!';
  const [user] = await db
    .insert(users)
    .values({
      email: options.email ?? `user-${uid()}@example.test`,
      name: 'Test User',
      phone: options.phone ?? null,
      role: options.role ?? 'customer',
      status: options.status ?? 'active',
      isDemo: options.isDemo ?? false,
      passwordHash: await hashPassword(password),
    })
    .returning();
  return { user: user!, password };
}

export async function createCoupon(overrides: Partial<typeof coupons.$inferInsert> = {}) {
  const [coupon] = await db
    .insert(coupons)
    .values({ code: `TEST${uid().toUpperCase()}`, type: 'percentage', value: 10, ...overrides })
    .returning();
  return coupon!;
}

export function checkoutInput(overrides: Partial<CheckoutInput> = {}): CheckoutInput {
  return {
    idempotencyKey: `test-${uid()}${uid()}${uid()}`,
    contact: { name: 'Rahim Uddin', phone: '01712345678', email: 'rahim@example.test' },
    address: { addressLine: 'House 12, Road 5', area: 'Dhanmondi', division: 'Dhaka', district: 'Dhaka', postalCode: undefined },
    saveAddress: false,
    paymentMethod: 'cod',
    couponCode: undefined,
    note: undefined,
    ...overrides,
  };
}
