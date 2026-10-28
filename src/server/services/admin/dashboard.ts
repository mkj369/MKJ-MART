import 'server-only';
import { and, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { colors, orderItems, orders, productImages, products, productVariants, sizes, users } from '@/server/db/schema';
import { getSetting } from '../settings';
import { VALID_ORDER_SQL } from './customers';

const DAY = 24 * 60 * 60 * 1000;
const DHAKA_OFFSET = 6 * 60 * 60 * 1000;

/** YYYY-MM-DD of a timestamp in Asia/Dhaka. */
function dhakaDay(date: Date): string {
  return new Date(date.getTime() + DHAKA_OFFSET).toISOString().slice(0, 10);
}

async function periodTotals(from: Date, to: Date) {
  const [row] = await db
    .select({
      sales: sql<number>`coalesce(sum(${orders.total}) filter (where ${VALID_ORDER_SQL}), 0)::bigint`,
      orders: sql<number>`count(*) filter (where ${VALID_ORDER_SQL})::int`,
      collected: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.paymentStatus} = 'paid'), 0)::bigint`,
    })
    .from(orders)
    .where(and(gte(orders.placedAt, from), lt(orders.placedAt, to)));
  return { sales: Number(row?.sales ?? 0), orders: Number(row?.orders ?? 0), collected: Number(row?.collected ?? 0) };
}

/**
 * Dashboard metrics. "Sales" counts orders that are not cancelled and not stuck awaiting online
 * payment; "Collected" counts only orders actually paid (COD cash received or gateway-confirmed).
 */
export async function getDashboard(rangeDays = 30) {
  const now = new Date();
  const from = new Date(now.getTime() - rangeDays * DAY);
  const prevFrom = new Date(from.getTime() - rangeDays * DAY);
  const { lowStockThreshold } = await getSetting('checkout');

  const [current, previous, queue, stock, daily, top, recent, lowItems, customerStats] = await Promise.all([
    periodTotals(from, now),
    periodTotals(prevFrom, from),
    db
      .select({
        toConfirm: sql<number>`count(*) filter (where ${orders.status} = 'pending' and ${VALID_ORDER_SQL})::int`,
        toFulfil: sql<number>`count(*) filter (where ${orders.status} in ('confirmed','processing'))::int`,
        inTransit: sql<number>`count(*) filter (where ${orders.status} = 'shipped')::int`,
        awaitingPayment: sql<number>`count(*) filter (where ${orders.status} = 'pending' and ${orders.paymentMethod} = 'sslcommerz' and ${orders.paymentStatus} = 'pending')::int`,
        codToCollect: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.paymentMethod} = 'cod' and ${orders.paymentStatus} = 'unpaid' and ${orders.status} in ('confirmed','processing','shipped')), 0)::bigint`,
      })
      .from(orders),
    db
      .select({
        low: sql<number>`count(*) filter (where ${productVariants.stock} > 0 and ${productVariants.stock} <= ${lowStockThreshold})::int`,
        out: sql<number>`count(*) filter (where ${productVariants.stock} = 0)::int`,
        units: sql<number>`coalesce(sum(${productVariants.stock}), 0)::int`,
        value: sql<number>`coalesce(sum(${productVariants.stock} * ${products.price}), 0)::bigint`,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(productVariants.isActive, true), eq(products.status, 'active'))),
    db
      .select({
        day: sql<string>`to_char(${orders.placedAt} AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD')`,
        sales: sql<number>`coalesce(sum(${orders.total}), 0)::bigint`,
        orders: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(and(gte(orders.placedAt, from), VALID_ORDER_SQL))
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .select({
        productId: orderItems.productId,
        name: orderItems.productName,
        quantity: sql<number>`sum(${orderItems.quantity})::int`,
        revenue: sql<number>`sum(${orderItems.lineTotal})::bigint`,
        image: sql<string | null>`max(${orderItems.imageUrl})`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(gte(orders.placedAt, from), VALID_ORDER_SQL))
      .groupBy(orderItems.productId, orderItems.productName)
      .orderBy(desc(sql`sum(${orderItems.quantity})`))
      .limit(5),
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        customerName: orders.customerName,
        total: orders.total,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
        paymentMethod: orders.paymentMethod,
        placedAt: orders.placedAt,
      })
      .from(orders)
      .orderBy(desc(orders.placedAt))
      .limit(6),
    db
      .select({
        variantId: productVariants.id,
        productId: products.id,
        productName: products.name,
        sku: productVariants.sku,
        stock: productVariants.stock,
        sizeLabel: sizes.label,
        colorName: colors.name,
        image: sql<string | null>`(select url from product_images i where i.product_id = products.id order by i.sort_order limit 1)`,
      })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(sizes, eq(sizes.id, productVariants.sizeId))
      .leftJoin(colors, eq(colors.id, productVariants.colorId))
      .where(and(eq(productVariants.isActive, true), eq(products.status, 'active'), lte(productVariants.stock, lowStockThreshold)))
      .orderBy(productVariants.stock, products.name)
      .limit(6),
    db
      .select({
        total: sql<number>`count(*) filter (where ${users.role} = 'customer')::int`,
        newInRange: sql<number>`count(*) filter (where ${users.role} = 'customer' and ${users.createdAt} >= ${from})::int`,
      })
      .from(users),
  ]);

  // Fill missing days so the chart has a continuous axis.
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const series: { day: string; sales: number; orders: number }[] = [];
  for (let i = rangeDays - 1; i >= 0; i--) {
    const day = dhakaDay(new Date(now.getTime() - i * DAY));
    const hit = byDay.get(day);
    series.push({ day, sales: Number(hit?.sales ?? 0), orders: Number(hit?.orders ?? 0) });
  }

  const pct = (cur: number, prev: number) => (prev === 0 ? (cur > 0 ? null : 0) : Math.round(((cur - prev) / prev) * 100));

  return {
    rangeDays,
    sales: current.sales,
    salesChange: pct(current.sales, previous.sales),
    orders: current.orders,
    ordersChange: pct(current.orders, previous.orders),
    collected: current.collected,
    averageOrderValue: current.orders ? Math.round(current.sales / current.orders / 100) * 100 : 0,
    queue: { ...queue[0]!, codToCollect: Number(queue[0]?.codToCollect ?? 0) },
    stock: { ...stock[0]!, value: Number(stock[0]?.value ?? 0) },
    lowStockThreshold,
    series,
    topProducts: top.map((t) => ({ ...t, revenue: Number(t.revenue) })),
    recentOrders: recent,
    lowStockItems: lowItems,
    customers: customerStats[0]!,
  };
}

export async function getPendingOrderCount(): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(inArray(orders.status, ['pending']), VALID_ORDER_SQL));
  return row?.value ?? 0;
}
