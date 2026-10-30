import 'server-only';
import { asc, eq, ne } from 'drizzle-orm';
import { db } from '@/server/db';
import { shippingZones } from '@/server/db/schema';
import { conflict, notFound, validationError } from '@/server/errors';
import type { ShippingZoneInput } from '@/lib/validation/admin';

export async function listShippingZonesAdmin() {
  return db.select().from(shippingZones).orderBy(asc(shippingZones.sortOrder), asc(shippingZones.name));
}

/** Each district may belong to at most one zone; exactly one zone can be the catch-all default. */
export async function saveShippingZone(input: ShippingZoneInput, id?: string) {
  return db.transaction(async (tx) => {
    const others = await tx.select().from(shippingZones).where(id ? ne(shippingZones.id, id) : undefined);
    const overlaps = input.districts.filter((d) => others.some((z) => z.districts.includes(d)));
    if (overlaps.length) {
      const owner = others.find((z) => z.districts.includes(overlaps[0]!));
      throw validationError({
        districts: `${overlaps.slice(0, 3).join(', ')}${overlaps.length > 3 ? '…' : ''} already belong to “${owner?.name}”.`,
      });
    }
    if (input.isDefault) await tx.update(shippingZones).set({ isDefault: false }).where(eq(shippingZones.isDefault, true));
    if (id) {
      const [row] = await tx.update(shippingZones).set(input).where(eq(shippingZones.id, id)).returning();
      if (!row) throw notFound('Delivery zone not found.');
      return row;
    }
    const [row] = await tx.insert(shippingZones).values(input).returning();
    return row!;
  });
}

export async function deleteShippingZone(id: string) {
  const [zone] = await db.select().from(shippingZones).where(eq(shippingZones.id, id)).limit(1);
  if (!zone) throw notFound('Delivery zone not found.');
  if (zone.isDefault) throw conflict('Make another zone the default before deleting this one.', 'DEFAULT_ZONE');
  await db.delete(shippingZones).where(eq(shippingZones.id, id));
}
