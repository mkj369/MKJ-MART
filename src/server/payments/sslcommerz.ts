import 'server-only';
import type { SslcommerzConfig } from '@/server/env';
import { poishaToDecimalString } from '@/lib/money';

/**
 * Minimal, dependency-free SSLCommerz v4 client.
 * Docs: https://developer.sslcommerz.com/doc/v4/
 *
 * Flow:
 *  1. initiateSession()  → POST /gwprocess/v4/api.php → redirect customer to GatewayPageURL
 *  2. Customer pays with bKash / Nagad / Rocket / card / net banking on SSLCommerz
 *  3. SSLCommerz POSTs to our success/fail/cancel URLs (browser) and to the IPN URL (server-to-server)
 *  4. validatePayment(val_id) → GET /validator/api/validationserverAPI.php — the ONLY source of truth.
 *     We then check tran_id, amount and currency against our own records before marking an order paid.
 */

export type SslcInitParams = {
  tranId: string;
  amount: number; // poisha
  orderNumber: string;
  callbackBaseUrl: string; // e.g. https://shop.example.com
  customer: {
    name: string;
    email: string;
    phone: string;
    addressLine: string;
    area: string;
    district: string;
    division: string;
    postalCode?: string | null;
  };
  productSummary: string;
  itemCount: number;
};

export type SslcInitResult = { sessionKey: string; gatewayUrl: string; raw: Record<string, unknown> };

export class SslcommerzError extends Error {
  constructor(
    message: string,
    readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'SslcommerzError';
  }
}

export async function initiateSession(config: SslcommerzConfig, params: SslcInitParams): Promise<SslcInitResult> {
  const base = params.callbackBaseUrl.replace(/\/+$/, '');
  const body = new URLSearchParams({
    store_id: config.storeId,
    store_passwd: config.storePassword,
    total_amount: poishaToDecimalString(params.amount),
    currency: 'BDT',
    tran_id: params.tranId,
    success_url: `${base}/api/payments/sslcommerz/success`,
    fail_url: `${base}/api/payments/sslcommerz/fail`,
    cancel_url: `${base}/api/payments/sslcommerz/cancel`,
    ipn_url: `${base}/api/payments/sslcommerz/ipn`,
    cus_name: params.customer.name,
    cus_email: params.customer.email,
    cus_phone: params.customer.phone,
    cus_add1: params.customer.addressLine.slice(0, 250),
    cus_add2: params.customer.area,
    cus_city: params.customer.district,
    cus_state: params.customer.division,
    cus_postcode: params.customer.postalCode || '1000',
    cus_country: 'Bangladesh',
    shipping_method: 'Courier',
    num_of_item: String(params.itemCount),
    ship_name: params.customer.name,
    ship_add1: params.customer.addressLine.slice(0, 250),
    ship_city: params.customer.district,
    ship_state: params.customer.division,
    ship_postcode: params.customer.postalCode || '1000',
    ship_country: 'Bangladesh',
    product_name: params.productSummary.slice(0, 250) || 'Clothing',
    product_category: 'Clothing',
    product_profile: 'physical-goods',
    value_a: params.orderNumber,
  });

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/gwprocess/v4/api.php`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new SslcommerzError(`Gateway unreachable: ${String(error)}`);
  }
  const raw = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !raw) throw new SslcommerzError(`Gateway HTTP ${response.status}`, raw);
  if (raw.status !== 'SUCCESS' || typeof raw.GatewayPageURL !== 'string' || !raw.GatewayPageURL) {
    throw new SslcommerzError(String(raw.failedreason || 'Session initiation failed'), raw);
  }
  return { sessionKey: String(raw.sessionkey ?? ''), gatewayUrl: raw.GatewayPageURL, raw: redact(raw) };
}

export type SslcValidation = {
  status?: string;
  tran_id?: string;
  val_id?: string;
  amount?: string;
  currency?: string;
  currency_type?: string;
  currency_amount?: string;
  bank_tran_id?: string;
  card_type?: string;
  risk_level?: string;
  risk_title?: string;
  [key: string]: unknown;
};

export async function validatePayment(config: SslcommerzConfig, valId: string): Promise<SslcValidation> {
  const url = new URL(`${config.baseUrl}/validator/api/validationserverAPI.php`);
  url.searchParams.set('val_id', valId);
  url.searchParams.set('store_id', config.storeId);
  url.searchParams.set('store_passwd', config.storePassword);
  url.searchParams.set('format', 'json');
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    throw new SslcommerzError(`Validation API unreachable: ${String(error)}`);
  }
  const raw = (await response.json().catch(() => null)) as SslcValidation | null;
  if (!response.ok || !raw) throw new SslcommerzError(`Validation API HTTP ${response.status}`, raw);
  return raw;
}

export type ValidationCheck =
  | { ok: true; riskLevel: number; riskTitle: string | null }
  | { ok: false; reason: string };

/** Verifies a validation response against OUR transaction record. Pure — unit tested. */
export function checkValidation(v: SslcValidation, expected: { tranId: string; amount: number }): ValidationCheck {
  if (v.status !== 'VALID' && v.status !== 'VALIDATED') {
    return { ok: false, reason: `Gateway status ${v.status ?? 'unknown'}` };
  }
  if (v.tran_id !== expected.tranId) return { ok: false, reason: 'Transaction id mismatch' };
  const currency = v.currency_type ?? v.currency;
  if (currency !== 'BDT') return { ok: false, reason: `Unexpected currency ${currency ?? 'unknown'}` };
  const paid = Math.round(Number(v.currency_amount ?? v.amount) * 100);
  if (!Number.isFinite(paid) || paid !== expected.amount) {
    return { ok: false, reason: `Amount mismatch (paid ${paid}, expected ${expected.amount})` };
  }
  return { ok: true, riskLevel: Number(v.risk_level ?? 0) || 0, riskTitle: v.risk_title ?? null };
}

/** Never persist credentials echoed back by the gateway. */
export function redact<T extends Record<string, unknown>>(raw: T): T {
  const copy: Record<string, unknown> = { ...raw };
  for (const key of ['store_passwd', 'store_password', 'verify_key', 'verify_sign', 'verify_sign_sha2']) {
    if (key in copy) copy[key] = '[redacted]';
  }
  return copy as T;
}
