import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/ui/feedback';
import { OrderStatusBadge, PageHeader, Panel, PaymentStatusBadge, StatCard } from '@/components/admin/ui';
import { CustomerActions } from '@/components/admin/managers';
import { requireAdminPage } from '@/server/auth/current-user';
import { getCustomer } from '@/server/services/admin/customers';
import { formatBDT } from '@/lib/money';
import { can, ROLE_LABEL } from '@/lib/permissions';
import { formatBdPhone } from '@/lib/phone';
import { formatDate, formatDateTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Customer' };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireAdminPage('customers:view', `/admin/customers/${id}`);
  const { user, addresses, orders, stats } = await getCustomer(id);
  return (
    <>
      <PageHeader
        back={{ href: '/admin/customers', label: 'Customers' }}
        title={user.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {user.email}
            <Badge tone={user.role === 'customer' ? 'outline' : 'ink'}>{ROLE_LABEL[user.role]}</Badge>
            {user.status === 'blocked' ? <Badge tone="danger">Blocked</Badge> : null}
            {user.isDemo ? <Badge tone="gold">Demo</Badge> : null}
          </span>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Orders" value={stats.orderCount} />
        <StatCard label="Total spent" value={formatBDT(stats.totalSpent)} />
        <StatCard label="Member since" value={<span className="text-[24px]">{formatDate(user.createdAt)}</span>} hint={user.lastLoginAt ? `Last sign-in ${formatDateTime(user.lastLoginAt)}` : 'Never signed in'} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Panel title="Orders" bodyClassName="p-0">
          {orders.length ? (
            <ul className="divide-y divide-line">
              {orders.map((o) => (
                <li key={o.id}>
                  <Link href={`/admin/orders/${o.id}`} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13.5px] hover:bg-bone/60">
                    <span className="w-40 font-medium">{o.orderNumber}</span>
                    <span className="flex-1 text-muted">{formatDateTime(o.placedAt)}</span>
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
          <Panel title="Account">
            <p className="text-[13.5px]">{user.phone ? formatBdPhone(user.phone) : 'No phone on file'}</p>
            <div className="mt-5">
              <CustomerActions id={user.id} status={user.status} role={user.role} canManage={can(viewer.role, 'customers:manage')} isSelf={viewer.id === user.id} />
            </div>
          </Panel>
          <Panel title={`Addresses (${addresses.length})`}>
            {addresses.length ? (
              <ul className="space-y-4 text-[13px]">
                {addresses.map((a) => (
                  <li key={a.id}>
                    <p className="font-medium">
                      {a.label} {a.isDefault ? <Badge tone="gold" className="ml-1">Default</Badge> : null}
                    </p>
                    <p className="text-muted">
                      {a.recipientName} · {formatBdPhone(a.phone)}
                      <br />
                      {a.addressLine}, {a.area}, {a.district}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">No saved addresses.</p>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
