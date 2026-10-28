import 'server-only';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { addresses, users } from '@/server/db/schema';
import { AppError, notFound, validationError } from '@/server/errors';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { invalidateUserSessions } from '@/server/auth/session';
import { enforceRateLimit } from '@/server/rate-limit';
import type { AddressInput, ChangePasswordInput, ProfileInput } from '@/lib/validation/store';

export async function getProfile(userId: string) {
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, phone: users.phone, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw notFound('Account not found.');
  return user;
}

export async function updateProfile(userId: string, input: ProfileInput) {
  const [user] = await db
    .update(users)
    .set({ name: input.name, phone: input.phone ?? null })
    .where(eq(users.id, userId))
    .returning({ id: users.id, name: users.name, email: users.email, phone: users.phone, role: users.role });
  if (!user) throw notFound('Account not found.');
  return user;
}

/** Verifies the current password, stores the new hash and signs out every OTHER session. */
export async function changePassword(userId: string, currentSessionId: string, input: ChangePasswordInput) {
  await enforceRateLimit(`password-change:${userId}`, 10, 15 * 60);
  const [user] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw notFound('Account not found.');
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw validationError({ currentPassword: 'Your current password is incorrect.' });
  }
  await db.update(users).set({ passwordHash: await hashPassword(input.newPassword) }).where(eq(users.id, userId));
  await invalidateUserSessions(userId, currentSessionId);
}

// ─── Address book ─────────────────────────────────────────────────────────────

const MAX_ADDRESSES = 10;

export async function listAddresses(userId: string) {
  return db
    .select()
    .from(addresses)
    .where(eq(addresses.userId, userId))
    .orderBy(desc(addresses.isDefault), asc(addresses.createdAt));
}

export async function createAddress(userId: string, input: AddressInput) {
  return db.transaction(async (tx) => {
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(addresses)
      .where(eq(addresses.userId, userId));
    if (count >= MAX_ADDRESSES) {
      throw new AppError(400, 'ADDRESS_LIMIT', `You can save up to ${MAX_ADDRESSES} addresses.`);
    }
    const makeDefault = input.isDefault || count === 0;
    if (makeDefault) await tx.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, userId));
    const [address] = await tx
      .insert(addresses)
      .values({ ...input, postalCode: input.postalCode ?? null, userId, isDefault: makeDefault })
      .returning();
    return address!;
  });
}

export async function updateAddress(userId: string, addressId: string, input: AddressInput) {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(addresses)
      .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
      .limit(1);
    if (!existing) throw notFound('Address not found.');
    if (input.isDefault) {
      await tx.update(addresses).set({ isDefault: false }).where(and(eq(addresses.userId, userId), ne(addresses.id, addressId)));
    }
    const [address] = await tx
      .update(addresses)
      .set({ ...input, postalCode: input.postalCode ?? null, isDefault: input.isDefault || existing.isDefault })
      .where(eq(addresses.id, addressId))
      .returning();
    return address!;
  });
}

export async function deleteAddress(userId: string, addressId: string) {
  await db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(addresses)
      .where(and(eq(addresses.id, addressId), eq(addresses.userId, userId)))
      .returning();
    if (!deleted) throw notFound('Address not found.');
    if (deleted.isDefault) {
      const [next] = await tx
        .select({ id: addresses.id })
        .from(addresses)
        .where(eq(addresses.userId, userId))
        .orderBy(asc(addresses.createdAt))
        .limit(1);
      if (next) await tx.update(addresses).set({ isDefault: true }).where(eq(addresses.id, next.id));
    }
  });
}
