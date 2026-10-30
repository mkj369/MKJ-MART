import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { Pagination } from '@/components/ui/misc';
import { OrderStatusBadge, PageHeader, PaymentStatusBadge, Table, Tabs, Td, Th } from '@/components/admin/ui';
import { SearchBox } from '@/components/admin/search-box';
import { requireAdminPage } from '@/server/auth/current-user';
import { listOrdersAdmin } from '@/server/services/admin/orders';
import { formatBDT } from '@/lib/money';
import { ORDER_STATUS_LABEL, ORDER_STATUSES, PAYMENT_METHOD_LABEL, type OrderStatus, type PaymentStatus } from '@/lib/order-status';
import { formatBdPhone } from '@/lib/phone';
import { formatDateTime } from '@/lib/utils';
import { orderListQuerySchema } from '@/lib/validation/admin';

export const metadata: Metadata = { title: 'Orders' };

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage('orders:manage', '/admin/orders');
  const sp = await searchParams;
  const parsed = orderListQuerySchema.safeParse({
    q: typeof sp.q === 'string' ? sp.q : undefined,
    status: typeof sp.status === 'string' ? sp.status : undefined,
    payment: typeof sp.payment === 'string' ? sp.payment : undefined,
    page: typeof sp.page === 'string' ? sp.page : undefined,
  });
  const query = parsed.success ? parsed.data : orderListQuerySchema.parse({});
  const result = await listOrdersAdmin({ ...query, status: query.status as OrderStatus | 'all', payment: query.payment as PaymentStatus | 'all' });
  const totalPages = Math.ceil(result.total / result.pageSize);
  const allCount = Object.values(result.counts).reduce((a, b) => a + (b ?? 0), 0);

  const href = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { q: query.q, status: query.status === 'all' ? undefined : query.status, payment: query.payment === 'all' ? undefined : query.payment, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/admin/orders?${qs}` : '/admin/orders';
  };

  return (
    <>
      <PageHeader title="Orders" description="Confirm, pack, ship and track every order." actions={<SearchBox placeholder="Order no., name, phone or email" />} />
      <Tabs
        items={[
          { href: href({ status: undefined, page: undefined }), label: 'All', count: allCount, active: query.status === 'all' },
          ...ORDER_STATUSES.map((s) => ({
            href: href({ status: s, page: undefined }),
            label: ORDER_STATUS_LABEL[s],
            count: result.counts[s] ?? 0,
            active: query.status === s,
          })),
        ]}
      />
      {query.payment !== 'all' ? (
        <p className="mb-4 text-[13px] text-muted">
          Filtered by payment: <Badge tone="outline">{query.payment}</Badge>{' '}
          <Link href={href({ payment: undefined })} className="underline underline-offset-4">
            clear
          </Link>
        </p>
      ) : null}
      {result.items.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Order</Th>
              <Th>Placed</Th>
              <Th>Customer</Th>
              <Th>Items</Th>
              <Th>Payment</Th>
              <Th>Status</Th>
              <Th className="text-right">Total</Th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((o) => (
              <tr key={o.id} className="transition-colors hover:bg-bone/50">
                <Td>
                  <Link href={`/admin/orders/${o.id}`} className="font-medium hover:underline">
                    {o.orderNumber}
                  </Link>
                  {o.isDemo ? <Badge tone="gold" className="ml-2">Demo</Badge> : null}
                </Td>
                <Td className="whitespace-nowrap text-muted">{formatDateTime(o.placedAt)}</Td>
                <Td>
                  <p>{o.customerName}</p>
                  <p className="text-[12px] text-muted">
                    {formatBdPhone(o.phone)} · {o.district} {o.userId ? '' : '· guest'}
                  </p>
                </Td>
                <Td className="tabular-nums">{o.itemCount}</Td>
                <Td>
                  <div className="flex flex-col items-start gap-1">
                    <PaymentStatusBadge status={o.paymentStatus} />
                    <span className="text-[11.5px] text-muted">{PAYMENT_METHOD_LABEL[o.paymentMethod]}</span>
                  </div>
                </Td>
                <Td>
                  <OrderStatusBadge status={o.status} />
                </Td>
                <Td className="text-right tabular-nums">{formatBDT(o.total)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState className="border border-line bg-paper" title="No orders found" description="Try another status or search term." />
      )}
      <Pagination className="mt-8" page={query.page} totalPages={totalPages} hrefFor={(p) => href({ page: p > 1 ? String(p) : undefined })} />
    </>
  );
}
