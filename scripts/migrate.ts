/**
 * Applies pending SQL migrations from ./drizzle to the database in DATABASE_URL.
 * Safe to run on every deploy: already-applied migrations are skipped (tracked in drizzle.__drizzle_migrations).
 *
 *   npm run db:migrate
 */
import { describeDatabase, requireDatabaseUrl } from './_env';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

async function main() {
  const url = requireDatabaseUrl();
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    console.log(`→ Applying migrations to ${describeDatabase(url)} …`);
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
    console.log('✔ Database schema is up to date.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('✖ Migration failed:', err);
  process.exit(1);
});
