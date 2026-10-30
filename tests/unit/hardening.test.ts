import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyCallbackSignature } from '@/server/payments/sslcommerz';
import { escapeHtml, renderEmail, renderSms, type TemplateContext } from '@/server/notifications/templates';
import { interpolate, toBdInternational } from '@/server/notifications/sms';
import { __sanitizeForTests as sanitize } from '@/server/logger';
import { smsConfig, smtpConfig } from '@/server/env';
import { computeReturnEligibility } from '@/lib/returns';
import { adminPasswordProblem } from '@/lib/validation/common';

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

/** Independent implementation of the official algorithm (SSLCommerz-PHP SSLCOMMERZ_hash_verify). */
function officialSign(payload: Record<string, string>, password: string) {
  const keys = Object.keys(payload);
  const data: Record<string, string> = { ...payload, store_passwd: md5(password) };
  const hash = md5(
    Object.keys(data)
      .sort()
      .map((k) => `${k}=${data[k]}`)
      .join('&'),
  );
  return { ...payload, verify_key: keys.join(','), verify_sign: hash };
}

describe('SSLCommerz callback signature (verify_sign / verify_key)', () => {
  const payload = { tran_id: 'MKJ-261030-ABCDE-X7Y8Z9', val_id: '2610301234567abc', amount: '2570.00', status: 'VALID', currency: 'BDT', card_type: 'BKASH-BKash' };

  it('accepts a correctly signed payload', () => {
    expect(verifyCallbackSignature(officialSign(payload, 'store-secret'), 'store-secret')).toBe('valid');
  });
  it('rejects tampering, the wrong password and injected store_passwd', () => {
    const signed = officialSign(payload, 'store-secret');
    expect(verifyCallbackSignature({ ...signed, amount: '10.00' }, 'store-secret')).toBe('invalid');
    expect(verifyCallbackSignature(signed, 'other-secret')).toBe('invalid');
    // An attacker signing with their own password and smuggling store_passwd=md5(theirs) gains nothing.
    const forged = officialSign({ ...payload, amount: '10.00' }, 'attacker');
    expect(verifyCallbackSignature({ ...forged, store_passwd: md5('attacker'), verify_key: `${forged.verify_key},store_passwd` }, 'store-secret')).toBe('invalid');
  });
  it('ignores fields that are not covered by verify_key', () => {
    expect(verifyCallbackSignature({ ...officialSign(payload, 'pw'), extra_field: 'anything' }, 'pw')).toBe('valid');
  });
  it('reports unsigned payloads as missing', () => {
    expect(verifyCallbackSignature(payload, 'pw')).toBe('missing');
  });
});

const ctx: TemplateContext = {
  appUrl: 'https://shop.example.com',
  store: { storeName: 'MKJ Store', supportEmail: 'care@shop.example', supportPhone: '01700000000', address: '', legalName: '' },
};

describe('notification templates', () => {
  it('escapes HTML in every customer-controlled value', () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
    const mail = renderEmail('order_status', { name: '<img src=x onerror=alert(1)>', orderNumber: 'MKJ-1', status: 'shipped', courierName: '<b>RedX</b>', trackingNumber: '1', trackingUrl: 'https://redx.com.bd/t?a=1&b=2', orderUrl: null }, ctx);
    expect(mail.html).not.toMatch(/<img|<b>/);
    expect(mail.html).toContain('https://redx.com.bd/t?a=1&amp;b=2');
    expect(mail.subject).toBe('Order MKJ-1: Shipped');
  });
  it('uses the private guest link only from the secret payload, otherwise the tracking page', () => {
    const data = { name: 'Rahim', orderNumber: 'MKJ-2', status: 'confirmed' as const, courierName: null, trackingNumber: null, trackingUrl: null, orderUrl: null };
    expect(renderEmail('order_status', data, ctx).text).toContain('https://shop.example.com/track-order?order=MKJ-2');
    expect(renderEmail('order_status', data, ctx, { orderUrl: 'https://shop.example.com/orders/MKJ-2?token=abc' }).text).toContain('?token=abc');
  });
  it('states the reset-link lifetime and keeps SMS short, ASCII-only and free of the taka sign', () => {
    expect(renderEmail('password_reset', { name: 'Rahim', resetUrl: 'https://shop.example.com/reset-password?token=t', ttlMinutes: 30 }, ctx).text).toContain('expires in 30 minutes');
    const sms = renderSms('sms_order_status', { orderNumber: 'MKJ-261030-ABCDE', status: 'shipped', courierName: 'Steadfast Courier', trackingNumber: 'SF123456789' }, ctx);
    expect(sms).toMatch(/^[\x20-\x7E]+$/);
    expect(sms.length).toBeLessThanOrEqual(160);
    expect(renderSms('sms_order_confirmation', { orderNumber: 'MKJ-1', total: 157_000, paid: false }, ctx)).toContain('Tk 1570');
  });
  it('links staff alerts into the admin panel', () => {
    expect(renderEmail('staff_new_return', { requestNumber: 'RT-1', returnId: 'abc', orderNumber: 'MKJ-1', reason: 'Damaged' }, ctx).text).toContain('https://shop.example.com/admin/returns/abc');
  });
});

