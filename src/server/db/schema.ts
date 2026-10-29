/**
 * MKJ MART database schema (PostgreSQL, managed with Drizzle ORM).
 *
 * Conventions
 * - Primary keys are UUID v4 (`gen_random_uuid()`), safe to expose and to share with other
 *   MKJ Ecosystem services.
 * - ALL money columns are integers in POISHA (1 BDT = 100 poisha).
 * - Timestamps are `timestamptz`; the UI renders them in Asia/Dhaka.
 * - `is_demo` marks seed/demo records so they can be identified and purged from the admin.
 * - Orders snapshot product/price/address data so history never changes when the catalogue does.
 *
 * NOTE: keep this file free of `@/` path aliases — drizzle-kit loads it directly.
 */
import { relations, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// ─── Enums ──────────────────────────────────────────────────────────────────────────────────

export const userRoleEnum = pgEnum('user_role', ['customer', 'staff', 'admin']);
export const userStatusEnum = pgEnum('user_status', ['active', 'blocked']);
export const productStatusEnum = pgEnum('product_status', ['draft', 'active', 'archived']);
export const orderStatusEnum = pgEnum('order_status', [
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'returned',
]);
export const paymentMethodEnum = pgEnum('payment_method', ['cod', 'sslcommerz']);
export const paymentStatusEnum = pgEnum('payment_status', [
  'unpaid',
  'pending',
  'paid',
  'failed',
  'cancelled',
  'refunded',
  'partially_refunded',
]);
export const paymentTxnStatusEnum = pgEnum('payment_txn_status', [
  'initiated',
  'pending',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
]);
export const couponTypeEnum = pgEnum('coupon_type', ['percentage', 'fixed']);
export const stockReasonEnum = pgEnum('stock_reason', [
  'initial',
  'restock',
  'adjustment',
  'order',
  'order_cancelled',
  'return',
  'correction',
]);
export const userTokenPurposeEnum = pgEnum('user_token_purpose', ['password_reset']);
export const notificationChannelEnum = pgEnum('notification_channel', ['email', 'sms']);
export const notificationStatusEnum = pgEnum('notification_status', ['pending', 'sent', 'failed', 'skipped']);
export const returnStatusEnum = pgEnum('return_status', [
  'requested',
  'approved',
  'rejected',
  'received',
  'refunded',
  'cancelled',
]);
export const supportStatusEnum = pgEnum('support_status', ['open', 'in_progress', 'resolved']);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ─── Identity ───────────────────────────────────────────────────────────────────────────────

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: varchar('email', { length: 255 }).notNull(), // stored lower-cased
    passwordHash: text('password_hash').notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    phone: varchar('phone', { length: 20 }),
    role: userRoleEnum('role').notNull().default('customer'),
    status: userStatusEnum('status').notNull().default('active'),
    isDemo: boolean('is_demo').notNull().default(false),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_key').on(t.email), index('users_role_idx').on(t.role)],
);

/** Server-side sessions. `id` is the SHA-256 of the cookie token, so a DB leak exposes no live tokens. */
export const sessions = pgTable(
  'sessions',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    userAgent: varchar('user_agent', { length: 300 }),
    ipAddress: varchar('ip_address', { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

export const addresses = pgTable(
  'addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 40 }).notNull().default('Home'),
    recipientName: varchar('recipient_name', { length: 120 }).notNull(),
    phone: varchar('phone', { length: 20 }).notNull(),
    addressLine: text('address_line').notNull(),
    area: varchar('area', { length: 120 }).notNull(),
    district: varchar('district', { length: 60 }).notNull(),
    division: varchar('division', { length: 40 }).notNull(),
    postalCode: varchar('postal_code', { length: 10 }),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('addresses_user_idx').on(t.userId)],
);

// ─── Catalogue ──────────────────────────────────────────────────────────────────────────────

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 120 }).notNull(),
    slug: varchar('slug', { length: 140 }).notNull(),
    description: text('description'),
    imageUrl: text('image_url'),
    parentId: uuid('parent_id').references((): AnyPgColumn => categories.id, { onDelete: 'set null' }),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('categories_slug_key').on(t.slug), index('categories_parent_idx').on(t.parentId)],
);

export const collections = pgTable(
  'collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 120 }).notNull(),
    slug: varchar('slug', { length: 140 }).notNull(),
    description: text('description'),
    imageUrl: text('image_url'),
    isFeatured: boolean('is_featured').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('collections_slug_key').on(t.slug)],
);

