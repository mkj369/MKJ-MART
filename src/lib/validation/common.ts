import { z } from 'zod';
import { districtBelongsToDivision, isValidDivision } from '@/lib/bd-geo';
import { normalizeBdPhone } from '@/lib/phone';

export const emailSchema = z
  .string({ error: 'Email is required.' })
  .trim()
  .toLowerCase()
  .max(255, 'Email is too long.')
  .pipe(z.email({ error: 'Enter a valid email address.' }));

export const optionalEmailSchema = z
  .union([z.literal(''), emailSchema])
  .optional()
  .transform((value) => (value ? value : undefined));

export const phoneSchema = z
  .string({ error: 'Mobile number is required.' })
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizeBdPhone(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid Bangladeshi mobile number (01XXXXXXXXX).' });
      return z.NEVER;
    }
    return normalized;
  });

export const optionalPhoneSchema = z
  .string()
  .trim()
  .optional()
  .transform((value, ctx) => {
    if (!value) return undefined;
    const normalized = normalizeBdPhone(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid Bangladeshi mobile number (01XXXXXXXXX).' });
      return z.NEVER;
    }
    return normalized;
  });

export const personNameSchema = z
  .string({ error: 'Name is required.' })
  .trim()
  .min(2, 'Enter your full name.')
  .max(120, 'Name is too long.');

export const passwordSchema = z
  .string({ error: 'Password is required.' })
  .min(8, 'Use at least 8 characters.')
  .max(128, 'Password is too long.')
  .regex(/[A-Za-z]/, 'Include at least one letter.')
  .regex(/\d/, 'Include at least one number.');

/** Staff/admin accounts: longer passwords, and never derived from the email address. */
export const ADMIN_PASSWORD_MIN = 12;
export function adminPasswordProblem(password: string, email?: string): string | null {
  if (password.length < ADMIN_PASSWORD_MIN) return `Use at least ${ADMIN_PASSWORD_MIN} characters.`;
  if (password.length > 128) return 'Password is too long.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Include at least one letter and one number.';
  const local = email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 3 && password.toLowerCase().includes(local)) return 'Do not include your email name in the password.';
  if (/^(.)\1+$/.test(password) || /^(password|admin|qwerty|123456)/i.test(password)) return 'Choose a less predictable password.';
  return null;
}

export const postalCodeSchema = z
  .string()
  .trim()
  .optional()
  .transform((value, ctx) => {
    if (!value) return undefined;
    if (!/^\d{4}$/.test(value)) {
      ctx.addIssue({ code: 'custom', message: 'Postal codes in Bangladesh have 4 digits.' });
      return z.NEVER;
    }
    return value;
  });

/** Shipping address fields (recipient name/phone are captured separately at checkout). */
export const addressFieldsSchema = z.object({
  addressLine: z
    .string({ error: 'Address is required.' })
    .trim()
    .min(5, 'Enter house, road and area details.')
    .max(300, 'Address is too long.'),
  area: z
    .string({ error: 'Area is required.' })
    .trim()
    .min(2, 'Enter your area or thana / upazila.')
    .max(120, 'Area is too long.'),
  division: z.string({ error: 'Select a division.' }).refine(isValidDivision, 'Select a division.'),
  district: z.string({ error: 'Select a district.' }).min(1, 'Select a district.'),
  postalCode: postalCodeSchema,
});

export function refineDistrict<T extends { district: string; division: string }>(value: T, ctx: z.RefinementCtx) {
  if (!districtBelongsToDivision(value.district, value.division)) {
    ctx.addIssue({ code: 'custom', path: ['district'], message: 'Select a district within the chosen division.' });
  }
}

/** Only our own media paths are accepted as image URLs (prevents hot-linking/SSRF via the optimiser). */
export const imageUrlSchema = z
  .string()
  .trim()
  .max(500)
  .regex(/^\/(images|media)\/[A-Za-z0-9/_\-.]+$/, 'Use an uploaded image.')
  .refine((value) => !value.includes('..'), 'Invalid image path.');

export const uuidSchema = z.uuid({ error: 'Invalid identifier.' });

/** Converts zod issues into a flat `{ "field.path": "message" }` map for forms. */
export function zodFieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_form';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}
