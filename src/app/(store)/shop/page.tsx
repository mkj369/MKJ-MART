import type { Metadata } from 'next';
import { Breadcrumbs } from '@/components/ui/misc';
import { CatalogListing } from '@/components/store/catalog-listing';
import { getCatalogFacets, getCategoryTree, listProducts, type CategoryNode } from '@/server/services/catalog';
import { parseProductQuery } from '@/lib/validation/store';

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function findCategory(tree: CategoryNode[], slug: string | undefined) {
  if (!slug) return { category: null, parent: null };
  for (const root of tree) {
    if (root.slug === slug) return { category: root, parent: null };
    const child = root.children.find((c) => c.slug === slug);
    if (child) return { category: child, parent: root };
  }
  return { category: null, parent: null };
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const query = parseProductQuery(await searchParams);
  if (query.q) return { title: `Search: ${query.q}` };
  if (query.category) {
    const { category } = findCategory(await getCategoryTree(), query.category);
    if (category) return { title: category.name, description: category.description ?? undefined };
  }
  return { title: 'Shop all' };
}

export default async function ShopPage({ searchParams }: Props) {
  const sp = await searchParams;
  const query = parseProductQuery(sp);
  const [result, facets, tree] = await Promise.all([listProducts(query), getCatalogFacets(), getCategoryTree()]);
  const { category, parent } = findCategory(tree, query.category);

  const title = query.q ? `“${query.q}”` : (category?.name ?? 'All products');
  const crumbs = [{ label: 'Home', href: '/' }, { label: 'Shop', href: '/shop' }];
  if (parent) crumbs.push({ label: parent.name, href: `/shop?category=${parent.slug}` });
  if (category) crumbs.push({ label: category.name, href: `/shop?category=${category.slug}` });

  return (
    <>
      <header className="border-b border-line bg-bone">
        <div className="container-x py-12 lg:py-16">
          <Breadcrumbs items={crumbs.map((c, i) => (i === crumbs.length - 1 ? { label: c.label } : c))} />
          <p className="eyebrow mt-8 text-gold-deep">{query.q ? 'Search results' : category ? 'Category' : 'The collection'}</p>
          <h1 className="mt-3 font-display text-[46px] font-light leading-none md:text-[64px]">{title}</h1>
          {category?.description && !query.q ? <p className="mt-4 max-w-xl text-[15px] text-muted">{category.description}</p> : null}
        </div>
      </header>
      <CatalogListing result={result} facets={facets} categories={tree} basePath="/shop" searchParams={sp} />
    </>
  );
}