describe('SMS helpers & provider configuration', () => {
  afterEach(() => {
    for (const k of ['SMS_PROVIDER', 'SMS_HTTP_URL', 'SMS_HTTP_PARAMS', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'SMTP_HOST', 'SMTP_FROM', 'SMTP_SECURE', 'SMTP_PORT', 'SMTP_REQUIRE_TLS']) delete process.env[k];
  });
  it('formats numbers and fills templates', () => {
    expect(toBdInternational('01712345678')).toBe('8801712345678');
    expect(interpolate('{{to}}:{{message}}:{{unknown}}', { to: '880', message: 'hi' })).toBe('880:hi:{{unknown}}');
  });
  it('stays OFF unless a provider is fully configured', () => {
    expect(smsConfig()).toBeNull();
    process.env.SMS_PROVIDER = 'twilio';
    process.env.TWILIO_ACCOUNT_SID = 'AC1';
    expect(smsConfig()).toBeNull(); // no token / sender
    process.env.TWILIO_AUTH_TOKEN = 't';
    process.env.TWILIO_FROM = '+15005550006';
    expect(smsConfig()).toMatchObject({ provider: 'twilio' });
    process.env.SMS_PROVIDER = 'http';
    process.env.SMS_HTTP_URL = 'https://gateway.example/send';
    process.env.SMS_HTTP_PARAMS = '{not json';
    expect(smsConfig()).toBeNull();
    process.env.SMS_HTTP_PARAMS = '{"to":"{{to}}","text":"{{message}}"}';
    expect(smsConfig()).toMatchObject({ provider: 'http', method: 'POST', format: 'json' });
  });
  it('requires STARTTLS by default and implicit TLS on 465', () => {
    expect(smtpConfig()).toBeNull();
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_FROM = 'Shop <a@b.c>';
    expect(smtpConfig()).toMatchObject({ port: 587, secure: false, requireTls: true });
    process.env.SMTP_SECURE = 'true';
    expect(smtpConfig()).toMatchObject({ port: 465, secure: true, requireTls: false });
  });
});

describe('structured logging', () => {
  it('redacts secrets at any depth and summarises errors', () => {
    const clean = sanitize({ user: 'a', password: 'p', nested: { authorization: 'Bearer x', apiKey: 'k', ok: 1 }, list: [{ token: 't' }], error: new Error('boom') }) as Record<string, unknown>;
    expect(clean).toMatchObject({ user: 'a', password: '[redacted]', nested: { authorization: '[redacted]', apiKey: '[redacted]', ok: 1 }, list: [{ token: '[redacted]' }] });
    expect(clean.error).toMatchObject({ name: 'Error', message: 'boom' });
  });
});

describe('return eligibility', () => {
  const base = {
    status: 'delivered',
    deliveredAt: new Date('2026-10-01T10:00:00Z'),
    items: [{ id: 'a', quantity: 2 }, { id: 'b', quantity: 1 }],
    returns: [] as Parameters<typeof computeReturnEligibility>[0]['returns'],
    settings: { enabled: true, windowDays: 7 },
    now: new Date('2026-10-05T10:00:00Z'),
  };
  it('allows returns inside the window and tracks remaining quantities', () => {
    const r = computeReturnEligibility({ ...base, returns: [{ status: 'refunded', items: [{ orderItemId: 'a', quantity: 1 }] }, { status: 'rejected', items: [{ orderItemId: 'b', quantity: 1 }] }] });
    expect(r).toMatchObject({ eligible: true, remaining: { a: 1, b: 1 } });
    expect(r.deadline?.toISOString()).toBe('2026-10-08T10:00:00.000Z');
  });
  it('denies outside the window, when disabled, with an open request, when nothing is left, or before delivery', () => {
    expect(computeReturnEligibility({ ...base, now: new Date('2026-10-09T10:00:00Z') }).eligible).toBe(false);
    expect(computeReturnEligibility({ ...base, settings: { enabled: false, windowDays: 7 } }).eligible).toBe(false);
    expect(computeReturnEligibility({ ...base, returns: [{ status: 'requested', items: [{ orderItemId: 'a', quantity: 1 }] }] }).eligible).toBe(false);
    expect(computeReturnEligibility({ ...base, returns: [{ status: 'received', items: [{ orderItemId: 'a', quantity: 2 }, { orderItemId: 'b', quantity: 1 }] }] }).eligible).toBe(false);
    expect(computeReturnEligibility({ ...base, status: 'shipped', deliveredAt: null })).toMatchObject({ eligible: false, reason: null });
  });
});

describe('administrator password policy', () => {
  it('requires 12+ characters with letters and digits, not based on the email', () => {
    expect(adminPasswordProblem('Short1')).toMatch(/12/);
    expect(adminPasswordProblem('onlyletterslong')).toMatch(/letter and one number/);
    expect(adminPasswordProblem('owner2026secure', 'owner@shop.com')).toMatch(/email/);
    expect(adminPasswordProblem('password12345')).toMatch(/predictable/);
    expect(adminPasswordProblem('river-Tiger-42-lamp')).toBeNull();
  });
});
