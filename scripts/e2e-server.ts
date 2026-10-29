/**
 * Starts the app for Playwright against an isolated, freshly seeded database.
 *
 *   npm run build && npm run test:e2e      (Playwright launches this script automatically)
 *
 * E2E_DATABASE_URL defaults to DATABASE_URL with the database renamed to "mkj_e2e".
 * The database is dropped and recreated on every run — never point it at real data.
 * Demo accounts use E2E_DEMO_PASSWORD (generated per run by playwright.config.ts); outgoing email
 * goes to a local mail catcher so tests can follow real password-reset links.
 */
import { requireDatabaseUrl } from './_env';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const SMTP_PORT = Number(process.env.E2E_SMTP_PORT ?? 3125);
const MAIL_HTTP_PORT = Number(process.env.E2E_MAIL_HTTP_PORT ?? 3126);

async function main() {
  const base = new URL(process.env.E2E_DATABASE_URL ?? requireDatabaseUrl());
  if (!process.env.E2E_DATABASE_URL) base.pathname = '/mkj_e2e';
  const dbName = base.pathname.slice(1);
  if (!/^mkj_e2e/.test(dbName)) throw new Error(`Refusing to reset "${dbName}": E2E database names must start with mkj_e2e.`);

  const adminUrl = new URL(base);
  adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const pool = new Pool({ connectionString: base.toString(), max: 1 });
  await migrate(drizzle(pool), { migrationsFolder: path.resolve('drizzle') });
  await pool.end();

  const demoPassword = process.env.E2E_DEMO_PASSWORD;
  if (!demoPassword) throw new Error('E2E_DEMO_PASSWORD is not set (playwright.config.ts generates it).');
  const env = {
    ...process.env,
    DATABASE_URL: base.toString(),
    APP_URL: `http://localhost:${PORT}`,
    COOKIE_SECURE: 'false',
    PORT: String(PORT),
    DEMO_ACCOUNT_PASSWORD: demoPassword,
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(SMTP_PORT),
    SMTP_REQUIRE_TLS: 'false',
    SMTP_FROM: 'MKJ Store <orders@e2e.test>',
    MAIL_CATCHER_SMTP_PORT: String(SMTP_PORT),
    MAIL_CATCHER_HTTP_PORT: String(MAIL_HTTP_PORT),
  };
  const catcher = spawn('npx', ['tsx', 'scripts/mail-catcher.ts'], { env, stdio: 'inherit' });
  await new Promise<void>((resolve, reject) => {
    const seed = spawn('npx', ['tsx', '--conditions=react-server', 'scripts/seed.ts', '--demo'], { env, stdio: 'inherit' });
    seed.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`seed exited with ${code}`))));
  });

  // A production build with demo data is, by definition, a deliberate demo: DEMO_MODE=true.
  const server = spawn('npx', ['next', 'start', '-p', String(PORT)], { env: { ...env, NODE_ENV: 'production', DEMO_MODE: 'true' }, stdio: 'inherit' });
  const stop = () => {
    server.kill('SIGTERM');
    catcher.kill('SIGTERM');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  server.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error('✖ e2e server failed:', err);
  process.exit(1);
});
