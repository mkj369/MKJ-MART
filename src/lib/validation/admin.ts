import { z } from 'zod';
import { isValidDistrict } from '@/lib/bd-geo';
import { ORDER_STATUSES } from '@/lib/order-status';
import { ROLES } from '@/lib/permissions';
import { imageUrlSchema, optionalPhoneSchema, uuidSchema } from './common';

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(140)
  .optional()
  .transform((v, ctx) => {
    if (!v) return undefined;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)) {
      ctx.addIssue({ code: 'custom', message: 'Use lowercase letters, numbers and single hyphens.' });
      return z.NEVER;
    }
    return v;
  });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .nullish()
    .transform((v) => (v ? v : null));

const money = (label: string) =>
  z
    .number({ error: `${label} is required.` })
    .int(`${label} must be a whole number of poisha.`)
    .min(0, `${label} cannot be negative.`)
    .max(1_000_000_000, `${label} is too large.`);

// ─── Catalogue ────────────────────────────────────────────────────────────────

export const productVariantInputSchema = z.object({
  id: uuidSchema.optional(),
  sku: z
    .string({ error: 'SKU is required.' })
    .trim()
    .toUpperCase()
    .min(2, 'SKU is required.')
    .max(64)
    .regex(/^[A-Z0-9._-]+$/, 'SKUs may contain letters, numbers, dot, dash and underscore.'),
  sizeId: uuidSchema.nullable(),
  colorId: uuidSchema.nullable(),
  stock: z.number().int('Stock must be a whole number.').min(0, 'Stock cannot be negative.').max(1_000_000),
  /**
   * Stock value the editor originally loaded. When present the server applies only the difference
   * (stock - stockBaseline), so sales made while the form was open are not overwritten.
   */
  stockBaseline: z.number().int().min(0).optional(),
  isActive: z.boolean().optional().default(true),
});

export const productImageInputSchema = z.object({
  id: uuidSchema.optional(),
  url: imageUrlSchema,
  alt: z.string().trim().max(200).optional().default(''),
  colorId: uuidSchema.nullish().transform((v) => v ?? null),
});

export const productInputSchema = z
  .object({
    name: z.string({ error: 'Name is required.' }).trim().min(2, 'Name is required.').max(200),
    slug: slugSchema,
    description: z.string().trim().max(5000).optional().default(''),
    material: optionalText(200),
    careInstructions: optionalText(2000),
    categoryId: uuidSchema.nullable(),
    price: money('Price'),
    compareAtPrice: money('Compare-at price').nullish().transform((v) => v ?? null),
    status: z.enum(['draft', 'active', 'archived']),
    isFeatured: z.boolean().optional().default(false),
    tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(20).optional().default([]),
    collectionIds: z.array(uuidSchema).max(20).optional().default([]),
    images: z.array(productImageInputSchema).max(12, 'Up to 12 images per product.').optional().default([]),
    variants: z.array(productVariantInputSchema).min(1, 'Add at least one variant.').max(200),
  })
  .superRefine((value, ctx) => {
    if (value.compareAtPrice !== null && value.compareAtPrice <= value.price) {
      ctx.addIssue({
        code: 'custom',
        path: ['compareAtPrice'],
        message: 'Compare-at price must be higher than the selling price.',
      });
    }
    if (value.status === 'active' && value.images.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['images'], message: 'Add at least one image before publishing.' });
    }
    const skus = new Map<string, number>();
    const combos = new Map<string, number>();
    value.variants.forEach((variant, index) => {
      if (skus.has(variant.sku)) {
        ctx.addIssue({ code: 'custom', path: ['variants', index, 'sku'], message: 'Duplicate SKU.' });
      }
      skus.set(variant.sku, index);
      const combo = `${variant.sizeId ?? '-'}|${variant.colorId ?? '-'}`;
      if (combos.has(combo)) {
        ctx.addIssue({
          code: 'custom',
          path: ['variants', index, 'sizeId'],
          message: 'Duplicate size/colour combination.',
        });
      }
      combos.set(combo, index);
    });
  });
export type ProductInput = z.infer<typeof productInputSchema>;

export const categoryInputSchema = z.object({
  name: z.string({ error: 'Name is required.' }).trim().min(2, 'Name is required.').max(120),
  slug: slugSchema,
  description: optionalText(1000),
  imageUrl: imageUrlSchema.nullish().transform((v) => v ?? null),
  parentId: uuidSchema.nullish().transform((v) => v ?? null),
  sortOrder: z.number().int().min(0).max(10_000).optional().default(0),
  isActive: z.boolean().optional().default(true),
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;

export const collectionInputSchema = z.object({
  name: z.string({ error: 'Name is required.' }).trim().min(2, 'Name is required.').max(120),
  slug: slugSchema,
  description: optionalText(1000),
  imageUrl: imageUrlSchema.nullish().transform((v) => v ?? null),
  isFeatured: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).max(10_000).optional().default(0),
});
export type CollectionInput = z.infer<typeof collectionInputSchema>;

export const sizeInputSchema = z.object({
  label: z.string({ error: 'Label is required.' }).trim().min(1, 'Label is required.').max(20),
  sortOrder: z.number().int().min(0).max(10_000).optional().default(0),
});

export const colorInputSchema = z.object({
  name: z.string({ error: 'Name is required.' }).trim().min(1, 'Name is required.').max(40),
  hex: z
    .string()
    .trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Use a hex colour like #1A1A1A.')
    .transform((v) => v.toUpperCase()),
});

// ─── Inventory & orders ───────────────────────────────────────────────────────

export const stockAdjustmentSchema = z.object({
  variantId: uuidSchema,
  mode: z.enum(['delta', 'set']),
  value: z.number().int().min(-1_000_000).max(1_000_000),
  reason: z.enum(['restock', 'adjustment', 'return', 'correction']),
  note: optionalText(300),
});
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;

export const orderStatusUpdateSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: optionalText(500),
  courierName: optionalText(80),
  trackingNumber: optionalText(80),
});
export type OrderStatusUpdateInput = z.infer<typeof orderStatusUpdateSchema>;

