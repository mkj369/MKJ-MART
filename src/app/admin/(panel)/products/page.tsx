import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { buttonClasses } from '@/components/ui/button';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { Pagination } from '@/components/ui/misc';
import { PageHeader, ProductStatusBadge, Table, Tabs, Td, Th } from '@/components/admin/ui';
import { SearchBox } from '@/components/admin/search-box';
import { requireAdminPage } from '@/server/auth/current-user';
import { listProductsAdmin } from '@/server/services/admin/products';
import { formatBDT } from '@/lib/money';
import { cn, formatDate } from '@/lib/utils';

export const metadata: Metadata = { title: 'Products' };

export default async function AdminProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage('catalog:manage', '/admin/products');
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.slice(0, 100) : undefined;
  const status = (['draft', 'active', 'archived'] as const).find((s) => s === sp.status) ?? 'all';
  const page = Math.max(1, Number(sp.page) || 1);
  const result = await listProductsAdmin({ q, status, page });
  const totalPages = Math.ceil(result.total / result.pageSize);
  const all = Object.values(result.counts).reduce((a, b) => a + b, 0);
  const href = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { q, status: status === 'all' ? undefined : status, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/admin/products?${qs}` : '/admin/products';
  };

  return (
    <>
      <PageHeader
        title="Products"
        description="Catalogue, pricing and variants."
        actions={
          <>
            <SearchBox placeholder="Name, slug or SKU" />
            <Link href="/admin/products/new" className={buttonClasses({ variant: 'primary', size: 'sm', caps: false, className: 'h-10' })}>
              <Plus className="h-4 w-4" /> New product
            </Link>
          </>
        }
      />
      <Tabs
        items={[
          { href: href({ status: undefined }), label: 'All', count: all, active: status === 'all' },
          { href: href({ status: 'active' }), label: 'Active', count: result.counts.active ?? 0, active: status === 'active' },
          { href: href({ status: 'draft' }), label: 'Drafts', count: result.counts.draft ?? 0, active: status === 'draft' },
          { href: href({ status: 'archived' }), label: 'Archived', count: result.counts.archived ?? 0, active: status === 'archived' },
        ]}
      />
      {result.items.length ? (
        <Table>
          <thead>
            <tr>
              <Th className="w-16" />
              <Th>Product</Th>
              <Th>Category</Th>
              <Th>Price</Th>
              <Th>Stock</Th>
              <Th>Sold</Th>
              <Th>Status</Th>
              <Th>Updated</Th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((p) => (
              <tr key={p.id} className="transition-colors hover:bg-bone/50">
                <Td>
                  <div className="relative h-14 w-11 bg-linen">{p.image ? <Image src={p.image} alt="" fill sizes="44px" className="object-cover" /> : null}</div>
                </Td>
                <Td>
                  <Link href={`/admin/products/${p.id}`} className="font-medium hover:underline">
                    {p.name}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-2 text-[12px] text-muted">
                    /{p.slug} · {p.variantCount} variants
                    {p.isFeatured ? <Badge tone="outline">Featured</Badge> : null}
                    {p.isDemo ? <Badge tone="gold">Demo</Badge> : null}
                    {!p.image ? <Badge tone="warning">No photo</Badge> : null}
                  </div>
                </Td>
                <Td className="text-muted">{p.categoryName ?? '—'}</Td>
                <Td className="whitespace-nowrap tabular-nums">
                  {formatBDT(p.price)}
                  {p.compareAtPrice ? <span className="ml-1.5 text-[12px] text-muted line-through">{formatBDT(p.compareAtPrice)}</span> : null}
                </Td>
                <Td className={cn('tabular-nums', p.totalStock === 0 ? 'text-danger' : p.totalStock <= 5 ? 'text-warning' : '')}>{p.totalStock}</Td>
                <Td className="tabular-nums text-muted">{p.soldCount}</Td>
                <Td>
                  <ProductStatusBadge status={p.status} />
                </Td>
                <Td className="whitespace-nowrap text-muted">{formatDate(p.updatedAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState
          className="border border-line bg-paper"
          title="No products found"
          description="Create your first product or adjust the filters."
          action={
            <Link href="/admin/products/new" className={buttonClasses({ variant: 'primary', caps: false })}>
              New product
            </Link>
          }
        />
      )}
      <Pagination className="mt-8" page={page} totalPages={totalPages} hrefFor={(p) => href({ page: p > 1 ? String(p) : undefined })} />
    </>
  );
}
