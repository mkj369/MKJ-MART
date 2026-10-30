import 'server-only';
import { lt, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { rateLimits } from '@/server/db/schema';
import { tooManyRequests } from '@/server/errors';

export type RateLimitResult = { ok: boolean; count: number; remaining: number; resetAt: Date };

/**
 * Fixed-window counter stored in PostgreSQL, so limits hold across multiple app instances.
 * A single atomic upsert per call; no read-modify-write race.
 */
export async function hitRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const result = await db.execute<{ count: number; reset_at: Date }>(sql`
    INSERT INTO ${rateLimits} (key, count, reset_at)
    VALUES (${key}, 1, now() + make_interval(secs => ${windowSeconds}))
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN ${rateLimits.resetAt} <= now() THEN 1 ELSE ${rateLimits.count} + 1 END,
      reset_at = CASE WHEN ${rateLimits.resetAt} <= now()
        THEN now() + make_interval(secs => ${windowSeconds}) ELSE ${rateLimits.resetAt} END
    RETURNING count, reset_at
  `);
  const row = result.rows[0]!;
  const count = Number(row.count);
  if (Math.random() < 0.02) {
    await db.delete(rateLimits).where(lt(rateLimits.resetAt, new Date()));
  }
  return { ok: count <= limit, count, remaining: Math.max(0, limit - count), resetAt: new Date(row.reset_at) };
}

/** Throws a 429 AppError when the limit is exceeded. */
export async function enforceRateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const result = await hitRateLimit(key, limit, windowSeconds);
  if (!result.ok) {
    throw tooManyRequests(Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)));
  }
}

export async function resetRateLimit(key: string): Promise<void> {
  await db.execute(sql`DELETE FROM ${rateLimits} WHERE key = ${key}`);
}
