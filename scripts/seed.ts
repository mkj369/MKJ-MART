/**
 * Seeds the database.
 *
 *   npm run db:seed              # base configuration only (sizes, colours, delivery zones) — safe in production
 *   npm run db:seed -- --demo    # + fictional demo catalogue, accounts, coupons and orders (is_demo = true)
 *
 * Demo data is refused when NODE_ENV=production unless --force is given. Remove demo data at any time
 * from Admin → Settings → Demo data.
 */
import { describeDatabase, hasFlag, requireDatabaseUrl } from './_env';
import { randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { closeDb, db } from '@/server/db';
import {
  addresses,
  categories,
  collectionProducts,
  collections,
  colors,
  coupons,
  orderEvents,
  orders,
  productImages,
  products,
  productVariants,
  shippingZones,
  sizes,
  stockMovements,
  users,
} from '@/server/db/schema';
import { hashPassword } from '@/server/auth/password';
import { addToCart, ensureCart } from '@/server/services/cart';
import { generateOrderNumber, placeOrder } from '@/server/services/checkout';
import { updateOrderStatus } from '@/server/services/admin/orders';
import { updateSetting, getSetting } from '@/server/services/settings';
import type { CheckoutInput } from '@/lib/validation/store';
import {
  COLORS,
  DEMO_CATEGORIES,
  DEMO_COLLECTIONS,
  DEMO_COUPONS,
  DEMO_ORDERS,
  DEMO_PRODUCTS,
  DEMO_USERS,
  SHIPPING_ZONES,
  SIZES,
} from './seed-data';

const DAY = 24 * 60 * 60 * 1000;

async function seedBase() {
  for (const size of SIZES) {
    await db.insert(sizes).values(size).onConflictDoNothing({ target: sizes.label });
  }
  for (const color of COLORS) {
    await db.insert(colors).values(color).onConflictDoNothing({ target: colors.name });
  }
  const [{ zones }] = await db.select({ zones: sql<number>`count(*)::int` }).from(shippingZones);
  if (zones === 0) {
    await db.insert(shippingZones).values(SHIPPING_ZONES);
    console.log('  • Delivery zones: Inside Dhaka ৳70 · Dhaka Suburbs ৳110 · Outside Dhaka ৳140');
  }
  console.log(`  • ${SIZES.length} sizes and ${COLORS.length} colours available`);
}

async function seedAdminFromEnv() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return;
  await db.insert(users).values({
    email,
    name: process.env.ADMIN_NAME?.trim() || 'Store Owner',
    role: 'admin',
    passwordHash: await hashPassword(password),
  });
  console.log(`  • Created administrator ${email} (from ADMIN_EMAIL / ADMIN_PASSWORD)`);
}

function colorCode(name: string) {
  return name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
}