export const sizes = pgTable(
  'sizes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    label: varchar('label', { length: 20 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sizes_label_key').on(t.label)],
);

export const colors = pgTable(
  'colors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 40 }).notNull(),
    hex: varchar('hex', { length: 7 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('colors_name_key').on(t.name),
    check('colors_hex_format', sql`${t.hex} ~ '^#[0-9A-Fa-f]{6}$'`),
  ],
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 200 }).notNull(),
    slug: varchar('slug', { length: 220 }).notNull(),
    description: text('description').notNull().default(''),
    material: varchar('material', { length: 200 }),
    careInstructions: text('care_instructions'),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'restrict' }),
    price: integer('price').notNull(), // poisha
    compareAtPrice: integer('compare_at_price'), // poisha; original price when on sale
    status: productStatusEnum('status').notNull().default('draft'),
    isFeatured: boolean('is_featured').notNull().default(false),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    soldCount: integer('sold_count').notNull().default(0), // denormalised for "bestsellers"
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('products_slug_key').on(t.slug),
    index('products_category_idx').on(t.categoryId),
    index('products_status_created_idx').on(t.status, t.createdAt),
    check('products_price_nonnegative', sql`${t.price} >= 0`),
    check(
      'products_compare_at_gt_price',
      sql`${t.compareAtPrice} IS NULL OR ${t.compareAtPrice} > ${t.price}`,
    ),
    check('products_sold_count_nonnegative', sql`${t.soldCount} >= 0`),
  ],
);

export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sku: varchar('sku', { length: 64 }).notNull(),
    sizeId: uuid('size_id').references(() => sizes.id, { onDelete: 'restrict' }),
    colorId: uuid('color_id').references(() => colors.id, { onDelete: 'restrict' }),
    stock: integer('stock').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('product_variants_sku_key').on(t.sku),
    unique('product_variants_option_key').on(t.productId, t.sizeId, t.colorId).nullsNotDistinct(),
    index('product_variants_product_idx').on(t.productId),
    check('product_variants_stock_nonnegative', sql`${t.stock} >= 0`),
  ],
);

export const productImages = pgTable(
  'product_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    alt: varchar('alt', { length: 200 }).notNull().default(''),
    colorId: uuid('color_id').references(() => colors.id, { onDelete: 'set null' }),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('product_images_product_idx').on(t.productId, t.sortOrder)],
);

export const collectionProducts = pgTable(
  'collection_products',
  {
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.productId] }),
    index('collection_products_product_idx').on(t.productId),
  ],
);

/** Append-only stock ledger: every change to `product_variants.stock` is recorded here. */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    delta: integer('delta').notNull(),
    stockAfter: integer('stock_after').notNull(),
    reason: stockReasonEnum('reason').notNull(),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    note: text('note'),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('stock_movements_variant_idx').on(t.variantId, t.createdAt)],
);

// ─── Shopping ───────────────────────────────────────────────────────────────────────────────

/** A cart belongs to a signed-in user (user_id) or to a guest (id held in an httpOnly cookie). */
export const carts = pgTable(
  'carts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('carts_user_key').on(t.userId)],
);

export const cartItems = pgTable(
  'cart_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('cart_items_cart_variant_key').on(t.cartId, t.variantId),
    check('cart_items_quantity_positive', sql`${t.quantity} > 0`),
  ],
);

export const wishlistItems = pgTable(
  'wishlist_items',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.productId] })],
);

// ─── Commerce configuration ─────────────────────────────────────────────────────────────────

export const shippingZones = pgTable(
  'shipping_zones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 80 }).notNull(),
    fee: integer('fee').notNull(), // poisha
    estimatedDays: varchar('estimated_days', { length: 40 }).notNull(),
    districts: text('districts')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    isDefault: boolean('is_default').notNull().default(false), // catch-all for unlisted districts
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('shipping_zones_single_default').on(t.isDefault).where(sql`${t.isDefault} = true`),
    check('shipping_zones_fee_nonnegative', sql`${t.fee} >= 0`),
  ],
);

export const coupons = pgTable(
  'coupons',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 40 }).notNull(), // stored upper-cased
    description: varchar('description', { length: 200 }),
    type: couponTypeEnum('type').notNull(),
    value: integer('value').notNull(), // percentage (1–100) or fixed amount in poisha
    minOrderAmount: integer('min_order_amount').notNull().default(0),
    maxDiscountAmount: integer('max_discount_amount'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    usageLimit: integer('usage_limit'),
    usageLimitPerCustomer: integer('usage_limit_per_customer'),
    usedCount: integer('used_count').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('coupons_code_key').on(t.code),
    check('coupons_value_positive', sql`${t.value} > 0`),
    check('coupons_percentage_range', sql`${t.type} <> 'percentage' OR ${t.value} <= 100`),
    check('coupons_used_count_nonnegative', sql`${t.usedCount} >= 0`),
  ],
);

