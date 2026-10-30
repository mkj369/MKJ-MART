import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/server/db';
import { carts, sessions, users } from '@/server/db/schema';
import { createSession, validateSessionToken } from '@/server/auth/session';
import { login, registerCustomer } from '@/server/services/auth';
import { changePassword } from '@/server/services/account';
import { addToCart, ensureCart, getCartView, mergeGuestCartIntoUser, updateCartItem } from '@/server/services/cart';
import { updateCustomer } from '@/server/services/admin/customers';
import { AppError } from '@/server/errors';
import { sha256Hex } from '@/server/auth/tokens';
import { createProduct, createUser, seedReferenceData, uid } from '../support/fixtures';

const meta = () => ({ ipAddress: `10.0.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`, userAgent: 'vitest' });

async function errorCode(promise: Promise<unknown>) {
  try {
    await promise;
    return null;
  } catch (e) {
    return e instanceof AppError ? e.code : String(e);
  }
}

beforeAll(async () => {
  await seedReferenceData();
});

describe('registration & sign-in', () => {
  it('registers a customer, stores only a password hash and a hashed session id', async () => {
    const email = `new-${uid()}@example.test`;
    const result = await registerCustomer({ name: 'Nusrat Jahan', email, phone: '01911000003', password: 'Secret123' }, meta());
    expect(result.user).toMatchObject({ email, role: 'customer' });
    const [row] = await db.select().from(users).where(eq(users.email, email));
    expect(row!.passwordHash).toMatch(/^scrypt\$/);
    expect(row!.passwordHash).not.toContain('Secret123');
    const [session] = await db.select().from(sessions).where(eq(sessions.userId, row!.id));
    expect(session!.id).toBe(sha256Hex(result.token));
    expect(session!.id).not.toBe(result.token);
  });

  it('rejects duplicate emails with a field error', async () => {
    const email = `dup-${uid()}@example.test`;
    await registerCustomer({ name: 'First User', email, phone: undefined, password: 'Secret123' }, meta());
    try {
      await registerCustomer({ name: 'Second User', email, phone: undefined, password: 'Secret123' }, meta());
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).fields?.email).toMatch(/already exists/);
    }
  });

  it('uses one generic error for unknown emails and wrong passwords', async () => {
    const { user } = await createUser({ password: 'Right123' });
    expect(await errorCode(login({ email: user.email, password: 'Wrong123' }, meta()))).toBe('INVALID_CREDENTIALS');
    expect(await errorCode(login({ email: `nobody-${uid()}@example.test`, password: 'Wrong123' }, meta()))).toBe('INVALID_CREDENTIALS');
    const ok = await login({ email: user.email, password: 'Right123' }, meta());
    expect(ok.user.id).toBe(user.id);
  });

  it('locks an account after repeated failures (brute-force protection)', async () => {
    const { user } = await createUser({ password: 'Right123' });
    for (let i = 0; i < 8; i++) await errorCode(login({ email: user.email, password: `Wrong${i}x` }, meta()));
    expect(await errorCode(login({ email: user.email, password: 'Right123' }, meta()))).toBe('RATE_LIMITED');
  });

  it('keeps customers out of the admin, even with the right password', async () => {
    const { user, password } = await createUser({ role: 'customer' });
    expect(await errorCode(login({ email: user.email, password }, meta(), 'admin'))).toBe('NOT_STAFF');
    const { user: staff, password: staffPassword } = await createUser({ role: 'staff' });
    expect((await login({ email: staff.email, password: staffPassword }, meta(), 'admin')).user.role).toBe('staff');
  });

  it('rejects blocked accounts at sign-in and invalidates their live sessions', async () => {
    const { user, password } = await createUser();
    const { token } = await createSession(user);
    expect(await validateSessionToken(token)).not.toBeNull();
    const { user: admin } = await createUser({ role: 'admin' });
    await updateCustomer(user.id, { status: 'blocked' }, { id: admin.id, role: 'admin' });
    expect(await validateSessionToken(token)).toBeNull();
    expect(await errorCode(login({ email: user.email, password }, meta()))).toBe('ACCOUNT_BLOCKED');
  });

  it('signs out other devices after a password change', async () => {
    const { user } = await createUser({ password: 'Old12345' });
    const current = await createSession(user);
    const other = await createSession(user);
    const currentId = sha256Hex(current.token);
    await changePassword(user.id, currentId, { currentPassword: 'Old12345', newPassword: 'New12345' });
    expect(await validateSessionToken(current.token)).not.toBeNull();
    expect(await validateSessionToken(other.token)).toBeNull();
    expect(await errorCode(changePassword(user.id, currentId, { currentPassword: 'wrong-pass1', newPassword: 'Newer1234' }))).toBe('VALIDATION_ERROR');
  });

  it('protects the last administrator and forbids self-demotion', async () => {
    const { user: admin } = await createUser({ role: 'admin' });
    await db.update(users).set({ role: 'customer' }).where(eq(users.role, 'admin'));
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin.id));
    const { user: other } = await createUser({ role: 'admin' });
    await db.update(users).set({ role: 'customer' }).where(eq(users.id, other.id));
    expect(await errorCode(updateCustomer(admin.id, { role: 'customer' }, { id: admin.id, role: 'admin' }))).toBe('SELF_EDIT');
    const { user: admin2 } = await createUser({ role: 'admin' });
    await updateCustomer(admin.id, { role: 'staff' }, { id: admin2.id, role: 'admin' });
    expect(await errorCode(updateCustomer(admin2.id, { status: 'blocked' }, { id: admin.id, role: 'staff' }))).toBe('FORBIDDEN');
  });
});

