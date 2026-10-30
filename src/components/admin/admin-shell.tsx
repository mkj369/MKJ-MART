'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  BadgePercent,
  Boxes,
  ExternalLink,
  FolderTree,
  LayoutDashboard,
  Layers,
  LifeBuoy,
  LogOut,
  Menu,
  Palette,
  RotateCcw,
  Settings,
  ShoppingBag,
  Shirt,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { Logo } from '@/components/brand/logo';
import { api } from '@/lib/api-client';
import { can, ROLE_LABEL, type Permission, type Role } from '@/lib/permissions';
import { cn } from '@/lib/utils';

const NAV: { href: string; label: string; icon: typeof LayoutDashboard; permission: Permission; group: string }[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard:view', group: 'Overview' },
  { href: '/admin/orders', label: 'Orders', icon: ShoppingBag, permission: 'orders:manage', group: 'Sales' },
  { href: '/admin/returns', label: 'Returns', icon: RotateCcw, permission: 'returns:manage', group: 'Sales' },
  { href: '/admin/support', label: 'Support inbox', icon: LifeBuoy, permission: 'support:manage', group: 'Sales' },
  { href: '/admin/customers', label: 'Customers', icon: Users, permission: 'customers:view', group: 'Sales' },
  { href: '/admin/coupons', label: 'Coupons', icon: BadgePercent, permission: 'coupons:manage', group: 'Sales' },
  { href: '/admin/products', label: 'Products', icon: Shirt, permission: 'catalog:manage', group: 'Catalogue' },
  { href: '/admin/inventory', label: 'Inventory', icon: Boxes, permission: 'inventory:manage', group: 'Catalogue' },
  { href: '/admin/categories', label: 'Categories', icon: FolderTree, permission: 'catalog:manage', group: 'Catalogue' },
  { href: '/admin/collections', label: 'Collections', icon: Layers, permission: 'catalog:manage', group: 'Catalogue' },
  { href: '/admin/attributes', label: 'Sizes & colours', icon: Palette, permission: 'catalog:manage', group: 'Catalogue' },
  { href: '/admin/shipping', label: 'Delivery zones', icon: Truck, permission: 'shipping:manage', group: 'Store' },
  { href: '/admin/settings', label: 'Settings', icon: Settings, permission: 'settings:manage', group: 'Store' },
];

export function AdminShell({
  user,
  badges,
  children,
}: {
  user: { name: string; email: string; role: Role };
  /** Count bubbles keyed by nav href (pending orders, open returns, open support requests). */
  badges: Record<string, number>;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    // Close the mobile drawer when the route changes (state adjustment during render, no effect needed).
    setLastPath(pathname);
    setOpen(false);
  }

  const items = NAV.filter((n) => can(user.role, n.permission));
  const groups = [...new Set(items.map((i) => i.group))];

  const signOut = async () => {
    await api('/api/v1/auth/logout', { method: 'POST' });
    router.replace('/admin/login');
    router.refresh();
  };

  const sidebar = (
    <div className="flex h-full flex-col bg-ink text-paper">
      <div className="flex items-center justify-between px-6 py-6">
        <Link href="/admin" className="flex items-center gap-3">
          <Logo inverted compact className="[&>span]:text-[22px]" />
          <span className="border-l border-paper/20 pl-3 text-[10px] uppercase tracking-[0.3em] text-gold-light">Admin</span>
        </Link>
        <button type="button" className="p-1 text-paper/60 lg:hidden" onClick={() => setOpen(false)} aria-label="Close menu">
          <X className="h-5 w-5" />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-6" aria-label="Admin">
        {groups.map((group) => (
          <div key={group} className="mt-5 first:mt-1">
            <p className="px-3 pb-2 text-[10px] uppercase tracking-[0.22em] text-paper/35">{group}</p>
            <ul className="space-y-0.5">
              {items
                .filter((i) => i.group === group)
                .map(({ href, label, icon: Icon }) => {
                  const active = href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-3 border-l-2 px-3 py-2 text-[13.5px] transition-colors',
                          active ? 'border-gold bg-paper/[0.07] text-paper' : 'border-transparent text-paper/65 hover:bg-paper/[0.04] hover:text-paper',
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                        <span className="flex-1">{label}</span>
                        {(badges[href] ?? 0) > 0 ? (
                          <span className="rounded-full bg-gold px-1.5 py-0.5 text-[10px] font-medium leading-none text-ink">{badges[href]}</span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-paper/10 px-6 py-5">
        <p className="truncate text-[13px] text-paper">{user.name}</p>
        <p className="truncate text-[11.5px] text-paper/45">
          {ROLE_LABEL[user.role]} · {user.email}
        </p>
        <div className="mt-4 flex items-center gap-4 text-[12px] text-paper/60">
          <Link href="/" target="_blank" className="inline-flex items-center gap-1.5 hover:text-paper">
            <ExternalLink className="h-3.5 w-3.5" /> View store
          </Link>
          <button type="button" onClick={signOut} className="inline-flex items-center gap-1.5 hover:text-paper">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-[#faf9f6] lg:grid lg:grid-cols-[256px_1fr]">
      <aside className="sticky top-0 hidden h-dvh lg:block">{sidebar}</aside>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 animate-[sheet-in-left_0.4s_var(--ease-luxe)]">{sidebar}</div>
        </div>
      ) : null}
      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-paper/95 px-4 backdrop-blur lg:hidden">
          <button type="button" onClick={() => setOpen(true)} className="p-2" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-display text-lg tracking-[0.3em]">MKJ</span>
          <span className="w-9" />
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-8 md:px-8 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
