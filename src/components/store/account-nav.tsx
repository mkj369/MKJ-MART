'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/account', label: 'Profile' },
  { href: '/account/orders', label: 'Orders' },
  { href: '/account/addresses', label: 'Addresses' },
  { href: '/account/wishlist', label: 'Wishlist' },
  { href: '/account/security', label: 'Password & security' },
];

export function AccountNav({ isStaff }: { isStaff: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    await api('/api/v1/auth/logout', { method: 'POST' });
    router.replace('/');
    router.refresh();
  };

  return (
    <nav aria-label="Account" className="flex gap-1 overflow-x-auto scrollbar-none border-b border-line pb-3 lg:flex-col lg:border-b-0 lg:border-r lg:pb-0 lg:pr-6">
      {LINKS.map((link) => {
        const active = link.href === '/account' ? pathname === '/account' : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap px-3 py-2 text-[14px] transition-colors lg:border-l-2 lg:px-4',
              active ? 'text-ink lg:border-gold' : 'text-muted hover:text-ink lg:border-transparent',
            )}
          >
            {link.label}
          </Link>
        );
      })}
      {isStaff ? (
        <Link href="/admin" className="whitespace-nowrap px-3 py-2 text-[14px] text-gold-deep lg:border-l-2 lg:border-transparent lg:px-4">
          Admin panel →
        </Link>
      ) : null}
      <button
        type="button"
        onClick={signOut}
        disabled={signingOut}
        className="whitespace-nowrap px-3 py-2 text-left text-[14px] text-muted transition-colors hover:text-danger lg:mt-4 lg:border-l-2 lg:border-transparent lg:px-4"
      >
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </nav>
  );
}
