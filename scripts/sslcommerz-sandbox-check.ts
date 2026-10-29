/**
 * SSLCommerz sandbox connectivity & credentials check (run on the server that will host the shop).
 *
 *   npm run payments:sandbox-check
 *
 * Needs SSLCOMMERZ_STORE_ID / SSLCOMMERZ_STORE_PASSWORD (sandbox) and APP_URL in the environment.
 * It talks to the REAL sandbox API (no money moves) and:
 *   1. checks TLS 1.2+ connectivity to sandbox.sslcommerz.com
 *   2. creates a ৳10 test session (proves the store id/password and callback URLs are accepted)
 *   3. calls the Transaction Query API for that tran_id (proves query credentials work)
 *   4. calls the Validation API with an invalid val_id (must answer INVALID_TRANSACTION)
 * Then it prints the manual end-to-end checklist from docs/SSLCOMMERZ.md. Refuses live mode unless
 * --live is passed (live sessions are real payment pages).
 */
import { hasFlag } from './_env';
import { randomBytes } from 'node:crypto';
import { appUrl, sslcommerzConfig } from '@/server/env';
import { initiateSession, queryTransactionsByTranId, SslcommerzError, validatePayment } from '@/server/payments/sslcommerz';

const results: { step: string; ok: boolean; detail: string }[] = [];
const record = (step: string, ok: boolean, detail: string) => {
  results.push({ step, ok, detail });
  console.log(`${ok ? '✔' : '✖'} ${step} — ${detail}`);
};

async function main() {
  const config = sslcommerzConfig();
  if (!config) {
    console.error('✖ SSLCOMMERZ_STORE_ID and SSLCOMMERZ_STORE_PASSWORD are not set. Get sandbox credentials at https://developer.sslcommerz.com/registration/');
    process.exit(1);
  }
  if (config.mode === 'live' && !hasFlag('live')) {
    console.error('✖ SSLCOMMERZ_MODE=live. This check is meant for the sandbox; pass --live only if you understand it opens a real payment session.');
    process.exit(1);
  }
  const base = appUrl();
  console.log(`→ SSLCommerz ${config.mode} · store ${config.storeId} · callbacks at ${base}/api/payments/sslcommerz/*`);
  if (!base.startsWith('https://')) console.log('⚠ APP_URL is not https:// — SSLCommerz requires reachable HTTPS callback URLs for a full test.');

  // 1. TLS
  try {
    const res = await fetch(`${config.baseUrl}/public/tls/`, { signal: AbortSignal.timeout(15_000) });
    const text = (await res.text()).trim();
    record('TLS connectivity', res.ok, `${res.status} ${text.slice(0, 60)}`);
  } catch (error) {
    record('TLS connectivity', false, `cannot reach ${config.baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 2. Session
  const tranId = `MKJ-SBX-${randomBytes(4).toString('hex').toUpperCase()}`;
  try {
    const session = await initiateSession(config, {
      tranId,
      amount: 1_000,
      orderNumber: tranId,
      callbackBaseUrl: base,
      customer: { name: 'Sandbox Tester', email: 'sandbox@example.com', phone: '01700000000', addressLine: 'Test address', area: 'Gulshan', district: 'Dhaka', division: 'Dhaka', postalCode: '1212' },
      productSummary: 'Sandbox connectivity check',
      itemCount: 1,
    });
    record('Create session (৳10)', true, `tran_id ${tranId}`);
    console.log(`\n  Open this sandbox payment page to complete a test payment manually:\n  ${session.gatewayUrl}\n`);
  } catch (error) {
    const detail = error instanceof SslcommerzError ? `${error.message}${error.raw ? ` ${JSON.stringify(error.raw).slice(0, 200)}` : ''}` : String(error);
    record('Create session (৳10)', false, detail);
  }

  // 3. Transaction Query API
  try {
    const query = await queryTransactionsByTranId(config, tranId);
    record('Transaction Query API', true, `APIConnect=${query.apiConnect || 'n/a'} · ${query.elements.length} attempt(s) so far`);
  } catch (error) {
    record('Transaction Query API', false, error instanceof Error ? error.message : String(error));
  }

  // 4. Validation API
  try {
    const validation = await validatePayment(config, `INVALID-${randomBytes(6).toString('hex')}`);
    record('Validation API', validation.status === 'INVALID_TRANSACTION', `status=${validation.status ?? 'unknown'} (expected INVALID_TRANSACTION)`);
  } catch (error) {
    record('Validation API', false, error instanceof Error ? error.message : String(error));
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${failed === 0 ? '✔ Automated checks passed.' : `✖ ${failed} automated check(s) failed.`} Now complete the MANUAL checklist in docs/SSLCOMMERZ.md:`);
  console.log(`  [ ] IPN URL set in the merchant panel: ${base}/api/payments/sslcommerz/ipn`);
  console.log('  [ ] Successful card payment (4111 1111 1111 1111, any future expiry, CVV 111, OTP 111111) → order shows "Paid"');
  console.log('  [ ] Successful mobile-banking payment (sandbox bKash/Nagad flow) → order shows "Paid"');
  console.log('  [ ] Failed payment → order stays reserved, "Pay now" retry works');
  console.log('  [ ] Cancelled payment → order stays reserved; cancelling the order releases stock');
  console.log('  [ ] Close the gateway tab mid-payment → order expires after PAYMENT_TIMEOUT_MINUTES (cron) and stock returns');
  console.log('  [ ] Admin → order → "Check payment with gateway" reports the same result as the merchant panel');
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('✖ Check failed:', error);
  process.exit(1);
});
