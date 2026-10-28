import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { users } from '@/server/db/schema';
import { AppError, isUniqueViolation, validationError } from '@/server/errors';
import { getDummyHash, hashPassword, needsRehash, verifyPassword } from '@/server/auth/password';
import { createSession, type SessionUser } from '@/server/auth/session';
import { enforceRateLimit, hitRateLimit, resetRateLimit } from '@/server/rate-limit';
import { isStaffRole } from '@/lib/permissions';
import type { LoginInput, RegisterInput } from '@/lib/validation/store';
import { recordEvent } from './events';

export type RequestMeta = { ipAddress: string | null; userAgent: string | null };
export type AuthResult = { user: SessionUser; token: string; expiresAt: Date };

function toSessionUser(row: typeof users.$inferSelect): SessionUser {
  return { id: row.id, email: row.email, name: row.name, phone: row.phone, role: row.role };
}

export async function registerCustomer(input: RegisterInput, meta: RequestMeta): Promise<AuthResult> {
  await enforceRateLimit(`register:ip:${meta.ipAddress ?? 'unknown'}`, 10, 60 * 60);

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
  if (existing) throw validationError({ email: 'An account with this email already exists. Try signing in.' });

  const passwordHash = await hashPassword(input.password);
  let user: typeof users.$inferSelect;
  try {
    user = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({ email: input.email, name: input.name, phone: input.phone ?? null, passwordHash, role: 'customer' })
        .returning();
      await recordEvent(tx, 'customer.registered', created!.id, { email: created!.email, name: created!.name });
      return created!;
    });
  } catch (error) {
    if (isUniqueViolation(error, 'users_email_key')) {
      throw validationError({ email: 'An account with this email already exists. Try signing in.' });
    }
    throw error;
  }
  const session = await createSession(user, meta);
  return { user: toSessionUser(user), ...session };
}

const INVALID_CREDENTIALS = () => new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');

/**
 * Email + password sign-in with brute-force protection (per IP and per account), constant-time
 * behaviour for unknown emails, and blocked-account enforcement. `scope: 'admin'` additionally
 * requires a staff role.
 */
export async function login(input: LoginInput, meta: RequestMeta, scope: 'store' | 'admin' = 'store'): Promise<AuthResult> {
  await enforceRateLimit(`login:ip:${meta.ipAddress ?? 'unknown'}`, 30, 15 * 60);
  const accountKey = `login:account:${input.email}`;
  const accountAttempts = await hitRateLimit(accountKey, 8, 15 * 60);
  if (!accountAttempts.ok) {
    throw new AppError(429, 'RATE_LIMITED', 'Too many sign-in attempts for this account. Please try again in 15 minutes.');
  }

  const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  const valid = user
    ? await verifyPassword(input.password, user.passwordHash)
    : (await verifyPassword(input.password, await getDummyHash()), false);
  if (!user || !valid) throw INVALID_CREDENTIALS();

  if (user.status !== 'active') {
    throw new AppError(403, 'ACCOUNT_BLOCKED', 'This account has been suspended. Please contact customer care.');
  }
  if (scope === 'admin' && !isStaffRole(user.role)) {
    throw new AppError(403, 'NOT_STAFF', 'This account does not have access to the admin panel.');
  }

  await resetRateLimit(accountKey);
  const updates: Partial<typeof users.$inferInsert> = { lastLoginAt: new Date() };
  if (needsRehash(user.passwordHash)) updates.passwordHash = await hashPassword(input.password);
  await db.update(users).set(updates).where(eq(users.id, user.id));

  const session = await createSession(user, meta);
  return { user: toSessionUser(user), ...session };
}