/** Key/value store for admin-editable configuration (validated by zod in settings service). */
export const settings = pgTable('settings', {
  key: varchar('key', { length: 80 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: updatedAt(),
});

// ─── Orders & payments ──────────────────────────────────────────────────────────────────────

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderNumber: varchar('order_number', { length: 32 }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    customerName: varchar('customer_name', { length: 120 }).notNull(),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 20 }).notNull(),
    // Shipping address snapshot
    addressLine: text('address_line').notNull(),
    area: varchar('area', { length: 120 }).notNull(),
    district: varchar('district', { length: 60 }).notNull(),
    division: varchar('division', { length: 40 }).notNull(),
    postalCode: varchar('postal_code', { length: 10 }),
    shippingZoneId: uuid('shipping_zone_id').references(() => shippingZones.id, { onDelete: 'set null' }),
    shippingZoneName: varchar('shipping_zone_name', { length: 80 }).notNull(),
    // State
    status: orderStatusEnum('status').notNull().default('pending'),
    paymentMethod: paymentMethodEnum('payment_method').notNull(),
    paymentStatus: paymentStatusEnum('payment_status').notNull(),
    // Totals (poisha)
    subtotal: integer('subtotal').notNull(),
    discountTotal: integer('discount_total').notNull().default(0),
    shippingFee: integer('shipping_fee').notNull(),
    total: integer('total').notNull(),
    couponId: uuid('coupon_id').references(() => coupons.id, { onDelete: 'set null' }),
    couponCode: varchar('coupon_code', { length: 40 }),
    // Notes & fulfilment
    customerNote: text('customer_note'),
    adminNote: text('admin_note'),
    courierName: varchar('courier_name', { length: 80 }),
    trackingNumber: varchar('tracking_number', { length: 80 }),
    trackingUrl: varchar('tracking_url', { length: 300 }),
    // Sum of recorded refunds (poisha). Refunds are made outside the platform and recorded here.
    refundedTotal: integer('refunded_total').notNull().default(0),
    // Safety
    idempotencyKey: varchar('idempotency_key', { length: 80 }),
    accessTokenHash: varchar('access_token_hash', { length: 64 }),
    stockReleased: boolean('stock_released').notNull().default(false),
    isDemo: boolean('is_demo').notNull().default(false),
    // Lifecycle timestamps
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
    paymentExpiresAt: timestamp('payment_expires_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('orders_order_number_key').on(t.orderNumber),
    uniqueIndex('orders_idempotency_key').on(t.idempotencyKey),
    index('orders_user_idx').on(t.userId, t.placedAt),
    index('orders_status_idx').on(t.status, t.placedAt),
    index('orders_phone_idx').on(t.phone),
    index('orders_payment_pending_idx').on(t.paymentStatus, t.paymentExpiresAt),
    check(
      'orders_totals_consistent',
      sql`${t.total} = ${t.subtotal} - ${t.discountTotal} + ${t.shippingFee} AND ${t.total} >= 0`,
    ),
    check('orders_refunded_total_range', sql`${t.refundedTotal} >= 0 AND ${t.refundedTotal} <= ${t.total}`),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'set null' }),
    productName: varchar('product_name', { length: 200 }).notNull(),
    productSlug: varchar('product_slug', { length: 220 }),
    variantLabel: varchar('variant_label', { length: 80 }),
    sku: varchar('sku', { length: 64 }).notNull(),
    imageUrl: text('image_url'),
    unitPrice: integer('unit_price').notNull(),
    quantity: integer('quantity').notNull(),
    lineTotal: integer('line_total').notNull(),
  },
  (t) => [
    index('order_items_order_idx').on(t.orderId),
    index('order_items_product_idx').on(t.productId),
    check('order_items_quantity_positive', sql`${t.quantity} > 0`),
    check('order_items_line_total', sql`${t.lineTotal} = ${t.unitPrice} * ${t.quantity}`),
  ],
);

/** Order timeline: status changes, payment events and notes (some visible to the customer). */
export const orderEvents = pgTable(
  'order_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    status: orderStatusEnum('status'),
    paymentStatus: paymentStatusEnum('payment_status'),
    message: text('message').notNull(),
    visibleToCustomer: boolean('visible_to_customer').notNull().default(true),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('order_events_order_idx').on(t.orderId, t.createdAt)],
);

