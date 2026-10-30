import { z } from 'zod';
import { PAYMENT_METHODS } from '@/lib/order-status';
import { RETURN_REASONS } from '@/lib/returns';
import {
  addressFieldsSchema,
  emailSchema,
  optionalEmailSchema,
  optionalPhoneSchema,
  passwordSchema,
  personNameSchema,
  phoneSchema,
  refineDistrict,
  uuidSchema,
} from './common';

// ─── Authentication & account ─────────────────────────────────────────────────

export const registerSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  phone: optionalPhoneSchema,
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ error: 'Password is required.' }).min(1, 'Password is required.').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const profileSchema = z.object({
  name: personNameSchema,
  phone: optionalPhoneSchema,
});
export type ProfileInput = z.infer<typeof profileSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.').max(128),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'Choose a password different from the current one.',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string({ error: 'This reset link is invalid.' }).trim().min(20, 'This reset link is invalid.').max(200, 'This reset link is invalid.'),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const addressSchema = addressFieldsSchema
  .extend({
    label: z.string().trim().max(40, 'Label is too long.').optional().default('Home'),
    recipientName: personNameSchema,
    phone: phoneSchema,
    isDefault: z.boolean().optional().default(false),
  })
  .superRefine(refineDistrict);
export type AddressInput = z.infer<typeof addressSchema>;

// ─── Cart ─────────────────────────────────────────────────────────────────────

export const addToCartSchema = z.object({
  variantId: uuidSchema,
  quantity: z.number().int().min(1).max(50).optional().default(1),
});

export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(0).max(50),
});

// ─── Checkout ─────────────────────────────────────────────────────────────────

export const couponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .max(40)
  .optional()
  .transform((v) => (v ? v : undefined));

export const quoteSchema = z.object({
  district: z.string().trim().max(60).optional(),
  couponCode: couponCodeSchema,
  phone: z.string().trim().max(20).optional(),
});
export type QuoteInput = z.infer<typeof quoteSchema>;

export const checkoutSchema = z.object({
  idempotencyKey: z
    .string()
    .min(16)
    .max(80)
    .regex(/^[A-Za-z0-9_-]+$/, 'Invalid request key.'),
  contact: z.object({
    name: personNameSchema,
    phone: phoneSchema,
    email: optionalEmailSchema,
  }),
  address: addressFieldsSchema.superRefine(refineDistrict),
  saveAddress: z.boolean().optional().default(false),
  paymentMethod: z.enum(PAYMENT_METHODS, { error: 'Choose a payment method.' }),
  couponCode: couponCodeSchema,
  note: z
    .string()
    .trim()
    .max(500, 'Keep delivery notes under 500 characters.')
    .optional()
    .transform((v) => (v ? v : undefined)),
  /** Total the customer saw (poisha). If prices changed meanwhile, the order is rejected for review. */
  expectedTotal: z.number().int().nonnegative().optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

// ─── Order tracking ───────────────────────────────────────────────────────────

export const trackOrderSchema = z.object({
  orderNumber: z
    .string({ error: 'Enter your order number.' })
    .trim()
    .toUpperCase()
    .min(6, 'Enter your order number.')
    .max(32),
  phone: phoneSchema,
});

// ─── Returns ──────────────────────────────────────────────────────────────────

export const returnRequestSchema = z.object({
  items: z
    .array(z.object({ orderItemId: uuidSchema, quantity: z.number().int().min(1).max(50) }), { error: 'Choose at least one item.' })
    .min(1, 'Choose at least one item to return.')
    .max(50),
  reason: z.enum(RETURN_REASONS, { error: 'Tell us why you are returning the items.' }),
  note: z.string().trim().max(1000, 'Keep the note under 1,000 characters.').nullish().transform((v) => v || null),
  /** Guest access token (order link) when not signed in. */
  token: z.string().max(200).optional(),
});
export type ReturnRequestInput = z.infer<typeof returnRequestSchema>;

// ─── Customer support ─────────────────────────────────────────────────────────

export const SUPPORT_TOPICS = ['order', 'delivery', 'return', 'payment', 'product', 'other'] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];
export const SUPPORT_TOPIC_LABEL: Record<SupportTopic, string> = {
  order: 'An existing order',
  delivery: 'Delivery',
  return: 'Returns & exchanges',
  payment: 'Payment or refund',
  product: 'Product, size or stock question',
  other: 'Something else',
};

export const supportRequestSchema = z
  .object({
    name: personNameSchema,
    email: optionalEmailSchema,
    phone: optionalPhoneSchema,
    orderNumber: z
      .string()
      .trim()
      .toUpperCase()
      .max(32)
      .nullish()
      .transform((v) => v || null)
      .refine((v) => v === null || /^[A-Z0-9-]{6,32}$/.test(v), 'Check the order number.'),
    topic: z.enum(SUPPORT_TOPICS, { error: 'Choose a topic.' }),
    message: z.string({ error: 'Write your message.' }).trim().min(10, 'Please add a little more detail (10+ characters).').max(4000, 'Keep the message under 4,000 characters.'),
    /** Honeypot: real visitors never see or fill this field. */
    website: z.string().max(200).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.email && !v.phone) ctx.addIssue({ code: 'custom', path: ['email'], message: 'Give us an email or phone number so we can reply.' });
  });
