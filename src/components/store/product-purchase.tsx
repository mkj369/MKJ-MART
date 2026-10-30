'use client';

import Image from 'next/image';
import { useMemo, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Price } from '@/components/ui/misc';
import { api } from '@/lib/api-client';
import type { ProductDetail } from '@/server/services/catalog';
import type { CartView } from '@/server/services/cart';
import { cn } from '@/lib/utils';
import { useStore } from './store-provider';
import { WishlistButton } from './wishlist-button';

const LOW_STOCK = 5;

export function ProductGallery({ images, name, activeColorId }: { images: ProductDetail['images']; name: string; activeColorId: string | null }) {
  const ordered = useMemo(() => {
    if (!activeColorId) return images;
    const matching = images.filter((i) => i.colorId === activeColorId);
    return matching.length ? [...matching, ...images.filter((i) => i.colorId !== activeColorId)] : images;
  }, [images, activeColorId]);
  const [index, setIndex] = useState(0);
  const current = ordered[Math.min(index, ordered.length - 1)];

  if (!current) {
    return <div className="flex aspect-[3/4] items-center justify-center bg-linen font-display text-5xl text-faint">MKJ</div>;
  }
  return (
    <div className="flex flex-col-reverse gap-3 md:flex-row">
      {ordered.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto scrollbar-none md:w-20 md:flex-col">
          {ordered.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setIndex(i)}
              className={cn('relative aspect-[3/4] w-16 shrink-0 overflow-hidden bg-linen md:w-full', i === index ? 'ring-1 ring-ink' : 'opacity-70 hover:opacity-100')}
              aria-label={`Show image ${i + 1}`}
            >
              <Image src={img.url} alt="" fill sizes="80px" className="object-cover" />
            </button>
          ))}
        </div>
      ) : null}
      <div className="relative aspect-[3/4] flex-1 overflow-hidden bg-linen">
        <Image key={current.id} src={current.url} alt={current.alt || name} fill loading="eager" fetchPriority="high" sizes="(min-width: 1024px) 50vw, 100vw" className="animate-fade-in object-cover" />
      </div>
    </div>
  );
}

export function ProductPurchase({
  product,
  deliveryNote,
  colorId,
  onColorChange,
}: {
  product: ProductDetail;
  deliveryNote: string;
  colorId: string | null;
  onColorChange: (colorId: string) => void;
}) {
  const { openCart, setCartCount } = useStore();
  const setColorId = onColorChange;
  const [sizeId, setSizeId] = useState<string | null>(product.sizes.length === 1 ? product.sizes[0]!.id : null);
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);
  const [sizeError, setSizeError] = useState(false);

  const variantFor = (s: string | null, c: string | null) =>
    product.variants.find((v) => (v.size?.id ?? null) === s && (v.color?.id ?? null) === c) ?? null;
  const needsSize = product.sizes.length > 0;
  const variant = needsSize ? (sizeId ? variantFor(sizeId, colorId) : null) : variantFor(null, colorId);
  const colorName = product.colors.find((c) => c.id === colorId)?.name;
  const maxQty = Math.min(variant?.stock ?? 0, 10);

  const add = async () => {
    if (needsSize && !sizeId) {
      setSizeError(true);
      return;
    }
    if (!variant || variant.stock <= 0) return;
    setAdding(true);
    const result = await api<CartView>('/api/v1/cart/items', { body: { variantId: variant.id, quantity } });
    setAdding(false);
    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    setCartCount(result.data.itemCount);
    openCart();
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-6">
        <h1 className="font-display text-[38px] font-light leading-[1.05] md:text-[46px]">{product.name}</h1>
      </div>
      <Price className="mt-4" size="lg" price={product.price} compareAtPrice={product.compareAtPrice} />
      <p className="mt-2 text-[12.5px] text-muted">VAT included · {deliveryNote}</p>

      {product.colors.length ? (
        <fieldset className="mt-9">
          <legend className="eyebrow mb-3">
            Colour <span className="ml-1 normal-case tracking-normal text-muted">— {colorName}</span>
          </legend>
          <div className="flex flex-wrap gap-2.5">
            {product.colors.map((c) => {
              const available = product.variants.some((v) => v.color?.id === c.id && v.stock > 0);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setColorId(c.id)}
                  aria-pressed={colorId === c.id}
                  aria-label={`${c.name}${available ? '' : ' (sold out)'}`}
                  title={c.name}
                  className={cn(
                    'relative h-9 w-9 rounded-full border border-ink/15 transition-shadow',
                    colorId === c.id && 'ring-1 ring-ink ring-offset-[3px]',
                    !available && 'opacity-40',
                  )}
                  style={{ backgroundColor: c.hex }}
                />
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {needsSize ? (
        <fieldset className="mt-8">
          <legend className="eyebrow mb-3 flex w-full items-center justify-between">
            <span>Size</span>
            {variant && variant.stock > 0 && variant.stock <= LOW_STOCK ? (
              <span className="normal-case tracking-normal text-warning">Only {variant.stock} left</span>
            ) : null}
          </legend>
          <div className="flex flex-wrap gap-2">
            {product.sizes.map((s) => {
              const v = variantFor(s.id, colorId);
              const soldOut = !v || v.stock <= 0;
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={soldOut}
                  onClick={() => {
                    setSizeId(s.id);
                    setSizeError(false);
                    setQuantity(1);
                  }}
                  aria-pressed={sizeId === s.id}
                  aria-label={`Size ${s.label}${soldOut ? ' — sold out' : ''}`}
                  className={cn(
                    'h-11 min-w-14 border px-4 text-[13px] transition-colors',
                    sizeId === s.id ? 'border-ink bg-ink text-paper' : 'border-line-strong hover:border-ink',
                    soldOut && 'cursor-not-allowed border-line text-faint line-through hover:border-line',
                  )}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          {sizeError ? (
            <p className="mt-2 text-[12.5px] text-danger" role="alert">
              Please choose a size.
            </p>
          ) : null}
        </fieldset>
      ) : null}

      <div className="mt-9 flex gap-3">
        <div className="flex h-13 items-center border border-line-strong" role="group" aria-label="Quantity">
          <button
            type="button"
            className="flex h-full w-11 items-center justify-center text-muted hover:text-ink disabled:opacity-30"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            disabled={quantity <= 1}
            aria-label="Decrease quantity"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="w-8 text-center tabular-nums" aria-live="polite">
            {quantity}
          </span>
          <button
            type="button"
            className="flex h-full w-11 items-center justify-center text-muted hover:text-ink disabled:opacity-30"
            onClick={() => setQuantity((q) => Math.min(maxQty || 1, q + 1))}
            disabled={!variant || quantity >= maxQty}
            aria-label="Increase quantity"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <Button
          size="lg"
          className="flex-1"
          onClick={add}
          loading={adding}
          disabled={product.totalStock <= 0 || (variant !== null && variant.stock <= 0)}
          data-testid="add-to-bag"
        >
          {product.totalStock <= 0 ? 'Sold out' : variant && variant.stock <= 0 ? 'Sold out in this size' : 'Add to bag'}
        </Button>
        <WishlistButton productId={product.id} productName={product.name} variant="outline" />
      </div>
    </div>
  );
}
