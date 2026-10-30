import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/ui/feedback';
import { PageHeader, ProductStatusBadge } from '@/components/admin/ui';
import { ProductEditor } from '@/components/admin/product-editor';
import { requireAdminPage } from '@/server/auth/current-user';
import { getProductAdmin, getProductEditorOptions } from '@/server/services/admin/products';

export const metadata: Metadata = { title: 'Edit product' };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdminPage('catalog:manage', `/admin/products/${id}`);
  const [product, options] = await Promise.all([getProductAdmin(id), getProductEditorOptions()]);
  return (
    <>
      <PageHeader
        back={{ href: '/admin/products', label: 'Products' }}
        title={product.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ProductStatusBadge status={product.status} />
            {product.isDemo ? <Badge tone="gold">Demo data</Badge> : null}
            {product.status === 'active' ? (
              <Link href={`/products/${product.slug}`} target="_blank" className="underline underline-offset-4">
                View in store ↗
              </Link>
            ) : null}
          </span>
        }
      />
      <ProductEditor
        options={options}
        product={{
          id: product.id,
          name: product.name,
          slug: product.slug,
          description: product.description,
          material: product.material ?? '',
          careInstructions: product.careInstructions ?? '',
          categoryId: product.categoryId,
          price: product.price,
          compareAtPrice: product.compareAtPrice,
          status: product.status,
          isFeatured: product.isFeatured,
          tags: product.tags,
          collectionIds: product.collectionIds,
          images: product.images.map((i) => ({ id: i.id, url: i.url, alt: i.alt, colorId: i.colorId })),
          variants: product.variants.map((v) => ({ id: v.id, sku: v.sku, sizeId: v.sizeId, colorId: v.colorId, stock: v.stock, stockBaseline: v.stock, isActive: v.isActive })),
        }}
      />
    </>
  );
}
