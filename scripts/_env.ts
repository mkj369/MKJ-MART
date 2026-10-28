/**
 * Shared bootstrap for CLI scripts: loads .env files the same way Next.js does.
 * Import this first in every script.
 */
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('✖ DATABASE_URL is not set. Copy .env.example to .env.local first (see README).');
    process.exit(1);
  }
  return url;
}

export function describeDatabase(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

export function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1) return process.argv[index + 1];
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}
