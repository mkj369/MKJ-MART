'use client';

import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';
import { buttonClasses } from '@/components/ui/button';
import { Alert, EmptyState } from '@/components/ui/feedback';
import type { CartView } from '@/server/services/cart';
import { formatBDT } from '@/lib/money';
import { CartLines, FreeShippingMeter } from './cart-lines';
import { useCart } from './use-cart';

export function CartPageClient({
  initialCart,
  freeShippingThreshold,
  paymentNotice,
}: {
  initialCart: CartView;
  freeShippingThreshold: number | null;
  paymentNotice: boolean;
}) {
  const { cart, busyId, updateQuantity, remove } = useCart({ enabled: false, initial: initialCart });
  const view = cart ?? initialCart;

  return (
    <div className="container-x pt-12">
      <h1 className="font-display text-[46px] font-light leading-none md:text-[58px]">Your bag</h1>
      {paymentNotice ? (
        <Alert tone="warning" className="mt-6" title="We could not match that payment to an order">
          If money was deducted, contact customer care with your transaction ID — it will be refunded or applied to your order.
        </Alert>
      ) : null}
      {view.lines.length === 0 ? (
        <EmptyState
          className="mt-8 border border-line"
          icon={<ShoppingBag className="h-6 w-6" strokeWidth={1.25} />}
          title="Your bag is empty"
          description="Discover panjabis, shirting and leather goods made to last."
          action={
            <Link href="/shop" className={buttonClasses({ variant: 'primary' })}>
              Shop the collection
            </Link>
          }
        />
      ) : (
        <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_380px]">
          <div className="border-t border-line">
            {view.hasIssues ? (
              <Alert tone="warning" className="mt-5" title="Some items need your attention">
                Availability changed since you added them. Update or remove the highlighted items to continue.
              </Alert>
            ) : null}
            <CartLines lines={view.lines} busyId={busyId} onQuantity={updateQuantity} onRemove={remove} />
          </div>
          <aside className="h-fit border border-line bg-bone p-7 lg:sticky lg:top-28">
            <h2 className="eyebrow">Order summary</h2>
            <dl className="mt-6 space-y-3 text-[14px]">
              <div className="flex justify-between">
                <dt className="text-muted">Subtotal ({view.itemCount} items)</dt>
                <dd className="tabular-nums">{formatBDT(view.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Delivery</dt>
                <dd className="text-muted">Calculated at checkout</dd>
              </div>
            </dl>
            <div className="my-6 h-px bg-line" />
            <div className="flex items-baseline justify-between">
              <span className="eyebrow">Estimated total</span>
              <span className="text-xl font-medium tabular-nums">{formatBDT(view.subtotal)}</span>
            </div>
            <div className="mt-6">
              <FreeShippingMeter subtotal={view.subtotal} threshold={freeShippingThreshold} />
            </div>
            {view.hasIssues ? (
              <span className={buttonClasses({ variant: 'primary', size: 'lg', className: 'mt-7 w-full opacity-45' })} aria-disabled="true">
                Checkout
              </span>
            ) : (
              <Link href="/checkout" className={buttonClasses({ variant: 'primary', size: 'lg', className: 'mt-7 w-full' })} data-testid="checkout-link">
                Checkout
              </Link>
            )}
            <p className="mt-4 text-center text-[12px] text-muted">Cash on Delivery available · Prices include VAT</p>
          </aside>
        </div>
      )}
    </div>
  );
}
