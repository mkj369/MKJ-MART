import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { after } from 'next/server';
import { db } from '@/server/db';
import { sessions, userTokens, users } from '@/server/db/schema';
import { AppError, isUniqueViolation, validationError } from '@/server/errors';
import { appUrl, demoLoginAllowed, passwordResetTtlMinutes } from '@/server/env';
import { getDummyHash, hashPassword, needsRehash, verifyPassword } from '@/server/auth/password';
import { createSession, type SessionUser } from '@/server/auth/session';
import { generateToken, sha256Hex } from '@/server/auth/tokens';
import { log } from '@/server/logger';
import { enqueueNotification, scheduleNotificationDispatch, sendEmailNow } from '@/server/notifications';
import { enforceRateLimit, hitRateLimit, resetRateLimit } from '@/server/rate-limit';
import { isStaffRole } from '@/lib/permissions';
import type { ForgotPasswordInput, LoginInput, RegisterInput, ResetPasswordInput } from '@/lib/validation/store';
import { recordEvent } from './events';
import { getSetting } from './settings';

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
  const notify = await getSetting('notifications');
  let user: typeof users.$inferSelect;
  try {
    user = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({ email: input.email, name: input.name, phone: input.phone ?? null, passwordHash, role: 'customer' })
        .returning();
      await recordEvent(tx, 'customer.registered', created!.id, { email: created!.email, name: created!.name });
      if (notify.emailWelcome) {
        await enqueueNotification(tx, { template: 'welcome', recipient: created!.email, data: { name: created!.name }, userId: created!.id });
      }
      return created!;
    });
  } catch (error) {
    if (isUniqueViolation(error, 'users_email_key')) {
      throw validationError({ email: 'An account with this email already exists. Try signing in.' });
    }
    throw error;
  }
  scheduleNotificationDispatch();
  const session = await createSession(user, meta);
  return { user: toSessionUser(user), ...session };
}

const INVALID_CREDENTIALS = () => new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password.');

/**
 * Email + password sign-in with brute-force protection (per IP and per account), constant-time
 * behaviour for unknown emails, and blocked-account enforcement. `scope: 'admin'` additionally
 * requires a staff role. Demo accounts cannot sign in to a production build unless DEMO_MODE=true.
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

  if (user.isDemo && !demoLoginAllowed()) {
    log.warn('auth.demo_login_blocked', { scope });
    throw new AppError(403, 'DEMO_ACCOUNT_DISABLED', 'Demo accounts are disabled on this store.');
  }
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

// ─── Password reset ───────────────────────────────────────────────────────────

/** Runs work after the HTTP response (so response time does not reveal whether an account exists). */
async function afterResponse(task: () => Promise<unknown>) {
  const run = () => task().catch((error) => log.error('auth.background_task_failed', { error }));
  try {
    after(run);
  } catch {
    await run(); // outside a request (tests, scripts)
  }
}

/**
 * Step 1: "Forgot password". Always resolves the same way whether or not the email belongs to an
 * account (no enumeration). For eligible CUSTOMER accounts a single-use token (256-bit, stored only as
 * SHA-256) is created and emailed; earlier unused tokens are revoked. Staff accounts are excluded —
 * their passwords are reset by an administrator or with `npm run admin:create`.
 */
export async function requestPasswordReset(input: ForgotPasswordInput, meta: RequestMeta): Promise<void> {
  await enforceRateLimit(`pwreset:ip:${meta.ipAddress ?? 'unknown'}`, 10, 60 * 60);
  const perEmail = await hitRateLimit(`pwreset:email:${input.email}`, 3, 60 * 60);
  if (!perEmail.ok) return; // silently drop: same response, no extra emails

  const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  if (!user || user.status !== 'active' || user.role !== 'customer' || (user.isDemo && !demoLoginAllowed())) return;

  const token = generateToken(32);
  const ttl = passwordResetTtlMinutes();
  await db.transaction(async (tx) => {
    await tx.delete(userTokens).where(and(eq(userTokens.userId, user.id), eq(userTokens.purpose, 'password_reset'), isNull(userTokens.usedAt)));
    await tx.insert(userTokens).values({
      userId: user.id,
      purpose: 'password_reset',
      tokenHash: sha256Hex(token),
      expiresAt: new Date(Date.now() + ttl * 60_000),
      requestIp: meta.ipAddress?.slice(0, 64) ?? null,
    });
  });
  const resetUrl = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  await afterResponse(() =>
    sendEmailNow({
      template: 'password_reset',
      recipient: user.email,
      data: { name: user.name, resetUrl, ttlMinutes: ttl },
      storedData: { name: user.name, ttlMinutes: ttl },
      userId: user.id,
    }),
  );
}

const INVALID_RESET = () =>
  new AppError(400, 'INVALID_RESET_TOKEN', 'This reset link is invalid or has expired. Please request a new one.');

/** Returns whether a reset token is currently usable (for the reset page; reveals nothing else). */
export async function isResetTokenValid(token: string | null | undefined): Promise<boolean> {
  if (!token || token.length < 20 || token.length > 200) return false;
  const [row] = await db
    .select({ expiresAt: userTokens.expiresAt, usedAt: userTokens.usedAt, status: users.status })
    .from(userTokens)
    .innerJoin(users, eq(users.id, userTokens.userId))
    .where(and(eq(userTokens.tokenHash, sha256Hex(token)), eq(userTokens.purpose, 'password_reset')))
    .limit(1);
  return !!row && !row.usedAt && row.expiresAt.getTime() > Date.now() && row.status === 'active';
}

/**
 * Step 2: sets the new password. The token is consumed atomically (row lock), every session of the
 * account is revoked, a "password changed" email is queued, and the customer is signed in afresh.
 */
export async function resetPassword(input: ResetPasswordInput, meta: RequestMeta): Promise<AuthResult> {
  await enforceRateLimit(`pwreset-submit:ip:${meta.ipAddress ?? 'unknown'}`, 20, 60 * 60);
  const tokenHash = sha256Hex(input.token);
  const passwordHash = await hashPassword(input.password);

  const user = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(userTokens)
      .where(and(eq(userTokens.tokenHash, tokenHash), eq(userTokens.purpose, 'password_reset')))
      .for('update');
    if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) throw INVALID_RESET();
    const [account] = await tx.select().from(users).where(eq(users.id, row.userId)).for('update');
    if (!account || account.status !== 'active' || account.role !== 'customer' || (account.isDemo && !demoLoginAllowed())) throw INVALID_RESET();

    await tx.update(userTokens).set({ usedAt: new Date() }).where(eq(userTokens.id, row.id));
    await tx.delete(userTokens).where(and(eq(userTokens.userId, account.id), eq(userTokens.purpose, 'password_reset'), isNull(userTokens.usedAt)));
    const [updated] = await tx.update(users).set({ passwordHash }).where(eq(users.id, account.id)).returning();
    await tx.delete(sessions).where(eq(sessions.userId, account.id));
    await recordEvent(tx, 'customer.password_reset', account.id, { email: account.email });
    await enqueueNotification(tx, { template: 'password_changed', recipient: account.email, data: { name: account.name }, userId: account.id });
    return updated!;
  });
  await resetRateLimit(`login:account:${user.email}`);
  scheduleNotificationDispatch();
  const session = await createSession(user, meta);
  return { user: toSessionUser(user), ...session };
}