export const paymentTransactions = pgTable(
  'payment_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    provider: paymentMethodEnum('provider').notNull(),
    tranId: varchar('tran_id', { length: 64 }).notNull(), // our reference sent to the gateway
    amount: integer('amount').notNull(), // poisha
    currency: varchar('currency', { length: 3 }).notNull().default('BDT'),
    status: paymentTxnStatusEnum('status').notNull().default('initiated'),
    gatewaySessionKey: varchar('gateway_session_key', { length: 128 }),
    valId: varchar('val_id', { length: 128 }),
    bankTranId: varchar('bank_tran_id', { length: 128 }),
    cardType: varchar('card_type', { length: 64 }),
    failureReason: text('failure_reason'),
    gatewayResponse: jsonb('gateway_response'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('payment_transactions_tran_id_key').on(t.tranId),
    index('payment_transactions_order_idx').on(t.orderId),
  ],
);

export const couponRedemptions = pgTable(
  'coupon_redemptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    couponId: uuid('coupon_id')
      .notNull()
      .references(() => coupons.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    phone: varchar('phone', { length: 20 }).notNull(),
    amount: integer('amount').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('coupon_redemptions_order_key').on(t.orderId),
    index('coupon_redemptions_coupon_idx').on(t.couponId),
  ],
);

// ─── Platform ───────────────────────────────────────────────────────────────────────────────

/** Fixed-window rate limiting shared across app instances (login, registration, tracking…). */
export const rateLimits = pgTable('rate_limits', {
  key: varchar('key', { length: 200 }).primaryKey(),
  count: integer('count').notNull(),
  resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
});

/**
 * Transactional outbox of domain events (order.placed, order.status_changed, payment.succeeded…)
 * for integration with other MKJ Ecosystem services via signed webhooks.
 */
export const domainEvents = pgTable(
  'domain_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: varchar('type', { length: 80 }).notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    payload: jsonb('payload').notNull(),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('domain_events_pending_idx').on(t.dispatchedAt, t.createdAt)],
);

// ─── Account security ───────────────────────────────────────────────────────────────────────

/**
 * Single-use, expiring tokens (password reset). Only the SHA-256 of the token is stored, so a
 * database leak exposes no usable links.
 */
export const userTokens = pgTable(
  'user_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: userTokenPurposeEnum('purpose').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    requestIp: varchar('request_ip', { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('user_tokens_hash_key').on(t.tokenHash), index('user_tokens_user_idx').on(t.userId, t.purpose)],
);

// ─── Notifications ──────────────────────────────────────────────────────────────────────────

/**
 * Outbox of customer/staff notifications (email, SMS). Rows are written in the same transaction
 * as the change they describe and delivered by a dispatcher with retries. `status` reflects what
 * the provider actually reported: messages are only `sent` after the SMTP server / SMS gateway
 * accepted them; `skipped` means no provider is configured (or the record is demo data).
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channel: notificationChannelEnum('channel').notNull(),
    template: varchar('template', { length: 60 }).notNull(),
    recipient: varchar('recipient', { length: 255 }).notNull(),
    subject: varchar('subject', { length: 255 }),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    /** Sensitive render data (e.g. a guest order link). Erased once the message reaches a final state. */
    secretPayload: jsonb('secret_payload'),
    status: notificationStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    providerMessageId: varchar('provider_message_id', { length: 255 }),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('notifications_pending_idx').on(t.status, t.nextAttemptAt),
    index('notifications_order_idx').on(t.orderId, t.createdAt),
  ],
);

// ─── Returns & refunds ──────────────────────────────────────────────────────────────────────

export const returnRequests = pgTable(
  'return_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestNumber: varchar('request_number', { length: 32 }).notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    status: returnStatusEnum('status').notNull().default('requested'),
    reason: varchar('reason', { length: 40 }).notNull(),
    customerNote: text('customer_note'),
    /** Shown to the customer (e.g. why a request was declined, drop-off instructions). */
    resolutionNote: text('resolution_note'),
    /** Internal only. */
    adminNote: text('admin_note'),
    restocked: boolean('restocked').notNull().default(false),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('return_requests_number_key').on(t.requestNumber),
    index('return_requests_order_idx').on(t.orderId),
    index('return_requests_status_idx').on(t.status, t.createdAt),
  ],
);

