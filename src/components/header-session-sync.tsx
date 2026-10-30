'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isStaffRole, type Role } from '@/lib/permissions';
import { STORAGE_KEYS } from '@/lib/session-transport';
import { safeRedirectPath } from '@/lib/utils';

/**
 * Companion of the preview header-session script (src/lib/session-transport.ts). A full page load
 * (first visit, reload, typed URL) cannot carry custom headers, so the server renders it signed out
 * and with an empty bag. Once per full load: a sign-in page forwards to its destination when this
 * tab still holds a valid session; any other page re-renders with the headers attached.
 */
export function HeaderSessionSync() {
  const router = useRouter();
  const pathname = usePathname();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    let token: string | null = null;
    let cart: string | null = null;
    try {
      token = window.sessionStorage.getItem(STORAGE_KEYS.session);
      cart = window.sessionStorage.getItem(STORAGE_KEYS.cart);
    } catch {
      return;
    }
    if (!token && !cart) return;

    const signInPage = pathname === '/login' || pathname === '/admin/login';
    if (!signInPage || !token) {
      router.refresh();
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.has('denied')) return;
    void fetch('/api/v1/auth/me', { headers: { accept: 'application/json' } })
      .then((res) => res.json() as Promise<{ data?: { user?: { role: Role } | null } }>)
      .then((json) => {
        const role = json.data?.user?.role;
        if (!role) return; // expired: the response already told the script to forget the token
        if (pathname === '/admin/login') {
          if (isStaffRole(role)) router.replace(safeRedirectPath(params.get('next'), '/admin'));
        } else {
          router.replace(safeRedirectPath(params.get('next'), '/account'));
        }
      })
      .catch(() => {});
  }, [pathname, router]);

  return null;
}
