import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { can, isStaffRole, type Permission } from '@/lib/permissions';
import { SESSION_COOKIE, validateSessionToken, type SessionUser } from './session';

/**
 * Session lookup for Server Components / pages, de-duplicated per request with React `cache`.
 * (Route handlers use `src/server/http/api.ts`, which reads cookies from the Request instead.)
 */
export const getCurrentSession = cache(async () => {
  const store = await cookies();
  return validateSessionToken(store.get(SESSION_COOKIE)?.value);
});

export async function getCurrentUser(): Promise<SessionUser | null> {
  return (await getCurrentSession())?.user ?? null;
}

/** For customer account pages: redirects anonymous visitors to the login page. */
export async function requireCustomerPage(nextPath: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  return user;
}

/**
 * For admin pages. This is the authoritative check (the proxy only does a cheap cookie-presence
 * redirect). Customers are never shown admin UI; staff without a permission are bounced to the dashboard.
 */
export async function requireAdminPage(permission: Permission, nextPath = '/admin'): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/admin/login?next=${encodeURIComponent(nextPath)}`);
  if (!isStaffRole(user.role)) redirect('/admin/login?denied=1');
  if (!can(user.role, permission)) redirect('/admin?denied=1');
  return user;
}
