import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/ui';
import { AttributeManager } from '@/components/admin/taxonomy-managers';
import { requireAdminPage } from '@/server/auth/current-user';
import { listColors, listSizes } from '@/server/services/admin/taxonomy';

export const metadata: Metadata = { title: 'Sizes & colours' };

export default async function AttributesPage() {
  await requireAdminPage('catalog:manage', '/admin/attributes');
  const [sizes, colors] = await Promise.all([listSizes(), listColors()]);
  return (
    <>
      <PageHeader title="Sizes & colours" description="Options used to build product variants. Options in use cannot be deleted." />
      <AttributeManager sizes={sizes} colors={colors} />
    </>
  );
}
