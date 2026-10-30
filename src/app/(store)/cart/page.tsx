import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { getCurrentUser } from '@/server/auth/current-user';
import { guestCartIdFrom } from '@/server/auth/transport';
import { findCartId, getCartView } from '@/server/services/cart';
import { getSetting } from '@/server/services/settings';
import { CartPageClient } from '@/components/store/cart-page';

export const metadata: Metadata = { title: 'Your bag' };

export default async function CartPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, cookieStore, requestHeaders, sp] = await Promise.all([getCurrentUser(), cookies(), headers(), searchParams]);
  const cartId = await findCartId({ userId: user?.id ?? null, guestCartId: guestCartIdFrom(cookieStore, requestHeaders) });
  const [cart, checkout] = await Promise.all([getCartView(cartId), getSetting('checkout')]);
  // The client keeps its own copy of the lines, so remount it whenever the server-side bag differs
  // (e.g. the refresh that restores the bag under the preview header fallback after a full page load).
  const cartKey = `${cart.id ?? 'none'}:${cart.lines.map((line) => `${line.id}x${line.quantity}`).join(',')}`;
  return <CartPageClient key={cartKey} initialCart={cart} freeShippingThreshold={checkout.freeShippingThreshold} paymentNotice={sp.payment === 'unknown'} />;
}
