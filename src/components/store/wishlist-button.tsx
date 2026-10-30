'use client';

import { Heart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStore } from './store-provider';

export function WishlistButton({
  productId,
  productName,
  className,
  variant = 'overlay',
}: {
  productId: string;
  productName: string;
  className?: string;
  variant?: 'overlay' | 'outline';
}) {
  const { isWishlisted, toggleWishlist } = useStore();
  const saved = isWishlisted(productId);
  return (
    <button
      type="button"
      onClick={() => void toggleWishlist(productId, productName)}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${productName} from wishlist` : `Save ${productName} to wishlist`}
      className={cn(
        'flex items-center justify-center transition-all duration-300',
        variant === 'overlay'
          ? 'h-9 w-9 rounded-full bg-paper/0 text-ink hover:bg-paper/90 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100'
          : 'h-13 w-13 border border-line-strong hover:border-ink',
        saved && 'md:opacity-100',
        className,
      )}
    >
      <Heart className={cn('h-[18px] w-[18px] transition-colors', saved ? 'fill-ink text-ink' : '')} strokeWidth={1.4} />
    </button>
  );
}
