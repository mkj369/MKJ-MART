'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';
import type { Role } from '@/lib/permissions';
import { CartDrawer } from './cart-drawer';

export type StoreUser = { id: string; name: string; email: string; role: Role };

type StoreContextValue = {
  user: StoreUser | null;
  cartCount: number;
  setCartCount: (count: number) => void;
  wishlistIds: string[];
  isWishlisted: (productId: string) => boolean;
  toggleWishlist: (productId: string, productName?: string) => Promise<void>;
  cartOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
  freeShippingThreshold: number | null;
};

const StoreContext = createContext<StoreContextValue | null>(null);

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}

export function StoreProvider({
  user,
  initialCartCount,
  initialWishlistIds,
  freeShippingThreshold,
  children,
}: {
  user: StoreUser | null;
  initialCartCount: number;
  initialWishlistIds: string[];
  freeShippingThreshold: number | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [cartCount, setCartCount] = useState(initialCartCount);
  const [wishlistIds, setWishlistIds] = useState(initialWishlistIds);
  const [cartOpen, setCartOpen] = useState(false);

  // Server re-renders (router.refresh, navigation) are the source of truth: adopt new values.
  const [serverCartCount, setServerCartCount] = useState(initialCartCount);
  const [serverWishlist, setServerWishlist] = useState(initialWishlistIds);
  if (serverCartCount !== initialCartCount) {
    setServerCartCount(initialCartCount);
    setCartCount(initialCartCount);
  }
  if (serverWishlist !== initialWishlistIds) {
    setServerWishlist(initialWishlistIds);
    setWishlistIds(initialWishlistIds);
  }

  const isWishlisted = useCallback((id: string) => wishlistIds.includes(id), [wishlistIds]);

  const toggleWishlist = useCallback(
    async (productId: string, productName?: string) => {
      if (!user) {
        toast('Sign in to save pieces to your wishlist.', {
          action: { label: 'Sign in', onClick: () => router.push(`/login?next=${encodeURIComponent(pathname)}`) },
        });
        return;
      }
      const saved = wishlistIds.includes(productId);
      setWishlistIds((ids) => (saved ? ids.filter((id) => id !== productId) : [productId, ...ids]));
      const result = saved
        ? await api<{ ids: string[] }>(`/api/v1/wishlist/${productId}`, { method: 'DELETE' })
        : await api<{ ids: string[] }>('/api/v1/wishlist', { body: { productId } });
      if (!result.ok) {
        setWishlistIds((ids) => (saved ? [productId, ...ids] : ids.filter((id) => id !== productId)));
        toast.error(result.error.message);
        return;
      }
      setWishlistIds(result.data.ids);
      toast(saved ? 'Removed from your wishlist' : `${productName ?? 'Item'} saved to your wishlist`);
    },
    [user, wishlistIds, router, pathname],
  );

  const value = useMemo<StoreContextValue>(
    () => ({
      user,
      cartCount,
      setCartCount,
      wishlistIds,
      isWishlisted,
      toggleWishlist,
      cartOpen,
      openCart: () => setCartOpen(true),
      closeCart: () => setCartOpen(false),
      freeShippingThreshold,
    }),
    [user, cartCount, wishlistIds, isWishlisted, toggleWishlist, cartOpen, freeShippingThreshold],
  );

  return (
    <StoreContext.Provider value={value}>
      {children}
      <CartDrawer />
    </StoreContext.Provider>
  );
}
