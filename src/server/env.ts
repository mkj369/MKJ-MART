import 'server-only';

/**
 * Typed access to server configuration. Values are read lazily (at call time) so that builds
 * and tests do not require every variable, and secrets never reach client bundles.
 */
function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '' || value === 'auto') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export const isProduction = () => process.env.NODE_ENV === 'production';

export function appUrl(): string {
  return (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

export function cookieSecure(): boolean {
  return bool(process.env.COOKIE_SECURE, isProduction());
}

export function trustProxy(): boolean {
  return bool(process.env.TRUST_PROXY, false);
}

export function uploadDir(): string {
  return process.env.UPLOAD_DIR || './uploads';
}

export function paymentTimeoutMinutes(): number {
  const value = Number(process.env.PAYMENT_TIMEOUT_MINUTES ?? 30);
  return Number.isFinite(value) && value >= 5 && value <= 24 * 60 ? value : 30;
}

export type SslcommerzConfig = {
  storeId: string;
  storePassword: string;
  mode: 'sandbox' | 'live';
  /** Base URL of the SSLCommerz API. Overridable only for automated tests against a mock server. */
  baseUrl: string;
};

export function sslcommerzConfig(): SslcommerzConfig | null {
  const storeId = process.env.SSLCOMMERZ_STORE_ID?.trim();
  const storePassword = process.env.SSLCOMMERZ_STORE_PASSWORD?.trim();
  if (!storeId || !storePassword) return null;
  const mode = process.env.SSLCOMMERZ_MODE === 'live' ? 'live' : 'sandbox';
  const defaultBase = mode === 'live' ? 'https://securepay.sslcommerz.com' : 'https://sandbox.sslcommerz.com';
  const baseUrl = (process.env.SSLCOMMERZ_API_BASE_URL || defaultBase).replace(/\/+$/, '');
  return { storeId, storePassword, mode, baseUrl };
}

export function cronSecret(): string | null {
  const secret = process.env.CRON_SECRET?.trim();
  return secret && secret.length >= 16 ? secret : null;
}

export function ecosystemWebhook(): { url: string; secret: string } | null {
  const url = process.env.ECOSYSTEM_WEBHOOK_URL?.trim();
  const secret = process.env.ECOSYSTEM_WEBHOOK_SECRET?.trim();
  return url && secret ? { url, secret } : null;
}
