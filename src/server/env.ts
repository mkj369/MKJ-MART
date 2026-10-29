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

/**
 * DEMO_MODE=true marks a deliberate public demo deployment. Only then may demo data be seeded into
 * a production build and demo accounts sign in. Real stores leave it unset.
 */
export function demoModeEnabled(): boolean {
  return bool(process.env.DEMO_MODE, false);
}

/** Demo accounts may sign in during development/tests, and in production only with DEMO_MODE=true. */
export function demoLoginAllowed(): boolean {
  return !isProduction() || demoModeEnabled();
}

export function passwordResetTtlMinutes(): number {
  const value = Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? 30);
  return Number.isFinite(value) && value >= 10 && value <= 180 ? Math.round(value) : 30;
}

export type SmtpConfig = {
  host: string;
  port: number;
  /** true = implicit TLS (port 465). false = STARTTLS, which is REQUIRED unless SMTP_REQUIRE_TLS=false. */
  secure: boolean;
  requireTls: boolean;
  user: string | null;
  password: string | null;
  from: string;
  replyTo: string | null;
};

/** SMTP provider (any: Amazon SES, Mailgun, Brevo, Zoho, Google Workspace…). Null = email disabled. */
export function smtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim();
  if (!host || !from) return null;
  const secure = bool(process.env.SMTP_SECURE, false);
  const port = Number(process.env.SMTP_PORT || (secure ? 465 : 587));
  return {
    host,
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : secure ? 465 : 587,
    secure,
    requireTls: !secure && bool(process.env.SMTP_REQUIRE_TLS, true),
    user: process.env.SMTP_USER?.trim() || null,
    password: process.env.SMTP_PASSWORD || null,
    from,
    replyTo: process.env.SMTP_REPLY_TO?.trim() || null,
  };
}

export type SmsConfig =
  | {
      provider: 'twilio';
      accountSid: string;
      authToken: string;
      from: string | null;
      messagingServiceSid: string | null;
      /** Overridable only for automated tests against a local mock. */
      baseUrl: string;
    }
  | {
      provider: 'http';
      url: string;
      method: 'POST' | 'GET';
      format: 'json' | 'form';
      /** JSON object template; string values may contain {{to}}, {{to_local}}, {{message}}, {{id}}, {{api_key}}, {{sender_id}}. */
      params: Record<string, string>;
      headers: Record<string, string>;
      apiKey: string | null;
      senderId: string | null;
      /** Optional regex the response body must match for the message to count as accepted. */
      successPattern: string | null;
    };

function parseJsonObject(value: string | undefined): Record<string, string> | null {
  if (!value?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
  } catch {
    return null;
  }
}

/** SMS is OFF unless SMS_PROVIDER is set to a fully configured provider. */
export function smsConfig(): SmsConfig | null {
  const provider = process.env.SMS_PROVIDER?.trim().toLowerCase();
  if (provider === 'twilio') {
    const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
    const from = process.env.TWILIO_FROM?.trim() || null;
    const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() || null;
    if (!accountSid || !authToken || (!from && !messagingServiceSid)) return null;
    const baseUrl = (process.env.TWILIO_API_BASE_URL || 'https://api.twilio.com').replace(/\/+$/, '');
    return { provider: 'twilio', accountSid, authToken, from, messagingServiceSid, baseUrl };
  }
  if (provider === 'http') {
    const url = process.env.SMS_HTTP_URL?.trim();
    const params = parseJsonObject(process.env.SMS_HTTP_PARAMS);
    const headers = parseJsonObject(process.env.SMS_HTTP_HEADERS);
    if (!url || !/^https?:\/\//.test(url) || !params || !headers) return null;
    return {
      provider: 'http',
      url,
      method: process.env.SMS_HTTP_METHOD?.toUpperCase() === 'GET' ? 'GET' : 'POST',
      format: process.env.SMS_HTTP_FORMAT?.toLowerCase() === 'form' ? 'form' : 'json',
      params,
      headers,
      apiKey: process.env.SMS_HTTP_API_KEY?.trim() || null,
      senderId: process.env.SMS_SENDER_ID?.trim() || null,
      successPattern: process.env.SMS_HTTP_SUCCESS_PATTERN?.trim() || null,
    };
  }
  return null;
}
