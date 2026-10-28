'use client';

import Link from 'next/link';
import { Heart } from 'lucide-react';
import { buttonClasses } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import type { ProductCard as ProductCardData } from '@/server/services/catalog';
import { ProductCard } from './product-card';
import { useStore } from './store-provider';

/** Filters by live wishlist state so removed items disappear immediately. */
export function WishlistGrid({ products }: { products: ProductCardData[] }) {
  const { wishlistIds } = useStore();
  const visible = products.filter((p) => wishlistIds.includes(p.id));
  if (!visible.length) {
    return (
      <EmptyState
        className="border border-line"
        icon={<Heart className="h-6 w-6" strokeWidth={1.25} />}
        title="Your wishlist is empty"
        description="Tap the heart on any piece to save it for later."
        action={
          <Link href="/shop" className={buttonClasses({ variant: 'primary' })}>
            Discover pieces
          </Link>
        }
      />
    );
  }
  return (
    <div>
      <h2 className="eyebrow border-b border-line pb-3">Saved pieces ({visible.length})</h2>
      <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 md:gap-x-6" data-testid="wishlist-grid">
        {visible.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </div>
  );
}
