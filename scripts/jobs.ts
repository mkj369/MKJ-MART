/**
 * Background jobs runnable from cron / a scheduler (alternative to the HTTP cron endpoints).
 *
 *   npm run jobs:expire-payments   # cancel unpaid online orders past their payment window
 *   npm run jobs:dispatch-events   # deliver domain events to the MKJ Ecosystem webhook
 */
import { requireDatabaseUrl } from './_env';
import { closeDb } from '@/server/db';
import { dispatchPendingEvents } from '@/server/services/events';
import { expireStalePayments } from '@/server/services/payments';

async function main() {
  requireDatabaseUrl();
  const job = process.argv[2];
  if (job === 'expire-payments') {
    console.log(`✔ Expired ${await expireStalePayments()} unpaid online order(s).`);
  } else if (job === 'dispatch-events') {
    const result = await dispatchPendingEvents();
    console.log(result.skipped ? '• ECOSYSTEM_WEBHOOK_URL not configured — nothing to do.' : `✔ Delivered ${result.delivered}, failed ${result.failed}.`);
  } else {
    console.error('Usage: tsx scripts/jobs.ts <expire-payments|dispatch-events>');
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('✖ Job failed:', err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
