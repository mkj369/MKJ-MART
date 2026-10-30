import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/ui';
import { ProductEditor } from '@/components/admin/product-editor';
import { requireAdminPage } from '@/server/auth/current-user';
import { getProductEditorOptions } from '@/server/services/admin/products';

export const metadata: Metadata = { title: 'New product' };

export default async function NewProductPage() {
  await requireAdminPage('catalog:manage', '/admin/products/new');
  const options = await getProductEditorOptions();
  return (
    <>
      <PageHeader back={{ href: '/admin/products', label: 'Products' }} title="New product" description="Products are saved as drafts until you publish them." />
      <ProductEditor options={options} />
    </>
  );
}
