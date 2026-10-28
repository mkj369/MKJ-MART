import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/ui';
import { CouponManager } from '@/components/admin/managers';
import { requireAdminPage } from '@/server/auth/current-user';
import { listCouponsAdmin } from '@/server/services/admin/coupons';

export const metadata: Metadata = { title: 'Coupons' };

export default async function CouponsPage() {
  await requireAdminPage('coupons:manage', '/admin/coupons');
  const coupons = await listCouponsAdmin();
  return (
    <>
      <PageHeader title="Coupons & discounts" description="Discounts apply to merchandise (not delivery), are validated server-side, and per-customer limits match account or phone." />
      <CouponManager
        coupons={coupons.map((c) => ({
          id: c.id,
          code: c.code,
          description: c.description,
          type: c.type,
          value: c.value,
          minOrderAmount: c.minOrderAmount,
          maxDiscountAmount: c.maxDiscountAmount,
          startsAt: c.startsAt?.toISOString() ?? null,
          endsAt: c.endsAt?.toISOString() ?? null,
          usageLimit: c.usageLimit,
          usageLimitPerCustomer: c.usageLimitPerCustomer,
          usedCount: c.usedCount,
          isActive: c.isActive,
          isDemo: c.isDemo,
        }))}
      />
    </>
  );
}
