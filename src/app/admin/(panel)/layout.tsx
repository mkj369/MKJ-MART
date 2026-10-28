import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/admin-shell';
import { requireAdminPage } from '@/server/auth/current-user';
import { getPendingOrderCount } from '@/server/services/admin/dashboard';

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · MKJ Admin' },
  robots: { index: false, follow: false },
};

export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdminPage('dashboard:view', '/admin');
  const pendingOrders = await getPendingOrderCount();
  return (
    <AdminShell user={{ name: user.name, email: user.email, role: user.role }} pendingOrders={pendingOrders}>
      {children}
    </AdminShell>
  );
}
