import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, EmptyState } from '@/components/ui/feedback';
import { Pagination } from '@/components/ui/misc';
import { PageHeader, Table, Tabs, Td, Th } from '@/components/admin/ui';
import { SearchBox } from '@/components/admin/search-box';
import { requireAdminPage } from '@/server/auth/current-user';
import { listCustomers } from '@/server/services/admin/customers';
import { formatBDT } from '@/lib/money';
import { ROLE_LABEL } from '@/lib/permissions';
import { formatBdPhone } from '@/lib/phone';
import { formatDate } from '@/lib/utils';

export const metadata: Metadata = { title: 'Customers' };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage('customers:view', '/admin/customers');
  const sp = await searchParams;
  const role = sp.role === 'staff' ? 'staff' : sp.role === 'all' ? 'all' : 'customer';
  const status = sp.status === 'blocked' ? 'blocked' : 'all';
  const q = typeof sp.q === 'string' ? sp.q.slice(0, 100) : undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const result = await listCustomers({ q, role, status, page });
  const totalPages = Math.ceil(result.total / result.pageSize);
  const href = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, role: role === 'customer' ? undefined : role, status: status === 'all' ? undefined : status, ...patch })) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/admin/customers?${qs}` : '/admin/customers';
  };

  return (
    <>
      <PageHeader title="Customers" description="Accounts, order history and lifetime value." actions={<SearchBox placeholder="Name, email or phone" />} />
      <Tabs
        items={[
          { href: href({ role: undefined, status: undefined }), label: 'Customers', active: role === 'customer' && status === 'all' },
          { href: href({ role: 'staff', status: undefined }), label: 'Staff & admins', active: role === 'staff' },
          { href: href({ role: 'all', status: 'blocked' }), label: 'Blocked', active: status === 'blocked' },
        ]}
      />
      {result.items.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Contact</Th>
              <Th>Role</Th>
              <Th>Orders</Th>
              <Th>Total spent</Th>
              <Th>Joined</Th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((c) => (
              <tr key={c.id} className="hover:bg-bone/50">
                <Td>
                  <Link href={`/admin/customers/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                  {c.status === 'blocked' ? <Badge tone="danger" className="ml-2">Blocked</Badge> : null}
                  {c.isDemo ? <Badge tone="gold" className="ml-2">Demo</Badge> : null}
                </Td>
                <Td>
                  <p>{c.email}</p>
                  {c.phone ? <p className="text-[12px] text-muted">{formatBdPhone(c.phone)}</p> : null}
                </Td>
                <Td>{c.role === 'customer' ? <span className="text-muted">Customer</span> : <Badge tone="ink">{ROLE_LABEL[c.role]}</Badge>}</Td>
                <Td className="tabular-nums">{c.orderCount}</Td>
                <Td className="tabular-nums">{formatBDT(c.totalSpent)}</Td>
                <Td className="text-muted">{formatDate(c.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState className="border border-line bg-paper" title="No accounts found" />
      )}
      <Pagination className="mt-8" page={page} totalPages={totalPages} hrefFor={(p) => href({ page: p > 1 ? String(p) : undefined })} />
    </>
  );
}
