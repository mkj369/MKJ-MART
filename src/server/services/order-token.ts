import 'server-only';
import { createHmac } from 'node:crypto';

/**
 * Guest order access token, derived from the client's idempotency key (known only to the browser
 * that placed the order). Deterministic, so duplicate submissions, payment callbacks and order
 * emails can re-issue the same private link without storing the token itself.
 */
export function deriveOrderAccessToken(idempotencyKey: string, orderNumber: string): string {
  return createHmac('sha256', idempotencyKey).update(`order-access:${orderNumber}`).digest('base64url');
}