export const returnRequestItems = pgTable(
  'return_request_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    returnRequestId: uuid('return_request_id')
      .notNull()
      .references(() => returnRequests.id, { onDelete: 'cascade' }),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
  },
  (t) => [
    uniqueIndex('return_request_items_key').on(t.returnRequestId, t.orderItemId),
    check('return_request_items_quantity_positive', sql`${t.quantity} > 0`),
  ],
);

/**
 * Refund ledger. MKJ MART does not move money: refunds are paid through the SSLCommerz merchant
 * panel, bKash/Nagad, bank transfer or cash, and then RECORDED here with the external reference.
 */
export const refunds = pgTable(
  'refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    returnRequestId: uuid('return_request_id').references(() => returnRequests.id, { onDelete: 'set null' }),
    amount: integer('amount').notNull(),
    method: varchar('method', { length: 30 }).notNull(),
    reference: varchar('reference', { length: 120 }),
    note: text('note'),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('refunds_order_idx').on(t.orderId), check('refunds_amount_positive', sql`${t.amount} > 0`)],
);

// ─── Customer support ───────────────────────────────────────────────────────────────────────

export const supportRequests = pgTable(
  'support_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketNumber: varchar('ticket_number', { length: 32 }).notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    email: varchar('email', { length: 255 }),
    phone: varchar('phone', { length: 20 }),
    orderNumber: varchar('order_number', { length: 32 }),
    topic: varchar('topic', { length: 40 }).notNull(),
    message: text('message').notNull(),
    status: supportStatusEnum('status').notNull().default('open'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    adminNote: text('admin_note'),
    ipAddress: varchar('ip_address', { length: 64 }),
    isDemo: boolean('is_demo').notNull().default(false),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('support_requests_ticket_key').on(t.ticketNumber),
    index('support_requests_status_idx').on(t.status, t.createdAt),
    check('support_requests_contact', sql`${t.email} IS NOT NULL OR ${t.phone} IS NOT NULL`),
  ],
);

// ─── Operations ─────────────────────────────────────────────────────────────────────────────

/** Heartbeat of scheduled jobs, so the admin can see whether cron is actually running. */
export const jobRuns = pgTable('job_runs', {
  name: varchar('name', { length: 60 }).primaryKey(),
  lastStartedAt: timestamp('last_started_at', { withTimezone: true }),
  lastSucceededAt: timestamp('last_succeeded_at', { withTimezone: true }),
  lastFailedAt: timestamp('last_failed_at', { withTimezone: true }),
  lastError: text('last_error'),
  lastResult: jsonb('last_result'),
  runCount: integer('run_count').notNull().default(0),
});

// ─── Relations (for relational queries) ─────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  addresses: many(addresses),
  orders: many(orders),
  sessions: many(sessions),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, { fields: [categories.parentId], references: [categories.id], relationName: 'tree' }),
  children: many(categories, { relationName: 'tree' }),
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  variants: many(productVariants),
  images: many(productImages),
  collections: many(collectionProducts),
}));

export const productVariantsRelations = relations(productVariants, ({ one }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
  size: one(sizes, { fields: [productVariants.sizeId], references: [sizes.id] }),
  color: one(colors, { fields: [productVariants.colorId], references: [colors.id] }),
}));

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, { fields: [productImages.productId], references: [products.id] }),
  color: one(colors, { fields: [productImages.colorId], references: [colors.id] }),
}));

export const collectionsRelations = relations(collections, ({ many }) => ({
  products: many(collectionProducts),
}));

export const collectionProductsRelations = relations(collectionProducts, ({ one }) => ({
  collection: one(collections, { fields: [collectionProducts.collectionId], references: [collections.id] }),
  product: one(products, { fields: [collectionProducts.productId], references: [products.id] }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, { fields: [orders.userId], references: [users.id] }),
  items: many(orderItems),
  events: many(orderEvents),
  transactions: many(paymentTransactions),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
}));

export const orderEventsRelations = relations(orderEvents, ({ one }) => ({
  order: one(orders, { fields: [orderEvents.orderId], references: [orders.id] }),
}));

export const paymentTransactionsRelations = relations(paymentTransactions, ({ one }) => ({
  order: one(orders, { fields: [paymentTransactions.orderId], references: [orders.id] }),
}));

export const addressesRelations = relations(addresses, ({ one }) => ({
  user: one(users, { fields: [addresses.userId], references: [users.id] }),
}));

export const cartsRelations = relations(carts, ({ many }) => ({
  items: many(cartItems),
}));

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, { fields: [cartItems.cartId], references: [carts.id] }),
  variant: one(productVariants, { fields: [cartItems.variantId], references: [productVariants.id] }),
}));
