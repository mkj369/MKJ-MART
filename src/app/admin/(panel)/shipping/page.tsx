import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/ui';
import { ShippingManager } from '@/components/admin/managers';
import { requireAdminPage } from '@/server/auth/current-user';
import { listShippingZonesAdmin } from '@/server/services/admin/shipping';

export const metadata: Metadata = { title: 'Delivery zones' };

export default async function ShippingPage() {
  await requireAdminPage('shipping:manage', '/admin/shipping');
  const zones = await listShippingZonesAdmin();
  return (
    <>
      <PageHeader title="Delivery zones" description="Charges by district. Each district belongs to one zone; the default zone covers the rest of Bangladesh." />
      <ShippingManager zones={zones.map((z) => ({ id: z.id, name: z.name, fee: z.fee, estimatedDays: z.estimatedDays, districts: z.districts, isDefault: z.isDefault, isActive: z.isActive, sortOrder: z.sortOrder }))} />
    </>
  );
}
