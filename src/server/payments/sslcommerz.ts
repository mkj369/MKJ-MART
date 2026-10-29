import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { SslcommerzConfig } from '@/server/env';
import { poishaToDecimalString } from '@/lib/money';

/** SSLCommerz accepts 10.00–500000.00 BDT per transaction (developer.sslcommerz.com/doc/v4). */
export const SSLC_MIN_AMOUNT = 1_000;
export const SSLC_MAX_AMOUNT = 50_000_000;

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
 *  5. Callbacks carry verify_sign/verify_key; verifyCallbackSignature() implements the official
 *     check (github.com/sslcommerz/SSLCommerz-PHP → SSLCOMMERZ_hash_verify). Failure notices are only
 *     acted on when signed; unsigned ones are reconciled with queryTransactionsByTranId().
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

/** Safe description of a network failure: error name + low-level code, never the request URL. */
function networkErrorLabel(error: unknown): string {
  if (!(error instanceof Error)) return 'network error';
  const cause = (error as Error & { cause?: { code?: unknown } }).cause;
  const code = cause && typeof cause.code === 'string' ? cause.code : null;
  return code ? `${error.name} (${code})` : error.name;
}

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
    throw new SslcommerzError(`Gateway unreachable: ${networkErrorLabel(error)}`);
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
  url.searchParams.set('v', '1');
  url.searchParams.set('format', 'json');
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    // Never include the URL: it carries the store password.
    throw new SslcommerzError(`Validation API unreachable: ${networkErrorLabel(error)}`);
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

const md5 = (value: string) => createHash('md5').update(value, 'utf8').digest('hex');

/**
 * Official SSLCommerz callback signature check: take the fields listed in `verify_key`, add
 * `store_passwd = md5(store password)`, sort by key, join as `k=v&…` and compare md5 with `verify_sign`.
 */
export function verifyCallbackSignature(payload: Record<string, string>, storePassword: string): 'valid' | 'invalid' | 'missing' {
  const sign = payload.verify_sign?.trim().toLowerCase();
  const keyList = payload.verify_key?.trim();
  if (!sign || !keyList) return 'missing';
  const data: Record<string, string> = {};
  for (const key of keyList.split(',').map((k) => k.trim()).filter(Boolean)) {
    if (key in payload && key !== 'store_passwd') data[key] = payload[key]!;
  }
  data.store_passwd = md5(storePassword);
  const hashString = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join('&');
  const expected = Buffer.from(md5(hashString), 'utf8');
  const provided = Buffer.from(sign, 'utf8');
  return expected.length === provided.length && timingSafeEqual(expected, provided) ? 'valid' : 'invalid';
}

export type SslcTransactionQuery = { apiConnect: string; elements: SslcValidation[] };

/**
 * Transaction Query API (by tran_id): server-to-server status of every attempt for one of OUR
 * transaction ids. Used to reconcile payments whose IPN was missed before an order is expired.
 */
export async function queryTransactionsByTranId(config: SslcommerzConfig, tranId: string): Promise<SslcTransactionQuery> {
  const url = new URL(`${config.baseUrl}/validator/api/merchantTransIDvalidationAPI.php`);
  url.searchParams.set('tran_id', tranId);
  url.searchParams.set('store_id', config.storeId);
  url.searchParams.set('store_passwd', config.storePassword);
  url.searchParams.set('v', '1');
  url.searchParams.set('format', 'json');
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    throw new SslcommerzError(`Transaction Query API unreachable: ${networkErrorLabel(error)}`);
  }
  const raw = (await response.json().catch(() => null)) as { APIConnect?: string; element?: unknown } | null;
  if (!response.ok || !raw) throw new SslcommerzError(`Transaction Query API HTTP ${response.status}`);
  const apiConnect = String(raw.APIConnect ?? '');
  if (apiConnect && apiConnect !== 'DONE') throw new SslcommerzError(`Transaction Query API refused the request (${apiConnect})`);
  const elements = Array.isArray(raw.element) ? (raw.element as SslcValidation[]) : [];
  return { apiConnect, elements };
}

/** Never persist credentials echoed back by the gateway. */
export function redact<T extends Record<string, unknown>>(raw: T): T {
  const copy: Record<string, unknown> = { ...raw };
  for (const key of ['store_passwd', 'store_password', 'verify_key', 'verify_sign', 'verify_sign_sha2']) {
    if (key in copy) copy[key] = '[redacted]';
  }
  return copy as T;
}
