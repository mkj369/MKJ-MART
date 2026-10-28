'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { Sheet } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/feedback';
import { PRODUCT_SORT_LABEL, PRODUCT_SORTS, type ProductSort } from '@/lib/validation/store';
import { cn } from '@/lib/utils';

export type FilterFacets = {
  sizes: string[];
  colors: { name: string; hex: string }[];
  priceRange: { min: number; max: number };
};
export type FilterCategory = { name: string; slug: string; productCount: number; children: { name: string; slug: string; productCount: number }[] };

/** URL is the single source of truth for filters; every change resets pagination. */
function useFilterNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    params.delete('page');
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  const toggleMulti = (key: string, value: string) =>
    update((p) => {
      const values = p.getAll(key);
      p.delete(key);
      const next = values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
      next.forEach((v) => p.append(key, v));
    });
  const setSingle = (key: string, value: string | null) =>
    update((p) => {
      if (value === null || value === '') p.delete(key);
      else p.set(key, value);
    });
  return { searchParams, pathname, pending, update, toggleMulti, setSingle };
}

export function SortSelect() {
  const { searchParams, setSingle, pending } = useFilterNavigation();
  const current = (searchParams.get('sort') as ProductSort) || 'featured';
  return (
    <label className="flex items-center gap-3 text-[13px]">
      {pending ? <Spinner className="h-4 w-4 text-muted" /> : null}
      <span className="eyebrow hidden text-muted sm:inline">Sort</span>
      <select
        value={PRODUCT_SORTS.includes(current) ? current : 'featured'}
        onChange={(e) => setSingle('sort', e.target.value === 'featured' ? null : e.target.value)}
        className="select-chevron h-10 border border-line-strong bg-paper pl-3 text-[13px] focus:border-ink focus:outline-none"
        aria-label="Sort products"
      >
        {PRODUCT_SORTS.map((s) => (
          <option key={s} value={s}>
            {PRODUCT_SORT_LABEL[s]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterPanel({
  facets,
  categories,
  showCategories = true,
}: {
  facets: FilterFacets;
  categories: FilterCategory[];
  showCategories?: boolean;
}) {
  const { searchParams, toggleMulti, setSingle, update } = useFilterNavigation();
  const activeSizes = searchParams.getAll('size').flatMap((s) => s.split(','));
  const activeColors = searchParams.getAll('color').flatMap((s) => s.split(',')).map((c) => c.toLowerCase());
  const activeCategory = searchParams.get('category');
  const [minPrice, setMinPrice] = useState(searchParams.get('minPrice') ?? '');
  const [maxPrice, setMaxPrice] = useState(searchParams.get('maxPrice') ?? '');

  const categoryHref = (slug: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('page');
    if (slug) params.set('category', slug);
    else params.delete('category');
    const qs = params.toString();
    return qs ? `/shop?${qs}` : '/shop';
  };

  return (
    <div className="space-y-9">
      {showCategories ? (
        <FilterGroup title="Category">
          <ul className="space-y-2 text-[14px]">
            <li>
              <Link href={categoryHref(null)} className={cn('transition-colors hover:text-ink', !activeCategory ? 'font-medium text-ink' : 'text-muted')}>
                All products
              </Link>
            </li>
            {categories
              .filter((c) => c.productCount > 0)
              .map((cat) => (
                <li key={cat.slug}>
                  <Link
                    href={categoryHref(cat.slug)}
                    className={cn('transition-colors hover:text-ink', activeCategory === cat.slug ? 'font-medium text-ink' : 'text-muted')}
                  >
                    {cat.name} <span className="text-faint">({cat.productCount})</span>
                  </Link>
                  {cat.children.some((c) => c.productCount > 0) ? (
                    <ul className="mt-2 space-y-1.5 border-l border-line pl-3">
                      {cat.children
                        .filter((c) => c.productCount > 0)
                        .map((child) => (
                          <li key={child.slug}>
                            <Link
                              href={categoryHref(child.slug)}
                              className={cn(
                                'text-[13.5px] transition-colors hover:text-ink',
                                activeCategory === child.slug ? 'font-medium text-ink' : 'text-muted',
                              )}
                            >
                              {child.name}
                            </Link>
                          </li>
                        ))}
                    </ul>
                  ) : null}
                </li>
              ))}
          </ul>
        </FilterGroup>
      ) : null}

      {facets.sizes.length ? (
        <FilterGroup title="Size">
          <div className="flex flex-wrap gap-1.5">
            {facets.sizes.map((size) => {
              const active = activeSizes.includes(size);
              return (
                <button
                  key={size}
                  type="button"
                  onClick={() => toggleMulti('size', size)}
                  aria-pressed={active}
                  className={cn(
                    'h-9 min-w-11 border px-3 text-[12.5px] transition-colors',
                    active ? 'border-ink bg-ink text-paper' : 'border-line-strong hover:border-ink',
                  )}
                >
                  {size}
                </button>
              );
            })}
          </div>
        </FilterGroup>
      ) : null}

      {facets.colors.length ? (
        <FilterGroup title="Colour">
          <ul className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            {facets.colors.map((color) => {
              const active = activeColors.includes(color.name.toLowerCase());
              return (
                <li key={color.name}>
                  <button
                    type="button"
                    onClick={() => toggleMulti('color', color.name)}
                    aria-pressed={active}
                    className="flex items-center gap-2.5 text-[13.5px]"
                  >
                    <span
                      className={cn('h-5 w-5 rounded-full border transition-shadow', active ? 'ring-1 ring-ink ring-offset-2' : 'border-ink/15')}
                      style={{ backgroundColor: color.hex }}
                    />
                    <span className={active ? 'font-medium' : 'text-muted'}>{color.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </FilterGroup>
      ) : null}

      <FilterGroup title="Price (৳)">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            update((p) => {
              if (minPrice) p.set('minPrice', minPrice.replace(/\D/g, ''));
              else p.delete('minPrice');
              if (maxPrice) p.set('maxPrice', maxPrice.replace(/\D/g, ''));
              else p.delete('maxPrice');
            });
          }}
        >
          <input
            inputMode="numeric"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            placeholder={String(facets.priceRange.min)}
            aria-label="Minimum price in taka"
            className="h-9 w-full border border-line-strong px-2.5 text-[13px] tabular-nums focus:border-ink focus:outline-none"
          />
          <span className="text-muted">–</span>
          <input
            inputMode="numeric"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            placeholder={String(facets.priceRange.max)}
            aria-label="Maximum price in taka"
            className="h-9 w-full border border-line-strong px-2.5 text-[13px] tabular-nums focus:border-ink focus:outline-none"
          />
          <button type="submit" className="h-9 shrink-0 border border-ink px-3 text-[11px] font-medium uppercase tracking-[0.14em] hover:bg-ink hover:text-paper">
            Go
          </button>
        </form>
      </FilterGroup>

      <FilterGroup title="Availability">
        <div className="space-y-2.5 text-[14px]">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" checked={searchParams.get('inStock') === '1'} onChange={(e) => setSingle('inStock', e.target.checked ? '1' : null)} className="h-4 w-4" />
            In stock only
          </label>
          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" checked={searchParams.get('onSale') === '1'} onChange={(e) => setSingle('onSale', e.target.checked ? '1' : null)} className="h-4 w-4" />
            On sale
          </label>
        </div>
      </FilterGroup>
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="eyebrow mb-4 border-b border-line pb-3">{title}</h3>
      {children}
    </section>
  );
}

/** Chips summarising active filters, each removable, plus "clear all". */
export function ActiveFilters() {
  const { searchParams, update } = useFilterNavigation();
  const chips: { key: string; value: string; label: string }[] = [];
  for (const size of searchParams.getAll('size')) chips.push({ key: 'size', value: size, label: `Size ${size}` });
  for (const color of searchParams.getAll('color')) chips.push({ key: 'color', value: color, label: color });
  if (searchParams.get('minPrice')) chips.push({ key: 'minPrice', value: '', label: `From ৳${searchParams.get('minPrice')}` });
  if (searchParams.get('maxPrice')) chips.push({ key: 'maxPrice', value: '', label: `Up to ৳${searchParams.get('maxPrice')}` });
  if (searchParams.get('inStock')) chips.push({ key: 'inStock', value: '', label: 'In stock' });
  if (searchParams.get('onSale')) chips.push({ key: 'onSale', value: '', label: 'On sale' });
  if (searchParams.get('q')) chips.push({ key: 'q', value: '', label: `“${searchParams.get('q')}”` });
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <button
          key={`${chip.key}-${chip.value}`}
          type="button"
          onClick={() =>
            update((p) => {
              if (chip.value) {
                const rest = p.getAll(chip.key).filter((v) => v !== chip.value);
                p.delete(chip.key);
                rest.forEach((v) => p.append(chip.key, v));
              } else p.delete(chip.key);
            })
          }
          className="inline-flex items-center gap-1.5 border border-line-strong bg-bone px-2.5 py-1 text-[12.5px] transition-colors hover:border-ink"
        >
          {chip.label}
          <X className="h-3 w-3" />
        </button>
      ))}
      <button
        type="button"
        onClick={() =>
          update((p) => {
            ['size', 'color', 'minPrice', 'maxPrice', 'inStock', 'onSale', 'q'].forEach((k) => p.delete(k));
          })
        }
        className="text-[12.5px] text-muted underline underline-offset-4 hover:text-ink"
      >
        Clear all
      </button>
    </div>
  );
}

export function MobileFilters(props: { facets: FilterFacets; categories: FilterCategory[]; showCategories?: boolean; total: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="lg:hidden">
        <SlidersHorizontal className="h-3.5 w-3.5" /> Filter
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        side="left"
        title="Filter"
        footer={
          <Button className="w-full" size="lg" onClick={() => setOpen(false)}>
            Show {props.total} {props.total === 1 ? 'result' : 'results'}
          </Button>
        }
      >
        <div className="px-6 py-6">
          <FilterPanel facets={props.facets} categories={props.categories} showCategories={props.showCategories} />
        </div>
      </Sheet>
    </>
  );
}
