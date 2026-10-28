import 'server-only';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing with scrypt (memory-hard, built into Node — no native add-ons).
 * Production parameters follow OWASP's equivalence table: N=2^15, r=8, p=3 (~32 MiB).
 * Hashes are self-describing (`scrypt$N$r$p$salt$hash`) so parameters can be raised later and old
 * hashes upgraded transparently on login (see `needsRehash`).
 */
const PRODUCTION_PARAMS = { N: 2 ** 15, r: 8, p: 3 };
// Tests use a cheaper cost so the suite stays fast; stored hashes still carry their parameters.
const TEST_PARAMS = { N: 2 ** 12, r: 8, p: 1 };
const KEY_LENGTH = 64;

function currentParams() {
  return process.env.NODE_ENV === 'test' ? TEST_PARAMS : PRODUCTION_PARAMS;
}

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password.normalize('NFKC'), salt, keylen, options, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

function maxmem(N: number, r: number, p: number) {
  return 128 * N * r * p + 32 * 1024 * 1024;
}

export async function hashPassword(password: string): Promise<string> {
  const { N, r, p } = currentParams();
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, { N, r, p, maxmem: maxmem(N, r, p) });
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (![N, r, p].every((v) => Number.isInteger(v) && v > 0)) return false;
  const expected = Buffer.from(hashB64!, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64!, 'base64'), expected.length, {
    N,
    r,
    p,
    maxmem: maxmem(N, r, p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function needsRehash(stored: string): boolean {
  const { N, r, p } = currentParams();
  const [, nStr, rStr, pStr] = stored.split('$');
  return Number(nStr) !== N || Number(rStr) !== r || Number(pStr) !== p;
}

/**
 * A valid hash of a random password. Used when a login email does not exist so the response
 * takes as long as a real verification (prevents account enumeration by timing).
 */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}
