import Image from 'next/image';
import Link from 'next/link';
import type { ProductCard as ProductCardData } from '@/server/services/catalog';
import { Price } from '@/components/ui/misc';
import { discountPercent } from '@/lib/money';
import { cn } from '@/lib/utils';
import { WishlistButton } from './wishlist-button';

export function ProductCard({ product, priority = false, className }: { product: ProductCardData; priority?: boolean; className?: string }) {
  const sale = discountPercent(product.price, product.compareAtPrice);
  return (
    <article className={cn('group relative', className)} data-testid="product-card">
      <Link href={`/products/${product.slug}`} className="block" aria-label={product.name}>
        <div className="relative aspect-[3/4] overflow-hidden bg-linen">
          {product.image ? (
            <Image
              src={product.image.url}
              alt={product.image.alt}
              fill
              priority={priority}
              sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 48vw"
              className={cn(
                'object-cover transition-[transform,opacity] duration-[1200ms] ease-[var(--ease-luxe)] group-hover:scale-[1.035]',
                product.hoverImage && 'group-hover:opacity-0',
                !product.inStock && 'opacity-70 grayscale-[30%]',
              )}
            />
          ) : (
            <div className="flex h-full items-center justify-center font-display text-4xl text-faint">MKJ</div>
          )}
          {product.hoverImage ? (
            <Image
              src={product.hoverImage.url}
              alt=""
              fill
              sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 48vw"
              className="object-cover opacity-0 transition-opacity duration-700 group-hover:opacity-100"
            />
          ) : null}
          <div className="absolute left-3 top-3 flex flex-col items-start gap-1.5">
            {!product.inStock ? (
              <span className="bg-paper/95 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em]">Sold out</span>
            ) : sale > 0 ? (
              <span className="bg-ink px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-paper">−{sale}%</span>
            ) : product.isNew ? (
              <span className="bg-paper/95 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em]">New</span>
            ) : null}
          </div>
        </div>
      </Link>
      <WishlistButton productId={product.id} productName={product.name} className="absolute right-2 top-2" />
      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          {product.categoryName ? <p className="eyebrow mb-1.5 text-[10px] text-muted">{product.categoryName}</p> : null}
          <h3 className="text-[14.5px] leading-snug">
            <Link href={`/products/${product.slug}`} className="hover:underline hover:decoration-line-strong hover:underline-offset-4">
              {product.name}
            </Link>
          </h3>
        </div>
        {product.colors.length > 1 ? (
          <ul className="mt-1 flex shrink-0 gap-1" aria-label={`${product.colors.length} colours`}>
            {product.colors.slice(0, 4).map((c) => (
              <li key={c.name} className="h-2.5 w-2.5 rounded-full border border-ink/15" style={{ backgroundColor: c.hex }} title={c.name} />
            ))}
          </ul>
        ) : null}
      </div>
      <Price className="mt-1.5" price={product.price} compareAtPrice={product.compareAtPrice} />
    </article>
  );
}

export function ProductGrid({ products, className, priorityCount = 0 }: { products: ProductCardData[]; className?: string; priorityCount?: number }) {
  return (
    <div className={cn('grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 md:gap-x-6 xl:grid-cols-4', className)}>
      {products.map((p, i) => (
        <ProductCard key={p.id} product={p} priority={i < priorityCount} />
      ))}
    </div>
  );
}
