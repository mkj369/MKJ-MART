'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';
import type { CartLine, CartView } from '@/server/services/cart';
import { useStore } from './store-provider';

/** Loads the bag from the API and exposes optimistic-safe mutations shared by drawer & bag page. */
export function useCart(options: { enabled: boolean; initial?: CartView | null }) {
  const { setCartCount } = useStore();
  const [cart, setCart] = useState<CartView | null>(options.initial ?? null);
  const [loading, setLoading] = useState(!options.initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  const apply = useCallback(
    (next: CartView) => {
      setCart(next);
      setCartCount(next.itemCount);
    },
    [setCartCount],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    const result = await api<CartView>('/api/v1/cart');
    setLoading(false);
    if (result.ok) apply(result.data);
    else toast.error(result.error.message);
  }, [apply]);

  useEffect(() => {
    if (!options.enabled) return;
    let cancelled = false;
    void api<CartView>('/api/v1/cart').then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.ok) apply(result.data);
      else toast.error(result.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [options.enabled, apply]);

  const updateQuantity = useCallback(
    async (line: CartLine, quantity: number) => {
      setBusyId(line.id);
      const result = await api<CartView>(`/api/v1/cart/items/${line.id}`, { method: 'PATCH', body: { quantity } });
      setBusyId(null);
      if (result.ok) apply(result.data);
      else {
        toast.error(result.error.message);
        void reload();
      }
    },
    [apply, reload],
  );

  const remove = useCallback(
    async (line: CartLine) => {
      setBusyId(line.id);
      const result = await api<CartView>(`/api/v1/cart/items/${line.id}`, { method: 'DELETE' });
      setBusyId(null);
      if (result.ok) apply(result.data);
      else toast.error(result.error.message);
    },
    [apply],
  );

  return { cart, loading, busyId, updateQuantity, remove, reload };
}
