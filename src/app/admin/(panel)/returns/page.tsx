import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { Pagination } from '@/components/ui/misc';
import { PageHeader, ReturnStatusBadge, Table, Tabs, Td, Th } from '@/components/admin/ui';
import { requireAdminPage } from '@/server/auth/current-user';
import { listReturnsAdmin } from '@/server/services/returns';
import { formatBDT } from '@/lib/money';
import { RETURN_REASON_LABEL, RETURN_STATUS_LABEL, type ReturnStatus } from '@/lib/returns';
import { formatDateTime } from '@/lib/utils';
import { returnListQuerySchema } from '@/lib/validation/admin';

export const metadata: Metadata = { title: 'Returns' };

const TABS: (ReturnStatus | 'open' | 'all')[] = ['open', 'requested', 'approved', 'received', 'refunded', 'rejected', 'cancelled', 'all'];
const TAB_LABEL: Record<string, string> = { open: 'Needs action', all: 'All', ...RETURN_STATUS_LABEL };

export default async function AdminReturnsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage('returns:manage', '/admin/returns');
  const sp = await searchParams;
  const parsed = returnListQuerySchema.safeParse({ status: typeof sp.status === 'string' ? sp.status : undefined, page: typeof sp.page === 'string' ? sp.page : undefined });
  const query = parsed.success ? parsed.data : returnListQuerySchema.parse({});
  const result = await listReturnsAdmin(query);
  const totalPages = Math.ceil(result.total / result.pageSize);
  const href = (status: string, page?: number) => {
    const params = new URLSearchParams();
    if (status !== 'open') params.set('status', status);
    if (page && page > 1) params.set('page', String(page));
    const qs = params.toString();
    return qs ? `/admin/returns?${qs}` : '/admin/returns';
  };
  const openCount = (result.counts.requested ?? 0) + (result.counts.approved ?? 0) + (result.counts.received ?? 0);
  const allCount = Object.values(result.counts).reduce((a, b) => a + (b ?? 0), 0);

  return (
    <>
      <PageHeader title="Returns" description="Approve, receive and refund customer returns. Refunds are paid outside MKJ MART and recorded here." />
      <Tabs
        items={TABS.map((t) => ({
          href: href(t),
          label: TAB_LABEL[t]!,
          count: t === 'open' ? openCount : t === 'all' ? allCount : (result.counts[t as ReturnStatus] ?? 0),
          active: query.status === t,
        }))}
      />
      {result.items.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Return</Th>
              <Th>Order</Th>
              <Th>Customer</Th>
              <Th>Reason</Th>
              <Th>Units</Th>
              <Th>Status</Th>
              <Th className="text-right">Refunded</Th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((r) => (
              <tr key={r.id} className="transition-colors hover:bg-bone/50">
                <Td>
                  <Link href={`/admin/returns/${r.id}`} className="font-medium hover:underline">
                    {r.requestNumber}
                  </Link>
                  {r.isDemo ? <Badge tone="gold" className="ml-2">Demo</Badge> : null}
                  <p className="text-[12px] text-muted">{formatDateTime(r.createdAt)}</p>
                </Td>
                <Td>
                  <Link href={`/admin/orders/${r.orderId}`} className="hover:underline">
                    {r.orderNumber}
                  </Link>
                </Td>
                <Td>{r.customerName}</Td>
                <Td className="text-muted">{RETURN_REASON_LABEL[r.reason]}</Td>
                <Td className="tabular-nums">{r.units}</Td>
                <Td>
                  <ReturnStatusBadge status={r.status} />
                </Td>
                <Td className="text-right tabular-nums">{r.refunded ? formatBDT(r.refunded) : '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState className="border border-line bg-paper" title="No return requests here" description="Customers request returns from their order page after delivery." />
      )}
      <Pagination className="mt-8" page={query.page} totalPages={totalPages} hrefFor={(p) => href(query.status, p)} />
    </>
  );
}
