import Link from 'next/link';
import { Search } from 'lucide-react';
import { EmptyState } from '@/components/ui/feedback';
import { buttonClasses } from '@/components/ui/button';
import { Pagination } from '@/components/ui/misc';
import type { ProductListResult } from '@/server/services/catalog';
import { ActiveFilters, FilterPanel, MobileFilters, SortSelect, type FilterCategory, type FilterFacets } from './catalog-filters';
import { ProductGrid } from './product-card';

/** Shared listing body for /shop and /collections/[slug]. */
export function CatalogListing({
  result,
  facets,
  categories,
  basePath,
  searchParams,
  showCategories = true,
}: {
  result: ProductListResult;
  facets: FilterFacets;
  categories: FilterCategory[];
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
  showCategories?: boolean;
}) {
  const hrefFor = (page: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (key === 'page' || value === undefined) continue;
      (Array.isArray(value) ? value : [value]).forEach((v) => params.append(key, v));
    }
    if (page > 1) params.set('page', String(page));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className="container-x mt-10 lg:grid lg:grid-cols-[230px_1fr] lg:gap-14">
      <aside className="hidden lg:block" aria-label="Filters">
        <div className="sticky top-28">
          <FilterPanel facets={facets} categories={categories} showCategories={showCategories} />
        </div>
      </aside>
      <div>
        <div className="flex items-center justify-between gap-4 border-b border-line pb-4">
          <div className="flex items-center gap-4">
            <MobileFilters facets={facets} categories={categories} showCategories={showCategories} total={result.total} />
            <p className="text-[13px] text-muted" aria-live="polite">
              {result.total} {result.total === 1 ? 'piece' : 'pieces'}
            </p>
          </div>
          <SortSelect />
        </div>
        <div className="mt-4">
          <ActiveFilters />
        </div>
        {result.items.length ? (
          <ProductGrid products={result.items} className="mt-8 xl:grid-cols-3 2xl:grid-cols-4" priorityCount={3} />
        ) : (
          <EmptyState
            icon={<Search className="h-6 w-6" strokeWidth={1.25} />}
            title="Nothing matches — yet"
            description="Try removing a filter or searching for something broader."
            action={
              <Link href={basePath} className={buttonClasses({ variant: 'secondary' })}>
                Clear filters
              </Link>
            }
          />
        )}
        <Pagination className="mt-16" page={result.page} totalPages={result.totalPages} hrefFor={hrefFor} />
      </div>
    </div>
  );
}
