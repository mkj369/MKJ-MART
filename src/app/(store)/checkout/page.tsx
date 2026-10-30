import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ShoppingBag } from 'lucide-react';
import { buttonClasses } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { CheckoutForm } from '@/components/store/checkout-form';
import { getCurrentUser } from '@/server/auth/current-user';
import { guestCartIdFrom } from '@/server/auth/transport';
import { listAddresses } from '@/server/services/account';
import { findCartId } from '@/server/services/cart';
import { getCheckoutQuote } from '@/server/services/checkout';
import { getSetting } from '@/server/services/settings';

export const metadata: Metadata = { title: 'Checkout' };

export default async function CheckoutPage() {
  const [user, cookieStore, requestHeaders, settings] = await Promise.all([getCurrentUser(), cookies(), headers(), getSetting('checkout')]);
  if (!user && !settings.guestCheckoutEnabled) redirect('/login?next=/checkout');

  const cartId = await findCartId({ userId: user?.id ?? null, guestCartId: guestCartIdFrom(cookieStore, requestHeaders) });
  const addresses = user ? await listAddresses(user.id) : [];
  const defaultAddress = addresses.find((a) => a.isDefault) ?? addresses[0];
  const quote = await getCheckoutQuote(cartId, { district: defaultAddress?.district, couponCode: undefined }, { userId: user?.id ?? null });

  if (quote.lines.length === 0) {
    return (
      <div className="container-x pt-12">
        <EmptyState
          className="border border-line"
          icon={<ShoppingBag className="h-6 w-6" strokeWidth={1.25} />}
          title="Your bag is empty"
          description="Add something you love, then come back to check out."
          action={
            <Link href="/shop" className={buttonClasses({ variant: 'primary' })}>
              Continue shopping
            </Link>
          }
        />
      </div>
    );
  }
  if (quote.hasIssues) redirect('/cart');

  return (
    <div className="container-x pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <h1 className="font-display text-[44px] font-light leading-none md:text-[54px]">Checkout</h1>
        {!user ? (
          <p className="text-[13.5px] text-muted">
            Have an account?{' '}
            <Link href="/login?next=/checkout" className="text-ink underline underline-offset-4">
              Sign in
            </Link>{' '}
            for faster checkout — or continue as a guest.
          </p>
        ) : null}
      </div>
      <CheckoutForm
        initialQuote={quote}
        user={user ? { name: user.name, email: user.email, phone: user.phone } : null}
        addresses={addresses.map((a) => ({
          id: a.id,
          label: a.label,
          recipientName: a.recipientName,
          phone: a.phone,
          addressLine: a.addressLine,
          area: a.area,
          district: a.district,
          division: a.division,
          postalCode: a.postalCode,
          isDefault: a.isDefault,
        }))}
      />
    </div>
  );
}