describe('cart', () => {
  it('caps quantities at available stock and the per-item limit', async () => {
    const { variants } = await createProduct({ stock: { M: 3 } });
    const { cartId } = await ensureCart({ userId: null, guestCartId: null });
    await addToCart(cartId, variants.M!.id, 2);
    expect(await errorCode(addToCart(cartId, variants.M!.id, 2))).toBe('INSUFFICIENT_STOCK');
    const view = await getCartView(cartId);
    expect(view.itemCount).toBe(2);
    expect(await errorCode(updateCartItem(cartId, view.lines[0]!.id, 4))).toBe('INSUFFICIENT_STOCK');
    await updateCartItem(cartId, view.lines[0]!.id, 0);
    expect((await getCartView(cartId)).lines).toHaveLength(0);
  });

  it('never accepts draft products', async () => {
    const { variants } = await createProduct({ status: 'draft' });
    const { cartId } = await ensureCart({ userId: null, guestCartId: null });
    expect(await errorCode(addToCart(cartId, variants.M!.id, 1))).toBe('NOT_FOUND');
  });

  it('prices lines from the live catalogue and flags lines that became unavailable', async () => {
    const { product, variants } = await createProduct({ price: 100_000, stock: { M: 5 } });
    const { cartId } = await ensureCart({ userId: null, guestCartId: null });
    await addToCart(cartId, variants.M!.id, 2);
    expect((await getCartView(cartId)).subtotal).toBe(200_000);
    const { products } = await import('@/server/db/schema');
    await db.update(products).set({ price: 120_000 }).where(eq(products.id, product.id));
    expect((await getCartView(cartId)).subtotal).toBe(240_000);
    await db.update(products).set({ status: 'archived' }).where(eq(products.id, product.id));
    const view = await getCartView(cartId);
    expect(view.lines[0]!.issue).toBe('unavailable');
    expect(view.hasIssues).toBe(true);
    expect(view.subtotal).toBe(0);
  });

  it('merges a guest cart into the account cart on sign-in', async () => {
    const { variants } = await createProduct({ stock: { M: 5, L: 5 } });
    const { user } = await createUser();
    const userCart = await ensureCart({ userId: user.id, guestCartId: null });
    await addToCart(userCart.cartId, variants.M!.id, 1);
    const guest = await ensureCart({ userId: null, guestCartId: null });
    await addToCart(guest.cartId, variants.M!.id, 2);
    await addToCart(guest.cartId, variants.L!.id, 1);
    await mergeGuestCartIntoUser(guest.cartId, user.id);
    const merged = await getCartView(userCart.cartId);
    expect(merged.lines.map((l) => [l.sizeLabel, l.quantity]).sort()).toEqual([
      ['L', 1],
      ['M', 3],
    ]);
    expect(await db.select().from(carts).where(eq(carts.id, guest.cartId))).toHaveLength(0);
  });
});
