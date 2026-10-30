'use client';

import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';
import { Sheet } from '@/components/ui/dialog';
import { buttonClasses } from '@/components/ui/button';
import { EmptyState, Skeleton } from '@/components/ui/feedback';
import { formatBDT } from '@/lib/money';
import { CartLines, FreeShippingMeter } from './cart-lines';
import { useStore } from './store-provider';
import { useCart } from './use-cart';

export function CartDrawer() {
  const { cartOpen, closeCart, freeShippingThreshold } = useStore();
  const { cart, loading, busyId, updateQuantity, remove } = useCart({ enabled: cartOpen });
  const lines = cart?.lines ?? [];

  return (
    <Sheet
      open={cartOpen}
      onOpenChange={(open) => (open ? undefined : closeCart())}
      title={`Your bag${cart && cart.itemCount ? ` (${cart.itemCount})` : ''}`}
      footer={
        lines.length > 0 ? (
          <div className="space-y-4">
            <FreeShippingMeter subtotal={cart?.subtotal ?? 0} threshold={freeShippingThreshold} />
            <div className="flex items-baseline justify-between">
              <span className="eyebrow text-muted">Subtotal</span>
              <span className="text-lg font-medium tabular-nums">{formatBDT(cart?.subtotal ?? 0)}</span>
            </div>
            <p className="text-[12.5px] text-muted">Delivery charges and coupons are calculated at checkout.</p>
            <div className="grid gap-2">
              {cart?.hasIssues ? (
                <Link href="/cart" onClick={closeCart} className={buttonClasses({ variant: 'primary', size: 'lg', className: 'w-full' })}>
                  Review bag
                </Link>
              ) : (
                <Link href="/checkout" onClick={closeCart} className={buttonClasses({ variant: 'primary', size: 'lg', className: 'w-full' })}>
                  Checkout
                </Link>
              )}
              <Link href="/cart" onClick={closeCart} className={buttonClasses({ variant: 'outline', size: 'md', className: 'w-full' })}>
                View bag
              </Link>
            </div>
          </div>
        ) : null
      }
    >
      {loading && !cart ? (
        <div className="space-y-5 p-6">
          {[0, 1].map((i) => (
            <div key={i} className="flex gap-4">
              <Skeleton className="h-[104px] w-[78px]" />
              <div className="flex-1 space-y-2 pt-1">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : lines.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag className="h-6 w-6" strokeWidth={1.25} />}
          title="Your bag is empty"
          description="Pieces you add will appear here."
          action={
            <Link href="/shop" onClick={closeCart} className={buttonClasses({ variant: 'secondary' })}>
              Continue shopping
            </Link>
          }
        />
      ) : (
        <CartLines lines={lines} busyId={busyId} onQuantity={updateQuantity} onRemove={remove} compact />
      )}
    </Sheet>
  );
}
