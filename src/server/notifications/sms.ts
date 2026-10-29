import 'server-only';
import { smsConfig, type SmsConfig } from '@/server/env';

/**
 * SMS delivery. OFF unless SMS_PROVIDER is configured:
 *  - `twilio`: Twilio Programmable Messaging REST API.
 *  - `http`:   any HTTP SMS gateway (common for Bangladeshi providers such as SSL Wireless,
 *              BulkSMSBD, Alpha SMS, MiM SMS…) described by a parameter template, e.g.
 *              SMS_HTTP_PARAMS={"api_key":"{{api_key}}","senderid":"{{sender_id}}","number":"{{to}}","message":"{{message}}"}
 * A message only counts as sent when the provider returns a success response.
 */
export class SmsNotConfiguredError extends Error {
  constructor() {
    super('SMS is not configured (SMS_PROVIDER is unset or incomplete).');
    this.name = 'SmsNotConfiguredError';
  }
}

/** 01XXXXXXXXX → 8801XXXXXXXXX (no plus), the format most Bangladeshi gateways expect. */
export function toBdInternational(localPhone: string): string {
  return `88${localPhone}`;
}

export function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) => (key in values ? values[key]! : match));
}

async function sendViaTwilio(config: Extract<SmsConfig, { provider: 'twilio' }>, to: string, text: string) {
  const body = new URLSearchParams({ To: `+${toBdInternational(to)}`, Body: text });
  if (config.messagingServiceSid) body.set('MessagingServiceSid', config.messagingServiceSid);
  else body.set('From', config.from!);
  const response = await fetch(`${config.baseUrl}/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await response.json().catch(() => null)) as { sid?: string; message?: string; code?: number } | null;
  if (!response.ok || !json?.sid) {
    throw new Error(`Twilio HTTP ${response.status}${json?.message ? `: ${json.message}` : ''}`.slice(0, 300));
  }
  return { providerMessageId: json.sid };
}

async function sendViaHttp(config: Extract<SmsConfig, { provider: 'http' }>, to: string, text: string, id: string) {
  const values: Record<string, string> = {
    to: toBdInternational(to),
    to_local: to,
    message: text,
    id: id.replace(/-/g, '').slice(0, 20),
    api_key: config.apiKey ?? '',
    sender_id: config.senderId ?? '',
  };
  const params = Object.fromEntries(Object.entries(config.params).map(([k, v]) => [k, interpolate(v, values)]));
  const headers = Object.fromEntries(Object.entries(config.headers).map(([k, v]) => [k, interpolate(v, values)]));
  let url = config.url;
  let body: string | undefined;
  if (config.method === 'GET') {
    const u = new URL(config.url);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    url = u.toString();
  } else if (config.format === 'form') {
    headers['content-type'] ??= 'application/x-www-form-urlencoded';
    body = new URLSearchParams(params).toString();
  } else {
    headers['content-type'] ??= 'application/json';
    body = JSON.stringify(params);
  }
  const response = await fetch(url, { method: config.method, headers, body, signal: AbortSignal.timeout(15_000) });
  const responseText = (await response.text().catch(() => '')).slice(0, 2000);
  if (!response.ok) throw new Error(`SMS gateway HTTP ${response.status}: ${responseText.slice(0, 200)}`);
  if (config.successPattern && !new RegExp(config.successPattern).test(responseText)) {
    throw new Error(`SMS gateway did not confirm the message: ${responseText.slice(0, 200)}`);
  }
  return { providerMessageId: responseText.slice(0, 200) || `http-${response.status}` };
}

export async function sendSms(to: string, text: string, id: string): Promise<{ providerMessageId: string }> {
  const config = smsConfig();
  if (!config) throw new SmsNotConfiguredError();
  if (!/^01[3-9]\d{8}$/.test(to)) throw new Error('Not a valid Bangladeshi mobile number.');
  return config.provider === 'twilio' ? sendViaTwilio(config, to, text) : sendViaHttp(config, to, text, id);
}
