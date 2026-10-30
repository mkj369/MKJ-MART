import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { route } from '@/server/http/api';

export const dynamic = 'force-dynamic';

/** Liveness + database connectivity probe for load balancers and uptime monitors. */
export const GET = route(async () => {
  const started = Date.now();
  await db.execute(sql`select 1`);
  return { status: 'ok', database: 'up', latencyMs: Date.now() - started, time: new Date().toISOString() };
});
