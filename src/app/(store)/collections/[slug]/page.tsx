import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '@/components/ui/misc';
import { CatalogListing } from '@/components/store/catalog-listing';
import { getCatalogFacets, getCategoryTree, getCollectionBySlug, listProducts } from '@/server/services/catalog';
import { parseProductQuery } from '@/lib/validation/store';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const collection = await getCollectionBySlug((await params).slug);
  return collection ? { title: collection.name, description: collection.description ?? undefined } : { title: 'Collection not found' };
}

export default async function CollectionPage({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const collection = await getCollectionBySlug(slug);
  if (!collection) notFound();
  const query = { ...parseProductQuery(sp), collection: slug };
  const [result, facets, tree] = await Promise.all([listProducts(query), getCatalogFacets(), getCategoryTree()]);

  return (
    <>
      <header className="relative overflow-hidden bg-ink text-paper">
        {collection.imageUrl ? (
          <Image src={collection.imageUrl} alt="" fill priority sizes="100vw" className="object-cover object-center opacity-45" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-r from-ink/80 via-ink/40 to-transparent" />
        <div className="container-x relative py-20 lg:py-28">
          <Breadcrumbs
            items={[{ label: 'Home', href: '/' }, { label: 'Collections', href: '/shop' }, { label: collection.name }]}
            className="text-paper/60 [&_a:hover]:text-paper [&_[aria-current]]:text-paper"
          />
          <p className="eyebrow mt-10 text-gold-light">Collection</p>
          <h1 className="mt-3 max-w-2xl font-display text-[50px] font-light leading-[0.95] md:text-[76px]">{collection.name}</h1>
          {collection.description ? <p className="mt-5 max-w-lg text-[15.5px] text-paper/80">{collection.description}</p> : null}
        </div>
      </header>
      <CatalogListing result={result} facets={facets} categories={tree} basePath={`/collections/${slug}`} searchParams={sp} showCategories={false} />
    </>
  );
}
