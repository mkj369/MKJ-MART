import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema> & { $client: Pool };
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Services accept either the root connection or an open transaction so they can be composed. */
export type DbOrTx = Database | Transaction;

type DbCache = { url: string; db: Database; pool: Pool };
const globalForDb = globalThis as unknown as { __mkjDb?: DbCache };

function poolConfig(url: string): PoolConfig {
  return {
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'mkj-mart',
  };
}

/**
 * Returns the shared Drizzle instance, creating the pool lazily on first use.
 * Lazy creation keeps `next build` and tooling from opening connections at import time, and lets
 * tests point DATABASE_URL at an isolated database before the first query.
 */
export function getDb(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and configure PostgreSQL (see README).',
    );
  }
  const cached = globalForDb.__mkjDb;
  if (cached && cached.url === url) return cached.db;
  if (cached) void cached.pool.end().catch(() => undefined);

  const pool = new Pool(poolConfig(url));
  pool.on('error', (err) => console.error('[db] idle client error', err));
  const db = drizzle({ client: pool, schema }) as Database;
  globalForDb.__mkjDb = { url, db, pool };
  return db;
}

/** Convenience proxy so modules can `import { db }` while still benefiting from lazy creation. */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<PropertyKey, unknown>;
    const value = real[prop];
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
});

export async function closeDb(): Promise<void> {
  const cached = globalForDb.__mkjDb;
  globalForDb.__mkjDb = undefined;
  if (cached) await cached.pool.end();
}

export { schema };
