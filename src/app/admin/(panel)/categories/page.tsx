import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/ui';
import { CategoryManager } from '@/components/admin/taxonomy-managers';
import { requireAdminPage } from '@/server/auth/current-user';
import { listCategoriesAdmin } from '@/server/services/admin/taxonomy';

export const metadata: Metadata = { title: 'Categories' };

export default async function CategoriesPage() {
  await requireAdminPage('catalog:manage', '/admin/categories');
  const categories = await listCategoriesAdmin();
  return (
    <>
      <PageHeader title="Categories" description="Two-level navigation (e.g. Men › Panjabi). Categories without active products are hidden from the store menu." />
      <CategoryManager categories={categories} />
    </>
  );
}
