/**
 * Creates (or promotes) a REAL administrator account.
 *
 *   npm run admin:create -- --email owner@yourstore.com --name "Store Owner" --password 'a-long-unique-passphrase'
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run admin:create
 *
 * Existing accounts with that email are promoted to admin, re-activated, and get the new password.
 */
import { argValue, requireDatabaseUrl } from './_env';
import { eq } from 'drizzle-orm';
import { closeDb, db } from '@/server/db';
import { users } from '@/server/db/schema';
import { hashPassword } from '@/server/auth/password';
import { invalidateUserSessions } from '@/server/auth/session';
import { emailSchema, passwordSchema } from '@/lib/validation/common';

async function main() {
  requireDatabaseUrl();
  const email = emailSchema.safeParse(argValue('email') ?? process.env.ADMIN_EMAIL ?? '');
  const password = passwordSchema.safeParse(argValue('password') ?? process.env.ADMIN_PASSWORD ?? '');
  const name = (argValue('name') ?? process.env.ADMIN_NAME ?? 'Store Owner').trim();
  if (!email.success) throw new Error('Provide a valid --email (or ADMIN_EMAIL).');
  if (!password.success) throw new Error(`Password rejected: ${password.error.issues[0]?.message}`);
  if (password.data.length < 12) console.warn('⚠ Consider a passphrase of 12+ characters for admin accounts.');

  const passwordHash = await hashPassword(password.data);
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email.data)).limit(1);
  if (existing) {
    await db.update(users).set({ role: 'admin', status: 'active', passwordHash, name, isDemo: false }).where(eq(users.id, existing.id));
    await invalidateUserSessions(existing.id);
    console.log(`✔ Updated ${email.data}: role=admin, password reset, other sessions signed out.`);
  } else {
    await db.insert(users).values({ email: email.data, name, role: 'admin', passwordHash });
    console.log(`✔ Created administrator ${email.data}. Sign in at /admin/login.`);
  }
}

main()
  .catch((err) => {
    console.error('✖', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
