import 'server-only';
import { asc, eq } from 'drizzle-orm';
import { db, type DbOrTx } from '@/server/db';
import { shippingZones } from '@/server/db/schema';

export type ShippingZone = typeof shippingZones.$inferSelect;

export async function listActiveZones(tx: DbOrTx = db): Promise<ShippingZone[]> {
  return tx
    .select()
    .from(shippingZones)
    .where(eq(shippingZones.isActive, true))
    .orderBy(asc(shippingZones.sortOrder), asc(shippingZones.name));
}

/** A district maps to the zone that lists it; otherwise to the default (catch-all) zone. */
export function resolveZone(zones: ShippingZone[], district: string | null | undefined): ShippingZone | null {
  const active = zones.filter((z) => z.isActive);
  if (district) {
    const match = active.find((z) => z.districts.includes(district));
    if (match) return match;
  }
  return active.find((z) => z.isDefault) ?? null;
}

/**
 * Delivery fee for a zone. Free when the merchandise total (after discounts) reaches the
 * configured threshold.
 */
export function shippingFeeFor(
  zone: Pick<ShippingZone, 'fee'>,
  merchandiseTotal: number,
  freeShippingThreshold: number | null,
): { fee: number; free: boolean } {
  if (freeShippingThreshold !== null && merchandiseTotal >= freeShippingThreshold) return { fee: 0, free: true };
  return { fee: zone.fee, free: false };
}
