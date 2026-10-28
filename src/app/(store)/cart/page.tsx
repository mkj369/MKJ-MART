import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getCurrentUser } from '@/server/auth/current-user';
import { GUEST_CART_COOKIE } from '@/server/auth/session';
import { findCartId, getCartView } from '@/server/services/cart';
import { getSetting } from '@/server/services/settings';
import { CartPageClient } from '@/components/store/cart-page';

export const metadata: Metadata = { title: 'Your bag' };

export default async function CartPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, cookieStore, sp] = await Promise.all([getCurrentUser(), cookies(), searchParams]);
  const cartId = await findCartId({ userId: user?.id ?? null, guestCartId: cookieStore.get(GUEST_CART_COOKIE)?.value ?? null });
  const [cart, checkout] = await Promise.all([getCartView(cartId), getSetting('checkout')]);
  return <CartPageClient initialCart={cart} freeShippingThreshold={checkout.freeShippingThreshold} paymentNotice={sp.payment === 'unknown'} />;
}
