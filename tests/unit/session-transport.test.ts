import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { headerSessionScript, headerSessionsEnabled, STORAGE_KEYS } from '@/lib/session-transport';

describe('headerSessionsEnabled (preview header fallback switch)', () => {
  it.each([
    [{}, false],
    [{ SESSION_HEADER_FALLBACK: 'true' }, false], // never without DEMO_MODE
    [{ DEMO_MODE: 'true' }, false],
    [{ SESSION_HEADER_FALLBACK: 'false', DEMO_MODE: 'true' }, false],
    [{ SESSION_HEADER_FALLBACK: 'true', DEMO_MODE: 'false' }, false],
    [{ SESSION_HEADER_FALLBACK: 'true', DEMO_MODE: 'true' }, true],
    [{ SESSION_HEADER_FALLBACK: '1', DEMO_MODE: 'YES' }, true],
  ])('%j → %s', (env, expected) => {
    expect(headerSessionsEnabled(env)).toBe(expected);
  });
});

/** Runs the inline <head> script in an isolated context with a stubbed fetch and sessionStorage. */
function boot(options: { storageThrows?: boolean; responseHeaders?: Record<string, string>; stored?: Record<string, string> } = {}) {
  const store = new Map<string, string>(Object.entries(options.stored ?? {}));
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
  };
  const calls: { url: string; headers: Headers }[] = [];
  const originalFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: input instanceof Request ? input.url : String(input), headers: new Headers(init?.headers) });
    return new Response('{}', { headers: options.responseHeaders ?? {} });
  };
  const win: Record<string, unknown> = { fetch: originalFetch };
  Object.defineProperty(win, 'sessionStorage', {
    get() {
      if (options.storageThrows) throw new Error('SecurityError: storage is disabled in this frame');
      return storage;
    },
  });
  const location = { href: 'https://shop.example/account', origin: 'https://shop.example' };
  vm.runInContext(headerSessionScript(), vm.createContext({ window: win, location, URL, Headers, Request, Response }));
  return { win, store, calls, originalFetch, fetch: win.fetch as typeof fetch };
}

describe('header-session script', () => {
  it('adds the stored session and bag to same-origin requests only', async () => {
    const env = boot({ stored: { [STORAGE_KEYS.session]: 'tok_'.padEnd(43, 'x'), [STORAGE_KEYS.cart]: '7f1c2b9e-0d7a-4c1e-9a55-3b2f1e0c4d6a' } });
    await env.fetch('/api/v1/auth/me');
    await env.fetch('https://shop.example/account?_rsc=1', { headers: { rsc: '1' } });
    await env.fetch('https://cdn.other.example/font.woff2');
    expect(env.calls[0]!.headers.get('x-mkj-session')).toBe('tok_'.padEnd(43, 'x'));
    expect(env.calls[0]!.headers.get('x-mkj-cart')).toBe('7f1c2b9e-0d7a-4c1e-9a55-3b2f1e0c4d6a');
    expect(env.calls[1]!.headers.get('rsc')).toBe('1'); // the caller's own headers are kept
    expect(env.calls[1]!.headers.get('x-mkj-session')).not.toBeNull();
    expect(env.calls[2]!.headers.get('x-mkj-session')).toBeNull(); // never leaks to other origins
  });

  it('stores values the server sends and forgets them on "-"', async () => {
    const signIn = boot({ responseHeaders: { 'x-mkj-set-session': 'new_'.padEnd(43, 'y'), 'x-mkj-set-cart': '-' }, stored: { [STORAGE_KEYS.cart]: 'old-cart' } });
    await signIn.fetch('/api/v1/auth/login', { method: 'POST' });
    expect(signIn.store.get(STORAGE_KEYS.session)).toBe('new_'.padEnd(43, 'y'));
    expect(signIn.store.has(STORAGE_KEYS.cart)).toBe(false);

    const signOut = boot({ responseHeaders: { 'x-mkj-set-session': '-' }, stored: { [STORAGE_KEYS.session]: 'old' } });
    await signOut.fetch('/api/v1/auth/logout', { method: 'POST' });
    expect(signOut.store.has(STORAGE_KEYS.session)).toBe(false);
  });

  it('does nothing when the frame has no usable storage', () => {
    const env = boot({ storageThrows: true });
    expect(env.fetch).toBe(env.originalFetch);
    expect(env.win.__mkjHeaderSessions).toBeUndefined();
  });
});
