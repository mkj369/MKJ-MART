import 'server-only';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { db, type Transaction } from '@/server/db';
import {
  addresses,
  cartItems,
  colors,
  couponRedemptions,
  coupons,
  orderItems,
  orders,
  paymentTransactions,
  productImages,
  products,
  productVariants,
  sizes,
  stockMovements,
} from '@/server/db/schema';
import { appUrl, paymentTimeoutMinutes, sslcommerzConfig } from '@/server/env';
import { AppError, badRequest, conflict, isUniqueViolation, unauthorized, validationError } from '@/server/errors';
import { randomCode, sha256Hex } from '@/server/auth/tokens';
import { log } from '@/server/logger';
import { scheduleNotificationDispatch } from '@/server/notifications';
import { queueOrderPlacedNotifications } from '@/server/notifications/orders';
import { initiateSession, SSLC_MAX_AMOUNT, SSLC_MIN_AMOUNT } from '@/server/payments/sslcommerz';
import { formatBDT } from '@/lib/money';
import type { PaymentMethod } from '@/lib/order-status';
import type { CheckoutInput, QuoteInput } from '@/lib/validation/store';
import { normalizeBdPhone } from '@/lib/phone';
import { addLinesToCart, getCartView } from './cart';
import { evaluateCoupon, loadCouponForCustomer } from './coupons';
import { recordEvent } from './events';
import { deriveOrderAccessToken, insertOrderEvent } from './orders';
import { failPaymentInitiation } from './payments';
import { getSetting } from './settings';
import { listActiveZones, resolveZone, shippingFeeFor } from './shipping';

// ─── Quote (preview shown on the checkout page) ───────────────────────────────

export type CheckoutQuote = {
  lines: Awaited<ReturnType<typeof getCartView>>['lines'];
  itemCount: number;
  subtotal: number;
  discount: number;
  coupon: { code: string; description: string | null } | null;
  couponError: string | null;
  shippingFee: number;
  freeShipping: boolean;
  freeShippingThreshold: number | null;
  zone: { id: string; name: string; estimatedDays: string } | null;
  total: number;
  hasIssues: boolean;
  paymentMethods: { method: PaymentMethod; available: boolean; reason: string | null }[];
};

export async function getAvailablePaymentMethods(total: number) {
  const settings = await getSetting('checkout');
  const online = settings.onlinePaymentEnabled && sslcommerzConfig() !== null;
  const onlineOutOfRange = total < SSLC_MIN_AMOUNT || total > SSLC_MAX_AMOUNT;
  const codOverLimit = settings.codMaxOrderAmount !== null && total > settings.codMaxOrderAmount;
  return [
    {
      method: 'cod' as const,
      available: settings.codEnabled && !codOverLimit,
      reason: !settings.codEnabled
        ? 'Cash on Delivery is currently unavailable.'
        : codOverLimit
          ? `Available for orders up to ${formatBDT(settings.codMaxOrderAmount!)}.`
          : null,
    },
    {
      method: 'sslcommerz' as const,
      available: online && !onlineOutOfRange,
      reason: !online
        ? 'Online payment is not available at the moment.'
        : onlineOutOfRange
          ? `Online payment is available for orders from ${formatBDT(SSLC_MIN_AMOUNT)} to ${formatBDT(SSLC_MAX_AMOUNT)}.`
          : null,
    },
  ];
}

