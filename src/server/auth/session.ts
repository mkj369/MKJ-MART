import 'server-only';
import { and, eq, gt, lt, ne } from 'drizzle-orm';
import { db } from '@/server/db';
import { sessions, users } from '@/server/db/schema';
import { cookieSecure } from '@/server/env';
import type { Role } from '@/lib/permissions';
import { generateToken, sha256Hex } from './tokens';

export const SESSION_COOKIE = 'mkj_session';
export const GUEST_CART_COOKIE = 'mkj_cart';

const DAY = 24 * 60 * 60 * 1000;
/** Customers stay signed in for 30 days (sliding). Staff/admin sessions are short-lived (12 h). */
const SESSION_TTL: Record<Role, number> = { customer: 30 * DAY, staff: 12 * 60 * 60 * 1000, admin: 12 * 60 * 60 * 1000 };

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: Role;
};

export type ValidatedSession = {
  sessionId: string;
  expiresAt: Date;
  user: SessionUser;
  /** True when the expiry was extended and the cookie should be re-issued. */
  refreshed: boolean;
};

export async function createSession(
  user: { id: string; role: Role },
  meta: { userAgent?: string | null; ipAddress?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL[user.role]);
  await db.insert(sessions).values({
    id: sha256Hex(token),
    userId: user.id,
    expiresAt,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
    ipAddress: meta.ipAddress?.slice(0, 64) ?? null,
  });
  // Opportunistic cleanup of expired sessions (cheap, indexed).
  if (Math.random() < 0.05) {
    await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  }
  return { token, expiresAt };
}

/**
 * Validates a session token from the cookie. Rejects expired sessions and blocked users.
 * With `slide: true`, sessions past half their lifetime are extended (only from route handlers,
 * which can re-issue the cookie).
 */
export async function validateSessionToken(
  token: string | undefined | null,
  options: { slide?: boolean } = {},
): Promise<ValidatedSession | null> {
  if (!token || token.length < 20 || token.length > 128) return null;
  const sessionId = sha256Hex(token);
  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      id: users.id,
      email: users.email,
      name: users.name,
      phone: users.phone,
      role: users.role,
      status: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!row) return null;
  if (row.status !== 'active') {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }

  let expiresAt = row.expiresAt;
  let refreshed = false;
  const ttl = SESSION_TTL[row.role];
  if (options.slide && expiresAt.getTime() - Date.now() < ttl / 2) {
    expiresAt = new Date(Date.now() + ttl);
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, sessionId));
    refreshed = true;
  }

  return {
    sessionId,
    expiresAt,
    refreshed,
    user: { id: row.id, email: row.email, name: row.name, phone: row.phone, role: row.role },
  };
}

export async function invalidateSession(token: string | undefined | null): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.id, sha256Hex(token)));
}

/** Signs a user out everywhere (e.g. after a password change or when blocked), optionally keeping one session. */
export async function invalidateUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await db
    .delete(sessions)
    .where(exceptSessionId ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId)) : eq(sessions.userId, userId));
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  };
}

export function guestCartCookieOptions() {
  return {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 24 * 60 * 60, // 60 days
  };
}
