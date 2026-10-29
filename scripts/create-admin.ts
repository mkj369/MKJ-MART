/**
 * Creates (or promotes / resets) a REAL administrator account — the safe first-admin procedure.
 *
 *   npm run admin:create -- --email owner@yourstore.com --name "Store Owner"
 *       → prompts for the password twice (hidden input)
 *
 *   printf '%s' "$ADMIN_PASSWORD" | npm run admin:create -- --email owner@yourstore.com --password-stdin
 *       → non-interactive (CI / provisioning). Prefer a secret manager over shell variables.
 *
 * Passwords are never accepted as a command-line argument (they would end up in shell history and
 * be visible to other users via `ps`). Admin passwords need 12+ characters with letters and numbers.
 * An existing account with that email is promoted to admin, re-activated, gets the new password and
 * is signed out everywhere. With Docker:  docker compose run --rm tools npm run admin:create -- --email …
 */
import { argValue, hasFlag, requireDatabaseUrl } from './_env';
import { createInterface } from 'node:readline';
import { eq } from 'drizzle-orm';
import { closeDb, db } from '@/server/db';
import { users } from '@/server/db/schema';
import { hashPassword } from '@/server/auth/password';
import { invalidateUserSessions } from '@/server/auth/session';
import { adminPasswordProblem, emailSchema } from '@/lib/validation/common';

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')));
    process.stdin.on('error', reject);
  });
}

/** Reads a line from the TTY without echoing it. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let muted = false;
    output._writeToOutput = (s: string) => {
      if (!muted || s.includes(question)) output.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  requireDatabaseUrl();
  if (argValue('password') !== undefined) {
    throw new Error('Do not pass the password on the command line. Run without --password to be prompted, or use --password-stdin.');
  }
  const email = emailSchema.safeParse(argValue('email') ?? process.env.ADMIN_EMAIL ?? '');
  if (!email.success) throw new Error('Provide a valid --email (or ADMIN_EMAIL).');
  const name = (argValue('name') ?? process.env.ADMIN_NAME ?? 'Store Owner').trim().slice(0, 120) || 'Store Owner';

  let password: string;
  if (hasFlag('password-stdin')) {
    password = await readStdin();
  } else if (process.stdin.isTTY) {
    password = await promptHidden(`New password for ${email.data}: `);
    const again = await promptHidden('Repeat the password: ');
    if (password !== again) throw new Error('The passwords did not match. Nothing was changed.');
  } else if (process.env.ADMIN_PASSWORD) {
    // Supported for automated provisioning; remove the variable from the environment afterwards.
    password = process.env.ADMIN_PASSWORD;
  } else {
    throw new Error('No password given. Run in a terminal to be prompted, or pipe it with --password-stdin.');
  }
  const problem = adminPasswordProblem(password, email.data);
  if (problem) throw new Error(`Password rejected: ${problem}`);

  const passwordHash = await hashPassword(password);
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email.data)).limit(1);
  if (existing) {
    await db.update(users).set({ role: 'admin', status: 'active', passwordHash, name, isDemo: false }).where(eq(users.id, existing.id));
    await invalidateUserSessions(existing.id);
    console.log(`✔ Updated ${email.data}: role=admin, password reset, all sessions signed out.`);
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
