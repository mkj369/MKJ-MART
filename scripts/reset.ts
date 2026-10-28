/**
 * DEVELOPMENT ONLY: drops every table in the database so it can be rebuilt from migrations.
 *
 *   npm run db:reset     # = reset + migrate + seed --demo
 */
import { describeDatabase, hasFlag, requireDatabaseUrl } from './_env';
import { Client } from 'pg';

async function main() {
  const url = requireDatabaseUrl();
  if (process.env.NODE_ENV === 'production' && !hasFlag('force')) {
    console.error('✖ Refusing to reset a database with NODE_ENV=production.');
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    console.log(`→ Dropping all data in ${describeDatabase(url)} …`);
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
    console.log('✔ Database emptied.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('✖ Reset failed:', err);
  process.exit(1);
});
