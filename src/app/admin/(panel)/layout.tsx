import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/admin-shell';
import { requireAdminPage } from '@/server/auth/current-user';
import { can } from '@/lib/permissions';
import { getPendingOrderCount } from '@/server/services/admin/dashboard';
import { countOpenReturns } from '@/server/services/returns';
import { countOpenSupport } from '@/server/services/support';

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · MKJ Admin' },
  robots: { index: false, follow: false },
};

export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdminPage('dashboard:view', '/admin');
  const [pendingOrders, openReturns, openSupport] = await Promise.all([
    can(user.role, 'orders:manage') ? getPendingOrderCount() : 0,
    can(user.role, 'returns:manage') ? countOpenReturns() : 0,
    can(user.role, 'support:manage') ? countOpenSupport() : 0,
  ]);
  return (
    <AdminShell
      user={{ name: user.name, email: user.email, role: user.role }}
      badges={{ '/admin/orders': pendingOrders, '/admin/returns': openReturns, '/admin/support': openSupport }}
    >
      {children}
    </AdminShell>
  );
}
