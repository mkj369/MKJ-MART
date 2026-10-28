import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/ui';
import { CollectionManager } from '@/components/admin/taxonomy-managers';
import { requireAdminPage } from '@/server/auth/current-user';
import { listCollectionsAdmin } from '@/server/services/admin/taxonomy';

export const metadata: Metadata = { title: 'Collections' };

export default async function CollectionsPage() {
  await requireAdminPage('catalog:manage', '/admin/collections');
  const collections = await listCollectionsAdmin();
  return (
    <>
      <PageHeader title="Collections" description="Curated edits featured on the home page and in navigation." />
      <CollectionManager collections={collections} />
    </>
  );
}
