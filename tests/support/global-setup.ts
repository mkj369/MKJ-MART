/**
 * Integration-test database bootstrap (runs once per `vitest` run).
 *
 * - Uses TEST_DATABASE_URL when provided (CI / your own PostgreSQL; the role must be able to CREATE DATABASE),
 *   otherwise starts a throwaway embedded PostgreSQL on port 54329 (data in .data/postgres-test).
 * - Builds a migrated template database; every test file clones it (fast, fully isolated).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import EmbeddedPostgres from 'embedded-postgres';
import { Client, Pool } from 'pg';
import type { TestProject } from 'vitest/node';

export const TEMPLATE_DB = 'mkj_test_template';

declare module 'vitest' {
  export interface ProvidedContext {
    pgAdminUrl: string;
  }
}

export default async function setup(project: TestProject) {
  let adminUrl = process.env.TEST_DATABASE_URL;
  let embedded: EmbeddedPostgres | null = null;

  if (!adminUrl) {
    const port = 54329;
    const dataDir = path.resolve('.data/postgres-test');
    embedded = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port, persistent: true, onLog: () => undefined, onError: () => undefined });
    if (!existsSync(path.join(dataDir, 'PG_VERSION'))) await embedded.initialise();
    await embedded.start();
    adminUrl = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  }

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  // Remove leftovers from interrupted runs.
  const stale = await admin.query<{ datname: string }>(`SELECT datname FROM pg_database WHERE datname LIKE 'mkj_test_%'`);
  for (const { datname } of stale.rows) {
    await admin.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
  }
  await admin.query(`CREATE DATABASE "${TEMPLATE_DB}"`);
  await admin.end();

  const templateUrl = new URL(adminUrl);
  templateUrl.pathname = `/${TEMPLATE_DB}`;
  const pool = new Pool({ connectionString: templateUrl.toString(), max: 1 });
  await migrate(drizzle(pool), { migrationsFolder: path.resolve('drizzle') });
  await pool.end();

  project.provide('pgAdminUrl', adminUrl);

  return async () => {
    const cleanup = new Client({ connectionString: adminUrl });
    await cleanup.connect();
    const dbs = await cleanup.query<{ datname: string }>(`SELECT datname FROM pg_database WHERE datname LIKE 'mkj_test_%'`);
    for (const { datname } of dbs.rows) await cleanup.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    await cleanup.end();
    if (embedded) await embedded.stop();
  };
}
