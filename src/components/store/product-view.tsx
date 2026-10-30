'use client';

import { useState } from 'react';
import type { ProductDetail } from '@/server/services/catalog';
import { ProductGallery, ProductPurchase } from './product-purchase';

/** Client wrapper so the gallery follows the selected colour. */
export function ProductView({ product, deliveryNote, children }: { product: ProductDetail; deliveryNote: string; children: React.ReactNode }) {
  const [colorId, setColorId] = useState<string | null>(product.colors[0]?.id ?? null);
  return (
    <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
      <ProductGallery images={product.images} name={product.name} activeColorId={colorId} />
      <div className="lg:sticky lg:top-28 lg:self-start">
        <ProductPurchase product={product} deliveryNote={deliveryNote} colorId={colorId} onColorChange={setColorId} />
        {children}
      </div>
    </div>
  );
}
