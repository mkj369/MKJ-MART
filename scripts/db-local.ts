/**
 * Runs a real PostgreSQL server locally WITHOUT Docker or a system install, using the
 * `embedded-postgres` npm package (official PostgreSQL binaries for macOS, Linux and Windows).
 *
 *   npm run db:local          # keeps running in the foreground; Ctrl+C to stop
 *
 * Connection details are read from DATABASE_URL (host must be localhost / 127.0.0.1), e.g.
 *   DATABASE_URL=postgres://mkj:mkj_local_dev@127.0.0.1:5433/mkj_mart
 * Data persists in ./.data/postgres (git-ignored). For production use a managed PostgreSQL.
 */
import { requireDatabaseUrl } from './_env';
import { existsSync } from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';

async function main() {
  const url = new URL(requireDatabaseUrl());
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    console.error(`✖ DATABASE_URL points to ${url.hostname}. db:local only runs a server on localhost.`);
    process.exit(1);
  }
  const port = Number(url.port || 5432);
  const user = decodeURIComponent(url.username || 'postgres');
  const password = decodeURIComponent(url.password || 'postgres');
  const database = url.pathname.replace(/^\//, '') || 'mkj_mart';
  const dataDir = path.resolve(process.env.LOCAL_PG_DATA_DIR ?? '.data/postgres');

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user,
    password,
    port,
    persistent: true,
    onLog: () => undefined,
    onError: (message: unknown) => {
      const text = String(message ?? '');
      if (/ERROR|FATAL|PANIC/.test(text)) console.error('[postgres]', text.trim());
    },
  });

  if (!existsSync(path.join(dataDir, 'PG_VERSION'))) {
    console.log(`→ Initialising a new PostgreSQL cluster in ${dataDir} …`);
    await pg.initialise();
  }
  await pg.start();

  const client = new Client({ host: '127.0.0.1', port, user, password, database: 'postgres' });
  await client.connect();
  const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
  if (exists.rowCount === 0) {
    await client.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
    console.log(`→ Created database "${database}".`);
  }
  await client.end();

  console.log(`✔ PostgreSQL is running on 127.0.0.1:${port} (database "${database}"). Press Ctrl+C to stop.`);

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log('\n→ Stopping PostgreSQL …');
    await pg.stop().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // Keep the process alive.
  setInterval(() => undefined, 1 << 30);
}

main().catch((err) => {
  console.error('✖ Could not start local PostgreSQL:', err);
  process.exit(1);
});
