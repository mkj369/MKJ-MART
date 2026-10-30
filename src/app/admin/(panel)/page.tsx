import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { Alert } from '@/components/ui/feedback';
import { OrderStatusBadge, PageHeader, Panel, PaymentStatusBadge, StatCard } from '@/components/admin/ui';
import { SalesChart } from '@/components/admin/sales-chart';
import { requireAdminPage } from '@/server/auth/current-user';
import { getDashboard } from '@/server/services/admin/dashboard';
import { formatBDT } from '@/lib/money';
import { cn, formatDateTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage('dashboard:view', '/admin');
  const sp = await searchParams;
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const d = await getDashboard(days);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Performance for the last ${days} days · Bangladesh time`}
        actions={
          <div className="flex border border-line-strong bg-paper text-[12.5px]">
            {[7, 30, 90].map((n) => (
              <Link key={n} href={`/admin?days=${n}`} className={cn('px-3 py-1.5', n === days ? 'bg-ink text-paper' : 'hover:bg-bone')}>
                {n} days
              </Link>
            ))}
          </div>
        }
      />
      {sp.denied ? (
        <Alert tone="warning" className="mb-6">
          Your role doesn’t include access to that section. Ask an administrator if you need it.
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Sales" value={formatBDT(d.sales)} change={d.salesChange} hint="vs previous period" />
        <StatCard label="Orders" value={d.orders} change={d.ordersChange} hint="excl. cancelled & unpaid online" />
        <StatCard label="Average order" value={formatBDT(d.averageOrderValue)} />
        <StatCard label="Collected" value={formatBDT(d.collected)} hint="COD received + online paid" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_340px]">
        <Panel title="Daily sales">
          <SalesChart series={d.series} />
        </Panel>
        <Panel title="Needs attention" bodyClassName="p-0">
          <ul className="divide-y divide-line text-[13.5px]">
            {[
              { label: 'Orders to confirm', value: d.queue.toConfirm, href: '/admin/orders?status=pending' },
              { label: 'Orders to pack & ship', value: d.queue.toFulfil, href: '/admin/orders?status=confirmed' },
              { label: 'Out for delivery', value: d.queue.inTransit, href: '/admin/orders?status=shipped' },
              { label: 'Awaiting online payment', value: d.queue.awaitingPayment, href: '/admin/orders?payment=pending' },
              { label: 'Low-stock variants', value: d.stock.low, href: '/admin/inventory?filter=low' },
              { label: 'Out-of-stock variants', value: d.stock.out, href: '/admin/inventory?filter=out' },
            ].map((row) => (
              <li key={row.label}>
                <Link href={row.href} className="flex items-center justify-between px-5 py-3 transition-colors hover:bg-bone/60">
                  <span>{row.label}</span>
                  <span className={cn('flex items-center gap-2 tabular-nums', row.value > 0 ? 'font-medium text-ink' : 'text-faint')}>
                    {row.value}
                    <ArrowRight className="h-3.5 w-3.5 text-faint" />
                  </span>
                </Link>
              </li>
            ))}
            <li className="flex items-center justify-between bg-bone/50 px-5 py-3">
              <span className="text-muted">COD cash to collect</span>
              <span className="tabular-nums">{formatBDT(d.queue.codToCollect)}</span>
            </li>
          </ul>
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_400px]">
        <Panel title="Recent orders" actions={<Link href="/admin/orders" className="text-[12px] text-muted hover:text-ink">View all →</Link>} bodyClassName="p-0">
          {d.recentOrders.length ? (
            <ul className="divide-y divide-line">
              {d.recentOrders.map((o) => (
                <li key={o.id}>
                  <Link href={`/admin/orders/${o.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-[13.5px] transition-colors hover:bg-bone/60">
                    <span className="w-40 font-medium">{o.orderNumber}</span>
                    <span className="min-w-0 flex-1 truncate text-muted">
                      {o.customerName} · {formatDateTime(o.placedAt)}
                    </span>
                    <OrderStatusBadge status={o.status} />
                    <PaymentStatusBadge status={o.paymentStatus} />
                    <span className="w-24 text-right tabular-nums">{formatBDT(o.total)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-8 text-center text-[13.5px] text-muted">No orders yet.</p>
          )}
        </Panel>
        <div className="space-y-6">
          <Panel title="Top products" bodyClassName="p-0">
            {d.topProducts.length ? (
              <ol className="divide-y divide-line">
                {d.topProducts.map((p, i) => (
                  <li key={`${p.productId}-${i}`} className="flex items-center gap-3 px-5 py-3 text-[13.5px]">
                    <span className="w-4 text-faint">{i + 1}</span>
                    <div className="relative h-10 w-8 shrink-0 bg-linen">{p.image ? <Image src={p.image} alt="" fill sizes="32px" className="object-cover" /> : null}</div>
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="text-muted tabular-nums">{p.quantity} sold</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="px-5 py-8 text-center text-[13.5px] text-muted">No sales in this period.</p>
            )}
          </Panel>
          <Panel title="Low stock" actions={<Link href="/admin/inventory?filter=low" className="text-[12px] text-muted hover:text-ink">Inventory →</Link>} bodyClassName="p-0">
            {d.lowStockItems.length ? (
              <ul className="divide-y divide-line">
                {d.lowStockItems.map((v) => (
                  <li key={v.variantId} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                    <AlertTriangle className={cn('h-3.5 w-3.5 shrink-0', v.stock === 0 ? 'text-danger' : 'text-warning')} />
                    <span className="min-w-0 flex-1 truncate">
                      {v.productName} <span className="text-muted">· {[v.colorName, v.sizeLabel].filter(Boolean).join(' / ')}</span>
                    </span>
                    <span className={cn('tabular-nums', v.stock === 0 ? 'text-danger' : 'text-warning')}>{v.stock}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-6 text-center text-[13px] text-muted">All variants above the {d.lowStockThreshold}-unit threshold.</p>
            )}
          </Panel>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Customers" value={d.customers.total} hint={`${d.customers.newInRange} new in ${days} days`} />
        <StatCard label="Units in stock" value={d.stock.units} />
        <StatCard label="Stock value (retail)" value={formatBDT(d.stock.value)} />
      </div>
    </>
  );
}