export async function getCheckoutQuote(
  cartId: string | null,
  input: QuoteInput,
  customer: { userId: string | null },
): Promise<CheckoutQuote> {
  const [cart, settings, zones] = await Promise.all([getCartView(cartId), getSetting('checkout'), listActiveZones()]);
  let discount = 0;
  let coupon: CheckoutQuote['coupon'] = null;
  let couponError: string | null = null;
  if (input.couponCode) {
    const loaded = await loadCouponForCustomer(db, input.couponCode, {
      userId: customer.userId,
      phone: normalizeBdPhone(input.phone),
    });
    const evaluation = evaluateCoupon(loaded.coupon, {
      subtotal: cart.subtotal,
      now: new Date(),
      customerRedemptions: loaded.customerRedemptions,
    });
    if (evaluation.ok) {
      discount = evaluation.discount;
      coupon = { code: loaded.coupon!.code, description: loaded.coupon!.description };
    } else {
      couponError = evaluation.reason;
    }
  }
  const zone = resolveZone(zones, input.district);
  const shipping = zone
    ? shippingFeeFor(zone, cart.subtotal - discount, settings.freeShippingThreshold)
    : { fee: 0, free: false };
  const total = cart.subtotal - discount + shipping.fee;
  return {
    lines: cart.lines,
    itemCount: cart.itemCount,
    subtotal: cart.subtotal,
    discount,
    coupon,
    couponError,
    shippingFee: shipping.fee,
    freeShipping: shipping.free,
    freeShippingThreshold: settings.freeShippingThreshold,
    zone: zone ? { id: zone.id, name: zone.name, estimatedDays: zone.estimatedDays } : null,
    total,
    hasIssues: cart.hasIssues,
    paymentMethods: await getAvailablePaymentMethods(total),
  };
}

// ─── Place order ──────────────────────────────────────────────────────────────

export type PlaceOrderContext = {
  userId: string | null;
  cartId: string | null;
};

export type PlaceOrderResult = {
  orderId: string;
  orderNumber: string;
  accessToken: string;
  reused: boolean;
  next: { type: 'confirmation' } | { type: 'redirect'; url: string };
};

export type StockProblem = {
  variantId: string;
  productName: string;
  variantLabel: string | null;
  requested: number;
  available: number;
};

/** MKJ-YYMMDD-XXXXX in Bangladesh time; 32^5 ≈ 33.5M combinations per day. */
export function generateOrderNumber(now = new Date()): string {
  const dhaka = new Date(now.getTime() + 6 * 60 * 60 * 1000); // UTC+6, no DST
  const ymd = dhaka.toISOString().slice(2, 10).replace(/-/g, '');
  return `MKJ-${ymd}-${randomCode(5)}`;
}

function variantLabel(size: string | null, color: string | null): string | null {
  return [color, size].filter(Boolean).join(' / ') || null;
}

async function findByIdempotencyKey(key: string) {
  const [order] = await db.select().from(orders).where(eq(orders.idempotencyKey, key)).limit(1);
  return order ?? null;
}

async function reuseExisting(order: typeof orders.$inferSelect, ctx: PlaceOrderContext): Promise<PlaceOrderResult> {
  if (order.userId && order.userId !== ctx.userId) {
    throw conflict('This checkout session has already been used.', 'IDEMPOTENCY_CONFLICT');
  }
  let next: PlaceOrderResult['next'] = { type: 'confirmation' };
  if (order.paymentMethod === 'sslcommerz' && order.status === 'pending' && order.paymentStatus === 'pending') {
    const [txn] = await db
      .select()
      .from(paymentTransactions)
      .where(and(eq(paymentTransactions.orderId, order.id), eq(paymentTransactions.status, 'pending')))
      .limit(1);
    const url = (txn?.gatewayResponse as { GatewayPageURL?: string } | null)?.GatewayPageURL;
    if (url) next = { type: 'redirect', url };
  }
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    accessToken: deriveOrderAccessToken(order.idempotencyKey!, order.orderNumber),
    reused: true,
    next,
  };
}

/**
 * Places an order from the shopper's cart in ONE database transaction:
 *  1. lock the variants being purchased (SELECT … FOR UPDATE) to serialise concurrent checkouts
 *  2. re-validate availability and recompute every price, discount and delivery fee server-side
 *  3. reject if the total differs from what the customer saw (`expectedTotal`)
 *  4. create the order with snapshots, decrement stock (with ledger), redeem the coupon,
 *     write timeline/outbox events and empty the cart
 * Duplicate submissions with the same idempotency key return the original order.
 */
