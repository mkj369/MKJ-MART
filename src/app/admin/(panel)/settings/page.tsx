import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/ui';
import {
  AnnouncementForm,
  CheckoutSettingsForm,
  DemoDataPanel,
  NotificationSettingsForm,
  PoliciesForm,
  ReturnSettingsForm,
  StoreSettingsForm,
  SupportSettingsForm,
} from '@/components/admin/managers';
import { JobsPanel, LaunchChecklist, NotificationLog } from '@/components/admin/settings-panels';
import { requireAdminPage } from '@/server/auth/current-user';
import { smsConfig, smtpConfig, sslcommerzConfig } from '@/server/env';
import { JOB_EXPECTED_INTERVAL_MINUTES, listJobRuns } from '@/server/jobs';
import { listRecentNotifications } from '@/server/notifications';
import { getDemoDataSummary } from '@/server/services/admin/demo-data';
import { getLaunchChecklist } from '@/server/services/admin/launch';
import { getSettings } from '@/server/services/settings';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requireAdminPage('settings:manage', '/admin/settings');
  const [settings, demo, launch, runs, failed, skipped] = await Promise.all([
    getSettings(['store', 'checkout', 'policies', 'announcement', 'returns', 'notifications', 'support']),
    getDemoDataSummary(),
    getLaunchChecklist(),
    listJobRuns(),
    listRecentNotifications({ status: 'failed', limit: 10 }),
    listRecentNotifications({ status: 'skipped', limit: 10 }),
  ]);
  const gateway = sslcommerzConfig();
  const sms = smsConfig();
  const problems = [...failed, ...skipped].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 12);
  return (
    <>
      <PageHeader
        title="Settings"
        description="Launch readiness, business details, checkout rules, notifications and policies. Secrets (payment, SMTP, SMS credentials) live in server environment variables, never here."
      />
      <div className="space-y-6">
        <section id="launch">
          <LaunchChecklist {...launch} />
        </section>
        <section id="store">
          <StoreSettingsForm initial={settings.store} />
        </section>
        <section id="checkout">
          <CheckoutSettingsForm initial={settings.checkout} gateway={{ configured: !!gateway, mode: gateway?.mode ?? null }} />
        </section>
        <section id="notifications">
          <NotificationSettingsForm initial={settings.notifications} providers={{ email: !!smtpConfig(), sms: sms?.provider ?? null }} adminEmail={user.email} />
        </section>
        <NotificationLog rows={problems} />
        <section id="returns">
          <ReturnSettingsForm initial={settings.returns} />
        </section>
        <section id="support">
          <SupportSettingsForm initial={settings.support} />
        </section>
        <AnnouncementForm initial={settings.announcement} />
        <section id="policies">
          <PoliciesForm initial={settings.policies} />
        </section>
        <JobsPanel runs={runs} expected={JOB_EXPECTED_INTERVAL_MINUTES} />
        <section id="demo">
          <DemoDataPanel summary={demo} />
        </section>
      </div>
    </>
  );
}
