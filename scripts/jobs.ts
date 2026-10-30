/**
 * Background jobs runnable from cron / a scheduler (alternative to the HTTP cron endpoints).
 *
 *   npm run jobs:expire-payments      # reconcile + cancel unpaid online orders past their payment window
 *   npm run jobs:send-notifications   # deliver due email/SMS notifications (retries failures)
 *   npm run jobs:dispatch-events      # deliver domain events to the MKJ Ecosystem webhook
 */
import { requireDatabaseUrl } from './_env';
import { closeDb } from '@/server/db';
import { runJob } from '@/server/jobs';
import { dispatchNotifications } from '@/server/notifications';
import { dispatchPendingEvents } from '@/server/services/events';
import { expireStalePayments } from '@/server/services/payments';

async function main() {
  requireDatabaseUrl();
  const job = process.argv[2];
  if (job === 'expire-payments') {
    const r = await runJob('expire-payments', () => expireStalePayments());
    console.log(`✔ Checked ${r.checked} stale order(s): ${r.expired} cancelled, ${r.paid} found paid, ${r.deferred} deferred.`);
  } else if (job === 'send-notifications') {
    const r = await runJob('send-notifications', () => dispatchNotifications(100));
    console.log(`✔ Notifications: ${r.sent} sent, ${r.retrying} retrying, ${r.failed} failed, ${r.skipped} skipped.`);
  } else if (job === 'dispatch-events') {
    const result = await runJob('dispatch-events', () => dispatchPendingEvents());
    console.log(result.skipped ? '• ECOSYSTEM_WEBHOOK_URL not configured — nothing to do.' : `✔ Delivered ${result.delivered}, failed ${result.failed}.`);
  } else {
    console.error('Usage: tsx scripts/jobs.ts <expire-payments|send-notifications|dispatch-events>');
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('✖ Job failed:', err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
