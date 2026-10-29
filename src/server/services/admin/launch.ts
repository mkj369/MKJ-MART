import 'server-only';
import { constants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { and, count, eq, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { productImages, products, shippingZones, users } from '@/server/db/schema';
import { appUrl, cookieSecure, cronSecret, demoModeEnabled, isProduction, smsConfig, smtpConfig, sslcommerzConfig, uploadDir } from '@/server/env';
import { JOB_EXPECTED_INTERVAL_MINUTES, JOB_NAMES, listJobRuns } from '@/server/jobs';
import { POLICY_KEYS } from '@/lib/validation/admin';
import { getDemoDataSummary } from './demo-data';
import { getSettings } from '../settings';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'info';
export type LaunchCheck = { id: string; label: string; status: CheckStatus; detail: string; href?: string };

const POLICY_LABEL: Record<(typeof POLICY_KEYS)[number], string> = {
  shipping: 'Delivery',
  returns: 'Returns',
  privacy: 'Privacy',
  terms: 'Terms',
};

/**
 * Pre-launch checklist shown to administrators. Everything is checked live against the running
 * configuration; nothing here can be "ticked off" manually except policy reviews.
 */
export async function getLaunchChecklist(): Promise<{ checks: LaunchCheck[]; blocking: number; warnings: number }> {
  const [settings, demo, jobRuns, [adminCount], [demoStaff], [activeProducts], [productsWithoutImages], [zones]] = await Promise.all([
    getSettings(['store', 'policies', 'checkout']),
    getDemoDataSummary(),
    listJobRuns(),
    db.select({ value: count() }).from(users).where(and(eq(users.role, 'admin'), eq(users.isDemo, false), eq(users.status, 'active'))),
    db.select({ value: count() }).from(users).where(and(sql`${users.role} IN ('admin','staff')`, eq(users.isDemo, true))),
    db.select({ value: count() }).from(products).where(eq(products.status, 'active')),
    db
      .select({ value: count() })
      .from(products)
      .where(and(eq(products.status, 'active'), sql`NOT EXISTS (SELECT 1 FROM ${productImages} pi WHERE pi.product_id = ${products.id})`)),
    db
      .select({ active: sql<number>`count(*) FILTER (WHERE ${shippingZones.isActive})::int`, defaults: sql<number>`count(*) FILTER (WHERE ${shippingZones.isActive} AND ${shippingZones.isDefault})::int` })
      .from(shippingZones),
  ]);
  const prod = isProduction();
  const checks: LaunchCheck[] = [];
  const add = (c: LaunchCheck) => checks.push(c);

  const url = appUrl();
  add({
    id: 'https',
    label: 'Public URL uses HTTPS',
    status: url.startsWith('https://') ? 'ok' : prod ? 'fail' : 'warn',
    detail: url.startsWith('https://') ? `APP_URL is ${url}.` : `APP_URL is ${url}. Set it to your https:// domain — payment callbacks and email links use it.`,
  });
  add({
    id: 'cookies',
    label: 'Secure session cookies',
    status: cookieSecure() ? 'ok' : prod ? 'fail' : 'info',
    detail: cookieSecure() ? 'Session cookies are HTTPS-only.' : 'COOKIE_SECURE is off. It must be on in production (default when NODE_ENV=production).',
  });

  const s = settings.store;
  const missing = [
    !s.legalName && 'legal business name',
    !s.address && 'address',
    !s.supportEmail && !s.supportPhone && 'support email or phone',
    !s.tradeLicense && 'trade licence number',
  ].filter(Boolean);
  add({
    id: 'business',
    label: 'Business details',
    status: missing.length === 0 ? 'ok' : 'warn',
    detail: missing.length === 0 ? 'Shown in the footer, emails and help page.' : `Missing: ${missing.join(', ')}. Use your real, verified details.`,
    href: '/admin/settings#store',
  });

  const unreviewed = POLICY_KEYS.filter((k) => !settings.policies.reviewed[k]);
  add({
    id: 'policies',
    label: 'Policies reviewed',
    status: unreviewed.length === 0 ? 'ok' : 'warn',
    detail:
      unreviewed.length === 0
        ? 'All policies are marked as reviewed by the business.'
        : `Templates not yet reviewed: ${unreviewed.map((k) => POLICY_LABEL[k]).join(', ')}. The storefront labels them as drafts until you mark them reviewed.`,
    href: '/admin/settings#policies',
  });

  const gateway = sslcommerzConfig();
  const checkout = settings.checkout;
  if (!checkout.codEnabled && !(checkout.onlinePaymentEnabled && gateway)) {
    add({ id: 'payments', label: 'Payment methods', status: 'fail', detail: 'No payment method is available — customers cannot check out.', href: '/admin/settings#checkout' });
  } else if (checkout.onlinePaymentEnabled && gateway?.mode === 'sandbox') {
    add({ id: 'payments', label: 'Payment methods', status: prod ? 'fail' : 'warn', detail: 'SSLCommerz is in SANDBOX mode: online payments are test transactions only. Set SSLCOMMERZ_MODE=live with live credentials.' });
  } else if (checkout.onlinePaymentEnabled && !gateway) {
    add({ id: 'payments', label: 'Payment methods', status: 'warn', detail: 'Online payment is switched on but SSLCommerz credentials are not set, so only Cash on Delivery is offered.' });
  } else {
    add({
      id: 'payments',
      label: 'Payment methods',
      status: 'ok',
      detail: [checkout.codEnabled && 'Cash on Delivery', checkout.onlinePaymentEnabled && gateway && 'SSLCommerz (live)'].filter(Boolean).join(' + ') + '.',
    });
  }

  add({
    id: 'email',
    label: 'Outgoing email (SMTP)',
    status: smtpConfig() ? 'ok' : 'fail',
    detail: smtpConfig()
      ? 'Configured. Use “Send test email” below to confirm delivery.'
      : 'Not configured: customers get no order emails and cannot reset passwords. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and SMTP_FROM.',
    href: '/admin/settings#notifications',
  });
  add({
    id: 'sms',
    label: 'SMS notifications',
    status: 'info',
    detail: smsConfig() ? `Configured (${smsConfig()!.provider}).` : 'Optional — off. Set SMS_PROVIDER to enable order SMS.',
  });

  if (!cronSecret()) {
    add({ id: 'cron', label: 'Scheduled jobs', status: 'fail', detail: 'CRON_SECRET is not set, so unpaid online orders are never expired and failed emails are never retried.' });
  } else {
    const stale = JOB_NAMES.filter((name) => {
      const run = jobRuns.find((r) => r.name === name);
      if (name === 'dispatch-events') return false; // only relevant when the ecosystem webhook is configured
      return !run?.lastSucceededAt || Date.now() - run.lastSucceededAt.getTime() > JOB_EXPECTED_INTERVAL_MINUTES[name] * 3 * 60_000;
    });
    add({
      id: 'cron',
      label: 'Scheduled jobs',
      status: stale.length === 0 ? 'ok' : 'warn',
      detail: stale.length === 0 ? 'The scheduler is calling the cron endpoints.' : `No recent successful run of: ${stale.join(', ')}. Check the scheduler (see docs/DEPLOYMENT.md).`,
    });
  }

  if (demo.total > 0) {
    add({
      id: 'demo',
      label: 'Demo data removed',
      status: demoModeEnabled() ? 'warn' : 'fail',
      detail: `${demo.products} demo products, ${demo.orders} orders and ${demo.users} accounts are still present. Remove them below before launch.`,
      href: '/admin/settings#demo',
    });
  } else {
    add({ id: 'demo', label: 'Demo data removed', status: 'ok', detail: 'Only your real records are in the database.' });
  }

  add({
    id: 'admins',
    label: 'Administrator accounts',
    status: demoStaff!.value > 0 ? 'fail' : adminCount!.value > 0 ? 'ok' : 'fail',
    detail:
      demoStaff!.value > 0
        ? 'Demo staff accounts exist. Remove demo data so they cannot sign in.'
        : adminCount!.value > 0
          ? `${adminCount!.value} active administrator account(s).`
          : 'No real administrator account. Create one with npm run admin:create.',
  });

  add({
    id: 'catalogue',
    label: 'Catalogue',
    status: activeProducts!.value === 0 ? 'fail' : productsWithoutImages!.value > 0 ? 'warn' : 'ok',
    detail:
      activeProducts!.value === 0
        ? 'No published products yet.'
        : productsWithoutImages!.value > 0
          ? `${productsWithoutImages!.value} published product(s) have no photo.`
          : `${activeProducts!.value} published products, all with photos.`,
    href: '/admin/products',
  });

  add({
    id: 'zones',
    label: 'Delivery zones',
    status: zones!.active > 0 && zones!.defaults > 0 ? 'ok' : 'fail',
    detail: zones!.active > 0 && zones!.defaults > 0 ? `${zones!.active} active zone(s) with a default fallback.` : 'Add at least one active delivery zone and mark one as the default.',
    href: '/admin/shipping',
  });

  let storageOk = true;
  try {
    const dir = path.resolve(uploadDir());
    await mkdir(dir, { recursive: true });
    await access(dir, constants.W_OK);
  } catch {
    storageOk = false;
  }
  add({
    id: 'storage',
    label: 'Image storage',
    status: storageOk ? 'ok' : 'fail',
    detail: storageOk ? `Uploads are written to ${path.resolve(uploadDir())} (must be a persistent volume).` : `UPLOAD_DIR (${uploadDir()}) is not writable.`,
  });

  add({
    id: 'backups',
    label: 'Backups',
    status: 'info',
    detail: 'Cannot be verified from the app. Make sure daily PostgreSQL and uploads backups run and that a restore has been tested (docs/OPERATIONS.md).',
  });

  return { checks, blocking: checks.filter((c) => c.status === 'fail').length, warnings: checks.filter((c) => c.status === 'warn').length };
}
