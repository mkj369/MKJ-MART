import type { Metadata } from 'next';
import { EmptyState } from '@/components/ui/feedback';
import { Pagination } from '@/components/ui/misc';
import { PageHeader, StatCard, Tabs } from '@/components/admin/ui';
import { SearchBox } from '@/components/admin/search-box';
import { InventoryTable } from '@/components/admin/inventory-manager';
import { requireAdminPage } from '@/server/auth/current-user';
import { listInventory, type InventoryFilter } from '@/server/services/admin/inventory';

export const metadata: Metadata = { title: 'Inventory' };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage('inventory:manage', '/admin/inventory');
  const sp = await searchParams;
  const filter: InventoryFilter = sp.filter === 'low' || sp.filter === 'out' ? sp.filter : 'all';
  const q = typeof sp.q === 'string' ? sp.q.slice(0, 100) : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const result = await listInventory({ q, filter, page });
  const totalPages = Math.ceil(result.total / result.pageSize);
  const href = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, filter: filter === 'all' ? undefined : filter, ...patch })) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/admin/inventory?${qs}` : '/admin/inventory';
  };

  return (
    <>
      <PageHeader title="Inventory" description={`Stock per variant. Low stock means ${result.lowStockThreshold} units or fewer (change in Settings).`} actions={<SearchBox placeholder="Product or SKU" />} />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <StatCard label="Active variants" value={result.summary.total} />
        <StatCard label="Units in stock" value={result.summary.units} />
        <StatCard label="Low stock" value={result.summary.low} />
        <StatCard label="Out of stock" value={result.summary.out} />
      </div>
      <Tabs
        items={[
          { href: href({ filter: undefined }), label: 'All', active: filter === 'all' },
          { href: href({ filter: 'low' }), label: 'Low stock', count: result.summary.low, active: filter === 'low' },
          { href: href({ filter: 'out' }), label: 'Out of stock', count: result.summary.out, active: filter === 'out' },
        ]}
      />
      {result.items.length ? (
        <InventoryTable rows={result.items} lowStockThreshold={result.lowStockThreshold} />
      ) : (
        <EmptyState className="border border-line bg-paper" title="Nothing here" description="No variants match this view." />
      )}
      <Pagination className="mt-8" page={page} totalPages={totalPages} hrefFor={(p) => href({ page: p > 1 ? String(p) : undefined })} />
    </>
  );
}
