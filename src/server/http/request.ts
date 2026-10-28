import 'server-only';
import { appUrl } from '@/server/env';

/**
 * Client IP for rate limiting. Behind N trusted reverse proxies (TRUST_PROXY=N, or "true" = 1),
 * the right-most N-th X-Forwarded-For entry is the address the outermost trusted proxy saw.
 * Without a trusted proxy the header is client-controlled, so the value is best-effort only;
 * per-account limits still apply in that case.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for');
  const entries = forwarded ? forwarded.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const raw = process.env.TRUST_PROXY?.toLowerCase();
  const hops = raw === 'true' ? 1 : Number.isInteger(Number(raw)) ? Number(raw) : 0;
  let ip: string | undefined;
  if (hops > 0 && entries.length >= hops) ip = entries[entries.length - hops];
  else ip = entries[0] ?? headers.get('x-real-ip') ?? undefined;
  return ip ? ip.slice(0, 64) : null;
}

export function userAgent(headers: Headers): string | null {
  return headers.get('user-agent')?.slice(0, 300) ?? null;
}

/**
 * CSRF defence for cookie-authenticated mutations. Browsers always send `Sec-Fetch-Site` and/or
 * `Origin` on cross-origin requests, which attackers cannot forge. Requests without either header
 * come from non-browser clients, which cannot ride a victim's cookies.
 */
export function isSameOriginRequest(headers: Headers): boolean {
  const fetchSite = headers.get('sec-fetch-site');
  if (fetchSite) return fetchSite === 'same-origin' || fetchSite === 'none';
  const origin = headers.get('origin');
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const allowed = new Set<string>();
  try {
    allowed.add(new URL(appUrl()).host);
  } catch {
    /* ignore */
  }
  const host = headers.get('host');
  if (host) allowed.add(host);
  const forwardedHost = headers.get('x-forwarded-host');
  if (forwardedHost) allowed.add(forwardedHost.split(',')[0]!.trim());
  return allowed.has(originHost);
}