async function seedDemo() {
  const [{ existing }] = await db
    .select({ existing: sql<number>`count(*)::int` })
    .from(products)
    .where(eq(products.isDemo, true));
  if (existing > 0) {
    console.log('  • Demo data already present — skipping. (Purge it from the admin, or run npm run db:reset.)');
    return;
  }

  const sizeRows = await db.select().from(sizes);
  const colorRows = await db.select().from(colors);
  const sizeId = (label: string) => sizeRows.find((s) => s.label === label)!.id;
  const colorId = (name: string) => colorRows.find((c) => c.name === name)!.id;

  // Categories (parents first)
  const categoryIds = new Map<string, string>();
  for (const cat of [...DEMO_CATEGORIES].sort((a, b) => Number(!!a.parent) - Number(!!b.parent))) {
    const [row] = await db
      .insert(categories)
      .values({
        name: cat.name,
        slug: cat.slug,
        description: cat.description,
        parentId: cat.parent ? categoryIds.get(cat.parent)! : null,
        sortOrder: cat.sortOrder,
        isDemo: true,
      })
      .returning({ id: categories.id });
    categoryIds.set(cat.slug, row!.id);
  }

  const collectionIds = new Map<string, string>();
  for (const col of DEMO_COLLECTIONS) {
    const [row] = await db.insert(collections).values({ ...col, isDemo: true }).returning({ id: collections.id });
    collectionIds.set(col.slug, row!.id);
  }

  // Products, variants, images, stock ledger
  for (const p of DEMO_PRODUCTS) {
    const createdAt = new Date(Date.now() - p.daysOld * DAY);
    const [product] = await db
      .insert(products)
      .values({
        name: p.name,
        slug: p.slug,
        description: p.description,
        material: p.material,
        careInstructions: p.care,
        categoryId: categoryIds.get(p.category)!,
        price: p.price * 100,
        compareAtPrice: p.compareAtPrice ? p.compareAtPrice * 100 : null,
        status: p.status,
        isFeatured: !!p.featured,
        tags: p.tags,
        isDemo: true,
        createdAt,
        updatedAt: createdAt,
      })
      .returning({ id: products.id });
    for (const [index, label] of p.sizes.entries()) {
      const [variant] = await db
        .insert(productVariants)
        .values({
          productId: product!.id,
          sku: `${p.skuPrefix}-${colorCode(p.color)}-${label.replace(/\s+/g, '').toUpperCase()}`,
          sizeId: sizeId(label),
          colorId: colorId(p.color),
          stock: p.stock[index] ?? 0,
          createdAt,
        })
        .returning({ id: productVariants.id, stock: productVariants.stock });
      if (variant!.stock > 0) {
        await db.insert(stockMovements).values({
          variantId: variant!.id,
          delta: variant!.stock,
          stockAfter: variant!.stock,
          reason: 'initial',
          note: 'Demo opening stock',
          createdAt,
        });
      }
    }
    if (p.image) {
      await db.insert(productImages).values({
        productId: product!.id,
        url: p.image,
        alt: `${p.name} in ${p.color.toLowerCase()} — AI-generated demo photograph`,
        colorId: colorId(p.color),
        sortOrder: 0,
      });
    }
    for (const [index, slug] of p.collections.entries()) {
      await db.insert(collectionProducts).values({ collectionId: collectionIds.get(slug)!, productId: product!.id, sortOrder: index });
    }
  }
  console.log(`  • ${DEMO_PRODUCTS.filter((p) => p.status === 'active').length} live demo products, ${DEMO_PRODUCTS.filter((p) => p.status === 'draft').length} drafts awaiting photos`);

  // Accounts
  const userIds = new Map<string, string>();
  for (const u of DEMO_USERS) {
    const [row] = await db
      .insert(users)
      .values({
        email: u.email,
        name: u.name,
        phone: u.phone,
        role: u.role,
        passwordHash: await hashPassword(u.password),
        isDemo: true,
        createdAt: new Date(Date.now() - 45 * DAY),
      })
      .returning({ id: users.id });
    userIds.set(u.email, row!.id);
    if ('address' in u && u.address) {
      await db.insert(addresses).values({
        userId: row!.id,
        label: 'Home',
        recipientName: u.name,
        phone: u.phone!,
        ...u.address,
        isDefault: true,
      });
    }
  }
  console.log(`  • ${DEMO_USERS.length} demo accounts (admin, staff, 4 customers)`);

  for (const c of DEMO_COUPONS) {
    const { endsAtDays, ...rest } = c;
    await db.insert(coupons).values({
      ...rest,
      startsAt: new Date(Date.now() - 60 * DAY),
      endsAt: new Date(Date.now() + endsAtDays * DAY),
      isDemo: true,
    });
  }
  console.log(`  • Coupons: ${DEMO_COUPONS.map((c) => c.code).join(', ')}`);

  const store = await getSetting('store');
  await updateSetting('store', { ...store, supportEmail: 'care@mkjmart.demo' });

  // Orders — placed through the real checkout service, then moved through the admin state machine.
  const adminId = userIds.get('admin@mkjmart.demo')!;
  const variantFor = async (slug: string, size: string) => {
    const [row] = await db
      .select({ id: productVariants.id })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .innerJoin(sizes, eq(sizes.id, productVariants.sizeId))
      .where(and(eq(products.slug, slug), eq(sizes.label, size)))
      .limit(1);
    if (!row) throw new Error(`Demo variant not found: ${slug} / ${size}`);
    return row.id;
  };
  const steps = ['confirmed', 'processing', 'shipped', 'delivered'] as const;
  const couriers = ['Pathao Courier', 'Steadfast Courier', 'RedX'];

  for (const [index, plan] of DEMO_ORDERS.entries()) {
    const registered = typeof plan.customer === 'string' ? DEMO_USERS.find((u) => u.email === plan.customer) : null;
    const userId = registered ? userIds.get(registered.email)! : null;
    const contact = registered
      ? { name: registered.name, phone: registered.phone!, email: registered.email }
      : { name: (plan.customer as { name: string }).name, phone: (plan.customer as { phone: string }).phone, email: undefined };
    const address = registered && 'address' in registered ? registered.address! : (plan.customer as { address: { addressLine: string; area: string; district: string; division: string } }).address;

    const { cartId } = await ensureCart({ userId, guestCartId: null });
    for (const item of plan.items) {
      const [slug, size, qty] = item.split(':');
      await addToCart(cartId, await variantFor(slug!, size!), Number(qty));
    }
    const result = await placeOrder(
      {
        idempotencyKey: `demo-${randomBytes(12).toString('hex')}`,
        contact,
        address: { ...address, postalCode: undefined } as CheckoutInput['address'],
        saveAddress: false,
        paymentMethod: 'cod',
        couponCode: plan.coupon,
        note: index % 4 === 1 ? 'Please call before delivery.' : undefined,
      },
      { userId, cartId },
    );

    const placedAt = new Date(Date.now() - plan.daysAgo * DAY - (index % 5) * 3_600_000 - 2 * 3_600_000);
    await db.update(orders).set({ isDemo: true }).where(eq(orders.id, result.orderId));

    if (plan.status === 'cancelled') {
      await updateOrderStatus(result.orderId, { status: 'cancelled', note: plan.note ?? null, courierName: null, trackingNumber: null }, adminId);
    } else {
      const target = steps.indexOf(plan.status as (typeof steps)[number]);
      for (let i = 0; i <= target; i++) {
        const status = steps[i]!;
        await updateOrderStatus(
          result.orderId,
          {
            status,
            note: null,
            courierName: status === 'shipped' ? couriers[index % couriers.length]! : null,
            trackingNumber: status === 'shipped' ? `TRK${(1_000_000 + index * 7_919).toString()}` : null,
          },
          adminId,
        );
      }
    }

    // Backdate the order timeline so dashboards and histories look realistic.
    const events = await db
      .select({ id: orderEvents.id })
      .from(orderEvents)
      .where(eq(orderEvents.orderId, result.orderId))
      .orderBy(orderEvents.createdAt);
    const hourStep = plan.daysAgo > 0 ? Math.min(20, (plan.daysAgo * 24) / Math.max(events.length, 1)) : 0.1;
    for (const [i, event] of events.entries()) {
      await db
        .update(orderEvents)
        .set({ createdAt: new Date(placedAt.getTime() + i * hourStep * 3_600_000) })
        .where(eq(orderEvents.id, event.id));
    }
    const at = (i: number) => new Date(placedAt.getTime() + i * hourStep * 3_600_000);
    await db.execute(sql`
      UPDATE ${orders} SET
        order_number = ${generateOrderNumber(placedAt)},
        placed_at = ${placedAt}, created_at = ${placedAt},
        confirmed_at = CASE WHEN confirmed_at IS NOT NULL THEN ${at(1)}::timestamptz END,
        shipped_at = CASE WHEN shipped_at IS NOT NULL THEN ${at(3)}::timestamptz END,
        delivered_at = CASE WHEN delivered_at IS NOT NULL THEN ${at(4)}::timestamptz END,
        paid_at = CASE WHEN paid_at IS NOT NULL THEN ${at(4)}::timestamptz END,
        cancelled_at = CASE WHEN cancelled_at IS NOT NULL THEN ${at(1)}::timestamptz END
      WHERE id = ${result.orderId}
    `);
    await db.update(stockMovements).set({ createdAt: placedAt }).where(eq(stockMovements.orderId, result.orderId));
  }
  console.log(`  • ${DEMO_ORDERS.length} demo orders across the last 30 days (placed via the real checkout flow)`);

}

async function main() {
  const url = requireDatabaseUrl();
  const demo = hasFlag('demo');
  if (demo && process.env.NODE_ENV === 'production' && !hasFlag('force')) {
    console.error('✖ Refusing to load demo data with NODE_ENV=production. Pass --force if you really mean it.');
    process.exit(1);
  }
  console.log(`→ Seeding ${describeDatabase(url)}${demo ? ' (with DEMO data)' : ''}`);
  await seedBase();
  await seedAdminFromEnv();
  if (demo) await seedDemo();
  console.log('✔ Seed complete.');
  if (demo) {
    console.log('\n  Demo sign-ins (fictional — remove before launch):');
    console.log('    Admin     admin@mkjmart.demo     / Admin@12345     → /admin');
    console.log('    Staff     staff@mkjmart.demo     / Staff@12345     → /admin');
    console.log('    Customer  customer@mkjmart.demo  / Customer@123    → /login');
  }
}

main()
  .catch((err) => {
    console.error('✖ Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
