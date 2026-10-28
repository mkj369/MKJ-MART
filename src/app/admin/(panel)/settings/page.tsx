import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/ui';
import { AnnouncementForm, CheckoutSettingsForm, DemoDataPanel, PoliciesForm, StoreSettingsForm } from '@/components/admin/managers';
import { requireAdminPage } from '@/server/auth/current-user';
import { sslcommerzConfig } from '@/server/env';
import { getDemoDataSummary } from '@/server/services/admin/demo-data';
import { getSettings } from '@/server/services/settings';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  await requireAdminPage('settings:manage', '/admin/settings');
  const [settings, demo] = await Promise.all([getSettings(['store', 'checkout', 'policies', 'announcement']), getDemoDataSummary()]);
  const gateway = sslcommerzConfig();
  return (
    <>
      <PageHeader title="Settings" description="Store details, checkout rules, policies and demo data. Secrets (payment credentials) live in server environment variables, never here." />
      <div className="space-y-6">
        <StoreSettingsForm initial={settings.store} />
        <CheckoutSettingsForm initial={settings.checkout} gateway={{ configured: !!gateway, mode: gateway?.mode ?? null }} />
        <AnnouncementForm initial={settings.announcement} />
        <PoliciesForm initial={settings.policies} />
        <DemoDataPanel summary={demo} />
      </div>
    </>
  );
}
