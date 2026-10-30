/**
 * Bangladeshi mobile numbers: 11 digits, starting 013–019 (operators: GP, Robi, Airtel,
 * Banglalink, Teletalk). Stored in the canonical local form "01XXXXXXXXX".
 */
export const BD_MOBILE_REGEX = /^01[3-9]\d{8}$/;

/** Accepts "+880 1712-345678", "8801712345678", "01712345678" … → "01712345678" or null. */
export function normalizeBdPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = input.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('880')) digits = digits.slice(2); // keep the leading 0
  else if (digits.startsWith('88') && digits.length === 13) digits = digits.slice(2);
  return BD_MOBILE_REGEX.test(digits) ? digits : null;
}

/** "01712345678" → "01712-345678" (display only). */
export function formatBdPhone(phone: string): string {
  return BD_MOBILE_REGEX.test(phone) ? `${phone.slice(0, 5)}-${phone.slice(5)}` : phone;
}

/** Masks a phone for public order tracking: "01712345678" → "017•••••678". */
export function maskPhone(phone: string): string {
  if (phone.length < 6) return '•••';
  return `${phone.slice(0, 3)}${'•'.repeat(phone.length - 6)}${phone.slice(-3)}`;
}
