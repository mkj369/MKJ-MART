/**
 * Per-test-file database: cloned from the migrated template so every file starts from an empty,
 * fully migrated schema and files can run in parallel without interfering.
 */
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, inject } from 'vitest';

const TEMPLATE_DB = 'mkj_test_template';
const adminUrl = inject('pgAdminUrl');
const dbName = `mkj_test_${randomBytes(5).toString('hex')}`;

beforeAll(async () => {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}" TEMPLATE "${TEMPLATE_DB}"`);
  await admin.end();
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  process.env.DATABASE_URL = url.toString();
});

afterAll(async () => {
  const { closeDb } = await import('@/server/db');
  await closeDb();
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.end();
});
