import 'server-only';
import { and, asc, count, desc, eq, ilike, ne, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/server/db';
import { addresses, orders, users } from '@/server/db/schema';
import { conflict, forbidden, notFound } from '@/server/errors';
import { invalidateUserSessions } from '@/server/auth/session';
import { can, type Role } from '@/lib/permissions';

/** An order "counts" as a sale unless cancelled or awaiting an online payment that never arrived. */
export const VALID_ORDER_SQL = sql`(${orders.status} <> 'cancelled' AND NOT (${orders.paymentMethod} = 'sslcommerz' AND ${orders.paymentStatus} <> 'paid'))`;

export async function listCustomers(query: {
  q?: string;
  role?: 'customer' | 'staff' | 'all';
  status?: 'active' | 'blocked' | 'all';
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, query.pageSize ?? 20);
  const conditions: SQL[] = [];
  if (query.role === 'customer') conditions.push(eq(users.role, 'customer'));
  if (query.role === 'staff') conditions.push(ne(users.role, 'customer'));
  if (query.status && query.status !== 'all') conditions.push(eq(users.status, query.status));
  if (query.q) {
    const like = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(or(ilike(users.name, like), ilike(users.email, like), ilike(users.phone, like))!);
  }
  const where = conditions.length ? and(...conditions) : undefined;
  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        role: users.role,
        status: users.status,
        isDemo: users.isDemo,
        createdAt: users.createdAt,
        lastLoginAt: users.lastLoginAt,
        orderCount: sql<number>`(select count(*)::int from orders o where o.user_id = users.id)`,
        totalSpent: sql<number>`(
          select coalesce(sum(o.total), 0)::int from orders o
          where o.user_id = users.id and o.status <> 'cancelled'
            and not (o.payment_method = 'sslcommerz' and o.payment_status <> 'paid')
        )`,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt), asc(users.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ value: count() }).from(users).where(where),
  ]);
  return { items: rows, total: totalRow?.value ?? 0, page, pageSize };
}

export async function getCustomer(id: string) {
  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: users.role,
      status: users.status,
      isDemo: users.isDemo,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!user) throw notFound('Customer not found.');
  const [addressRows, orderRows, [stats]] = await Promise.all([
    db.select().from(addresses).where(eq(addresses.userId, id)).orderBy(desc(addresses.isDefault)),
    db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
        total: orders.total,
        placedAt: orders.placedAt,
      })
      .from(orders)
      .where(eq(orders.userId, id))
      .orderBy(desc(orders.placedAt))
      .limit(20),
    db
      .select({
        orderCount: sql<number>`count(*)::int`,
        totalSpent: sql<number>`coalesce(sum(${orders.total}) filter (where ${VALID_ORDER_SQL}), 0)::int`,
      })
      .from(orders)
      .where(eq(orders.userId, id)),
  ]);
  return { user, addresses: addressRows, orders: orderRows, stats: stats! };
}

/**
 * Blocks/unblocks accounts and changes roles. Guards: nobody edits their own account here, only
 * admins can grant or revoke staff roles, and the last active admin can never be removed.
 */
export async function updateCustomer(
  id: string,
  input: { status?: 'active' | 'blocked'; role?: Role },
  actor: { id: string; role: Role },
) {
  if (!can(actor.role, 'customers:manage')) throw forbidden('Only administrators can manage accounts.');
  if (id === actor.id) throw conflict('You cannot change your own role or status.', 'SELF_EDIT');
  const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!target) throw notFound('Customer not found.');

  const losingAdmin = target.role === 'admin' && ((input.role && input.role !== 'admin') || input.status === 'blocked');
  if (losingAdmin) {
    const [{ admins }] = await db
      .select({ admins: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.status, 'active')));
    if (admins <= 1) throw conflict('At least one active administrator is required.', 'LAST_ADMIN');
  }

  const [updated] = await db
    .update(users)
    .set({ ...(input.status ? { status: input.status } : {}), ...(input.role ? { role: input.role } : {}) })
    .where(eq(users.id, id))
    .returning({ id: users.id, role: users.role, status: users.status });

  // Blocking or a role change ends existing sessions immediately.
  if (input.status === 'blocked' || (input.role && input.role !== target.role)) await invalidateUserSessions(id);
  return updated!;
}
