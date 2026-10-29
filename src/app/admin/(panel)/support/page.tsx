import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { Pagination } from '@/components/ui/misc';
import { PageHeader, Table, Tabs, Td, Th } from '@/components/admin/ui';
import { requireAdminPage } from '@/server/auth/current-user';
import { listSupportAdmin } from '@/server/services/support';
import { formatDateTime } from '@/lib/utils';
import { supportListQuerySchema } from '@/lib/validation/admin';
import { SUPPORT_TOPIC_LABEL, type SupportTopic } from '@/lib/validation/store';

export const metadata: Metadata = { title: 'Support inbox' };

const STATUS_LABEL = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' } as const;

export default async function AdminSupportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage('support:manage', '/admin/support');
  const sp = await searchParams;
  const parsed = supportListQuerySchema.safeParse({ status: typeof sp.status === 'string' ? sp.status : undefined, page: typeof sp.page === 'string' ? sp.page : undefined });
  const query = parsed.success ? parsed.data : supportListQuerySchema.parse({});
  const result = await listSupportAdmin(query);
  const totalPages = Math.ceil(result.total / result.pageSize);
  const href = (status: string, page?: number) => {
    const params = new URLSearchParams();
    if (status !== 'active') params.set('status', status);
    if (page && page > 1) params.set('page', String(page));
    const qs = params.toString();
    return qs ? `/admin/support?${qs}` : '/admin/support';
  };
  const c = result.counts;
  return (
    <>
      <PageHeader title="Support inbox" description="Messages from the Help & contact page. Reply by email or phone, then mark them resolved." />
      <Tabs
        items={[
          { href: href('active'), label: 'Active', count: (c.open ?? 0) + (c.in_progress ?? 0), active: query.status === 'active' },
          { href: href('open'), label: 'Open', count: c.open ?? 0, active: query.status === 'open' },
          { href: href('in_progress'), label: 'In progress', count: c.in_progress ?? 0, active: query.status === 'in_progress' },
          { href: href('resolved'), label: 'Resolved', count: c.resolved ?? 0, active: query.status === 'resolved' },
          { href: href('all'), label: 'All', count: (c.open ?? 0) + (c.in_progress ?? 0) + (c.resolved ?? 0), active: query.status === 'all' },
        ]}
      />
      {result.items.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Reference</Th>
              <Th>From</Th>
              <Th>Topic</Th>
              <Th>Order</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((t) => (
              <tr key={t.id} className="transition-colors hover:bg-bone/50">
                <Td>
                  <Link href={`/admin/support/${t.id}`} className="font-medium hover:underline">
                    {t.ticketNumber}
                  </Link>
                  <p className="text-[12px] text-muted">{formatDateTime(t.createdAt)}</p>
                </Td>
                <Td>
                  <p>{t.name}</p>
                  <p className="text-[12px] text-muted">{t.email ?? t.phone}</p>
                </Td>
                <Td className="text-muted">{SUPPORT_TOPIC_LABEL[t.topic as SupportTopic] ?? t.topic}</Td>
                <Td className="text-muted">{t.orderNumber ?? '—'}</Td>
                <Td>
                  <Badge tone={t.status === 'open' ? 'warning' : t.status === 'in_progress' ? 'info' : 'success'}>{STATUS_LABEL[t.status]}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState className="border border-line bg-paper" title="Inbox zero" description="New messages from the contact form appear here." />
      )}
      <Pagination className="mt-8" page={query.page} totalPages={totalPages} hrefFor={(p) => href(query.status, p)} />
    </>
  );
}