export async function placeOrder(input: CheckoutInput, ctx: PlaceOrderContext): Promise<PlaceOrderResult> {
  const existing = await findByIdempotencyKey(input.idempotencyKey);
  if (existing) return reuseExisting(existing, ctx);

  const settings = await getSetting('checkout');
  if (!ctx.userId && !settings.guestCheckoutEnabled) throw unauthorized('Please sign in to place your order.');
  if (input.paymentMethod === 'cod' && !settings.codEnabled) {
    throw badRequest('Cash on Delivery is currently unavailable.', 'PAYMENT_METHOD_UNAVAILABLE');
  }
  const gateway = sslcommerzConfig();
  if (input.paymentMethod === 'sslcommerz') {
    if (!settings.onlinePaymentEnabled || !gateway) {
      throw badRequest('Online payment is currently unavailable. Please choose Cash on Delivery.', 'PAYMENT_METHOD_UNAVAILABLE');
    }
    if (!input.contact.email) {
      throw validationError({ 'contact.email': 'An email address is required for online payment receipts.' });
    }
  }
  if (!ctx.cartId) throw badRequest('Your bag is empty.', 'CART_EMPTY');
  const cartId = ctx.cartId;

  const zones = await listActiveZones();
  const zone = resolveZone(zones, input.address.district);
  if (!zone) throw badRequest('Sorry, we do not deliver to this district yet.', 'NO_DELIVERY_ZONE');

  const orderNumber = generateOrderNumber();
  const accessToken = deriveOrderAccessToken(input.idempotencyKey, orderNumber);
  const isOnline = input.paymentMethod !== 'cod';

  let created: {
    order: typeof orders.$inferSelect;
    txn: typeof paymentTransactions.$inferSelect | null;
    lines: { variantId: string; quantity: number; productName: string }[];
  };

  try {
    created = await db.transaction(async (tx: Transaction) => {
      const lines = await tx
        .select({
          cartItemId: cartItems.id,
          variantId: cartItems.variantId,
          quantity: cartItems.quantity,
          stock: productVariants.stock,
          variantActive: productVariants.isActive,
          sku: productVariants.sku,
          colorId: productVariants.colorId,
          productId: products.id,
          productName: products.name,
          productSlug: products.slug,
          productStatus: products.status,
          price: products.price,
          sizeLabel: sizes.label,
          colorName: colors.name,
        })
        .from(cartItems)
        .innerJoin(productVariants, eq(productVariants.id, cartItems.variantId))
        .innerJoin(products, eq(products.id, productVariants.productId))
        .leftJoin(sizes, eq(sizes.id, productVariants.sizeId))
        .leftJoin(colors, eq(colors.id, productVariants.colorId))
        .where(eq(cartItems.cartId, cartId))
        .orderBy(asc(productVariants.id)) // consistent lock order prevents deadlocks
        .for('update', { of: productVariants });

      if (lines.length === 0) throw badRequest('Your bag is empty.', 'CART_EMPTY');

      const problems: StockProblem[] = [];
      for (const line of lines) {
        const available = line.productStatus === 'active' && line.variantActive ? line.stock : 0;
        if (available < line.quantity || line.quantity > settings.maxQuantityPerItem) {
          problems.push({
            variantId: line.variantId,
            productName: line.productName,
            variantLabel: variantLabel(line.sizeLabel, line.colorName),
            requested: line.quantity,
            available: Math.min(available, settings.maxQuantityPerItem),
          });
        }
      }
      if (problems.length > 0) {
        throw new AppError(
          409,
          'STOCK_UNAVAILABLE',
          'Some items in your bag are no longer available in the quantity requested.',
          { details: { problems } },
        );
      }

      const subtotal = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);

      let discount = 0;
      let coupon: typeof coupons.$inferSelect | null = null;
      if (input.couponCode) {
        const loaded = await loadCouponForCustomer(
          tx,
          input.couponCode,
          { userId: ctx.userId, phone: input.contact.phone },
          { lock: true },
        );
        const evaluation = evaluateCoupon(loaded.coupon, {
          subtotal,
          now: new Date(),
          customerRedemptions: loaded.customerRedemptions,
        });
        if (!evaluation.ok) {
          throw new AppError(422, 'COUPON_INVALID', evaluation.reason, { fields: { couponCode: evaluation.reason } });
        }
        discount = evaluation.discount;
        coupon = loaded.coupon;
      }

      const shipping = shippingFeeFor(zone, subtotal - discount, settings.freeShippingThreshold);
      const total = subtotal - discount + shipping.fee;

      if (input.expectedTotal !== undefined && input.expectedTotal !== total) {
        throw new AppError(409, 'PRICE_CHANGED', 'Prices or delivery charges changed. Please review your order total.', {
          details: { subtotal, discount, shippingFee: shipping.fee, total },
        });
      }
      if (input.paymentMethod === 'cod' && settings.codMaxOrderAmount !== null && total > settings.codMaxOrderAmount) {
        throw badRequest(
          `Cash on Delivery is available for orders up to ${formatBDT(settings.codMaxOrderAmount)}. Please pay online.`,
          'COD_LIMIT_EXCEEDED',
        );
      }
      if (input.paymentMethod === 'sslcommerz' && (total < SSLC_MIN_AMOUNT || total > SSLC_MAX_AMOUNT)) {
        throw badRequest(
          `Online payment is available for orders from ${formatBDT(SSLC_MIN_AMOUNT)} to ${formatBDT(SSLC_MAX_AMOUNT)}. Please choose another payment method.`,
          'AMOUNT_OUT_OF_RANGE',
        );
      }

      const images = await tx
        .select({ productId: productImages.productId, url: productImages.url, colorId: productImages.colorId })
        .from(productImages)
        .where(sql`${productImages.productId} IN (${sql.join([...new Set(lines.map((l) => sql`${l.productId}`))], sql`, `)})`)
        .orderBy(asc(productImages.sortOrder));

      const [order] = await tx
        .insert(orders)
        .values({
          orderNumber,
          userId: ctx.userId,
          customerName: input.contact.name,
          email: input.contact.email ?? null,
          phone: input.contact.phone,
          addressLine: input.address.addressLine,
          area: input.address.area,
          district: input.address.district,
          division: input.address.division,
          postalCode: input.address.postalCode ?? null,
          shippingZoneId: zone.id,
          shippingZoneName: zone.name,
          status: 'pending',
          paymentMethod: input.paymentMethod,
          paymentStatus: isOnline ? 'pending' : 'unpaid',
          subtotal,
          discountTotal: discount,
          shippingFee: shipping.fee,
          total,
          couponId: coupon?.id ?? null,
          couponCode: coupon?.code ?? null,
          customerNote: input.note ?? null,
          idempotencyKey: input.idempotencyKey,
          accessTokenHash: sha256Hex(accessToken),
          paymentExpiresAt: isOnline ? new Date(Date.now() + paymentTimeoutMinutes() * 60_000) : null,
        })
        .returning();

      await tx.insert(orderItems).values(
        lines.map((l) => {
          const productImgs = images.filter((i) => i.productId === l.productId);
          const image = (productImgs.find((i) => l.colorId && i.colorId === l.colorId) ?? productImgs[0])?.url ?? null;
          return {
            orderId: order!.id,
            productId: l.productId,
            variantId: l.variantId,
            productName: l.productName,
            productSlug: l.productSlug,
            variantLabel: variantLabel(l.sizeLabel, l.colorName),
            sku: l.sku,
            imageUrl: image,
            unitPrice: l.price,
            quantity: l.quantity,
            lineTotal: l.price * l.quantity,
          };
        }),
      );

      for (const line of lines) {
        const [updated] = await tx
          .update(productVariants)
          .set({ stock: sql`${productVariants.stock} - ${line.quantity}`, updatedAt: new Date() })
          .where(and(eq(productVariants.id, line.variantId), gte(productVariants.stock, line.quantity)))
          .returning({ stock: productVariants.stock });
        if (!updated) {
          throw new AppError(409, 'STOCK_UNAVAILABLE', 'An item sold out while you were checking out.');
        }
        await tx.insert(stockMovements).values({
          variantId: line.variantId,
          delta: -line.quantity,
          stockAfter: updated.stock,
          reason: 'order',
          orderId: order!.id,
          actorId: ctx.userId,
          note: `Reserved for ${orderNumber}`,
        });
        await tx
          .update(products)
          .set({ soldCount: sql`${products.soldCount} + ${line.quantity}` })
          .where(eq(products.id, line.productId));
      }

      if (coupon) {
        await tx.insert(couponRedemptions).values({
          couponId: coupon.id,
          orderId: order!.id,
          userId: ctx.userId,
          phone: input.contact.phone,
          amount: discount,
        });
        await tx
          .update(coupons)
          .set({ usedCount: sql`${coupons.usedCount} + 1` })
          .where(eq(coupons.id, coupon.id));
      }

      await insertOrderEvent(tx, {
        orderId: order!.id,
        status: 'pending',
        paymentStatus: order!.paymentStatus,
        message: isOnline ? 'Order created — awaiting online payment.' : 'Order placed with Cash on Delivery.',
        actorId: ctx.userId,
      });
      await recordEvent(tx, 'order.placed', order!.id, {
        orderNumber,
        total,
        currency: 'BDT',
        paymentMethod: input.paymentMethod,
        itemCount: lines.reduce((s, l) => s + l.quantity, 0),
        district: input.address.district,
        customerId: ctx.userId,
      });

      await tx.delete(cartItems).where(eq(cartItems.cartId, cartId));
      if (!isOnline) await queueOrderPlacedNotifications(tx, order!);

      if (input.saveAddress && ctx.userId) {
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(addresses)
          .where(eq(addresses.userId, ctx.userId));
        await tx.insert(addresses).values({
          userId: ctx.userId,
          label: 'Home',
          recipientName: input.contact.name,
          phone: input.contact.phone,
          addressLine: input.address.addressLine,
          area: input.address.area,
          district: input.address.district,
          division: input.address.division,
          postalCode: input.address.postalCode ?? null,
          isDefault: count === 0,
        });
      }

      let txn: typeof paymentTransactions.$inferSelect | null = null;
      if (isOnline) {
        [txn] = await tx
          .insert(paymentTransactions)
          .values({
            orderId: order!.id,
            provider: 'sslcommerz',
            tranId: `${orderNumber}-${randomCode(6)}`,
            amount: total,
            status: 'initiated',
          })
          .returning();
      }

      return {
        order: order!,
        txn,
        lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, productName: l.productName })),
      };
    });
  } catch (error) {
    // A concurrent duplicate submission (double click, retried request) may have won the race and
    // emptied the cart or claimed the idempotency key: return that order instead of an error.
    const again = await findByIdempotencyKey(input.idempotencyKey);
    if (again) return reuseExisting(again, ctx);
    if (isUniqueViolation(error, 'orders_order_number_key')) {
      return placeOrder(input, ctx); // astronomically rare collision: retry with a new number
    }
    throw error;
  }

  const base: Omit<PlaceOrderResult, 'next'> = {
    orderId: created.order.id,
    orderNumber,
    accessToken,
    reused: false,
  };
  if (!created.txn || !gateway) {
    scheduleNotificationDispatch();
    return { ...base, next: { type: 'confirmation' } };
  }

  try {
    const session = await initiateSession(gateway, {
      tranId: created.txn.tranId,
      amount: created.order.total,
      orderNumber,
      callbackBaseUrl: appUrl(),
      customer: {
        name: input.contact.name,
        email: input.contact.email!,
        phone: input.contact.phone,
        addressLine: input.address.addressLine,
        area: input.address.area,
        district: input.address.district,
        division: input.address.division,
        postalCode: input.address.postalCode,
      },
      productSummary: created.lines.map((l) => l.productName).join(', '),
      itemCount: created.lines.reduce((s, l) => s + l.quantity, 0),
    });
    await db
      .update(paymentTransactions)
      .set({ status: 'pending', gatewaySessionKey: session.sessionKey, gatewayResponse: session.raw })
      .where(eq(paymentTransactions.id, created.txn.id));
    return { ...base, next: { type: 'redirect', url: session.gatewayUrl } };
  } catch (error) {
    log.error('checkout.payment_session_failed', { orderNumber, error: error instanceof Error ? error.message : String(error) });
    await failPaymentInitiation(created.txn.id, created.order.id, 'Could not start the payment session.', {
      error: String(error instanceof Error ? error.message : error),
    });
    // Give the shopper their bag back so they can retry or switch to Cash on Delivery.
    await db.transaction((tx) => addLinesToCart(tx, cartId, created.lines));
    throw new AppError(
      502,
      'PAYMENT_INIT_FAILED',
      'We could not reach the payment gateway, so your order was not placed. Your bag has been restored — please try again or choose Cash on Delivery.',
    );
  }
}
