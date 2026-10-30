import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Banknote, RotateCcw, Truck } from 'lucide-react';
import { Breadcrumbs, RichText } from '@/components/ui/misc';
import { ProductGrid } from '@/components/store/product-card';
import { ProductView } from '@/components/store/product-view';
import { getProductBySlug, getRelatedProducts } from '@/server/services/catalog';
import { getSettings } from '@/server/services/settings';
import { listActiveZones } from '@/server/services/shipping';
import { appUrl } from '@/server/env';
import { formatBDT, poishaToDecimalString } from '@/lib/money';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await getProductBySlug((await params).slug);
  if (!product) return { title: 'Product not found' };
  const description = product.description.slice(0, 160);
  return {
    title: product.name,
    description,
    openGraph: { title: product.name, description, images: product.images[0] ? [{ url: product.images[0].url }] : undefined },
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  const [related, settings, zones] = await Promise.all([getRelatedProducts(product), getSettings(['checkout', 'policies']), listActiveZones()]);

  const cheapest = zones.length ? Math.min(...zones.map((z) => z.fee)) : null;
  const threshold = settings.checkout.freeShippingThreshold;
  const deliveryNote = threshold
    ? `Free delivery over ${formatBDT(threshold)}`
    : cheapest !== null
      ? `Delivery from ${formatBDT(cheapest)}`
      : 'Delivery charges at checkout';

  const crumbs = [{ label: 'Home', href: '/' }, { label: 'Shop', href: '/shop' }];
  if (product.parentCategory) crumbs.push({ label: product.parentCategory.name, href: `/shop?category=${product.parentCategory.slug}` });
  if (product.category) crumbs.push({ label: product.category.name, href: `/shop?category=${product.category.slug}` });

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    image: product.images.map((i) => `${appUrl()}${i.url}`),
    sku: product.variants[0]?.sku,
    brand: { '@type': 'Brand', name: 'MKJ Store' },
    offers: {
      '@type': 'Offer',
      priceCurrency: 'BDT',
      price: poishaToDecimalString(product.price),
      availability: product.totalStock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: `${appUrl()}/products/${product.slug}`,
    },
  };

  return (
    <div className="container-x pt-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <Breadcrumbs items={[...crumbs, { label: product.name }]} className="mb-8" />
      <ProductView product={product} deliveryNote={deliveryNote}>
        <ul className="mt-9 grid gap-3 border-y border-line py-6 text-[13px]">
          <li className="flex items-center gap-3">
            <Banknote className="h-4 w-4 text-gold-deep" strokeWidth={1.4} /> Cash on Delivery available nationwide
          </li>
          <li className="flex items-center gap-3">
            <Truck className="h-4 w-4 text-gold-deep" strokeWidth={1.4} />
            {zones.length ? zones.map((z) => `${z.name} ${formatBDT(z.fee)} (${z.estimatedDays})`).join(' · ') : 'Delivery charges calculated at checkout'}
          </li>
          <li className="flex items-center gap-3">
            <RotateCcw className="h-4 w-4 text-gold-deep" strokeWidth={1.4} /> 7-day returns on unworn pieces —{' '}
            <Link href="/policies/returns" className="underline underline-offset-4">
              details
            </Link>
          </li>
        </ul>
        <div className="divide-y divide-line border-b border-line">
          <Accordion title="Description" defaultOpen>
            <p className="text-[14.5px] leading-[1.8] text-ink/80">{product.description}</p>
            {product.tags.length ? <p className="mt-4 text-[12px] uppercase tracking-[0.14em] text-faint">{product.tags.join(' · ')}</p> : null}
          </Accordion>
          {product.material || product.careInstructions ? (
            <Accordion title="Material & care">
              {product.material ? <p className="text-[14.5px] text-ink/80">{product.material}</p> : null}
              {product.careInstructions ? <p className="mt-3 text-[14px] leading-relaxed text-muted">{product.careInstructions}</p> : null}
            </Accordion>
          ) : null}
          <Accordion title="Delivery & returns">
            <RichText text={settings.policies.shipping.split('\n\n').slice(0, 4).join('\n\n')} className="text-[14px] [&_h2]:text-[19px]" />
          </Accordion>
        </div>
      </ProductView>

      {related.length ? (
        <section className="mt-28" aria-labelledby="related-title">
          <p className="eyebrow text-gold-deep">Complete the look</p>
          <h2 id="related-title" className="mb-10 mt-3 font-display text-[38px] font-light md:text-[46px]">
            You may also like
          </h2>
          <ProductGrid products={related} />
        </section>
      ) : null}
    </div>
  );
}

function Accordion({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group py-5" open={defaultOpen}>
      <summary className="eyebrow flex cursor-pointer list-none items-center justify-between [&::-webkit-details-marker]:hidden">
        {title}
        <span className="text-lg font-light transition-transform duration-300 group-open:rotate-45">+</span>
      </summary>
      <div className="pt-4">{children}</div>
    </details>
  );
}
