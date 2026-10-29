import 'server-only';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/server/db';
import { settings } from '@/server/db/schema';
import { validationError } from '@/server/errors';
import { SETTINGS_SCHEMAS, type SettingsKey, type SettingsMap } from '@/lib/validation/admin';
import { zodFieldErrors } from '@/lib/validation/common';

/**
 * Defaults used until an administrator saves settings. Policy texts are TEMPLATES and must be
 * reviewed by the business before launch.
 */
export const DEFAULT_SETTINGS: SettingsMap = {
  // Business identity is intentionally BLANK: enter your real, verified details in Admin → Settings.
  store: {
    storeName: 'MKJ Store',
    tagline: 'Considered clothing, made in Bangladesh.',
    supportEmail: '',
    supportPhone: '',
    whatsappNumber: '',
    supportHours: '',
    address: '',
    legalName: '',
    tradeLicense: '',
    vatRegistration: '',
    facebookUrl: '',
    instagramUrl: '',
  },
  checkout: {
    codEnabled: true,
    codMaxOrderAmount: null,
    onlinePaymentEnabled: true,
    guestCheckoutEnabled: true,
    freeShippingThreshold: 500_000, // ৳5,000
    maxQuantityPerItem: 10,
    lowStockThreshold: 5,
  },
  announcement: {
    enabled: true,
    message: 'Cash on Delivery across all 64 districts · Free delivery on orders over ৳5,000',
  },
  policies: {
    shipping: [
      '## Delivery areas & charges',
      'We deliver to all 64 districts of Bangladesh. Delivery charges are calculated at checkout based on your district and shown before you place your order.',
      '## Delivery times',
      '- Dhaka city: 1–2 working days',
      '- Dhaka suburbs: 2–3 working days',
      '- Rest of Bangladesh: 3–5 working days',
      'Delivery times may be longer during Eid, national holidays or severe weather.',
      '## Cash on Delivery',
      'Pay in cash when your parcel arrives. Please keep the exact amount ready and check the parcel in front of the delivery person.',
    ].join('\n\n'),
    returns: [
      '## 7-day returns & exchanges',
      'Unworn items with original tags and packaging can be returned or exchanged within 7 days of delivery.',
      '## How to return',
      '- Contact customer care with your order number.',
      '- We arrange a pickup or share the drop-off address.',
      '- Refunds are issued to your original payment method, or via bKash/Nagad for Cash on Delivery orders, within 7 working days after inspection.',
      '## Non-returnable items',
      'Altered garments, items marked final sale and innerwear cannot be returned for hygiene reasons.',
    ].join('\n\n'),
    privacy: [
      '## What we collect',
      'Your name, contact details and delivery address — only what is needed to process and deliver your orders.',
      '## How we use it',
      'To fulfil orders, provide customer support and, with your consent, share updates. We never sell your personal data.',
      '## Payments',
      'Online payments are processed by our licensed payment gateway. We never see or store your card, bKash or Nagad credentials.',
    ].join('\n\n'),
    terms: [
      '## Orders',
      'An order is confirmed once we verify it by phone or once online payment is received. We may cancel orders with incorrect details or suspected misuse.',
      '## Pricing',
      'All prices are in Bangladeshi Taka (৳) and include applicable VAT. Prices are verified when you place your order.',
      '## Contact',
      'Questions about these terms? Contact our customer care team.',
    ].join('\n\n'),
    reviewed: { shipping: false, returns: false, privacy: false, terms: false },
  },
  returns: {
    enabled: true,
    windowDays: 7,
    instructions:
      'Pack the items with their original tags and packaging. We will contact you to arrange a pickup or share the drop-off address. Refunds are issued after the items pass inspection.',
  },
  notifications: {
    emailWelcome: true,
    emailOrderUpdates: true,
    emailReturnUpdates: true,
    smsOrderUpdates: true,
    staffEmail: '',
    staffNewOrder: true,
    staffNewReturn: true,
    staffNewSupport: true,
  },
  support: {
    contactFormEnabled: true,
    responseTime: 'within one working day',
    faq: [
      '## How long does delivery take?',
      'Delivery times depend on your district and are shown at checkout before you pay. Delays can happen during Eid and national holidays.',
      '## Can I pay with Cash on Delivery?',
      'Yes, where Cash on Delivery is available it is offered at checkout. Please keep the exact amount ready.',
      '## How do I track my order?',
      'Use Track order with your order number and the phone number used at checkout, or open the order from your account.',
      '## How do returns work?',
      'Delivered orders can be returned within the return window shown in our Returns policy. Request a return from your order page and we will guide you through the next steps.',
      '## Is online payment secure?',
      'Online payments are processed by our licensed payment gateway. We never see or store your card, bKash or Nagad credentials.',
    ].join('\n\n'),
  },
};

const CACHE_TTL_MS = 5_000;
const cache = new Map<SettingsKey, { value: unknown; expires: number }>();

function merge<K extends SettingsKey>(key: K, stored: unknown): SettingsMap[K] {
  const defaults = DEFAULT_SETTINGS[key];
  const candidate = { ...defaults, ...(typeof stored === 'object' && stored ? stored : {}) };
  const parsed = SETTINGS_SCHEMAS[key].safeParse(candidate);
  return (parsed.success ? parsed.data : defaults) as SettingsMap[K];
}

export async function getSetting<K extends SettingsKey>(key: K): Promise<SettingsMap[K]> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as SettingsMap[K];
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  const value = merge(key, row?.value);
  cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function getSettings<K extends SettingsKey>(keys: K[]): Promise<Pick<SettingsMap, K>> {
  const rows = await db.select().from(settings).where(inArray(settings.key, keys));
  const out = {} as Pick<SettingsMap, K>;
  for (const key of keys) {
    out[key] = merge(key, rows.find((r) => r.key === key)?.value) as SettingsMap[K];
  }
  return out;
}

export async function updateSetting<K extends SettingsKey>(key: K, input: unknown): Promise<SettingsMap[K]> {
  const parsed = SETTINGS_SCHEMAS[key].safeParse(input);
  if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
  await db
    .insert(settings)
    .values({ key, value: parsed.data })
    .onConflictDoUpdate({ target: settings.key, set: { value: parsed.data, updatedAt: new Date() } });
  cache.delete(key);
  return parsed.data as SettingsMap[K];
}

export function clearSettingsCache() {
  cache.clear();
}