export const orderPaymentUpdateSchema = z.object({
  action: z.enum(['mark_paid', 'mark_refunded']),
  note: optionalText(300),
});

export const orderNoteSchema = z.object({ adminNote: optionalText(2000) });

export const orderListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum([...ORDER_STATUSES, 'all']).optional().default('all'),
  payment: z.enum(['all', 'unpaid', 'pending', 'paid', 'failed', 'cancelled', 'refunded']).optional().default('all'),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
});

// ─── Customers ────────────────────────────────────────────────────────────────

export const customerUpdateSchema = z
  .object({
    status: z.enum(['active', 'blocked']).optional(),
    role: z.enum(ROLES).optional(),
  })
  .refine((v) => v.status !== undefined || v.role !== undefined, 'Nothing to update.');

// ─── Coupons ──────────────────────────────────────────────────────────────────

const optionalDate = z
  .union([z.string(), z.date(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === '') return null;
    const date = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid date.' });
      return z.NEVER;
    }
    return date;
  });

const optionalPositiveInt = z
  .number()
  .int()
  .positive()
  .nullish()
  .transform((v) => v ?? null);

export const couponInputSchema = z
  .object({
    code: z
      .string({ error: 'Code is required.' })
      .trim()
      .toUpperCase()
      .min(3, 'Use at least 3 characters.')
      .max(40)
      .regex(/^[A-Z0-9_-]+$/, 'Use letters, numbers, dash or underscore.'),
    description: optionalText(200),
    type: z.enum(['percentage', 'fixed']),
    value: z.number({ error: 'Value is required.' }).int().positive('Value must be greater than zero.'),
    minOrderAmount: money('Minimum order').optional().default(0),
    maxDiscountAmount: optionalPositiveInt,
    startsAt: optionalDate,
    endsAt: optionalDate,
    usageLimit: optionalPositiveInt,
    usageLimitPerCustomer: optionalPositiveInt,
    isActive: z.boolean().optional().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'percentage' && value.value > 100) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'A percentage cannot exceed 100.' });
    }
    if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'End date must be after the start date.' });
    }
  });
export type CouponInput = z.infer<typeof couponInputSchema>;

// ─── Shipping & settings ──────────────────────────────────────────────────────

export const shippingZoneInputSchema = z.object({
  name: z.string({ error: 'Name is required.' }).trim().min(2, 'Name is required.').max(80),
  fee: money('Delivery fee'),
  estimatedDays: z.string().trim().min(1, 'Add a delivery estimate, e.g. "1–2 days".').max(40),
  districts: z
    .array(z.string().refine(isValidDistrict, 'Unknown district.'))
    .max(64)
    .optional()
    .default([])
    .transform((list) => Array.from(new Set(list)).sort()),
  isDefault: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).max(10_000).optional().default(0),
});
export type ShippingZoneInput = z.infer<typeof shippingZoneInputSchema>;

export const storeSettingsSchema = z.object({
  storeName: z.string().trim().min(2).max(80),
  tagline: z.string().trim().max(160),
  supportEmail: z.union([z.literal(''), z.email({ error: 'Enter a valid email.' })]),
  supportPhone: optionalPhoneSchema.transform((v) => v ?? ''),
  address: z.string().trim().max(300),
  facebookUrl: z.union([z.literal(''), z.url({ protocol: /^https$/, error: 'Use an https:// link.' })]),
  instagramUrl: z.union([z.literal(''), z.url({ protocol: /^https$/, error: 'Use an https:// link.' })]),
});

export const checkoutSettingsSchema = z.object({
  codEnabled: z.boolean(),
  codMaxOrderAmount: optionalPositiveInt,
  onlinePaymentEnabled: z.boolean(),
  guestCheckoutEnabled: z.boolean(),
  freeShippingThreshold: optionalPositiveInt,
  maxQuantityPerItem: z.number().int().min(1).max(50),
  lowStockThreshold: z.number().int().min(0).max(1000),
});

export const policySettingsSchema = z.object({
  shipping: z.string().max(20_000),
  returns: z.string().max(20_000),
  privacy: z.string().max(20_000),
  terms: z.string().max(20_000),
});

export const announcementSettingsSchema = z.object({
  enabled: z.boolean(),
  message: z.string().trim().max(160),
});

export const SETTINGS_SCHEMAS = {
  store: storeSettingsSchema,
  checkout: checkoutSettingsSchema,
  policies: policySettingsSchema,
  announcement: announcementSettingsSchema,
} as const;
export type SettingsKey = keyof typeof SETTINGS_SCHEMAS;
export type SettingsMap = { [K in SettingsKey]: z.output<(typeof SETTINGS_SCHEMAS)[K]> };
