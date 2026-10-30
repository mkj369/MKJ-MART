import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';

/** Requires `Authorization: Bearer <CRON_SECRET>`; cron endpoints are disabled when no secret is set. */
export function authorizeCron(req: NextRequest, secret: string | null): NextResponse | null {
  if (!secret) {
    return NextResponse.json({ error: { code: 'CRON_DISABLED', message: 'Set CRON_SECRET to enable scheduled jobs.' } }, { status: 503 });
  }
  const header = req.headers.get('authorization') ?? '';
  const provided = Buffer.from(header.replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid cron secret.' } }, { status: 401 });
  }
  return null;
}