export type SupportRequestInput = z.infer<typeof supportRequestSchema>;

// ─── Catalogue query (URL search params) ──────────────────────────────────────

export const PRODUCT_SORTS = ['featured', 'newest', 'price-asc', 'price-desc', 'bestselling'] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export const PRODUCT_SORT_LABEL: Record<ProductSort, string> = {
  featured: 'Featured',
  newest: 'Newest',
  'price-asc': 'Price: low to high',
  'price-desc': 'Price: high to low',
  bestselling: 'Bestselling',
};

const multiValue = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) =>
    (Array.isArray(v) ? v : v ? v.split(',') : [])
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20),
  );

const flag = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => {
    const value = Array.isArray(v) ? v[0] : v;
    return value === '1' || value === 'true';
  });

const optionalInt = (max: number) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => {
      const value = Array.isArray(v) ? v[0] : v;
      if (!value) return undefined;
      const n = Number(value);
      return Number.isInteger(n) && n >= 0 && n <= max ? n : undefined;
    });

const single = (max: number) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => {
      const value = (Array.isArray(v) ? v[0] : v)?.trim();
      return value ? value.slice(0, max) : undefined;
    });

export const productQuerySchema = z.object({
  q: single(100),
  category: single(140),
  collection: single(140),
  size: multiValue,
  color: multiValue,
  /** Whole taka (user-facing URLs); converted to poisha in the catalogue service. */
  minPrice: optionalInt(10_000_000),
  maxPrice: optionalInt(10_000_000),
  inStock: flag,
  onSale: flag,
  sort: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v): ProductSort => {
      const value = Array.isArray(v) ? v[0] : v;
      return (PRODUCT_SORTS as readonly string[]).includes(value ?? '') ? (value as ProductSort) : 'featured';
    }),
  page: optionalInt(1000).transform((v) => (v && v >= 1 ? v : 1)),
  pageSize: optionalInt(48).transform((v) => (v && v >= 1 ? v : 12)),
});
export type ProductQuery = z.infer<typeof productQuerySchema>;

export function parseProductQuery(params: Record<string, string | string[] | undefined> | URLSearchParams): ProductQuery {
  let input: Record<string, string | string[]> = {};
  if (params instanceof URLSearchParams) {
    for (const key of new Set(params.keys())) {
      const all = params.getAll(key);
      input[key] = all.length > 1 ? all : all[0]!;
    }
  } else {
    input = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)) as Record<
      string,
      string | string[]
    >;
  }
  const parsed = productQuerySchema.safeParse(input);
  return parsed.success ? parsed.data : productQuerySchema.parse({});
}
