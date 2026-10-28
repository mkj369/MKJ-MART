/**
 * Money handling for MKJ MART.
 *
 * Convention: every monetary value in the database, services and API is an INTEGER number of
 * poisha (1 BDT = 100 poisha). This avoids floating-point rounding errors. Convert only at the
 * edges: when rendering (formatBDT) and when parsing admin input (takaToPoisha).
 */

export const CURRENCY = 'BDT' as const;
export const TAKA_SIGN = '৳';

const groupFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const decimalFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 125000 → "৳1,250"; 125050 → "৳1,250.50". Negative values render as "−৳500". */
export function formatBDT(poisha: number, options: { forceDecimals?: boolean } = {}): string {
  if (!Number.isFinite(poisha)) return `${TAKA_SIGN}0`;
  const negative = poisha < 0;
  const abs = Math.abs(Math.round(poisha));
  const taka = abs / 100;
  const hasFraction = abs % 100 !== 0;
  const body =
    hasFraction || options.forceDecimals ? decimalFormatter.format(taka) : groupFormatter.format(taka);
  return `${negative ? '−' : ''}${TAKA_SIGN}${body}`;
}

/**
 * Parses a taka amount (number or user-entered string like "1,250.50") into integer poisha.
 * Returns null for invalid, negative or over-precise input.
 */
export function takaToPoisha(value: number | string): number | null {
  const raw = typeof value === 'number' ? String(value) : value.replace(/[,\s৳]/g, '').replace(/^BDT/i, '');
  if (raw === '' || !/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  const poisha = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(poisha) ? poisha : null;
}

/** 125050 → 1250.5 (for display inputs). */
export function poishaToTaka(poisha: number): number {
  return Math.round(poisha) / 100;
}

/** 125050 → "1250.50" — the exact decimal string payment gateways expect. */
export function poishaToDecimalString(poisha: number): string {
  const abs = Math.abs(Math.round(poisha));
  const sign = poisha < 0 ? '-' : '';
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Percentage saved between a compare-at price and the selling price, rounded down. */
export function discountPercent(price: number, compareAtPrice: number | null | undefined): number {
  if (!compareAtPrice || compareAtPrice <= price) return 0;
  return Math.floor(((compareAtPrice - price) / compareAtPrice) * 100);
}
